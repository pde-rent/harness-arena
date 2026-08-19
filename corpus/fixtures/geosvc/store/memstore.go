package store

import (
	"errors"
	"fmt"
	"sort"
	"sync"

	"geosvc/config"
	"geosvc/geom"
)

// MemStore keeps every feature in memory behind a single reader/writer lock,
// optionally mirroring each mutation into an append log.
//
// It is the system of record for a process: the index packages hold ids and
// boxes, and come back here for the bodies. Nothing that crosses the API
// boundary shares memory with the map, so a caller can hold on to a returned
// feature for as long as it likes without observing later writes.
type MemStore struct {
	mu sync.RWMutex

	// byID holds the canonical copy of every live feature.
	byID map[string]*Feature
	// byLayer maps a layer to the ids it holds. It is kept in sync with byID
	// on every insert, update and delete, and never holds an id that byID has
	// dropped.
	byLayer map[string][]string

	// wal is nil when the store is memory only.
	wal *WAL

	maxFeatures  int
	compactRatio float64

	inserts int
	updates int
	deletes int
	appends int
	dropped int
}

// NewMemStore builds an empty store from a configuration.
//
// The store is memory only: cfg.Path is recorded so OpenLog can attach a log
// later, but no file is touched here, which keeps construction free of I/O
// errors. Attach a log with SetWAL or OpenLog when durability is wanted.
func NewMemStore(cfg config.StoreConfig) *MemStore {
	return &MemStore{
		byID:         make(map[string]*Feature),
		byLayer:      make(map[string][]string),
		maxFeatures:  cfg.MaxFeatures,
		compactRatio: cfg.CompactRatio,
	}
}

// SetWAL attaches an append log, replacing and closing any log already
// attached. Passing nil detaches logging.
func (s *MemStore) SetWAL(w *WAL) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	old := s.wal
	s.wal = w
	if old != nil && old != w {
		return old.Close()
	}
	return nil
}

// OpenLog opens the append log named by cfg.Path and attaches it. An empty
// path is not an error: it leaves the store memory only.
func (s *MemStore) OpenLog(cfg config.StoreConfig) error {
	if cfg.Path == "" {
		return nil
	}
	w, err := OpenWAL(cfg.Path, cfg.SyncEvery)
	if err != nil {
		return err
	}
	return s.SetWAL(w)
}

// Insert adds a feature that is not already present.
func (s *MemStore) Insert(f *Feature) error {
	if f == nil {
		return fmt.Errorf("store: insert: %w", errNilFeature)
	}
	if err := f.Validate(); err != nil {
		return fmt.Errorf("store: insert %q: %w", f.ID, err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.byID[f.ID]; ok {
		return fmt.Errorf("store: insert %q: %w", f.ID, ErrDuplicate)
	}
	if s.maxFeatures > 0 && len(s.byID) >= s.maxFeatures {
		return fmt.Errorf("store: insert %q: %d features: %w", f.ID, len(s.byID), ErrFull)
	}
	stored := f.Clone()
	s.byID[stored.ID] = stored
	s.addToLayer(stored.Layer, stored.ID)
	s.inserts++
	return s.appendLocked(Record{Kind: RecordInsert, ID: stored.ID, Feature: stored})
}

// Update replaces an existing feature and bumps its version.
//
// The version stored is one more than the version currently held, not one more
// than the version on the argument, so a caller that round-trips a stale copy
// cannot rewind the counter.
func (s *MemStore) Update(f *Feature) error {
	if f == nil {
		return fmt.Errorf("store: update: %w", errNilFeature)
	}
	if err := f.Validate(); err != nil {
		return fmt.Errorf("store: update %q: %w", f.ID, err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	prev, ok := s.byID[f.ID]
	if !ok {
		return fmt.Errorf("store: update %q: %w", f.ID, ErrNotFound)
	}
	stored := f.Clone()
	stored.Version = prev.Version + 1
	if prev.Layer != stored.Layer {
		s.removeFromLayer(prev.Layer, prev.ID)
		s.addToLayer(stored.Layer, stored.ID)
	}
	s.byID[stored.ID] = stored
	s.updates++
	return s.appendLocked(Record{Kind: RecordUpdate, ID: stored.ID, Feature: stored})
}

// Upsert inserts the feature when its id is new and replaces it otherwise,
// reporting which of the two happened.
func (s *MemStore) Upsert(f *Feature) (bool, error) {
	if f == nil {
		return false, fmt.Errorf("store: upsert: %w", errNilFeature)
	}
	s.mu.RLock()
	_, exists := s.byID[f.ID]
	s.mu.RUnlock()
	if exists {
		if err := s.Update(f); err != nil {
			return false, err
		}
		return false, nil
	}
	err := s.Insert(f)
	switch {
	case err == nil:
		return true, nil
	case errors.Is(err, ErrDuplicate):
		// Lost the race to another writer; the caller asked for the value to
		// be present, so finish as an update.
		if err := s.Update(f); err != nil {
			return false, err
		}
		return false, nil
	default:
		return false, err
	}
}

// Get returns a copy of one feature.
func (s *MemStore) Get(id string) (*Feature, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	f, ok := s.byID[id]
	if !ok {
		return nil, fmt.Errorf("store: get %q: %w", id, ErrNotFound)
	}
	return f.Clone(), nil
}

// Has reports whether an id is present without copying the feature.
func (s *MemStore) Has(id string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.byID[id]
	return ok
}

// Delete removes a feature, reporting whether it was present.
//
// A failure to append the deletion to the log does not resurrect the feature:
// the in-memory state is authoritative for this process, and the log is
// repaired by compaction.
func (s *MemStore) Delete(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, ok := s.byID[id]
	if !ok {
		return false
	}
	delete(s.byID, id)
	s.removeFromLayer(f.Layer, id)
	s.deletes++
	_ = s.appendLocked(Record{Kind: RecordDelete, ID: id})
	return true
}

// Len returns the number of live features.
func (s *MemStore) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.byID)
}

// All returns copies of every feature, ordered by id.
func (s *MemStore) All() []*Feature {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*Feature, 0, len(s.byID))
	for _, f := range s.byID {
		out = append(out, f.Clone())
	}
	SortFeatures(out)
	return out
}

// ByLayer returns copies of the features in one layer, ordered by id.
func (s *MemStore) ByLayer(layer string) []*Feature {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ids := s.byLayer[layer]
	out := make([]*Feature, 0, len(ids))
	for _, id := range ids {
		if f, ok := s.byID[id]; ok {
			out = append(out, f.Clone())
		}
	}
	SortFeatures(out)
	return out
}

// LayerNames returns the sorted names of the layers that currently hold at
// least one feature.
func (s *MemStore) LayerNames() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]string, 0, len(s.byLayer))
	for layer, ids := range s.byLayer {
		if len(ids) > 0 {
			out = append(out, layer)
		}
	}
	sort.Strings(out)
	return out
}

// Search returns copies of every feature whose bounds intersect b, ordered by
// id. It is a linear scan: the index packages exist so that the hot path does
// not call this.
func (s *MemStore) Search(b geom.BBox) []*Feature {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []*Feature
	for _, f := range s.byID {
		if f.Bounds().Intersects(b) {
			out = append(out, f.Clone())
		}
	}
	SortFeatures(out)
	return out
}

// Stats returns a snapshot of the counters and of the current contents.
func (s *MemStore) Stats() Stats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	layers := 0
	for _, ids := range s.byLayer {
		if len(ids) > 0 {
			layers++
		}
	}
	return Stats{
		Features: len(s.byID),
		Layers:   layers,
		Inserts:  s.inserts,
		Updates:  s.updates,
		Deletes:  s.deletes,
		Appends:  s.appends,
		Dropped:  s.dropped,
	}
}

// CompactionDue reports whether the share of dead records has reached the
// configured ratio. A ratio of zero or less disables compaction entirely.
func (s *MemStore) CompactionDue() bool {
	if s.compactRatio <= 0 {
		return false
	}
	return s.Stats().DeadRatio() >= s.compactRatio
}

// Compact reclaims the bookkeeping that superseded mutations left behind: the
// layer index is rebuilt from the live features, empty layers are dropped, and
// the mutation counters are rebased so that every remaining record corresponds
// to a live feature.
//
// It returns the number of records the rebase discarded. The append log is not
// rewritten here — a WAL writes to an opaque io.WriteCloser and cannot seek —
// so a durable store rewrites its log by draining ReplayWAL through
// LiveRecords into a fresh WAL.
func (s *MemStore) Compact() int {
	s.mu.Lock()
	defer s.mu.Unlock()

	rebuilt := make(map[string][]string, len(s.byLayer))
	for id, f := range s.byID {
		rebuilt[f.Layer] = append(rebuilt[f.Layer], id)
	}
	for _, ids := range rebuilt {
		sort.Strings(ids)
	}
	s.byLayer = rebuilt

	before := s.inserts + s.updates + s.deletes
	dropped := before - len(s.byID)
	if dropped < 0 {
		dropped = 0
	}
	s.inserts = len(s.byID)
	s.updates = 0
	s.deletes = 0
	s.dropped += dropped
	return dropped
}

// Close flushes and closes the append log, if one is attached. The features
// stay readable afterwards; only durability stops.
func (s *MemStore) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.wal == nil {
		return nil
	}
	w := s.wal
	s.wal = nil
	if err := w.Close(); err != nil {
		return fmt.Errorf("store: close: %w", err)
	}
	return nil
}

// Load replays a set of records into the store, replacing its contents. It is
// how a process restores itself from a log at start-up; the records are
// applied without being written back out.
func (s *MemStore) Load(recs []Record) error {
	live := ApplyRecords(recs)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.maxFeatures > 0 && len(live) > s.maxFeatures {
		return fmt.Errorf("store: load %d features into capacity %d: %w", len(live), s.maxFeatures, ErrFull)
	}
	s.byID = make(map[string]*Feature, len(live))
	s.byLayer = make(map[string][]string)
	for id, f := range live {
		if err := f.Validate(); err != nil {
			return fmt.Errorf("store: load %q: %w", id, err)
		}
		s.byID[id] = f
		s.addToLayer(f.Layer, id)
	}
	s.inserts = len(s.byID)
	s.updates = 0
	s.deletes = 0
	s.dropped += len(recs) - len(s.byID)
	return nil
}

// appendLocked mirrors one mutation into the append log. It must be called
// with s.mu held for writing.
func (s *MemStore) appendLocked(r Record) error {
	if s.wal == nil {
		return nil
	}
	if err := s.wal.Append(r); err != nil {
		return fmt.Errorf("store: log %s %q: %w", r.Kind, r.ID, err)
	}
	s.appends++
	return nil
}

// addToLayer records that id belongs to layer, keeping the slice sorted so
// ByLayer needs no extra work for the common case.
func (s *MemStore) addToLayer(layer, id string) {
	ids := s.byLayer[layer]
	at := sort.SearchStrings(ids, id)
	if at < len(ids) && ids[at] == id {
		return
	}
	ids = append(ids, "")
	copy(ids[at+1:], ids[at:])
	ids[at] = id
	s.byLayer[layer] = ids
}

// removeFromLayer drops id from layer's slice and removes the layer once it is
// empty, so LayerNames and Stats never report a layer with no features.
func (s *MemStore) removeFromLayer(layer, id string) {
	ids := s.byLayer[layer]
	at := sort.SearchStrings(ids, id)
	if at >= len(ids) || ids[at] != id {
		return
	}
	ids = append(ids[:at], ids[at+1:]...)
	if len(ids) == 0 {
		delete(s.byLayer, layer)
		return
	}
	s.byLayer[layer] = ids
}

// errNilFeature is reported when a caller passes no feature at all. It is
// unexported because callers cannot usefully distinguish it from any other
// validation failure.
var errNilFeature = errors.New("feature must not be nil")
