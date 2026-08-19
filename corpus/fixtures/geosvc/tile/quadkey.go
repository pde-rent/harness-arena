package tile

import (
	"errors"
	"strings"
)

// ErrBadQuadKey is returned when a quadkey contains a digit other than 0-3.
var ErrBadQuadKey = errors.New("tile: malformed quadkey")

// QuadKey renders the tile as a Bing-style quadkey. The key's length always
// equals the tile's zoom, so the zero-zoom tile has the empty key.
func (t Tile) QuadKey() string {
	var sb strings.Builder
	sb.Grow(t.Z)
	for i := t.Z; i > 0; i-- {
		digit := byte('0')
		mask := 1 << uint(i-1)
		if t.X&mask != 0 {
			digit++
		}
		if t.Y&mask != 0 {
			digit += 2
		}
		sb.WriteByte(digit)
	}
	return sb.String()
}

// FromQuadKey parses a quadkey back into a tile.
func FromQuadKey(key string) (Tile, error) {
	if len(key) > MaxZoom {
		return Tile{}, ErrZoomRange
	}
	t := Tile{Z: len(key)}
	for i := t.Z; i > 0; i-- {
		mask := 1 << uint(i-1)
		switch key[t.Z-i] {
		case '0':
		case '1':
			t.X |= mask
		case '2':
			t.Y |= mask
		case '3':
			t.X |= mask
			t.Y |= mask
		default:
			return Tile{}, ErrBadQuadKey
		}
	}
	return t, nil
}

// QuadKeyPrefix reports whether a is an ancestor of b, which for quadkeys is
// simply a prefix test.
func QuadKeyPrefix(a, b string) bool { return strings.HasPrefix(b, a) }
