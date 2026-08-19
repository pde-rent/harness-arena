package geom

import (
	"errors"
	"math"
	"strings"
)

// polylinePrecision is the number of decimal places preserved by the encoded
// polyline format. Five is the value every client of this service assumes.
const polylinePrecision = 5

var polylineFactor = math.Pow(10, polylinePrecision)

// ErrBadPolyline is returned when an encoded polyline is truncated or contains
// a byte outside the encodable range.
var ErrBadPolyline = errors.New("geom: malformed encoded polyline")

// EncodePolyline renders a point sequence in the encoded-polyline format used
// by the tile API. Coordinates are rounded to five decimal places and stored
// as deltas from the previous point.
func EncodePolyline(ps PointSet) string {
	var sb strings.Builder
	sb.Grow(len(ps) * 6)
	var prevLat, prevLon int64
	for _, p := range ps {
		lat := int64(math.Round(p.Lat * polylineFactor))
		lon := int64(math.Round(p.Lon * polylineFactor))
		encodeSigned(&sb, lat-prevLat)
		encodeSigned(&sb, lon-prevLon)
		prevLat, prevLon = lat, lon
	}
	return sb.String()
}

func encodeSigned(sb *strings.Builder, v int64) {
	u := uint64(v << 1)
	if v < 0 {
		u = uint64(^(v << 1))
	}
	for u >= 0x20 {
		sb.WriteByte(byte((0x20 | (u & 0x1f)) + 63))
		u >>= 5
	}
	sb.WriteByte(byte(u + 63))
}

// DecodePolyline is the inverse of EncodePolyline. It returns ErrBadPolyline
// if the input ends in the middle of a value.
func DecodePolyline(s string) (PointSet, error) {
	var out PointSet
	var lat, lon int64
	i := 0
	for i < len(s) {
		dLat, n, err := decodeSigned(s[i:])
		if err != nil {
			return nil, err
		}
		i += n
		dLon, n, err := decodeSigned(s[i:])
		if err != nil {
			return nil, err
		}
		i += n
		lat += dLat
		lon += dLon
		out = append(out, Point{
			Lat: float64(lat) / polylineFactor,
			Lon: float64(lon) / polylineFactor,
		})
	}
	return out, nil
}

func decodeSigned(s string) (int64, int, error) {
	var result int64
	var shift uint
	for i := 0; i < len(s); i++ {
		b := int64(s[i]) - 63
		if b < 0 {
			return 0, 0, ErrBadPolyline
		}
		result |= (b & 0x1f) << shift
		shift += 5
		if b < 0x20 {
			if result&1 != 0 {
				return ^(result >> 1), i + 1, nil
			}
			return result >> 1, i + 1, nil
		}
	}
	return 0, 0, ErrBadPolyline
}
