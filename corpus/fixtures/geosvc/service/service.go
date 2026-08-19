package service

import (
	"errors"
	"fmt"
	"sync"

	"geosvc/config"
	"geosvc/geom"
	"geosvc/index"
	"geosvc/metrics"
	"geosvc/store"
	"geosvc/tile"
)

// ErrTooManyResults is returned when a query matches more features than the
// configured response cap allows.
var ErrTooManyResults = errors.New("service: query matched more features than the response cap")

// Service is the read/write facade over one indexed region.
type Service struct {
	cfg config.Config
	reg *metrics.Registry

	mu    sync.RWMutex
	store *store.MemStore
	ix    index.Index

	// features is the configured feature cache, selected by cache.kind.
	features index.FeatureCache
	// hot is a second, smaller feature cache dedicated to the ids that the
	// tile renderer touches on every pass. It is deliberately segmented: the
	// renderer scans whole tiles, and a plain recency list would let one scan
	// flush the ids the query endpoints depend on.
	hot *index.SegmentedCache
	// tiles caches materialised tiles under the configured byte budget.
	tiles *index.TileCache

	queries   *metrics.Counter
	cacheHits *metrics.Counter
	cacheMiss *metrics.Counter
}

// hotCacheDivisor sizes the renderer's dedicated cache as a fraction of the
// configured feature cache capacity.
const hotCacheDivisor = 8

// New builds a service from a validated configuration.
func New(cfg config.Config, reg *metrics.Registry) (*Service, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	ix, err := index.NewIndex(cfg.Index)
	if err != nil {
		return nil, err
	}
	fc, err := index.NewFeatureCache(cfg.Cache)
	if err != nil {
		return nil, err
	}
	hotSize := cfg.Cache.Entries / hotCacheDivisor
	if hotSize < 1 {
		hotSize = 1
	}
	s := &Service{
		cfg:      cfg,
		reg:      reg,
		store:    store.NewMemStore(cfg.Store),
		ix:       ix,
		features: fc,
		hot:      index.NewSegmentedCache(hotSize),
		tiles:    index.NewTileCacheFromConfig(cfg.Cache),
	}
	if reg != nil {
		s.queries = reg.Counter("queries_total")
		s.cacheHits = reg.Counter("feature_cache_hits_total")
		s.cacheMiss = reg.Counter("feature_cache_misses_total")
	}
	return s, nil
}

// Config returns the configuration the service was built with.
func (s *Service) Config() config.Config { return s.cfg }

// Put inserts or replaces a feature and keeps the index and caches coherent.
func (s *Service) Put(f *store.Feature) (created bool, err error) {
	if err := f.Validate(); err != nil {
		return false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	created, err = s.store.Upsert(f)
	if err != nil {
		return false, err
	}
	if err := s.ix.Insert(index.Entry{ID: f.ID, Layer: f.Layer, Box: f.Bounds()}); err != nil {
		return created, err
	}
	key := index.FeatureKey(f.Layer, f.ID)
	s.features.Invalidate(key)
	s.hot.Invalidate(key)
	b := f.Bounds()
	s.tiles.InvalidateBox(b.MinLat, b.MinLon, b.MaxLat, b.MaxLon)
	return created, nil
}

// Delete drops a feature and everything derived from it.
func (s *Service) Delete(layer, id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := s.store.Get(id)
	if err != nil {
		return false
	}
	if !s.store.Delete(id) {
		return false
	}
	s.ix.Remove(id)
	key := index.FeatureKey(layer, id)
	s.features.Invalidate(key)
	s.hot.Invalidate(key)
	b := f.Bounds()
	s.tiles.InvalidateBox(b.MinLat, b.MinLon, b.MaxLat, b.MaxLon)
	return true
}

// Get returns one feature, consulting the feature cache first.
func (s *Service) Get(layer, id string) (*store.Feature, error) {
	key := index.FeatureKey(layer, id)
	if f, ok := s.features.Get(key); ok {
		s.count(s.cacheHits)
		return f, nil
	}
	s.count(s.cacheMiss)
	s.mu.RLock()
	f, err := s.store.Get(id)
	s.mu.RUnlock()
	if err != nil {
		return nil, err
	}
	if f.Layer != layer {
		return nil, store.ErrNotFound
	}
	s.features.Put(key, f)
	return f, nil
}

// Query returns every feature in the layer whose bounds intersect the box,
// after the configured query buffer has been applied.
func (s *Service) Query(b geom.BBox, layer string) ([]*store.Feature, error) {
	if !b.Valid() {
		return nil, fmt.Errorf("service: query box %s is not valid", b)
	}
	buffered := geom.BufferMeters(b, s.cfg.Index.QueryBufferMeters)
	s.mu.RLock()
	var filter index.Filter
	if layer != "" {
		filter = index.LayerFilter(layer)
	}
	entries := index.SearchFiltered(s.ix, buffered, filter)
	s.mu.RUnlock()
	s.count(s.queries)

	if len(entries) > s.cfg.Server.MaxFeaturesPerResponse {
		return nil, ErrTooManyResults
	}
	out := make([]*store.Feature, 0, len(entries))
	for _, e := range entries {
		f, err := s.Get(e.Layer, e.ID)
		if err != nil {
			continue
		}
		out = append(out, f)
	}
	store.SortFeatures(out)
	return out, nil
}

// Tile materialises one tile, caching both the tile and the features it names.
func (s *Service) Tile(t tile.Tile) (*index.CachedTile, error) {
	if !t.Valid() {
		return nil, tile.ErrTileRange
	}
	if ct, ok := s.tiles.Get(t); ok {
		return ct, nil
	}
	box := t.Bounds()
	s.mu.RLock()
	entries := s.ix.Search(box)
	s.mu.RUnlock()

	ct := &index.CachedTile{Tile: t, Entries: entries}
	ct.Envelope.MinLat, ct.Envelope.MinLon = box.MinLat, box.MinLon
	ct.Envelope.MaxLat, ct.Envelope.MaxLon = box.MaxLat, box.MaxLon

	for _, e := range entries {
		key := index.FeatureKey(e.Layer, e.ID)
		if _, ok := s.hot.Get(key); ok {
			continue
		}
		s.mu.RLock()
		f, err := s.store.Get(e.ID)
		s.mu.RUnlock()
		if err != nil {
			continue
		}
		s.hot.Put(key, f)
	}
	s.tiles.Put(t, ct)
	return ct, nil
}

// Len returns the number of stored features.
func (s *Service) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.store.Len()
}

// IndexKind reports which index implementation is in use.
func (s *Service) IndexKind() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.ix.Kind()
}

// CacheStats returns the counters of all three caches, keyed by role.
func (s *Service) CacheStats() map[string]index.CacheStats {
	return map[string]index.CacheStats{
		"feature": s.features.Stats(),
		"hot":     s.hot.Stats(),
		"tile":    s.tiles.Stats(),
	}
}

// PurgeCaches drops every cached entry without touching stored state.
func (s *Service) PurgeCaches() {
	s.features.Purge()
	s.hot.Purge()
	s.tiles.Purge()
}

// Close releases the store's resources.
func (s *Service) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.store.Close()
}

func (s *Service) count(c *metrics.Counter) {
	if c != nil {
		c.Inc()
	}
}
