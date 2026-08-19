package tile

import (
	"errors"
	"fmt"
	"math"

	"geosvc/geom"
)

// MaxZoom is the deepest zoom level the service will project. Beyond this the
// float64 mantissa stops giving useful sub-tile precision.
const MaxZoom = 22

// ErrZoomRange is returned when a caller supplies a zoom outside [0, MaxZoom].
var ErrZoomRange = errors.New("tile: zoom out of range")

// ErrTileRange is returned when x or y fall outside the tile grid for a zoom.
var ErrTileRange = errors.New("tile: tile coordinate out of range")

// Tile identifies one slippy-map tile.
//
// A Tile occupies 24 bytes of value storage: three int fields on a 64-bit
// platform. The tile cache accounts for that when it sizes its keys.
type Tile struct {
	Z int
	X int
	Y int
}

// Size returns the number of tiles along one axis at the given zoom, that is
// 2^z. Zooms outside the legal range return 0.
func Size(z int) int {
	if z < 0 || z > MaxZoom {
		return 0
	}
	return 1 << uint(z)
}

// Valid reports whether the tile's coordinates exist at its zoom.
func (t Tile) Valid() bool {
	n := Size(t.Z)
	if n == 0 {
		return false
	}
	return t.X >= 0 && t.X < n && t.Y >= 0 && t.Y < n
}

// String renders the tile in the "z/x/y" form used by the HTTP routes.
func (t Tile) String() string { return fmt.Sprintf("%d/%d/%d", t.Z, t.X, t.Y) }

// ID packs the tile into a single uint64 suitable for use as a map key.
// The layout is 5 bits of zoom followed by 24 bits each of y and x, which is
// exact for every zoom up to MaxZoom.
func (t Tile) ID() uint64 {
	return uint64(t.Z)<<48 | uint64(t.Y&0xffffff)<<24 | uint64(t.X&0xffffff)
}

// FromID is the inverse of ID.
func FromID(id uint64) Tile {
	return Tile{
		Z: int(id >> 48),
		Y: int((id >> 24) & 0xffffff),
		X: int(id & 0xffffff),
	}
}

// Parent returns the tile one zoom level out. The zero-zoom tile is its own
// parent.
func (t Tile) Parent() Tile {
	if t.Z == 0 {
		return t
	}
	return Tile{Z: t.Z - 1, X: t.X / 2, Y: t.Y / 2}
}

// Children returns the four tiles one zoom level in, in z-order:
// north-west, north-east, south-west, south-east.
func (t Tile) Children() [4]Tile {
	x, y, z := t.X*2, t.Y*2, t.Z+1
	return [4]Tile{
		{Z: z, X: x, Y: y},
		{Z: z, X: x + 1, Y: y},
		{Z: z, X: x, Y: y + 1},
		{Z: z, X: x + 1, Y: y + 1},
	}
}

// AncestorAt returns the ancestor of t at zoom z. If z is deeper than t's own
// zoom the tile is returned unchanged.
func (t Tile) AncestorAt(z int) Tile {
	for t.Z > z {
		t = t.Parent()
	}
	return t
}

// FromLatLon projects a point to the tile that contains it at zoom z.
// Latitudes beyond the Web Mercator limit are clamped to the limit, so every
// legal point lands on a real tile.
func FromLatLon(p geom.Point, z int) (Tile, error) {
	n := Size(z)
	if n == 0 {
		return Tile{}, ErrZoomRange
	}
	lat := p.Lat
	if lat > MercatorLatLimit {
		lat = MercatorLatLimit
	}
	if lat < -MercatorLatLimit {
		lat = -MercatorLatLimit
	}
	lon := geom.NormalizeLon(p.Lon)

	x := int(math.Floor((lon + 180) / 360 * float64(n)))
	latRad := lat * math.Pi / 180
	y := int(math.Floor((1 - math.Log(math.Tan(latRad)+1/math.Cos(latRad))/math.Pi) / 2 * float64(n)))

	if x < 0 {
		x = 0
	}
	if x >= n {
		x = n - 1
	}
	if y < 0 {
		y = 0
	}
	if y >= n {
		y = n - 1
	}
	return Tile{Z: z, X: x, Y: y}, nil
}

// MercatorLatLimit is the latitude at which the Web Mercator projection is
// truncated so the world is square.
const MercatorLatLimit = 85.0511287798066

// Bounds returns the geographic box the tile covers.
func (t Tile) Bounds() geom.BBox {
	n := float64(Size(t.Z))
	if n == 0 {
		return geom.EmptyBBox()
	}
	west := float64(t.X)/n*360 - 180
	east := float64(t.X+1)/n*360 - 180
	north := mercatorYToLat(float64(t.Y) / n)
	south := mercatorYToLat(float64(t.Y+1) / n)
	return geom.BBox{MinLat: south, MinLon: west, MaxLat: north, MaxLon: east}
}

func mercatorYToLat(y float64) float64 {
	n := math.Pi * (1 - 2*y)
	return 180 / math.Pi * math.Atan(math.Sinh(n))
}

// Center returns the geographic centre of the tile.
func (t Tile) Center() geom.Point { return t.Bounds().Center() }
