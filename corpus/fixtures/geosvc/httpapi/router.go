package httpapi

import (
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"geosvc/config"
	"geosvc/geom"
	"geosvc/index"
	"geosvc/metrics"
	"geosvc/service"
	"geosvc/store"
	"geosvc/tile"
)

// Backend is everything the HTTP layer needs from the service.
//
// It is deliberately the whole handler-facing surface and nothing more: the
// handlers never reach past it into the index, the caches or the store, so the
// service stays the single place where a mutation and the invalidations it
// implies happen together. See the package doc for why that rule exists.
type Backend interface {
	// Put inserts or replaces a feature, reporting whether it was created.
	Put(f *store.Feature) (bool, error)
	// Delete drops a feature, reporting whether it existed.
	Delete(layer, id string) bool
	// Get returns one feature from one layer.
	Get(layer, id string) (*store.Feature, error)
	// Query returns the features of a layer intersecting a box. An empty
	// layer matches every layer.
	Query(b geom.BBox, layer string) ([]*store.Feature, error)
	// Tile materialises one tile.
	Tile(t tile.Tile) (*index.CachedTile, error)
	// Len returns how many features are stored.
	Len() int
	// IndexKind reports which index implementation is in use.
	IndexKind() string
	// CacheStats returns each cache's counters, keyed by role.
	CacheStats() map[string]index.CacheStats
	// PurgeCaches drops every cached entry without touching stored state.
	PurgeCaches()
}

// The service is the production Backend; this fails to compile if the two ever
// drift apart.
var _ Backend = (*service.Service)(nil)

// Route path segments, relative to the configured base path.
const (
	segHealthz  = "/healthz"
	segMetrics  = "/metrics"
	segStats    = "/stats"
	segQuery    = "/query"
	segFeatures = "/features/"
	segTiles    = "/tiles/"
	segPurge    = "/admin/purge"
)

// featurePathSegments is the number of path components after {base}/features/,
// namely the layer and the id.
const featurePathSegments = 2

// Router serves the geosvc HTTP API.
//
// It is safe for concurrent use and holds no per-request state: the mux and
// the middleware chain are built once by [NewRouter] and only read afterwards.
type Router struct {
	backend Backend
	cfg     config.Config
	reg     *metrics.Registry

	// base is the configured base path with any trailing slash removed.
	base string
	// handler is the mux wrapped in the middleware chain.
	handler http.Handler
	// seq backs the injected request-id counter.
	seq atomic.Uint64
	// now is the clock the observability middleware reads. It is a field so a
	// test can replace it before the chain is built.
	now func() time.Time
	// onPanic receives a recovered panic value.
	onPanic func(any)
}

// NewRouter builds the router for one backend.
//
// Every route is mounted under cfg.Server.BasePath and the whole mux is
// wrapped in the middleware chain, outermost first: recovery, request id, body
// limit, then observation. Recovery is outermost so it also covers the
// middlewares beneath it; observation is innermost so the latency it records
// is the handler's own.
//
// reg may be nil, in which case nothing is observed and the metrics route
// reports an empty exposition.
func NewRouter(b Backend, cfg config.Config, reg *metrics.Registry) *Router {
	rt := &Router{
		backend: b,
		cfg:     cfg,
		reg:     reg,
		base:    strings.TrimSuffix(cfg.Server.BasePath, "/"),
		now:     time.Now,
	}

	mux := http.NewServeMux()
	mux.HandleFunc(rt.path(segHealthz), rt.handleHealthz)
	mux.HandleFunc(rt.path(segMetrics), rt.handleMetrics)
	mux.HandleFunc(rt.path(segStats), rt.handleStats)
	mux.HandleFunc(rt.path(segQuery), rt.handleQuery)
	mux.HandleFunc(rt.path(segPurge), rt.handlePurge)
	// The two parameterised routes are registered as subtrees; the trailing
	// segments are pulled apart by hand in the handlers rather than by pattern
	// wildcards, which the go 1.21 mux does not have.
	mux.HandleFunc(rt.path(segFeatures), rt.handleFeature)
	mux.HandleFunc(rt.path(segTiles), rt.handleTile)
	mux.HandleFunc("/", rt.handleNotFound)

	rt.handler = Chain(mux,
		Recover(rt.recovered),
		RequestID(rt.nextID),
		LimitBody(cfg.Server.MaxBodyBytes),
		Observe(reg, rt.clock),
	)
	return rt
}

// ServeHTTP implements http.Handler.
func (rt *Router) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rt.handler.ServeHTTP(w, r)
}

// Config returns the configuration the router was built with.
func (rt *Router) Config() config.Config { return rt.cfg }

// BasePath returns the normalised base path every route is mounted under.
func (rt *Router) BasePath() string { return rt.base }

// path joins the base path with a route-relative path.
func (rt *Router) path(rel string) string { return rt.base + rel }

// nextID hands out request ids from a monotonic counter starting at one. It is
// the deterministic sequence [RequestID] is given: no clock, no randomness.
func (rt *Router) nextID() uint64 { return rt.seq.Add(1) }

// clock reads the router's injected time source.
func (rt *Router) clock() time.Time { return rt.now() }

// recovered forwards a recovered panic to the configured hook, if any.
func (rt *Router) recovered(v any) {
	if rt.onPanic != nil {
		rt.onPanic(v)
	}
}

// SetClock replaces the time source the observability middleware reads. It
// must be called before the router serves its first request; the chain reads
// the clock through the router, so a later change would race with in-flight
// requests.
func (rt *Router) SetClock(now func() time.Time) {
	if now != nil {
		rt.now = now
	}
}

// SetPanicHandler installs a hook called with the value of any panic the
// recovery middleware catches. It has the same timing constraint as
// [Router.SetClock].
func (rt *Router) SetPanicHandler(fn func(any)) { rt.onPanic = fn }

// trimBase strips the base path from a request path, reporting whether the
// path was actually under the base.
func (rt *Router) trimBase(p string) (string, bool) {
	if rt.base == "" {
		return p, true
	}
	if !strings.HasPrefix(p, rt.base) {
		return "", false
	}
	rest := p[len(rt.base):]
	if rest == "" {
		return "/", true
	}
	if rest[0] != '/' {
		// The base is only a string prefix here, not a path prefix: "/v1x"
		// must not be read as being under "/v1".
		return "", false
	}
	return rest, true
}

// pathSuffix returns the part of the request path that follows a route prefix,
// with the base path already removed.
func (rt *Router) pathSuffix(p, prefix string) (string, bool) {
	rest, ok := rt.trimBase(p)
	if !ok {
		return "", false
	}
	if !strings.HasPrefix(rest, prefix) {
		return "", false
	}
	return rest[len(prefix):], true
}

// splitSegments splits a path remainder into its non-empty components. A
// remainder with an empty component ("a//b") yields no segments, so a caller
// that expects a fixed count rejects it.
func splitSegments(rest string) []string {
	if rest == "" {
		return nil
	}
	parts := strings.Split(rest, "/")
	for _, p := range parts {
		if p == "" {
			return nil
		}
	}
	return parts
}

// allowMethod checks the request method against the methods a route accepts.
// On a mismatch it writes 405 with an Allow header and reports false, so the
// caller returns immediately.
func allowMethod(w http.ResponseWriter, r *http.Request, allowed ...string) bool {
	for _, m := range allowed {
		if r.Method == m {
			return true
		}
	}
	// HEAD is served by the GET path when a route reads; net/http discards the
	// body for us.
	if r.Method == http.MethodHead {
		for _, m := range allowed {
			if m == http.MethodGet {
				return true
			}
		}
	}
	w.Header().Set("Allow", strings.Join(allowed, ", "))
	WriteError(w, &APIError{
		Status:  http.StatusMethodNotAllowed,
		Code:    "method_not_allowed",
		Message: "method " + r.Method + " is not allowed on this route",
	})
	return false
}
