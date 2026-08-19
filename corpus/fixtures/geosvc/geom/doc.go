// Package geom holds the primitive geographic value types used across the
// service: points on the WGS84 sphere, axis-aligned bounding boxes in degrees,
// great-circle distance helpers, and the encoded-polyline codec used on the
// wire.
//
// Everything in this package is a value type. Nothing here allocates a mutex,
// touches the network, or reads the clock; the package is safe to use from any
// number of goroutines at once.
//
// Latitudes are always degrees north of the equator in the range [-90, 90] and
// longitudes are always degrees east of the prime meridian in the range
// [-180, 180). Helpers that can produce out-of-range values normalise on the
// way out rather than returning an error.
package geom
