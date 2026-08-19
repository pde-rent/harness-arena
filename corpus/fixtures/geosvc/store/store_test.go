package store

import (
	"bytes"
	"errors"
	"testing"

	"geosvc/config"
	"geosvc/geom"
)

func pointFeature(id, layer string, lat, lon float64) *Feature {
	return &Feature{
		ID:     id,
		Layer:  layer,
		Kind:   GeometryPoint,
		Points: geom.PointSet{{Lat: lat, Lon: lon}},
		Props:  map[string]string{"name": id},
	}
}

func newTestStore(t *testing.T) *MemStore {
	t.Helper()
	cfg := config.Default().Store
	return NewMemStore(cfg)
}

func TestMemStoreInsertGetDelete(t *testing.T) {
	s := newTestStore(t)
	f := pointFeature("a", "roads", 52.5, 13.4)
	if err := s.Insert(f); err != nil {
		t.Fatalf("insert: %v", err)
	}
	if err := s.Insert(f); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("expected ErrDuplicate, got %v", err)
	}
	got, err := s.Get("a")
	if err != nil || got.ID != "a" {
		t.Fatalf("get: %v %v", got, err)
	}
	got.Props["name"] = "mutated"
	again, _ := s.Get("a")
	if again.Props["name"] != "a" {
		t.Fatal("the store handed out a mutable reference")
	}
	if !s.Delete("a") {
		t.Fatal("expected Delete to report the feature as present")
	}
	if _, err := s.Get("a"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
}

func TestMemStoreValidatesFeatures(t *testing.T) {
	s := newTestStore(t)
	if err := s.Insert(&Feature{ID: "", Layer: "roads", Kind: GeometryPoint}); err == nil {
		t.Fatal("expected an empty id to be rejected")
	}
	if err := s.Insert(&Feature{ID: "a", Layer: "roads", Kind: GeometryLine, Points: geom.PointSet{{Lat: 1, Lon: 1}}}); err == nil {
		t.Fatal("expected a one-point line to be rejected")
	}
}

func TestMemStoreSearchAndLayers(t *testing.T) {
	s := newTestStore(t)
	_ = s.Insert(pointFeature("a", "roads", 52.5, 13.4))
	_ = s.Insert(pointFeature("b", "roads", 52.6, 13.5))
	_ = s.Insert(pointFeature("c", "rivers", 40.0, -3.0))
	hits := s.Search(geom.BBox{MinLat: 52, MinLon: 13, MaxLat: 53, MaxLon: 14})
	if len(hits) != 2 || hits[0].ID != "a" || hits[1].ID != "b" {
		t.Fatalf("unexpected search result %v", hits)
	}
	if got := s.ByLayer("rivers"); len(got) != 1 || got[0].ID != "c" {
		t.Fatalf("unexpected layer result %v", got)
	}
	if got := Layers(s); len(got) != 2 || got[0] != "rivers" || got[1] != "roads" {
		t.Fatalf("unexpected layers %v", got)
	}
}

func TestMemStoreUpdateBumpsVersion(t *testing.T) {
	s := newTestStore(t)
	_ = s.Insert(pointFeature("a", "roads", 52.5, 13.4))
	if err := s.Update(pointFeature("a", "roads", 52.7, 13.9)); err != nil {
		t.Fatalf("update: %v", err)
	}
	got, _ := s.Get("a")
	if got.Version == 0 {
		t.Fatal("expected the version to be bumped")
	}
	if err := s.Update(pointFeature("missing", "roads", 1, 1)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestCodecRoundTrip(t *testing.T) {
	f := pointFeature("a", "roads", 52.5, 13.4)
	f.Version = 7
	f.Props["extra"] = "value"
	out, err := DecodeFeature(EncodeFeature(f))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.ID != f.ID || out.Layer != f.Layer || out.Version != f.Version {
		t.Fatalf("scalar fields did not survive: %+v", out)
	}
	if len(out.Points) != 1 || !out.Points[0].Equal(f.Points[0], 1e-9) {
		t.Fatalf("geometry did not survive: %v", out.Points)
	}
	if out.Props["extra"] != "value" || out.Props["name"] != "a" {
		t.Fatalf("properties did not survive: %v", out.Props)
	}
}

func TestCodecIsDeterministic(t *testing.T) {
	f := pointFeature("a", "roads", 52.5, 13.4)
	f.Props = map[string]string{"z": "1", "a": "2", "m": "3"}
	first := EncodeFeature(f)
	for i := 0; i < 5; i++ {
		if !bytes.Equal(first, EncodeFeature(f)) {
			t.Fatal("encoding the same feature twice produced different bytes")
		}
	}
}

func TestWALAppendAndReplay(t *testing.T) {
	var buf nopCloser
	w := NewWAL(&buf, 1)
	f := pointFeature("a", "roads", 52.5, 13.4)
	if err := w.Append(Record{Kind: RecordInsert, Seq: 1, ID: f.ID, Feature: f}); err != nil {
		t.Fatalf("append: %v", err)
	}
	if err := w.Append(Record{Kind: RecordDelete, Seq: 2, ID: "a"}); err != nil {
		t.Fatalf("append: %v", err)
	}
	if err := w.Flush(); err != nil {
		t.Fatalf("flush: %v", err)
	}
	recs, err := ReplayWAL(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if len(recs) != 2 || recs[0].Kind != RecordInsert || recs[1].ID != "a" {
		t.Fatalf("unexpected replay %v", recs)
	}
}

// nopCloser is a bytes.Buffer that satisfies io.WriteCloser.
type nopCloser struct{ bytes.Buffer }

func (nopCloser) Close() error { return nil }
