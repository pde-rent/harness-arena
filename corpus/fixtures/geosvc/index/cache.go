package index

import (
	"fmt"

	"geosvc/store"
)

// Key identifies one cache entry. Feature caches are keyed by
// "<layer>/<featureID>" and tile caches by the tile's "z/x/y" form; the cache
// implementations never parse the key, they only compare it.
type Key string

// FeatureKey builds the canonical feature cache key.
func FeatureKey(layer, id string) Key { return Key(layer + "/" + id) }

// CacheStats is a snapshot of one cache's counters. Every field is cumulative
// since construction except Entries and Bytes, which are instantaneous.
type CacheStats struct {
	Hits      uint64
	Misses    uint64
	Inserts   uint64
	Updates   uint64
	Evictions uint64
	Entries   int
	Bytes     int
}

// HitRatio returns hits/(hits+misses), or zero when nothing has been looked up.
func (s CacheStats) HitRatio() float64 {
	total := s.Hits + s.Misses
	if total == 0 {
		return 0
	}
	return float64(s.Hits) / float64(total)
}

// String renders the stats for the /debug/cache endpoint.
func (s CacheStats) String() string {
	return fmt.Sprintf("entries=%d bytes=%d hits=%d misses=%d evictions=%d ratio=%.3f",
		s.Entries, s.Bytes, s.Hits, s.Misses, s.Evictions, s.HitRatio())
}

// FeatureCache is the contract every feature cache implementation satisfies.
//
// Implementations must be safe for concurrent use by multiple goroutines. They
// must never hand out a feature that a caller can mutate: Put takes ownership
// of the pointer it is given and Get returns a value the caller may read but
// must not write.
//
// The service picks an implementation from configuration; see NewFeatureCache.
type FeatureCache interface {
	// Name returns the implementation's configuration name.
	Name() string
	// Get returns the cached feature for the key, if it is resident.
	Get(k Key) (*store.Feature, bool)
	// Put makes the feature resident under the key, evicting as needed.
	Put(k Key, f *store.Feature)
	// Invalidate drops the key and reports whether it was resident.
	Invalidate(k Key) bool
	// Len returns the number of resident entries.
	Len() int
	// Cap returns the configured capacity in entries.
	Cap() int
	// Bytes returns the accounted resident size of the cache.
	Bytes() int
	// Stats returns a snapshot of the counters.
	Stats() CacheStats
	// Purge drops every entry and resets the accounted size. Cumulative
	// counters survive a purge.
	Purge()
}

// featureBytes is the accounted size of one cached feature: the fixed index
// cost, the positions it carries and its property strings.
func featureBytes(f *store.Feature) int {
	if f == nil {
		return store.FeatureIndexBytes
	}
	n := store.FeatureIndexBytes + len(f.Points)*16
	for k, v := range f.Props {
		n += len(k) + len(v)
	}
	return n
}
