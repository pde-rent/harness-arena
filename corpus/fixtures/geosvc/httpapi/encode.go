package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"geosvc/geom"
	"geosvc/index"
	"geosvc/store"
	"geosvc/tile"
)

// contentTypeJSON is the Content-Type every JSON response carries.
const contentTypeJSON = "application/json; charset=utf-8"

// bboxFields is the number of comma-separated numbers a bbox parameter holds.
const bboxFields = 4

// pointJSON is one position on the wire, in the same lat/lon order geom.Point
// declares its fields.
type pointJSON struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

// bboxJSON is a bounding box on the wire. The field order mirrors the
// "minLon,minLat,maxLon,maxLat" order geom.BBox.String emits and parseBBox
// accepts, so the JSON form and the query-parameter form agree.
type bboxJSON struct {
	MinLon float64 `json:"minLon"`
	MinLat float64 `json:"minLat"`
	MaxLon float64 `json:"maxLon"`
	MaxLat float64 `json:"maxLat"`
}

// featureJSON is one stored feature on the wire.
//
// Kind travels as its string form ("point", "line", "polygon") rather than as
// the numeric store.GeometryKind, so the payload stays readable and survives a
// renumbering of the constants. BBox is derived on write and ignored on read:
// it is a convenience for clients, never an input.
type featureJSON struct {
	ID      string            `json:"id"`
	Layer   string            `json:"layer"`
	Kind    string            `json:"kind"`
	Points  []pointJSON       `json:"points"`
	Props   map[string]string `json:"props,omitempty"`
	Version uint64            `json:"version"`
	BBox    *bboxJSON         `json:"bbox,omitempty"`
}

// entryJSON is one index entry on the wire: the identity of a feature plus the
// box it occupies, without its geometry or properties.
type entryJSON struct {
	ID    string   `json:"id"`
	Layer string   `json:"layer"`
	BBox  bboxJSON `json:"bbox"`
}

// tileJSON is one materialised tile on the wire.
type tileJSON struct {
	Z        int         `json:"z"`
	X        int         `json:"x"`
	Y        int         `json:"y"`
	Envelope bboxJSON    `json:"envelope"`
	Count    int         `json:"count"`
	Entries  []entryJSON `json:"entries"`
}

// queryResponse is the body of a successful bbox query.
//
// Count is the number of features actually returned. Truncated reports whether
// the limit cut the result short, so a client can tell an exhaustive answer
// from a partial one without comparing counts itself.
type queryResponse struct {
	BBox      bboxJSON      `json:"bbox"`
	Layer     string        `json:"layer,omitempty"`
	Limit     int           `json:"limit"`
	Count     int           `json:"count"`
	Truncated bool          `json:"truncated"`
	Features  []featureJSON `json:"features"`
}

// cacheStatsJSON is one cache's counters on the wire.
type cacheStatsJSON struct {
	Hits      uint64  `json:"hits"`
	Misses    uint64  `json:"misses"`
	Inserts   uint64  `json:"inserts"`
	Updates   uint64  `json:"updates"`
	Evictions uint64  `json:"evictions"`
	Entries   int     `json:"entries"`
	Bytes     int     `json:"bytes"`
	HitRatio  float64 `json:"hitRatio"`
}

// statsResponse is the body of the stats route: how much is stored, which
// index implementation holds it, and how the caches in front of it are doing.
type statsResponse struct {
	Features  int                       `json:"features"`
	IndexKind string                    `json:"indexKind"`
	Caches    map[string]cacheStatsJSON `json:"caches"`
}

// encodeBBox converts a box to its wire form.
func encodeBBox(b geom.BBox) bboxJSON {
	return bboxJSON{MinLon: b.MinLon, MinLat: b.MinLat, MaxLon: b.MaxLon, MaxLat: b.MaxLat}
}

// encodeFeature converts a stored feature to its wire form. The feature is
// only read; the returned value shares no mutable state with it beyond the
// property strings, which are immutable.
func encodeFeature(f *store.Feature) featureJSON {
	if f == nil {
		return featureJSON{}
	}
	out := featureJSON{
		ID:      f.ID,
		Layer:   f.Layer,
		Kind:    f.Kind.String(),
		Points:  make([]pointJSON, 0, len(f.Points)),
		Version: f.Version,
	}
	for _, p := range f.Points {
		out.Points = append(out.Points, pointJSON{Lat: p.Lat, Lon: p.Lon})
	}
	// Props is copied rather than aliased so a later mutation of the stored
	// feature cannot change a response that is still being written. The map is
	// emitted with its keys in sorted order: encoding/json already sorts map
	// keys when it marshals a map, so no explicit sort is needed here for the
	// output to be deterministic.
	if len(f.Props) > 0 {
		out.Props = make(map[string]string, len(f.Props))
		for k, v := range f.Props {
			out.Props[k] = v
		}
	}
	if b := f.Bounds(); !b.IsEmpty() {
		box := encodeBBox(b)
		out.BBox = &box
	}
	return out
}

// encodeEntry converts one index entry to its wire form.
func encodeEntry(e index.Entry) entryJSON {
	return entryJSON{ID: e.ID, Layer: e.Layer, BBox: encodeBBox(e.Box)}
}

// encodeCacheStats converts one cache snapshot to its wire form.
func encodeCacheStats(s index.CacheStats) cacheStatsJSON {
	return cacheStatsJSON{
		Hits:      s.Hits,
		Misses:    s.Misses,
		Inserts:   s.Inserts,
		Updates:   s.Updates,
		Evictions: s.Evictions,
		Entries:   s.Entries,
		Bytes:     s.Bytes,
		HitRatio:  s.HitRatio(),
	}
}

// decodeFeature parses a feature payload. It rejects unknown fields so a
// client that misspells one is told about it rather than silently ignored, and
// it validates the result through store.Feature.Validate, which is the same
// check the service applies.
//
// The bbox field, if present, is accepted and discarded: bounds are derived
// from the geometry and are never taken from the caller.
func decodeFeature(b []byte) (*store.Feature, error) {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()

	var in featureJSON
	if err := dec.Decode(&in); err != nil {
		return nil, BadRequest("malformed feature payload", err)
	}
	// Reject trailing content so "{}{}" is an error rather than a silent
	// single-object decode.
	if dec.More() {
		return nil, BadRequest("feature payload has trailing content", nil)
	}

	kind, err := store.ParseGeometryKind(in.Kind)
	if err != nil {
		return nil, BadRequest(fmt.Sprintf("unknown geometry kind %q", in.Kind), err)
	}

	f := &store.Feature{
		ID:      in.ID,
		Layer:   in.Layer,
		Kind:    kind,
		Version: in.Version,
		Points:  make(geom.PointSet, 0, len(in.Points)),
	}
	for i, p := range in.Points {
		if math.IsNaN(p.Lat) || math.IsNaN(p.Lon) || math.IsInf(p.Lat, 0) || math.IsInf(p.Lon, 0) {
			return nil, BadRequest(fmt.Sprintf("position %d is not a finite coordinate", i), nil)
		}
		f.Points = append(f.Points, geom.Point{Lat: p.Lat, Lon: p.Lon})
	}
	if len(in.Props) > 0 {
		f.Props = make(map[string]string, len(in.Props))
		for k, v := range in.Props {
			f.Props[k] = v
		}
	}

	if err := f.Validate(); err != nil {
		return nil, BadRequest(err.Error(), err)
	}
	return f, nil
}

// writeJSON writes v as a JSON body with the given status.
//
// The body is marshalled in full before anything is written, so an encoding
// failure surfaces as an error the caller can turn into a 500 rather than as a
// truncated 200 that has already committed its status line.
func writeJSON(w http.ResponseWriter, status int, v any) error {
	body, err := json.Marshal(v)
	if err != nil {
		return Internal("response encoding failed", err)
	}

	h := w.Header()
	h.Set("Content-Type", contentTypeJSON)
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)

	if _, err := w.Write(body); err != nil {
		return err
	}
	_, err = w.Write([]byte("\n"))
	return err
}

// parseBBox parses the "minLon,minLat,maxLon,maxLat" form that
// geom.BBox.String emits, which is also the order every geospatial client
// already speaks.
//
// It rejects a wrong number of fields, a field that is not a finite number,
// coordinates outside the legal range, and a box whose minimum exceeds its
// maximum on either axis. An inverted box is an error rather than something to
// silently normalise: it almost always means the caller swapped lat and lon,
// and quietly re-ordering the corners would answer a question nobody asked.
func parseBBox(s string) (geom.BBox, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return geom.BBox{}, BadRequest("bbox parameter is required", nil)
	}

	parts := strings.Split(s, ",")
	if len(parts) != bboxFields {
		return geom.BBox{}, BadRequest(fmt.Sprintf(
			"bbox needs %d comma-separated values in minLon,minLat,maxLon,maxLat order, got %d",
			bboxFields, len(parts)), nil)
	}

	names := [bboxFields]string{"minLon", "minLat", "maxLon", "maxLat"}
	var vals [bboxFields]float64
	for i, p := range parts {
		v, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil {
			return geom.BBox{}, BadRequest(fmt.Sprintf("bbox field %s is not a number", names[i]), err)
		}
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return geom.BBox{}, BadRequest(fmt.Sprintf("bbox field %s is not finite", names[i]), nil)
		}
		vals[i] = v
	}

	b := geom.BBox{MinLon: vals[0], MinLat: vals[1], MaxLon: vals[2], MaxLat: vals[3]}
	if b.MinLon > b.MaxLon || b.MinLat > b.MaxLat {
		return geom.BBox{}, BadRequest("bbox is inverted: every minimum must not exceed its maximum", nil)
	}
	if !b.Valid() {
		return geom.BBox{}, BadRequest("bbox coordinates are out of range", nil)
	}
	return b, nil
}

// parseTilePath parses the "z/x/y" form tile.Tile.String emits.
//
// Every component must be a base-ten integer with no sign and no padding
// beyond what strconv accepts, the zoom must be within [0, tile.MaxZoom] and
// the coordinates must exist at that zoom. Range failures are reported with
// tile.ErrZoomRange and tile.ErrTileRange as the cause so callers that already
// match on those sentinels keep working.
func parseTilePath(s string) (tile.Tile, error) {
	parts := strings.Split(strings.Trim(strings.TrimSpace(s), "/"), "/")
	if len(parts) != 3 {
		return tile.Tile{}, BadRequest("tile path must have the form z/x/y", nil)
	}

	names := [3]string{"z", "x", "y"}
	var vals [3]int
	for i, p := range parts {
		v, err := strconv.Atoi(p)
		if err != nil {
			return tile.Tile{}, BadRequest(fmt.Sprintf("tile component %s is not an integer", names[i]), err)
		}
		vals[i] = v
	}

	t := tile.Tile{Z: vals[0], X: vals[1], Y: vals[2]}
	if tile.Size(t.Z) == 0 {
		return tile.Tile{}, BadRequest(
			fmt.Sprintf("zoom %d is outside [0, %d]", t.Z, tile.MaxZoom), tile.ErrZoomRange)
	}
	if !t.Valid() {
		return tile.Tile{}, BadRequest(
			fmt.Sprintf("tile %s does not exist at zoom %d", t, t.Z), tile.ErrTileRange)
	}
	return t, nil
}

// parseLimit parses an optional positive integer query parameter, returning
// def when the parameter is absent or empty.
func parseLimit(raw string, def int) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, BadRequest("limit is not an integer", err)
	}
	if n <= 0 {
		return 0, BadRequest("limit must be positive", errors.New("httpapi: non-positive limit"))
	}
	return n, nil
}
