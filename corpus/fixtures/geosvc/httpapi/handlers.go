package httpapi

import (
	"bytes"
	"io"
	"net/http"
	"strings"
)

// healthResponse is the body of the health route.
type healthResponse struct {
	Status   string `json:"status"`
	Features int    `json:"features"`
}

// purgeResponse is the body of the cache purge route. It reports the number of
// features still stored, which purging never changes, so a caller can see at a
// glance that it dropped caches and not data.
type purgeResponse struct {
	Purged   bool `json:"purged"`
	Features int  `json:"features"`
}

// handleHealthz answers the liveness probe. It is deliberately cheap: it only
// asks the backend how many features it holds, which takes the service's read
// lock and nothing else, so a probe can never be the reason a process looks
// unhealthy.
//
// Route: GET {base}/healthz
func (rt *Router) handleHealthz(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	body := healthResponse{Status: "ok", Features: rt.backend.Len()}
	if err := writeJSON(w, http.StatusOK, body); err != nil {
		WriteError(w, err)
	}
}

// handleMetrics writes the registry's text exposition.
//
// The body is rendered into a buffer first so that a failing WriteText cannot
// leave a half-written 200 on the wire. A router built without a registry
// answers with an empty body rather than an error: the route existing but
// reporting nothing is the honest description of a process with metrics
// disabled.
//
// Route: GET {base}/metrics
func (rt *Router) handleMetrics(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	var buf bytes.Buffer
	if rt.reg != nil {
		if err := rt.reg.WriteText(&buf); err != nil {
			WriteError(w, Internal("metrics rendering failed", err))
			return
		}
	}
	h := w.Header()
	h.Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf.Bytes())
}

// handleStats reports how much is stored, which index holds it and how the
// caches in front of it are performing.
//
// Route: GET {base}/stats
func (rt *Router) handleStats(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	raw := rt.backend.CacheStats()
	body := statsResponse{
		Features:  rt.backend.Len(),
		IndexKind: rt.backend.IndexKind(),
		Caches:    make(map[string]cacheStatsJSON, len(raw)),
	}
	for role, s := range raw {
		body.Caches[role] = encodeCacheStats(s)
	}
	if err := writeJSON(w, http.StatusOK, body); err != nil {
		WriteError(w, err)
	}
}

// handleQuery answers a bounding-box query.
//
// The bbox parameter is required and is read in the "minLon,minLat,maxLon,
// maxLat" order geom.BBox.String emits. The layer parameter is optional; an
// empty one matches every layer. The limit parameter is optional and is capped
// at cfg.Server.MaxFeaturesPerResponse, so a client asking for more than the
// process is configured to return gets the configured maximum rather than an
// error — the cap is an operator's decision, not a client mistake.
//
// The backend itself refuses a query matching more than the cap with
// service.ErrTooManyResults, which becomes a 413. That check and this one are
// not redundant: the backend guards the work it would have to do, this one
// shapes the answer that work produced.
//
// Route: GET {base}/query?bbox=…&layer=…&limit=…
func (rt *Router) handleQuery(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	q := r.URL.Query()

	box, err := parseBBox(q.Get("bbox"))
	if err != nil {
		WriteError(w, err)
		return
	}
	layer := strings.TrimSpace(q.Get("layer"))

	maxLimit := rt.cfg.Server.MaxFeaturesPerResponse
	if maxLimit < 1 {
		maxLimit = 1
	}
	limit, err := parseLimit(q.Get("limit"), maxLimit)
	if err != nil {
		WriteError(w, err)
		return
	}
	if limit > maxLimit {
		limit = maxLimit
	}

	features, err := rt.backend.Query(box, layer)
	if err != nil {
		WriteError(w, err)
		return
	}

	truncated := len(features) > limit
	if truncated {
		features = features[:limit]
	}

	body := queryResponse{
		BBox:      encodeBBox(box),
		Layer:     layer,
		Limit:     limit,
		Count:     len(features),
		Truncated: truncated,
		Features:  make([]featureJSON, 0, len(features)),
	}
	for _, f := range features {
		body.Features = append(body.Features, encodeFeature(f))
	}
	if err := writeJSON(w, http.StatusOK, body); err != nil {
		WriteError(w, err)
	}
}

// handleFeature dispatches the three single-feature routes. The layer and id
// are pulled out of the path by hand: the base path is stripped, the remainder
// after "/features/" is split on "/" and must yield exactly two non-empty
// segments.
//
// Routes: GET, PUT, DELETE {base}/features/{layer}/{id}
func (rt *Router) handleFeature(w http.ResponseWriter, r *http.Request) {
	rest, ok := rt.pathSuffix(r.URL.Path, segFeatures)
	if !ok {
		rt.handleNotFound(w, r)
		return
	}
	segs := splitSegments(rest)
	if len(segs) != featurePathSegments {
		WriteError(w, BadRequest("feature path must have the form features/{layer}/{id}", nil))
		return
	}
	layer, id := segs[0], segs[1]

	if !allowMethod(w, r, http.MethodGet, http.MethodPut, http.MethodDelete) {
		return
	}
	switch r.Method {
	case http.MethodPut:
		rt.putFeature(w, r, layer, id)
	case http.MethodDelete:
		rt.deleteFeature(w, layer, id)
	default:
		rt.getFeature(w, layer, id)
	}
}

// getFeature answers GET {base}/features/{layer}/{id}. An unknown id surfaces
// as store.ErrNotFound, which WriteError maps to 404.
func (rt *Router) getFeature(w http.ResponseWriter, layer, id string) {
	f, err := rt.backend.Get(layer, id)
	if err != nil {
		WriteError(w, err)
		return
	}
	if err := writeJSON(w, http.StatusOK, encodeFeature(f)); err != nil {
		WriteError(w, err)
	}
}

// putFeature answers PUT {base}/features/{layer}/{id}.
//
// The path is authoritative for identity: a body carrying a different id or
// layer is rejected rather than silently rewritten, because accepting it would
// make the request's own URL a lie about what it changed. A body that omits
// either field inherits it from the path, which is the common case.
//
// A created feature answers 201, a replaced one 200.
func (rt *Router) putFeature(w http.ResponseWriter, r *http.Request, layer, id string) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		// http.MaxBytesReader turns an oversized body into a read error; every
		// other read failure is the client's connection, which is also a 4xx
		// situation from this side.
		WriteError(w, TooLarge("request body is too large or could not be read", err))
		return
	}
	if len(bytes.TrimSpace(body)) == 0 {
		WriteError(w, BadRequest("request body is empty", nil))
		return
	}

	f, err := decodeFeature(body)
	if err != nil {
		WriteError(w, err)
		return
	}
	if f.ID != "" && f.ID != id {
		WriteError(w, BadRequest("body id does not match the path id", nil))
		return
	}
	if f.Layer != "" && f.Layer != layer {
		WriteError(w, BadRequest("body layer does not match the path layer", nil))
		return
	}
	f.ID, f.Layer = id, layer

	created, err := rt.backend.Put(f)
	if err != nil {
		WriteError(w, err)
		return
	}

	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	if err := writeJSON(w, status, encodeFeature(f)); err != nil {
		WriteError(w, err)
	}
}

// deleteFeature answers DELETE {base}/features/{layer}/{id}. Deleting an
// unknown feature is a 404 rather than a silent success, so a client that
// deletes the wrong id finds out.
func (rt *Router) deleteFeature(w http.ResponseWriter, layer, id string) {
	if !rt.backend.Delete(layer, id) {
		WriteError(w, NotFound("feature not found", nil))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleTile answers a tile request with the tile's envelope and the index
// entries that fall inside it.
//
// Entries, not features: a tile answers the question "what is here", and the
// geometry of each answer is one feature request away. Inlining full features
// would make a dense tile arbitrarily large and would duplicate what the
// feature routes already serve.
//
// Route: GET {base}/tiles/{z}/{x}/{y}
func (rt *Router) handleTile(w http.ResponseWriter, r *http.Request) {
	rest, ok := rt.pathSuffix(r.URL.Path, segTiles)
	if !ok {
		rt.handleNotFound(w, r)
		return
	}
	if !allowMethod(w, r, http.MethodGet) {
		return
	}

	t, err := parseTilePath(rest)
	if err != nil {
		WriteError(w, err)
		return
	}

	ct, err := rt.backend.Tile(t)
	if err != nil {
		WriteError(w, err)
		return
	}
	if ct == nil {
		WriteError(w, NotFound("tile not found", nil))
		return
	}

	body := tileJSON{
		Z: ct.Tile.Z,
		X: ct.Tile.X,
		Y: ct.Tile.Y,
		Envelope: bboxJSON{
			MinLon: ct.Envelope.MinLon,
			MinLat: ct.Envelope.MinLat,
			MaxLon: ct.Envelope.MaxLon,
			MaxLat: ct.Envelope.MaxLat,
		},
		Count:   len(ct.Entries),
		Entries: make([]entryJSON, 0, len(ct.Entries)),
	}
	for _, e := range ct.Entries {
		body.Entries = append(body.Entries, encodeEntry(e))
	}
	if err := writeJSON(w, http.StatusOK, body); err != nil {
		WriteError(w, err)
	}
}

// handlePurge drops every cached entry. Stored features are untouched, so the
// only visible effect is a cold cache and the latency that comes with it.
//
// Route: POST {base}/admin/purge
func (rt *Router) handlePurge(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodPost) {
		return
	}
	rt.backend.PurgeCaches()
	body := purgeResponse{Purged: true, Features: rt.backend.Len()}
	if err := writeJSON(w, http.StatusOK, body); err != nil {
		WriteError(w, err)
	}
}

// handleNotFound answers any path no route claims, in the same JSON error
// shape as every other failure so a client never has to parse two formats.
func (rt *Router) handleNotFound(w http.ResponseWriter, r *http.Request) {
	WriteError(w, NotFound("no route matches "+r.URL.Path, nil))
}
