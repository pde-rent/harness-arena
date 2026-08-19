package index

import (
	"container/list"
	"sync"

	"geosvc/store"
	"geosvc/tile"
)

// TileEnvelopeBytes is the per-tile overhead of a cached tile: the tile
// coordinate, the envelope box, the encoded-payload slice header and the
// bookkeeping the cache keeps for it. It is charged once per cached tile,
// independently of how many features the tile holds.
const TileEnvelopeBytes = 128

// CachedTileBytes returns the memory one cached tile occupies when it holds
// featuresPerTile features: one FeatureIndexBytes per feature plus a single
// TileEnvelopeBytes envelope.
func CachedTileBytes(featuresPerTile int) int {
	if featuresPerTile < 0 {
		featuresPerTile = 0
	}
	return featuresPerTile*store.FeatureIndexBytes + TileEnvelopeBytes
}

// CachedTile is one materialised tile: the entries that fall inside it plus
// the box they were clipped to.
type CachedTile struct {
	Tile     tile.Tile
	Envelope struct{ MinLat, MinLon, MaxLat, MaxLon float64 }
	Entries  []Entry
}

type tileEntry struct {
	key   tile.Tile
	value *CachedTile
	size  int
}

// TileCache is a byte-budgeted LRU over materialised tiles. Unlike the feature
// caches it is bounded by memory rather than by entry count, because tiles vary
// wildly in size.
//
// The budget is a soft ceiling: a single tile larger than the whole budget is
// still admitted, and the cache then holds exactly that one tile.
type TileCache struct {
	mu     sync.Mutex
	budget int64
	items  map[tile.Tile]*list.Element
	order  *list.List
	used   int64
	stats  CacheStats
}

// NewTileCache returns a tile cache with the given byte budget. A non-positive
// budget is raised to one byte, which yields a cache holding a single tile.
func NewTileCache(budgetBytes int64) *TileCache {
	if budgetBytes < 1 {
		budgetBytes = 1
	}
	return &TileCache{
		budget: budgetBytes,
		items:  make(map[tile.Tile]*list.Element),
		order:  list.New(),
	}
}

// Budget returns the configured byte budget.
func (c *TileCache) Budget() int64 { return c.budget }

// Get returns the cached tile if it is resident.
func (c *TileCache) Get(t tile.Tile) (*CachedTile, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.items[t]
	if !ok {
		c.stats.Misses++
		return nil, false
	}
	c.order.MoveToFront(el)
	c.stats.Hits++
	return el.Value.(*tileEntry).value, true
}

// Put makes a tile resident, evicting least recently used tiles until the
// accounted size is back inside the budget.
func (c *TileCache) Put(t tile.Tile, ct *CachedTile) {
	c.mu.Lock()
	defer c.mu.Unlock()
	size := int64(CachedTileBytes(len(ct.Entries)))
	if el, ok := c.items[t]; ok {
		e := el.Value.(*tileEntry)
		c.used += size - int64(e.size)
		e.value, e.size = ct, int(size)
		c.order.MoveToFront(el)
		c.stats.Updates++
		return
	}
	el := c.order.PushFront(&tileEntry{key: t, value: ct, size: int(size)})
	c.items[t] = el
	c.used += size
	c.stats.Inserts++
	for c.used > c.budget && c.order.Len() > 1 {
		c.evictOldest()
	}
}

func (c *TileCache) evictOldest() {
	el := c.order.Back()
	if el == nil {
		return
	}
	e := el.Value.(*tileEntry)
	c.order.Remove(el)
	delete(c.items, e.key)
	c.used -= int64(e.size)
	c.stats.Evictions++
}

// Invalidate drops one tile and reports whether it was resident.
func (c *TileCache) Invalidate(t tile.Tile) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.items[t]
	if !ok {
		return false
	}
	e := el.Value.(*tileEntry)
	c.order.Remove(el)
	delete(c.items, t)
	c.used -= int64(e.size)
	return true
}

// InvalidateBox drops every resident tile whose bounds intersect the box and
// returns how many were dropped.
func (c *TileCache) InvalidateBox(minLat, minLon, maxLat, maxLon float64) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	dropped := 0
	for t, el := range c.items {
		b := t.Bounds()
		if b.MaxLat < minLat || b.MinLat > maxLat || b.MaxLon < minLon || b.MinLon > maxLon {
			continue
		}
		e := el.Value.(*tileEntry)
		c.order.Remove(el)
		delete(c.items, t)
		c.used -= int64(e.size)
		dropped++
	}
	return dropped
}

// Len returns the number of resident tiles.
func (c *TileCache) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.items)
}

// Bytes returns the accounted resident size.
func (c *TileCache) Bytes() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.used
}

// Stats returns a snapshot of the counters.
func (c *TileCache) Stats() CacheStats {
	c.mu.Lock()
	defer c.mu.Unlock()
	s := c.stats
	s.Entries = len(c.items)
	s.Bytes = int(c.used)
	return s
}

// Purge drops every resident tile.
func (c *TileCache) Purge() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items = make(map[tile.Tile]*list.Element)
	c.order.Init()
	c.used = 0
}
