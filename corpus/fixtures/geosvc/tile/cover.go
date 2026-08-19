package tile

import "geosvc/geom"

// Range is the inclusive rectangle of tile coordinates that covers a box at
// one zoom level.
type Range struct {
	Z    int
	MinX int
	MinY int
	MaxX int
	MaxY int
}

// Count returns the number of tiles in the range. Because both ends are
// inclusive the count is (MaxX-MinX+1) * (MaxY-MinY+1).
func (r Range) Count() int {
	if r.MaxX < r.MinX || r.MaxY < r.MinY {
		return 0
	}
	return (r.MaxX - r.MinX + 1) * (r.MaxY - r.MinY + 1)
}

// Tiles materialises every tile in the range in row-major order.
func (r Range) Tiles() []Tile {
	out := make([]Tile, 0, r.Count())
	for y := r.MinY; y <= r.MaxY; y++ {
		for x := r.MinX; x <= r.MaxX; x++ {
			out = append(out, Tile{Z: r.Z, X: x, Y: y})
		}
	}
	return out
}

// Contains reports whether the tile falls inside the range.
func (r Range) Contains(t Tile) bool {
	return t.Z == r.Z && t.X >= r.MinX && t.X <= r.MaxX && t.Y >= r.MinY && t.Y <= r.MaxY
}

// CoverRange returns the inclusive tile rectangle covering the box at zoom z.
// The north-west corner of the box maps to (MinX, MinY) because tile y grows
// southward while latitude grows northward.
func CoverRange(b geom.BBox, z int) (Range, error) {
	if Size(z) == 0 {
		return Range{}, ErrZoomRange
	}
	if b.IsEmpty() {
		return Range{Z: z, MinX: 0, MinY: 0, MaxX: -1, MaxY: -1}, nil
	}
	nw, err := FromLatLon(geom.Point{Lat: b.MaxLat, Lon: b.MinLon}, z)
	if err != nil {
		return Range{}, err
	}
	se, err := FromLatLon(geom.Point{Lat: b.MinLat, Lon: b.MaxLon}, z)
	if err != nil {
		return Range{}, err
	}
	return Range{Z: z, MinX: nw.X, MinY: nw.Y, MaxX: se.X, MaxY: se.Y}, nil
}

// CoverBBox returns every tile at zoom z that intersects the box.
func CoverBBox(b geom.BBox, z int) ([]Tile, error) {
	r, err := CoverRange(b, z)
	if err != nil {
		return nil, err
	}
	return r.Tiles(), nil
}

// CoverCount returns how many tiles CoverBBox would return without building
// the slice. Sizing code uses this to avoid materialising large coverages.
func CoverCount(b geom.BBox, z int) (int, error) {
	r, err := CoverRange(b, z)
	if err != nil {
		return 0, err
	}
	return r.Count(), nil
}
