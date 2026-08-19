package geom

import "math"

// Simplify reduces a point sequence with the Ramer-Douglas-Peucker algorithm.
// toleranceMeters is the maximum distance a removed point may have had from
// the retained line. The first and last points are always retained.
func Simplify(ps PointSet, toleranceMeters float64) PointSet {
	if len(ps) < 3 || toleranceMeters <= 0 {
		return append(PointSet(nil), ps...)
	}
	keep := make([]bool, len(ps))
	keep[0] = true
	keep[len(ps)-1] = true
	simplifySegment(ps, 0, len(ps)-1, toleranceMeters, keep)
	out := make(PointSet, 0, len(ps))
	for i, k := range keep {
		if k {
			out = append(out, ps[i])
		}
	}
	return out
}

func simplifySegment(ps PointSet, first, last int, tol float64, keep []bool) {
	if last <= first+1 {
		return
	}
	maxDist := 0.0
	maxIdx := first
	for i := first + 1; i < last; i++ {
		d := math.Abs(CrossTrackDistance(ps[first], ps[last], ps[i]))
		if d > maxDist {
			maxDist = d
			maxIdx = i
		}
	}
	if maxDist <= tol {
		return
	}
	keep[maxIdx] = true
	simplifySegment(ps, first, maxIdx, tol, keep)
	simplifySegment(ps, maxIdx, last, tol, keep)
}

// Densify inserts intermediate points so that no consecutive pair is further
// apart than maxSpacingMeters.
func Densify(ps PointSet, maxSpacingMeters float64) PointSet {
	if len(ps) < 2 || maxSpacingMeters <= 0 {
		return append(PointSet(nil), ps...)
	}
	out := make(PointSet, 0, len(ps))
	for i := 1; i < len(ps); i++ {
		a, b := ps[i-1], ps[i]
		out = append(out, a)
		d := Haversine(a, b)
		steps := int(math.Floor(d / maxSpacingMeters))
		if steps <= 0 {
			continue
		}
		brg := Bearing(a, b)
		for s := 1; s <= steps; s++ {
			frac := float64(s) * maxSpacingMeters
			if frac >= d {
				break
			}
			out = append(out, Destination(a, brg, frac))
		}
	}
	return append(out, ps[len(ps)-1])
}
