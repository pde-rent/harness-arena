package index

import (
	"fmt"
	"testing"

	"geosvc/config"
	"geosvc/geom"
	"geosvc/tile"
)

func tileAt(i int) tile.Tile { return tile.Tile{Z: 14, X: 8779 + i, Y: 5352} }

func boxAt(lat, lon float64) geom.BBox {
	return geom.BBox{MinLat: lat, MinLon: lon, MaxLat: lat + 0.01, MaxLon: lon + 0.01}
}

func indexes() map[string]Index {
	region := geom.BBox{MinLat: 50, MinLon: 10, MaxLat: 55, MaxLon: 15}
	return map[string]Index{
		"rtree": NewRTree(),
		"grid":  NewGridIndex(region, 16),
	}
}

func TestIndexInsertSearchRemove(t *testing.T) {
	for name, ix := range indexes() {
		t.Run(name, func(t *testing.T) {
			for i := 0; i < 200; i++ {
				lat := 50 + float64(i%50)*0.1
				lon := 10 + float64(i/50)*0.1
				if err := ix.Insert(Entry{ID: fmt.Sprintf("f%03d", i), Layer: "roads", Box: boxAt(lat, lon)}); err != nil {
					t.Fatalf("insert %d: %v", i, err)
				}
			}
			if ix.Len() != 200 {
				t.Fatalf("Len %d, want 200", ix.Len())
			}
			hits := ix.Search(geom.BBox{MinLat: 50, MinLon: 10, MaxLat: 50.05, MaxLon: 10.05})
			if len(hits) == 0 {
				t.Fatal("expected the query box to match something")
			}
			for i := 1; i < len(hits); i++ {
				if hits[i-1].ID >= hits[i].ID {
					t.Fatalf("results are not ordered by id: %v", hits)
				}
			}
			if !ix.Remove("f000") {
				t.Fatal("expected Remove to report the entry as present")
			}
			if ix.Remove("f000") {
				t.Fatal("second Remove should report false")
			}
			if ix.Len() != 199 {
				t.Fatalf("Len %d after removal, want 199", ix.Len())
			}
		})
	}
}

func TestIndexRejectsBadEntries(t *testing.T) {
	for name, ix := range indexes() {
		t.Run(name, func(t *testing.T) {
			if err := ix.Insert(Entry{Box: boxAt(51, 11)}); err != ErrEmptyID {
				t.Fatalf("expected ErrEmptyID, got %v", err)
			}
			if err := ix.Insert(Entry{ID: "x", Box: geom.EmptyBBox()}); err != ErrBadBox {
				t.Fatalf("expected ErrBadBox, got %v", err)
			}
		})
	}
}

func TestIndexReinsertReplaces(t *testing.T) {
	for name, ix := range indexes() {
		t.Run(name, func(t *testing.T) {
			_ = ix.Insert(Entry{ID: "a", Layer: "roads", Box: boxAt(51, 11)})
			_ = ix.Insert(Entry{ID: "a", Layer: "roads", Box: boxAt(52, 12)})
			if ix.Len() != 1 {
				t.Fatalf("Len %d after reinsert, want 1", ix.Len())
			}
			if got := ix.Search(boxAt(52, 12)); len(got) != 1 {
				t.Fatalf("expected the new box to match, got %d results", len(got))
			}
			if got := ix.Search(boxAt(51, 11)); len(got) != 0 {
				t.Fatalf("expected the old box to be gone, got %d results", len(got))
			}
		})
	}
}

func TestSearchFilteredByLayer(t *testing.T) {
	ix := NewRTree()
	_ = ix.Insert(Entry{ID: "a", Layer: "roads", Box: boxAt(51, 11)})
	_ = ix.Insert(Entry{ID: "b", Layer: "rivers", Box: boxAt(51, 11)})
	got := SearchFiltered(ix, boxAt(51, 11), LayerFilter("rivers"))
	if len(got) != 1 || got[0].ID != "b" {
		t.Fatalf("unexpected filtered result %v", got)
	}
	if all := SearchFiltered(ix, boxAt(51, 11), AnyFilter()); len(all) != 2 {
		t.Fatalf("AnyFilter with no arguments should accept everything, got %d", len(all))
	}
}

func TestRTreeStaysShallow(t *testing.T) {
	ix := NewRTree()
	for i := 0; i < 500; i++ {
		lat := 50 + float64(i%25)*0.05
		lon := 10 + float64(i/25)*0.05
		_ = ix.Insert(Entry{ID: fmt.Sprintf("f%03d", i), Layer: "roads", Box: boxAt(lat, lon)})
	}
	if h := ix.Height(); h > 5 {
		t.Fatalf("tree height %d is deeper than expected for 500 entries", h)
	}
	if ix.NodeCount() < LeafNodeCount(500) {
		t.Fatalf("node count %d is below the packed leaf count %d", ix.NodeCount(), LeafNodeCount(500))
	}
}

func TestSizingLevels(t *testing.T) {
	if got := LeafNodeCount(0); got != 0 {
		t.Fatalf("LeafNodeCount(0) = %d, want 0", got)
	}
	if got := LeafNodeCount(RTreeMaxEntries + 1); got != 2 {
		t.Fatalf("LeafNodeCount(%d) = %d, want 2", RTreeMaxEntries+1, got)
	}
	if got := TotalNodeCount(RTreeMaxEntries); got != 1 {
		t.Fatalf("a single full leaf is its own root, got %d nodes", got)
	}
	sizes := LevelSizes(RTreeMaxEntries * RTreeMaxEntries * 2)
	if len(sizes) != 3 || sizes[len(sizes)-1] != 1 {
		t.Fatalf("unexpected level sizes %v", sizes)
	}
	total := 0
	for _, s := range sizes {
		total += s
	}
	if total != TotalNodeCount(RTreeMaxEntries*RTreeMaxEntries*2) {
		t.Fatalf("LevelSizes and TotalNodeCount disagree: %v vs %d", sizes, TotalNodeCount(RTreeMaxEntries*RTreeMaxEntries*2))
	}
}

func TestFactorySelectsImplementations(t *testing.T) {
	cfg := config.Default()
	ix, err := NewIndex(cfg.Index)
	if err != nil || ix.Kind() != KindRTree {
		t.Fatalf("expected the default index to be an rtree, got %v %v", ix, err)
	}
	cfg.Index.Kind = KindGrid
	ix, err = NewIndex(cfg.Index)
	if err != nil || ix.Kind() != KindGrid {
		t.Fatalf("expected a grid index, got %v %v", ix, err)
	}
	if _, err := NewIndex(config.IndexConfig{Kind: "nope"}); err == nil {
		t.Fatal("expected an error for an unknown index kind")
	}
	fc, err := NewFeatureCache(cfg.Cache)
	if err != nil || fc.Name() != cfg.Cache.Kind {
		t.Fatalf("expected a %q cache, got %v %v", cfg.Cache.Kind, fc, err)
	}
	if _, err := NewFeatureCache(config.CacheConfig{Kind: "nope"}); err == nil {
		t.Fatal("expected an error for an unknown cache kind")
	}
}
