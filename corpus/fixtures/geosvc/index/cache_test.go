package index

import (
	"fmt"
	"testing"

	"geosvc/geom"
	"geosvc/store"
)

func testFeature(id string) *store.Feature {
	return &store.Feature{
		ID:     id,
		Layer:  "roads",
		Kind:   store.GeometryPoint,
		Points: geom.PointSet{{Lat: 52.5, Lon: 13.4}},
	}
}

// caches lists every FeatureCache implementation so the shared behaviour tests
// run against all of them.
func caches(capacity int) map[string]FeatureCache {
	return map[string]FeatureCache{
		"lru":       NewLRUCache(capacity),
		"segmented": NewSegmentedCache(capacity),
	}
}

func TestFeatureCacheGetPutInvalidate(t *testing.T) {
	for name, c := range caches(16) {
		t.Run(name, func(t *testing.T) {
			if _, ok := c.Get("roads/a"); ok {
				t.Fatal("empty cache reported a hit")
			}
			c.Put(FeatureKey("roads", "a"), testFeature("a"))
			got, ok := c.Get(FeatureKey("roads", "a"))
			if !ok || got.ID != "a" {
				t.Fatalf("expected a hit for a, got %v %v", got, ok)
			}
			if !c.Invalidate(FeatureKey("roads", "a")) {
				t.Fatal("expected Invalidate to report the key as resident")
			}
			if _, ok := c.Get(FeatureKey("roads", "a")); ok {
				t.Fatal("invalidated key is still resident")
			}
			if c.Invalidate(FeatureKey("roads", "a")) {
				t.Fatal("second Invalidate should report false")
			}
		})
	}
}

func TestFeatureCacheUpdateDoesNotGrow(t *testing.T) {
	for name, c := range caches(8) {
		t.Run(name, func(t *testing.T) {
			key := FeatureKey("roads", "a")
			c.Put(key, testFeature("a"))
			before := c.Bytes()
			for i := 0; i < 10; i++ {
				c.Put(key, testFeature("a"))
			}
			if c.Len() != 1 {
				t.Fatalf("expected one entry, got %d", c.Len())
			}
			if c.Bytes() != before {
				t.Fatalf("accounted size drifted on update: %d -> %d", before, c.Bytes())
			}
		})
	}
}

func TestFeatureCacheRespectsCapacity(t *testing.T) {
	const capacity = 32
	for name, c := range caches(capacity) {
		t.Run(name, func(t *testing.T) {
			for i := 0; i < capacity*4; i++ {
				c.Put(FeatureKey("roads", fmt.Sprint(i)), testFeature(fmt.Sprint(i)))
			}
			if c.Len() > capacity {
				t.Fatalf("cache holds %d entries, above its capacity of %d", c.Len(), capacity)
			}
			if c.Cap() != capacity {
				t.Fatalf("Cap reported %d, want %d", c.Cap(), capacity)
			}
		})
	}
}

func TestFeatureCacheAccountingMatchesResidency(t *testing.T) {
	const capacity = 16
	perEntry := featureBytes(testFeature("x"))
	for name, c := range caches(capacity) {
		t.Run(name, func(t *testing.T) {
			for i := 0; i < capacity*3; i++ {
				c.Put(FeatureKey("roads", fmt.Sprint(i)), testFeature(fmt.Sprint(i)))
			}
			if want := c.Len() * perEntry; c.Bytes() != want {
				t.Fatalf("accounted %d bytes for %d entries, want %d", c.Bytes(), c.Len(), want)
			}
		})
	}
}

func TestFeatureCachePurge(t *testing.T) {
	for name, c := range caches(8) {
		t.Run(name, func(t *testing.T) {
			for i := 0; i < 5; i++ {
				c.Put(FeatureKey("roads", fmt.Sprint(i)), testFeature(fmt.Sprint(i)))
			}
			c.Purge()
			if c.Len() != 0 || c.Bytes() != 0 {
				t.Fatalf("after Purge: len=%d bytes=%d", c.Len(), c.Bytes())
			}
			s := c.Stats()
			if s.Inserts != 5 {
				t.Fatalf("cumulative inserts should survive a purge, got %d", s.Inserts)
			}
		})
	}
}

func TestFeatureCacheStatsHitRatio(t *testing.T) {
	for name, c := range caches(4) {
		t.Run(name, func(t *testing.T) {
			c.Put(FeatureKey("roads", "a"), testFeature("a"))
			c.Get(FeatureKey("roads", "a"))
			c.Get(FeatureKey("roads", "missing"))
			s := c.Stats()
			if s.Hits != 1 || s.Misses != 1 {
				t.Fatalf("unexpected counters %+v", s)
			}
			if s.HitRatio() != 0.5 {
				t.Fatalf("hit ratio %v, want 0.5", s.HitRatio())
			}
		})
	}
}

func TestSegmentedCachePromotesOnRead(t *testing.T) {
	c := NewSegmentedCache(16)
	key := FeatureKey("roads", "a")
	c.Put(key, testFeature("a"))
	probation, protected := c.SegmentLens()
	if probation != 1 || protected != 0 {
		t.Fatalf("new entry should land on probation, got %d/%d", probation, protected)
	}
	c.Get(key)
	probation, protected = c.SegmentLens()
	if probation != 0 || protected != 1 {
		t.Fatalf("read entry should be promoted, got %d/%d", probation, protected)
	}
}

func TestLRUCacheKeysAreMostRecentFirst(t *testing.T) {
	c := NewLRUCache(4)
	for _, id := range []string{"a", "b", "c"} {
		c.Put(FeatureKey("roads", id), testFeature(id))
	}
	c.Get(FeatureKey("roads", "a"))
	keys := c.Keys()
	if len(keys) != 3 || keys[0] != FeatureKey("roads", "a") {
		t.Fatalf("unexpected key order %v", keys)
	}
}

func TestTileCacheRespectsBudget(t *testing.T) {
	perTile := CachedTileBytes(1)
	c := NewTileCache(int64(perTile * 3))
	for i := 0; i < 20; i++ {
		tl := tileAt(i)
		c.Put(tl, &CachedTile{Tile: tl, Entries: []Entry{{ID: fmt.Sprint(i), Layer: "roads"}}})
	}
	if c.Bytes() > c.Budget() {
		t.Fatalf("tile cache holds %d bytes, over its budget of %d", c.Bytes(), c.Budget())
	}
}
