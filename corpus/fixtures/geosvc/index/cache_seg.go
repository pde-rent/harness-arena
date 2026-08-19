package index

import (
	"container/list"
	"sync"

	"geosvc/store"
)

// probationDivisor splits the configured capacity between the two segments.
// One part in probationDivisor is probation and the rest is protected, so with
// the divisor at four a cache configured for N entries admits N/4 entries into
// probation before it starts evicting from it.
const probationDivisor = 4

// segment names the list an entry currently lives on.
type segment uint8

const (
	// segNone means the entry is no longer on either list. Lookups treat such
	// an entry as absent.
	segNone segment = iota
	segProbation
	segProtected
)

type segEntry struct {
	key   Key
	value *store.Feature
	size  int
	seg   segment
	el    *list.Element
}

// SegmentedCache is the newer feature cache. It keeps two recency lists: newly
// admitted entries land on the probation list, and an entry that is read while
// on probation is promoted to the protected list. Protected entries that fall
// out of the protected list are demoted back to probation rather than being
// dropped outright, so a single scan of cold keys cannot flush the working set
// the way it can with a plain LRU.
//
// The capacity is split by probationDivisor. Both segments share one lock; the
// segments are small enough that finer locking has never paid for itself.
type SegmentedCache struct {
	mu           sync.Mutex
	capacity     int
	probationCap int
	protectedCap int
	entries      map[Key]*segEntry
	probation    *list.List
	protected    *list.List
	used         int
	stats        CacheStats
}

// NewSegmentedCache returns a segmented cache holding at most capacity entries
// across both of its segments. A capacity below one is raised to one.
func NewSegmentedCache(capacity int) *SegmentedCache {
	if capacity < 1 {
		capacity = 1
	}
	probationCap := capacity / probationDivisor
	if probationCap < 1 {
		probationCap = 1
	}
	return &SegmentedCache{
		capacity:     capacity,
		probationCap: probationCap,
		protectedCap: capacity - probationCap,
		entries:      make(map[Key]*segEntry, capacity),
		probation:    list.New(),
		protected:    list.New(),
	}
}

// Name implements FeatureCache.
func (c *SegmentedCache) Name() string { return "segmented" }

// Cap implements FeatureCache.
func (c *SegmentedCache) Cap() int { return c.capacity }

// ProbationCap returns the capacity of the probation segment.
func (c *SegmentedCache) ProbationCap() int { return c.probationCap }

// ProtectedCap returns the capacity of the protected segment.
func (c *SegmentedCache) ProtectedCap() int { return c.protectedCap }

// Get implements FeatureCache. A hit on a probation entry promotes it.
func (c *SegmentedCache) Get(k Key) (*store.Feature, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[k]
	if !ok || e.seg == segNone {
		c.stats.Misses++
		return nil, false
	}
	c.stats.Hits++
	switch e.seg {
	case segProtected:
		c.protected.MoveToFront(e.el)
	case segProbation:
		c.promote(e)
	}
	return e.value, true
}

// promote moves an entry from probation to protected, demoting the coldest
// protected entry if the protected segment is now over capacity.
func (c *SegmentedCache) promote(e *segEntry) {
	c.probation.Remove(e.el)
	e.el = c.protected.PushFront(e)
	e.seg = segProtected
	for c.protected.Len() > c.protectedCap {
		c.demoteColdest()
	}
	for c.probation.Len() > c.probationCap {
		c.evictProbation()
	}
}

// demoteColdest moves the least recently used protected entry back onto the
// probation list. It keeps the entry resident and its accounting unchanged.
func (c *SegmentedCache) demoteColdest() {
	el := c.protected.Back()
	if el == nil {
		return
	}
	e := el.Value.(*segEntry)
	c.protected.Remove(el)
	e.el = c.probation.PushFront(e)
	e.seg = segProbation
}

// evictProbation drops the least recently used probation entry. It is only
// ever called with the lock held and only when the probation segment is over
// its capacity.
func (c *SegmentedCache) evictProbation() {
	el := c.probation.Back()
	if el == nil {
		return
	}
	e := el.Value.(*segEntry)
	c.probation.Remove(el)
	e.el = nil
	e.seg = segNone
	e.value = nil
	c.used -= e.size
	c.stats.Evictions++
}

// Put implements FeatureCache.
func (c *SegmentedCache) Put(k Key, f *store.Feature) {
	c.mu.Lock()
	defer c.mu.Unlock()
	size := featureBytes(f)
	if e, ok := c.entries[k]; ok && e.seg != segNone {
		c.used += size - e.size
		e.value, e.size = f, size
		switch e.seg {
		case segProtected:
			c.protected.MoveToFront(e.el)
		case segProbation:
			c.probation.MoveToFront(e.el)
		}
		c.stats.Updates++
		return
	}
	e := &segEntry{key: k, value: f, size: size, seg: segProbation}
	e.el = c.probation.PushFront(e)
	c.entries[k] = e
	c.used += size
	c.stats.Inserts++
	for c.probation.Len() > c.probationCap {
		c.evictProbation()
	}
}

// Invalidate implements FeatureCache.
func (c *SegmentedCache) Invalidate(k Key) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[k]
	if !ok {
		return false
	}
	delete(c.entries, k)
	if e.seg == segNone {
		return false
	}
	switch e.seg {
	case segProtected:
		c.protected.Remove(e.el)
	case segProbation:
		c.probation.Remove(e.el)
	}
	e.el = nil
	e.seg = segNone
	c.used -= e.size
	return true
}

// Len implements FeatureCache. It is the number of entries that are resident
// on one of the two segments.
func (c *SegmentedCache) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.probation.Len() + c.protected.Len()
}

// Bytes implements FeatureCache.
func (c *SegmentedCache) Bytes() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.used
}

// Stats implements FeatureCache.
func (c *SegmentedCache) Stats() CacheStats {
	c.mu.Lock()
	defer c.mu.Unlock()
	s := c.stats
	s.Entries = c.probation.Len() + c.protected.Len()
	s.Bytes = c.used
	return s
}

// Purge implements FeatureCache.
func (c *SegmentedCache) Purge() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = make(map[Key]*segEntry, c.capacity)
	c.probation.Init()
	c.protected.Init()
	c.used = 0
}

// SegmentLens returns the resident count of each segment, probation first. It
// exists for the debug endpoint and is not part of FeatureCache.
func (c *SegmentedCache) SegmentLens() (probation, protected int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.probation.Len(), c.protected.Len()
}
