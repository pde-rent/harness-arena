package store

import (
	"errors"
	"fmt"
	"sort"
	"strings"

	"geosvc/geom"
)

// FeatureIndexBytes is the amount of memory one feature occupies inside an
// index, counting its identifier, its bounding box, its layer tag and the slot
// that points back into the store. It deliberately excludes the feature's own
// properties and geometry, which live only in the store.
//
// Capacity planning multiplies this constant by the number of indexed features
// to get the feature share of index-resident memory.
const FeatureIndexBytes = 96

// ErrNotFound is returned when a feature id is unknown to the store.
var ErrNotFound = errors.New("store: feature not found")

// ErrDuplicate is returned by Insert when the id is already present.
var ErrDuplicate = errors.New("store: feature already exists")

// ErrFull is returned when the store is at its configured capacity.
var ErrFull = errors.New("store: at capacity")

// GeometryKind enumerates the geometry types the service can store.
type GeometryKind uint8

// The supported geometry kinds.
const (
	GeometryPoint GeometryKind = iota
	GeometryLine
	GeometryPolygon
)

// String renders the kind the way it appears in JSON payloads.
func (k GeometryKind) String() string {
	switch k {
	case GeometryPoint:
		return "point"
	case GeometryLine:
		return "line"
	case GeometryPolygon:
		return "polygon"
	default:
		return fmt.Sprintf("kind(%d)", uint8(k))
	}
}

// ParseGeometryKind is the inverse of GeometryKind.String.
func ParseGeometryKind(s string) (GeometryKind, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "point":
		return GeometryPoint, nil
	case "line", "linestring":
		return GeometryLine, nil
	case "polygon":
		return GeometryPolygon, nil
	default:
		return 0, fmt.Errorf("store: unknown geometry kind %q", s)
	}
}

// Feature is one stored geographic object.
type Feature struct {
	// ID is the caller-supplied stable identifier.
	ID string
	// Layer groups features that are queried together.
	Layer string
	// Kind describes how Points should be interpreted.
	Kind GeometryKind
	// Points is the geometry. A point feature has exactly one; a polygon
	// feature has an implicitly closed outer ring.
	Points geom.PointSet
	// Props is free-form metadata carried through to responses.
	Props map[string]string
	// Version increments on every successful Update.
	Version uint64
}

// Bounds returns the feature's bounding box.
func (f *Feature) Bounds() geom.BBox { return f.Points.Bounds() }

// Centroid returns a representative point for the feature.
func (f *Feature) Centroid() geom.Point {
	switch f.Kind {
	case GeometryPolygon:
		return geom.Ring(f.Points).Centroid()
	default:
		return f.Points.Bounds().Center()
	}
}

// Validate checks that the feature is well formed for its kind.
func (f *Feature) Validate() error {
	if strings.TrimSpace(f.ID) == "" {
		return errors.New("store: feature id must not be empty")
	}
	if strings.TrimSpace(f.Layer) == "" {
		return errors.New("store: feature layer must not be empty")
	}
	switch f.Kind {
	case GeometryPoint:
		if len(f.Points) != 1 {
			return errors.New("store: point feature needs exactly one position")
		}
	case GeometryLine:
		if len(f.Points) < 2 {
			return errors.New("store: line feature needs at least two positions")
		}
	case GeometryPolygon:
		if len(f.Points) < 3 {
			return errors.New("store: polygon feature needs at least three positions")
		}
	default:
		return fmt.Errorf("store: unknown geometry kind %d", f.Kind)
	}
	for _, p := range f.Points {
		if !p.Valid() {
			return fmt.Errorf("store: position %s is out of range", p)
		}
	}
	return nil
}

// Clone returns a deep copy so callers cannot mutate stored state.
func (f *Feature) Clone() *Feature {
	if f == nil {
		return nil
	}
	out := &Feature{
		ID:      f.ID,
		Layer:   f.Layer,
		Kind:    f.Kind,
		Version: f.Version,
		Points:  append(geom.PointSet(nil), f.Points...),
	}
	if f.Props != nil {
		out.Props = make(map[string]string, len(f.Props))
		for k, v := range f.Props {
			out.Props[k] = v
		}
	}
	return out
}

// SortFeatures orders features by id so responses are stable.
func SortFeatures(fs []*Feature) {
	sort.Slice(fs, func(i, j int) bool { return fs[i].ID < fs[j].ID })
}
