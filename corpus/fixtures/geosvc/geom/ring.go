package geom

import "math"

// Ring is a closed polygon ring. The final point does not need to repeat the
// first; helpers close the ring implicitly.
type Ring PointSet

// SignedArea returns twice the signed planar area of the ring in square
// degrees. A positive result means the ring is wound counter-clockwise.
func (r Ring) SignedArea() float64 {
	if len(r) < 3 {
		return 0
	}
	sum := 0.0
	for i := range r {
		j := (i + 1) % len(r)
		sum += r[i].Lon*r[j].Lat - r[j].Lon*r[i].Lat
	}
	return sum
}

// IsClockwise reports the winding order of the ring.
func (r Ring) IsClockwise() bool { return r.SignedArea() < 0 }

// Bounds returns the ring's bounding box.
func (r Ring) Bounds() BBox { return PointSet(r).Bounds() }

// Contains reports whether p lies inside the ring, using the even-odd rule.
// Points exactly on an edge are reported as inside.
func (r Ring) Contains(p Point) bool {
	if len(r) < 3 {
		return false
	}
	if !r.Bounds().Contains(p) {
		return false
	}
	inside := false
	for i := range r {
		j := (i + len(r) - 1) % len(r)
		a, b := r[i], r[j]
		if onSegment(a, b, p) {
			return true
		}
		if (a.Lat > p.Lat) != (b.Lat > p.Lat) {
			x := (b.Lon-a.Lon)*(p.Lat-a.Lat)/(b.Lat-a.Lat) + a.Lon
			if p.Lon < x {
				inside = !inside
			}
		}
	}
	return inside
}

func onSegment(a, b, p Point) bool {
	const eps = 1e-12
	cross := (b.Lat-a.Lat)*(p.Lon-a.Lon) - (b.Lon-a.Lon)*(p.Lat-a.Lat)
	if math.Abs(cross) > eps {
		return false
	}
	return p.Lat >= math.Min(a.Lat, b.Lat)-eps && p.Lat <= math.Max(a.Lat, b.Lat)+eps &&
		p.Lon >= math.Min(a.Lon, b.Lon)-eps && p.Lon <= math.Max(a.Lon, b.Lon)+eps
}

// Centroid returns the area-weighted centroid of the ring. Degenerate rings
// fall back to the arithmetic mean of their vertices.
func (r Ring) Centroid() Point {
	area := r.SignedArea()
	if len(r) == 0 {
		return Point{}
	}
	if math.Abs(area) < 1e-15 {
		var lat, lon float64
		for _, p := range r {
			lat += p.Lat
			lon += p.Lon
		}
		n := float64(len(r))
		return Point{Lat: lat / n, Lon: lon / n}
	}
	var cx, cy float64
	for i := range r {
		j := (i + 1) % len(r)
		cross := r[i].Lon*r[j].Lat - r[j].Lon*r[i].Lat
		cx += (r[i].Lon + r[j].Lon) * cross
		cy += (r[i].Lat + r[j].Lat) * cross
	}
	return Point{Lat: cy / (3 * area), Lon: cx / (3 * area)}
}
