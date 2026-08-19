package httpapi

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"geosvc/metrics"
)

// Middleware wraps one handler in another. A middleware must call the handler
// it was given, or write a complete response itself; it must never do neither.
type Middleware func(http.Handler) http.Handler

// requestIDKey is the private context key under which RequestID stores the id.
// It is its own type so that no other package can collide with it.
type requestIDKey struct{}

// requestIDHeader is the response header RequestID sets.
const requestIDHeader = "X-Request-ID"

// Chain wraps h in every middleware, with the FIRST argument outermost.
//
// That is, Chain(h, a, b, c) produces a(b(c(h))): a sees the request first and
// the response last, c sees the request last and the response first. The order
// reads the way the request travels, which is what callers expect when they
// write the chain out:
//
//	Chain(mux, Recover(onPanic), RequestID(seq), LimitBody(n), Observe(reg, now))
//
// Recover is outermost there, so it also catches a panic raised inside any of
// the middlewares below it, and Observe is innermost, so the latency it
// records is the handler's own and not the cost of the chain around it.
//
// Chain with no middlewares returns h unchanged.
func Chain(h http.Handler, ms ...Middleware) http.Handler {
	for i := len(ms) - 1; i >= 0; i-- {
		if ms[i] == nil {
			continue
		}
		h = ms[i](h)
	}
	return h
}

// RequestID stamps every request with an identifier drawn from seq.
//
// The sequence is injected rather than generated here on purpose: no random
// source and no clock is consulted, so a test that supplies a counter starting
// at one gets ids 1, 2, 3 … in request order and can assert on them. A caller
// that wants process-unique ids passes a function closing over an atomic
// counter seeded however it likes.
//
// The id is written to the X-Request-ID response header and stored in the
// request context, where [RequestIDFrom] reads it. A nil seq disables the
// middleware, which then only passes requests through.
func RequestID(seq func() uint64) Middleware {
	return func(next http.Handler) http.Handler {
		if seq == nil {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := seq()
			w.Header().Set(requestIDHeader, strconv.FormatUint(id, 10))
			ctx := context.WithValue(r.Context(), requestIDKey{}, id)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequestIDFrom returns the id [RequestID] stored on the context, and whether
// there was one.
func RequestIDFrom(ctx context.Context) (uint64, bool) {
	if ctx == nil {
		return 0, false
	}
	id, ok := ctx.Value(requestIDKey{}).(uint64)
	return id, ok
}

// Recover turns a panic in a downstream handler into a 500 response.
//
// onPanic, when non-nil, is called with the recovered value before the
// response is written, so the caller can log it. It must not panic itself. The
// response is only written when the handler has not already committed a status
// line; a panic after the first Write can only be logged, because the status
// and part of the body are already on the wire.
func Recover(onPanic func(any)) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			defer func() {
				v := recover()
				if v == nil {
					return
				}
				if onPanic != nil {
					onPanic(v)
				}
				if !rec.wrote {
					WriteError(rec, Internal("internal error", nil))
				}
			}()
			next.ServeHTTP(rec, r)
		})
	}
}

// LimitBody caps how many bytes a handler may read from a request body.
//
// The cap is enforced by http.MaxBytesReader, so a body that exceeds it fails
// the read rather than being silently truncated, and the server also stops
// reading from the connection. A non-positive maxBytes disables the limit.
func LimitBody(maxBytes int64) Middleware {
	return func(next http.Handler) http.Handler {
		if maxBytes <= 0 {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Observe records one counter increment and one latency observation per
// request, in milliseconds.
//
// The clock is injected so a test can drive the histogram from a fake time
// source and get exact bucket placements instead of whatever the machine
// happened to take. A nil registry or a nil clock disables the middleware.
//
// Two instruments are used, both looked up once when the middleware is built:
// "http_requests_total" and "http_request_duration_ms". Per-request lookups
// would put a map access and a lock on the request path for no benefit.
func Observe(reg *metrics.Registry, now func() time.Time) Middleware {
	return func(next http.Handler) http.Handler {
		if reg == nil || now == nil {
			return next
		}
		requests := reg.Counter("http_requests_total")
		latency := reg.Histogram("http_request_duration_ms")
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			defer func() {
				requests.Inc()
				elapsed := now().Sub(start)
				latency.Observe(float64(elapsed) / float64(time.Millisecond))
			}()
			next.ServeHTTP(rec, r)
		})
	}
}

// statusRecorder wraps an http.ResponseWriter to remember the status code and
// the byte count the handler produced.
//
// A handler that writes a body without calling WriteHeader has implicitly sent
// 200, so the recorder is constructed with that status and Write records the
// implicit commit.
type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int64
	wrote  bool
}

// WriteHeader records the status and forwards it once. Later calls are
// dropped, matching what net/http itself does with a repeated WriteHeader.
func (s *statusRecorder) WriteHeader(status int) {
	if s.wrote {
		return
	}
	s.status = status
	s.wrote = true
	s.ResponseWriter.WriteHeader(status)
}

// Write forwards the body, committing an implicit 200 on the first call.
func (s *statusRecorder) Write(b []byte) (int, error) {
	if !s.wrote {
		s.WriteHeader(http.StatusOK)
	}
	n, err := s.ResponseWriter.Write(b)
	s.bytes += int64(n)
	return n, err
}

// Flush forwards a flush when the underlying writer supports one, so wrapping
// does not break a streaming handler.
func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		if !s.wrote {
			s.wrote = true
		}
		f.Flush()
	}
}

// Status returns the status code the handler committed.
func (s *statusRecorder) Status() int { return s.status }

// Bytes returns how many body bytes the handler wrote.
func (s *statusRecorder) Bytes() int64 { return s.bytes }
