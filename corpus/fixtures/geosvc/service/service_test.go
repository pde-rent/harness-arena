package service

import (
	"testing"

	"geosvc/config"
	"geosvc/geom"
	"geosvc/metrics"
	"geosvc/store"
	"geosvc/tile"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	cfg := config.Default()
	svc, err := New(cfg, metrics.NewRegistry(cfg.Metrics))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func feature(id string, lat, lon float64) *store.Feature {
	return &store.Feature{
		ID:     id,
		Layer:  "roads",
		Kind:   store.GeometryPoint,
		Points: geom.PointSet{{Lat: lat, Lon: lon}},
	}
}

func TestServicePutGetDelete(t *testing.T) {
	svc := newTestService(t)
	created, err := svc.Put(feature("a", 52.5, 13.4))
	if err != nil || !created {
		t.Fatalf("Put: created=%v err=%v", created, err)
	}
	if created, _ := svc.Put(feature("a", 52.5, 13.4)); created {
		t.Fatal("the second Put should not report a creation")
	}
	got, err := svc.Get("roads", "a")
	if err != nil || got.ID != "a" {
		t.Fatalf("Get: %v %v", got, err)
	}
	if _, err := svc.Get("rivers", "a"); err == nil {
		t.Fatal("expected a layer mismatch to look like a miss")
	}
	if !svc.Delete("roads", "a") {
		t.Fatal("expected Delete to succeed")
	}
	if svc.Len() != 0 {
		t.Fatalf("expected an empty store, got %d features", svc.Len())
	}
}

func TestServiceQueryUsesIndex(t *testing.T) {
	svc := newTestService(t)
	for i, p := range []geom.Point{{Lat: 52.50, Lon: 13.40}, {Lat: 52.51, Lon: 13.41}, {Lat: 40.0, Lon: -3.0}} {
		if _, err := svc.Put(feature(string(rune('a'+i)), p.Lat, p.Lon)); err != nil {
			t.Fatalf("put %d: %v", i, err)
		}
	}
	got, err := svc.Query(geom.BBox{MinLat: 52.4, MinLon: 13.3, MaxLat: 52.6, MaxLon: 13.5}, "roads")
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected two matches, got %d", len(got))
	}
	if _, err := svc.Query(geom.EmptyBBox(), ""); err == nil {
		t.Fatal("expected an invalid box to be rejected")
	}
}

func TestServiceCachesAreCoherentAfterWrite(t *testing.T) {
	svc := newTestService(t)
	_, _ = svc.Put(feature("a", 52.5, 13.4))
	if _, err := svc.Get("roads", "a"); err != nil {
		t.Fatalf("Get: %v", err)
	}
	updated := feature("a", 52.5, 13.4)
	updated.Props = map[string]string{"name": "second"}
	if _, err := svc.Put(updated); err != nil {
		t.Fatalf("Put: %v", err)
	}
	got, err := svc.Get("roads", "a")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Props["name"] != "second" {
		t.Fatalf("the cache served a stale feature: %v", got.Props)
	}
}

func TestServiceTileIsCached(t *testing.T) {
	svc := newTestService(t)
	_, _ = svc.Put(feature("a", 52.5, 13.4))
	tl, err := tile.FromLatLon(geom.Point{Lat: 52.5, Lon: 13.4}, svc.Config().Index.Zoom)
	if err != nil {
		t.Fatalf("FromLatLon: %v", err)
	}
	first, err := svc.Tile(tl)
	if err != nil {
		t.Fatalf("Tile: %v", err)
	}
	if len(first.Entries) != 1 {
		t.Fatalf("expected the tile to hold one entry, got %d", len(first.Entries))
	}
	second, err := svc.Tile(tl)
	if err != nil {
		t.Fatalf("Tile: %v", err)
	}
	if first != second {
		t.Fatal("expected the second call to be served from the tile cache")
	}
	stats := svc.CacheStats()
	if stats["tile"].Hits != 1 {
		t.Fatalf("expected one tile cache hit, got %+v", stats["tile"])
	}
	svc.PurgeCaches()
	if svc.CacheStats()["tile"].Entries != 0 {
		t.Fatal("expected the tile cache to be empty after a purge")
	}
}

func TestServiceRejectsInvalidConfig(t *testing.T) {
	cfg := config.Default()
	cfg.Cache.Kind = "nope"
	if _, err := New(cfg, nil); err == nil {
		t.Fatal("expected an unknown cache kind to be rejected")
	}
}
