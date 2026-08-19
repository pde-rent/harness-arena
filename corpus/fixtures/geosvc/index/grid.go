package index

import (
	"sort"

	"geosvc/geom"
)

// GridIndex is a uniform grid over a fixed region. It is cheaper to build than
// the R-tree and answers small-box queries in constant time, but it degrades
// badly when the data is clustered or when a query box spans most of the
// region.
//
// The grid never rebalances: the region and the cell count are fixed at
// construction. Entries whose boxes fall outside the region are kept in an
// overflow list that every search scans.
type GridIndex struct {
	region   geom.BBox
	cells    int
	buckets  [][]string
	entries  map[string]Entry
	overflow []string
}

// NewGridIndex returns a grid with cells x cells buckets covering region.
// A non-positive cell count is treated as one cell.
func NewGridIndex(region geom.BBox, cells int) *GridIndex {
	if cells <= 0 {
		cells = 1
	}
	return &GridIndex{
		region:  region,
		cells:   cells,
		buckets: make([][]string, cells*cells),
		entries: make(map[string]Entry),
	}
}

// Kind implements Index.
func (g *GridIndex) Kind() string { return KindGrid }

// Len implements Index.
func (g *GridIndex) Len() int { return len(g.entries) }

// Bounds implements Index.
func (g *GridIndex) Bounds() geom.BBox {
	b := geom.EmptyBBox()
	for _, e := range g.entries {
		b = b.Union(e.Box)
	}
	return b
}

// Cells returns the number of buckets per axis.
func (g *GridIndex) Cells() int { return g.cells }

func (g *GridIndex) cellRange(b geom.BBox) (minCol, minRow, maxCol, maxRow int, inside bool) {
	if !g.region.Intersects(b) {
		return 0, 0, 0, 0, false
	}
	latSpan := g.region.MaxLat - g.region.MinLat
	lonSpan := g.region.MaxLon - g.region.MinLon
	if latSpan <= 0 || lonSpan <= 0 {
		return 0, 0, 0, 0, false
	}
	clamp := func(v int) int {
		if v < 0 {
			return 0
		}
		if v >= g.cells {
			return g.cells - 1
		}
		return v
	}
	minCol = clamp(int((b.MinLon - g.region.MinLon) / lonSpan * float64(g.cells)))
	maxCol = clamp(int((b.MaxLon - g.region.MinLon) / lonSpan * float64(g.cells)))
	minRow = clamp(int((b.MinLat - g.region.MinLat) / latSpan * float64(g.cells)))
	maxRow = clamp(int((b.MaxLat - g.region.MinLat) / latSpan * float64(g.cells)))
	return minCol, minRow, maxCol, maxRow, true
}

// Insert implements Index.
func (g *GridIndex) Insert(e Entry) error {
	if err := validateEntry(e); err != nil {
		return err
	}
	if _, ok := g.entries[e.ID]; ok {
		g.Remove(e.ID)
	}
	g.entries[e.ID] = e
	minCol, minRow, maxCol, maxRow, inside := g.cellRange(e.Box)
	if !inside {
		g.overflow = append(g.overflow, e.ID)
		return nil
	}
	for row := minRow; row <= maxRow; row++ {
		for col := minCol; col <= maxCol; col++ {
			idx := row*g.cells + col
			g.buckets[idx] = append(g.buckets[idx], e.ID)
		}
	}
	return nil
}

// Remove implements Index.
func (g *GridIndex) Remove(id string) bool {
	e, ok := g.entries[id]
	if !ok {
		return false
	}
	delete(g.entries, id)
	minCol, minRow, maxCol, maxRow, inside := g.cellRange(e.Box)
	if !inside {
		g.overflow = removeString(g.overflow, id)
		return true
	}
	for row := minRow; row <= maxRow; row++ {
		for col := minCol; col <= maxCol; col++ {
			idx := row*g.cells + col
			g.buckets[idx] = removeString(g.buckets[idx], id)
		}
	}
	return true
}

func removeString(ss []string, want string) []string {
	for i, s := range ss {
		if s == want {
			return append(ss[:i], ss[i+1:]...)
		}
	}
	return ss
}

// Search implements Index.
func (g *GridIndex) Search(b geom.BBox) []Entry {
	seen := make(map[string]struct{})
	out := make([]Entry, 0, 16)
	consider := func(id string) {
		if _, dup := seen[id]; dup {
			return
		}
		e, ok := g.entries[id]
		if !ok || !e.Box.Intersects(b) {
			return
		}
		seen[id] = struct{}{}
		out = append(out, e)
	}
	minCol, minRow, maxCol, maxRow, inside := g.cellRange(b)
	if inside {
		for row := minRow; row <= maxRow; row++ {
			for col := minCol; col <= maxCol; col++ {
				for _, id := range g.buckets[row*g.cells+col] {
					consider(id)
				}
			}
		}
	}
	for _, id := range g.overflow {
		consider(id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Occupancy returns the number of non-empty buckets, which operators use to
// judge whether the cell count suits the data.
func (g *GridIndex) Occupancy() int {
	n := 0
	for _, b := range g.buckets {
		if len(b) > 0 {
			n++
		}
	}
	return n
}
