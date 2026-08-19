package geom

import (
	"fmt"
	"math"
)

// Point is a single position on the sphere in decimal degrees.
//
// A Point occupies 16 bytes of value storage (two float64 fields) and is
// copied by value everywhere in the service.
type Point struct {
	Lat float64
	Lon float64
}

// NewPoint returns a Point with the longitude normalised into [-180, 180) and
// the latitude clamped into [-90, 90].
func NewPoint(lat, lon float64) Point {
	return Point{Lat: ClampLat(lat), Lon: NormalizeLon(lon)}
}

// Valid reports whether the point's coordinates are finite and in range.
func (p Point) Valid() bool {
	if math.IsNaN(p.Lat) || math.IsNaN(p.Lon) {
		return false
	}
	if math.IsInf(p.Lat, 0) || math.IsInf(p.Lon, 0) {
		return false
	}
	return p.Lat >= -90 && p.Lat <= 90 && p.Lon >= -180 && p.Lon <= 180
}

// String renders the point as "lat,lon" with six decimal places, which is
// roughly 11cm of precision at the equator.
func (p Point) String() string {
	return fmt.Sprintf("%.6f,%.6f", p.Lat, p.Lon)
}

// Equal reports whether two points are within eps degrees on both axes.
func (p Point) Equal(q Point, eps float64) bool {
	return math.Abs(p.Lat-q.Lat) <= eps && math.Abs(p.Lon-q.Lon) <= eps
}

// Radians returns the point's coordinates in radians.
func (p Point) Radians() (lat, lon float64) {
	return p.Lat * math.Pi / 180, p.Lon * math.Pi / 180
}

// ClampLat clamps a latitude into the legal range.
func ClampLat(lat float64) float64 {
	if lat > 90 {
		return 90
	}
	if lat < -90 {
		return -90
	}
	return lat
}

// NormalizeLon wraps a longitude into [-180, 180).
func NormalizeLon(lon float64) float64 {
	if lon >= -180 && lon < 180 {
		return lon
	}
	lon = math.Mod(lon+180, 360)
	if lon < 0 {
		lon += 360
	}
	return lon - 180
}

// Midpoint returns the great-circle midpoint between two points.
func Midpoint(a, b Point) Point {
	lat1, lon1 := a.Radians()
	lat2, lon2 := b.Radians()
	dLon := lon2 - lon1
	bx := math.Cos(lat2) * math.Cos(dLon)
	by := math.Cos(lat2) * math.Sin(dLon)
	lat := math.Atan2(math.Sin(lat1)+math.Sin(lat2),
		math.Sqrt((math.Cos(lat1)+bx)*(math.Cos(lat1)+bx)+by*by))
	lon := lon1 + math.Atan2(by, math.Cos(lat1)+bx)
	return NewPoint(lat*180/math.Pi, lon*180/math.Pi)
}

// PointSet is an ordered collection of points, used for line geometry.
type PointSet []Point

// Bounds returns the bounding box of the set. The zero-length set yields the
// empty box.
func (ps PointSet) Bounds() BBox {
	if len(ps) == 0 {
		return EmptyBBox()
	}
	b := BBox{MinLat: ps[0].Lat, MinLon: ps[0].Lon, MaxLat: ps[0].Lat, MaxLon: ps[0].Lon}
	for _, p := range ps[1:] {
		b = b.ExtendPoint(p)
	}
	return b
}

// Length returns the total great-circle length of the polyline in metres.
func (ps PointSet) Length() float64 {
	total := 0.0
	for i := 1; i < len(ps); i++ {
		total += Haversine(ps[i-1], ps[i])
	}
	return total
}

// Reverse returns a copy of the set in reverse order.
func (ps PointSet) Reverse() PointSet {
	out := make(PointSet, len(ps))
	for i, p := range ps {
		out[len(ps)-1-i] = p
	}
	return out
}
