package geom

import (
	"fmt"
	"math"
)

// BBox is an axis-aligned bounding box in degrees.
//
// A BBox occupies 32 bytes of value storage (four float64 fields). The index
// packages rely on that number when they account for resident memory.
type BBox struct {
	MinLat float64
	MinLon float64
	MaxLat float64
	MaxLon float64
}

// NewBBox builds a box from two opposite corners in any order.
func NewBBox(a, b Point) BBox {
	return BBox{
		MinLat: math.Min(a.Lat, b.Lat),
		MinLon: math.Min(a.Lon, b.Lon),
		MaxLat: math.Max(a.Lat, b.Lat),
		MaxLon: math.Max(a.Lon, b.Lon),
	}
}

// EmptyBBox returns the inverted box that absorbs any point on extension.
func EmptyBBox() BBox {
	return BBox{MinLat: math.Inf(1), MinLon: math.Inf(1), MaxLat: math.Inf(-1), MaxLon: math.Inf(-1)}
}

// IsEmpty reports whether the box covers no area because it was never extended.
func (b BBox) IsEmpty() bool {
	return b.MinLat > b.MaxLat || b.MinLon > b.MaxLon
}

// Valid reports whether the box is well formed and in range.
func (b BBox) Valid() bool {
	if b.IsEmpty() {
		return false
	}
	return b.MinLat >= -90 && b.MaxLat <= 90 && b.MinLon >= -180 && b.MaxLon <= 180
}

// Contains reports whether the point lies inside the box, edges included.
func (b BBox) Contains(p Point) bool {
	return p.Lat >= b.MinLat && p.Lat <= b.MaxLat && p.Lon >= b.MinLon && p.Lon <= b.MaxLon
}

// ContainsBBox reports whether other lies entirely inside b.
func (b BBox) ContainsBBox(other BBox) bool {
	return other.MinLat >= b.MinLat && other.MaxLat <= b.MaxLat &&
		other.MinLon >= b.MinLon && other.MaxLon <= b.MaxLon
}

// Intersects reports whether the two boxes share any area, edges included.
func (b BBox) Intersects(other BBox) bool {
	if b.IsEmpty() || other.IsEmpty() {
		return false
	}
	return !(other.MinLat > b.MaxLat || other.MaxLat < b.MinLat ||
		other.MinLon > b.MaxLon || other.MaxLon < b.MinLon)
}

// Union returns the smallest box containing both inputs.
func (b BBox) Union(other BBox) BBox {
	if b.IsEmpty() {
		return other
	}
	if other.IsEmpty() {
		return b
	}
	return BBox{
		MinLat: math.Min(b.MinLat, other.MinLat),
		MinLon: math.Min(b.MinLon, other.MinLon),
		MaxLat: math.Max(b.MaxLat, other.MaxLat),
		MaxLon: math.Max(b.MaxLon, other.MaxLon),
	}
}

// ExtendPoint returns the smallest box containing b and p.
func (b BBox) ExtendPoint(p Point) BBox {
	if b.IsEmpty() {
		return BBox{MinLat: p.Lat, MinLon: p.Lon, MaxLat: p.Lat, MaxLon: p.Lon}
	}
	return BBox{
		MinLat: math.Min(b.MinLat, p.Lat),
		MinLon: math.Min(b.MinLon, p.Lon),
		MaxLat: math.Max(b.MaxLat, p.Lat),
		MaxLon: math.Max(b.MaxLon, p.Lon),
	}
}

// Center returns the arithmetic centre of the box.
func (b BBox) Center() Point {
	return Point{Lat: (b.MinLat + b.MaxLat) / 2, Lon: (b.MinLon + b.MaxLon) / 2}
}

// Corners returns the south-west and north-east corners.
func (b BBox) Corners() (sw, ne Point) {
	return Point{Lat: b.MinLat, Lon: b.MinLon}, Point{Lat: b.MaxLat, Lon: b.MaxLon}
}

// Area returns the box's area in square degrees. It is a comparison quantity
// only; it is not a real surface area.
func (b BBox) Area() float64 {
	if b.IsEmpty() {
		return 0
	}
	return (b.MaxLat - b.MinLat) * (b.MaxLon - b.MinLon)
}

// Perimeter returns the box's perimeter in degrees. The R-tree uses it as its
// split heuristic.
func (b BBox) Perimeter() float64 {
	if b.IsEmpty() {
		return 0
	}
	return 2 * ((b.MaxLat - b.MinLat) + (b.MaxLon - b.MinLon))
}

// Enlargement returns how much b's area would grow to also contain other.
func (b BBox) Enlargement(other BBox) float64 {
	return b.Union(other).Area() - b.Area()
}

// Buffer returns the box grown by d degrees on every side, clamped to the
// legal coordinate range.
func (b BBox) Buffer(d float64) BBox {
	return BBox{
		MinLat: ClampLat(b.MinLat - d),
		MinLon: NormalizeLon(b.MinLon - d),
		MaxLat: ClampLat(b.MaxLat + d),
		MaxLon: NormalizeLon(b.MaxLon + d),
	}
}

// String renders the box in the order used by the HTTP API:
// "minLon,minLat,maxLon,maxLat".
func (b BBox) String() string {
	return fmt.Sprintf("%.6f,%.6f,%.6f,%.6f", b.MinLon, b.MinLat, b.MaxLon, b.MaxLat)
}
