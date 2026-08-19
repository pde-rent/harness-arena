package index

import (
	"container/list"
	"sync"

	"geosvc/store"
)

// lruEntry is the value stored in the intrusive list.
type lruEntry struct {
	key   Key
	value *store.Feature
	size  int
}

// LRUCache is the original feature cache: one lock, one map, one recency list.
//
// It is O(1) for every operation and its accounting is exact: Bytes always
// equals the sum of the accounted sizes of the resident entries, and Len always
// equals the number of keys the map holds.
type LRUCache struct {
	mu       sync.Mutex
	capacity int
	items    map[Key]*list.Element
	order    *list.List
	used     int
	stats    CacheStats
}

// NewLRUCache returns a cache holding at most capacity entries. A capacity
// below one is raised to one so the cache is always usable.
func NewLRUCache(capacity int) *LRUCache {
	if capacity < 1 {
		capacity = 1
	}
	return &LRUCache{
		capacity: capacity,
		items:    make(map[Key]*list.Element, capacity),
		order:    list.New(),
	}
}

// Name implements FeatureCache.
func (c *LRUCache) Name() string { return "lru" }

// Cap implements FeatureCache.
func (c *LRUCache) Cap() int { return c.capacity }

// Get implements FeatureCache.
func (c *LRUCache) Get(k Key) (*store.Feature, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.items[k]
	if !ok {
		c.stats.Misses++
		return nil, false
	}
	c.order.MoveToFront(el)
	c.stats.Hits++
	return el.Value.(*lruEntry).value, true
}

// Put implements FeatureCache.
func (c *LRUCache) Put(k Key, f *store.Feature) {
	c.mu.Lock()
	defer c.mu.Unlock()
	size := featureBytes(f)
	if el, ok := c.items[k]; ok {
		e := el.Value.(*lruEntry)
		c.used += size - e.size
		e.value, e.size = f, size
		c.order.MoveToFront(el)
		c.stats.Updates++
		return
	}
	el := c.order.PushFront(&lruEntry{key: k, value: f, size: size})
	c.items[k] = el
	c.used += size
	c.stats.Inserts++
	for c.order.Len() > c.capacity {
		c.evictOldest()
	}
}

// evictOldest drops the least recently used entry. It is only ever called with
// the lock held.
func (c *LRUCache) evictOldest() {
	el := c.order.Back()
	if el == nil {
		return
	}
	e := el.Value.(*lruEntry)
	c.order.Remove(el)
	delete(c.items, e.key)
	c.used -= e.size
	c.stats.Evictions++
}

// Invalidate implements FeatureCache.
func (c *LRUCache) Invalidate(k Key) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.items[k]
	if !ok {
		return false
	}
	e := el.Value.(*lruEntry)
	c.order.Remove(el)
	delete(c.items, k)
	c.used -= e.size
	return true
}

// Len implements FeatureCache.
func (c *LRUCache) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.items)
}

// Bytes implements FeatureCache.
func (c *LRUCache) Bytes() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.used
}

// Stats implements FeatureCache.
func (c *LRUCache) Stats() CacheStats {
	c.mu.Lock()
	defer c.mu.Unlock()
	s := c.stats
	s.Entries = len(c.items)
	s.Bytes = c.used
	return s
}

// Purge implements FeatureCache.
func (c *LRUCache) Purge() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items = make(map[Key]*list.Element, c.capacity)
	c.order.Init()
	c.used = 0
}

// Keys returns the resident keys from most to least recently used. It exists
// for the debug endpoint and is not part of FeatureCache.
func (c *LRUCache) Keys() []Key {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]Key, 0, len(c.items))
	for el := c.order.Front(); el != nil; el = el.Next() {
		out = append(out, el.Value.(*lruEntry).key)
	}
	return out
}
