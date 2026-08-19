package geom

import (
	"math"
	"testing"
)

func TestNormalizeLon(t *testing.T) {
	cases := []struct{ in, want float64 }{
		{0, 0}, {179.5, 179.5}, {180, -180}, {-180, -180}, {181, -179}, {540, -180},
	}
	for _, c := range cases {
		if got := NormalizeLon(c.in); math.Abs(got-c.want) > 1e-9 {
			t.Errorf("NormalizeLon(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestBBoxContainsAndUnion(t *testing.T) {
	b := NewBBox(Point{Lat: 10, Lon: 20}, Point{Lat: 30, Lon: 40})
	if !b.Contains(Point{Lat: 20, Lon: 30}) {
		t.Fatal("expected interior point to be contained")
	}
	if b.Contains(Point{Lat: 5, Lon: 30}) {
		t.Fatal("expected exterior point to be excluded")
	}
	u := b.Union(NewBBox(Point{Lat: 0, Lon: 0}, Point{Lat: 5, Lon: 5}))
	if u.MinLat != 0 || u.MaxLon != 40 {
		t.Fatalf("unexpected union %v", u)
	}
}

func TestHaversineKnownDistance(t *testing.T) {
	berlin := Point{Lat: 52.52, Lon: 13.405}
	hamburg := Point{Lat: 53.551, Lon: 9.994}
	d := Haversine(berlin, hamburg)
	if d < 250000 || d > 265000 {
		t.Fatalf("Berlin-Hamburg distance %v m is implausible", d)
	}
}

func TestPolylineRoundTrip(t *testing.T) {
	in := PointSet{{Lat: 38.5, Lon: -120.2}, {Lat: 40.7, Lon: -120.95}, {Lat: 43.252, Lon: -126.453}}
	enc := EncodePolyline(in)
	out, err := DecodePolyline(enc)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(out) != len(in) {
		t.Fatalf("got %d points, want %d", len(out), len(in))
	}
	for i := range in {
		if !in[i].Equal(out[i], 1e-5) {
			t.Errorf("point %d: got %v want %v", i, out[i], in[i])
		}
	}
}

func TestDecodePolylineRejectsTruncated(t *testing.T) {
	if _, err := DecodePolyline("_p~iF"); err == nil {
		t.Fatal("expected an error for a truncated polyline")
	}
}

func TestRingContains(t *testing.T) {
	r := Ring{{Lat: 0, Lon: 0}, {Lat: 0, Lon: 10}, {Lat: 10, Lon: 10}, {Lat: 10, Lon: 0}}
	if !r.Contains(Point{Lat: 5, Lon: 5}) {
		t.Fatal("expected the centre to be inside")
	}
	if r.Contains(Point{Lat: 15, Lon: 5}) {
		t.Fatal("expected an outside point to be outside")
	}
}

func TestSimplifyKeepsEndpoints(t *testing.T) {
	in := PointSet{{Lat: 0, Lon: 0}, {Lat: 0.0001, Lon: 1}, {Lat: 0, Lon: 2}}
	out := Simplify(in, 1000)
	if len(out) != 2 || !out[0].Equal(in[0], 1e-9) || !out[1].Equal(in[2], 1e-9) {
		t.Fatalf("unexpected simplification %v", out)
	}
}
