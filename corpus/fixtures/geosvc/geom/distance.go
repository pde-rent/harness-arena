package geom

import "math"

// EarthRadiusMeters is the mean radius of the WGS84 ellipsoid. Every
// great-circle helper in this package uses it, so distances are consistent
// even though they are not survey grade.
const EarthRadiusMeters = 6371008.8

// DegreesPerMeterLat is the latitude delta that corresponds to one metre of
// northward travel. Longitude has no such constant because it depends on the
// latitude at which it is measured.
const DegreesPerMeterLat = 1 / (EarthRadiusMeters * math.Pi / 180)

// Haversine returns the great-circle distance between two points in metres.
func Haversine(a, b Point) float64 {
	lat1, lon1 := a.Radians()
	lat2, lon2 := b.Radians()
	dLat := lat2 - lat1
	dLon := lon2 - lon1
	sinLat := math.Sin(dLat / 2)
	sinLon := math.Sin(dLon / 2)
	h := sinLat*sinLat + math.Cos(lat1)*math.Cos(lat2)*sinLon*sinLon
	return 2 * EarthRadiusMeters * math.Asin(math.Sqrt(math.Min(1, h)))
}

// Bearing returns the initial compass bearing from a to b in degrees, measured
// clockwise from true north in [0, 360).
func Bearing(a, b Point) float64 {
	lat1, lon1 := a.Radians()
	lat2, lon2 := b.Radians()
	dLon := lon2 - lon1
	y := math.Sin(dLon) * math.Cos(lat2)
	x := math.Cos(lat1)*math.Sin(lat2) - math.Sin(lat1)*math.Cos(lat2)*math.Cos(dLon)
	deg := math.Atan2(y, x) * 180 / math.Pi
	return math.Mod(deg+360, 360)
}

// Destination returns the point reached by travelling distance metres from p
// along the given bearing in degrees.
func Destination(p Point, bearingDeg, distanceMeters float64) Point {
	lat1, lon1 := p.Radians()
	brg := bearingDeg * math.Pi / 180
	d := distanceMeters / EarthRadiusMeters
	lat2 := math.Asin(math.Sin(lat1)*math.Cos(d) + math.Cos(lat1)*math.Sin(d)*math.Cos(brg))
	lon2 := lon1 + math.Atan2(math.Sin(brg)*math.Sin(d)*math.Cos(lat1),
		math.Cos(d)-math.Sin(lat1)*math.Sin(lat2))
	return NewPoint(lat2*180/math.Pi, lon2*180/math.Pi)
}

// BufferMeters grows a box by approximately d metres on every side. The
// longitude expansion is computed at the latitude furthest from the equator,
// so the result is never too small.
func BufferMeters(b BBox, d float64) BBox {
	if b.IsEmpty() || d <= 0 {
		return b
	}
	dLat := d * DegreesPerMeterLat
	worst := math.Max(math.Abs(b.MinLat), math.Abs(b.MaxLat))
	cosWorst := math.Cos(worst * math.Pi / 180)
	if cosWorst < 1e-6 {
		cosWorst = 1e-6
	}
	dLon := dLat / cosWorst
	return b.Buffer(0).expand(dLat, dLon)
}

func (b BBox) expand(dLat, dLon float64) BBox {
	return BBox{
		MinLat: ClampLat(b.MinLat - dLat),
		MinLon: NormalizeLon(b.MinLon - dLon),
		MaxLat: ClampLat(b.MaxLat + dLat),
		MaxLon: NormalizeLon(b.MaxLon + dLon),
	}
}

// WithinRadius reports whether p lies within radius metres of centre.
func WithinRadius(centre, p Point, radiusMeters float64) bool {
	return Haversine(centre, p) <= radiusMeters
}

// CrossTrackDistance returns the signed distance in metres from p to the great
// circle through a and b. Positive means p lies to the left of a->b.
func CrossTrackDistance(a, b, p Point) float64 {
	d13 := Haversine(a, p) / EarthRadiusMeters
	brg13 := Bearing(a, p) * math.Pi / 180
	brg12 := Bearing(a, b) * math.Pi / 180
	return math.Asin(math.Sin(d13)*math.Sin(brg13-brg12)) * EarthRadiusMeters
}
