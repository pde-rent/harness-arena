package store

import (
	"errors"
	"fmt"
	"sort"

	"geosvc/geom"
)

// Stats is a snapshot of a store's contents and of the mutations it has seen
// since it was opened. The counters are cumulative and never reset; Features
// and Layers describe the current contents instead.
type Stats struct {
	// Features is the number of live features.
	Features int
	// Layers is the number of distinct layers those features belong to.
	Layers int
	// Inserts counts successful Insert calls, including the creating half of
	// an Upsert.
	Inserts int
	// Updates counts successful Update calls, including the overwriting half
	// of an Upsert.
	Updates int
	// Deletes counts Delete calls that removed a feature.
	Deletes int
	// Appends counts records handed to the append log.
	Appends int
	// Dropped counts records that compaction discarded because a later record
	// superseded them.
	Dropped int
}

// Mutations returns the total number of state-changing operations the store
// has accepted. It is the natural denominator for the compaction ratio.
func (s Stats) Mutations() int { return s.Inserts + s.Updates + s.Deletes }

// DeadRatio returns the fraction of accepted mutations that no longer
// contribute to the current contents. It is zero when nothing has been
// written yet.
func (s Stats) DeadRatio() float64 {
	total := s.Mutations()
	if total <= 0 {
		return 0
	}
	dead := total - s.Features
	if dead <= 0 {
		return 0
	}
	return float64(dead) / float64(total)
}

// String renders the counters on one line for logs.
func (s Stats) String() string {
	return fmt.Sprintf("features=%d layers=%d ins=%d upd=%d del=%d appends=%d dropped=%d",
		s.Features, s.Layers, s.Inserts, s.Updates, s.Deletes, s.Appends, s.Dropped)
}

// Store is the system of record for features.
//
// Implementations must be safe for concurrent use and must not hand out
// pointers into their own state: every feature that crosses the interface, in
// either direction, is copied.
type Store interface {
	// Insert adds a feature that is not already present. It returns
	// ErrDuplicate if the id exists and ErrFull if the store is at capacity.
	Insert(f *Feature) error
	// Update replaces an existing feature and bumps its version. It returns
	// ErrNotFound if the id is unknown.
	Update(f *Feature) error
	// Upsert inserts or replaces, reporting whether the feature was created.
	Upsert(f *Feature) (created bool, err error)
	// Get returns a copy of the feature, or ErrNotFound.
	Get(id string) (*Feature, error)
	// Delete removes a feature, reporting whether it was present.
	Delete(id string) bool
	// Len returns the number of live features.
	Len() int
	// All returns copies of every feature, ordered by id.
	All() []*Feature
	// ByLayer returns copies of the features in one layer, ordered by id.
	ByLayer(layer string) []*Feature
	// Search returns copies of every feature whose bounds intersect b,
	// ordered by id.
	Search(b geom.BBox) []*Feature
	// Stats returns a snapshot of the counters.
	Stats() Stats
	// Close releases the store's resources, flushing any append log.
	Close() error
}

// MemStore is the only implementation in this package; the assertion keeps the
// two definitions from drifting apart.
var _ Store = (*MemStore)(nil)

// Layers returns the sorted, deduplicated set of layers present in the store.
func Layers(s Store) []string {
	seen := make(map[string]struct{})
	for _, f := range s.All() {
		seen[f.Layer] = struct{}{}
	}
	out := make([]string, 0, len(seen))
	for layer := range seen {
		out = append(out, layer)
	}
	sort.Strings(out)
	return out
}

// CountByLayer returns how many features each layer holds.
func CountByLayer(s Store) map[string]int {
	out := make(map[string]int)
	for _, f := range s.All() {
		out[f.Layer]++
	}
	return out
}

// Bounds returns the box covering every feature in the store. It returns an
// empty box when the store holds nothing.
func Bounds(s Store) geom.BBox {
	box := geom.EmptyBBox()
	for _, f := range s.All() {
		box = box.Union(f.Bounds())
	}
	return box
}

// IndexBytes estimates how much index-resident memory the store's features
// would occupy. Feature bodies live only in the store and are not counted.
func IndexBytes(s Store) int64 {
	return int64(s.Len()) * FeatureIndexBytes
}

// CopyFeatures inserts every feature of src into dst, skipping ids dst already
// holds. It returns the number of features copied.
func CopyFeatures(dst, src Store) (int, error) {
	n := 0
	for _, f := range src.All() {
		switch err := dst.Insert(f); {
		case err == nil:
			n++
		case errors.Is(err, ErrDuplicate):
			continue
		default:
			return n, fmt.Errorf("store: copy %q: %w", f.ID, err)
		}
	}
	return n, nil
}
