package tile

import (
	"testing"

	"geosvc/geom"
)

func TestFromLatLonRoundTripsThroughBounds(t *testing.T) {
	p := geom.Point{Lat: 52.52, Lon: 13.405}
	for z := 1; z <= 16; z++ {
		tl, err := FromLatLon(p, z)
		if err != nil {
			t.Fatalf("zoom %d: %v", z, err)
		}
		if !tl.Valid() {
			t.Fatalf("zoom %d produced invalid tile %s", z, tl)
		}
		if !tl.Bounds().Contains(p) {
			t.Fatalf("zoom %d: %s does not contain %s", z, tl, p)
		}
	}
}

func TestQuadKeyRoundTrip(t *testing.T) {
	in := Tile{Z: 12, X: 2200, Y: 1345}
	key := in.QuadKey()
	if len(key) != in.Z {
		t.Fatalf("quadkey %q has length %d, want %d", key, len(key), in.Z)
	}
	out, err := FromQuadKey(key)
	if err != nil {
		t.Fatalf("FromQuadKey: %v", err)
	}
	if out != in {
		t.Fatalf("got %v want %v", out, in)
	}
}

func TestIDRoundTrip(t *testing.T) {
	in := Tile{Z: 18, X: 138513, Y: 89737}
	if got := FromID(in.ID()); got != in {
		t.Fatalf("got %v want %v", got, in)
	}
}

func TestParentAndChildren(t *testing.T) {
	parent := Tile{Z: 5, X: 10, Y: 11}
	for _, c := range parent.Children() {
		if c.Parent() != parent {
			t.Fatalf("child %s does not point back at %s", c, parent)
		}
	}
	root := Tile{Z: 0, X: 0, Y: 0}
	if got := root.Parent(); got != root {
		t.Fatalf("zoom zero tile should be its own parent, got %v", got)
	}
}

func TestCoverRangeIsInclusive(t *testing.T) {
	b := geom.BBox{MinLat: 52.4, MinLon: 13.2, MaxLat: 52.6, MaxLon: 13.6}
	r, err := CoverRange(b, 12)
	if err != nil {
		t.Fatalf("CoverRange: %v", err)
	}
	if r.Count() != len(r.Tiles()) {
		t.Fatalf("Count %d disagrees with Tiles %d", r.Count(), len(r.Tiles()))
	}
	for _, tl := range r.Tiles() {
		if !r.Contains(tl) {
			t.Fatalf("%s is not inside its own range", tl)
		}
	}
	n, err := CoverCount(b, 12)
	if err != nil || n != r.Count() {
		t.Fatalf("CoverCount %d err %v, want %d", n, err, r.Count())
	}
}

func TestResolutionDecreasesWithZoom(t *testing.T) {
	prev := Resolution(0, 0)
	for z := 1; z <= 10; z++ {
		cur := Resolution(z, 0)
		if cur >= prev {
			t.Fatalf("resolution did not shrink at zoom %d: %v >= %v", z, cur, prev)
		}
		prev = cur
	}
}
