package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"geosvc/geom"
	"geosvc/service"
	"geosvc/store"
	"geosvc/tile"
)

// APIError is one failure rendered on the wire.
//
// The zero value is not useful; construct one with [BadRequest], [NotFound],
// [Conflict], [TooLarge] or [Internal]. Status is the HTTP status the failure
// maps to, Code is a stable machine-readable token clients may switch on, and
// Message is the human-readable text. Err, when set, is the underlying cause;
// it is never sent to the client, it is only reachable through [APIError.Unwrap]
// so that callers and tests can match on sentinels with errors.Is.
type APIError struct {
	// Status is the HTTP status code the error is written with.
	Status int
	// Code is the stable token identifying the error class.
	Code string
	// Message is the client-facing description.
	Message string
	// Err is the wrapped cause, never serialised.
	Err error
}

// Error implements the error interface. It includes the wrapped cause when
// there is one, because this string is for logs and not for clients.
func (e *APIError) Error() string {
	if e == nil {
		return "<nil>"
	}
	if e.Err != nil {
		return fmt.Sprintf("httpapi: %d %s: %s: %v", e.Status, e.Code, e.Message, e.Err)
	}
	return fmt.Sprintf("httpapi: %d %s: %s", e.Status, e.Code, e.Message)
}

// Unwrap returns the wrapped cause so errors.Is and errors.As see through the
// API error to the sentinel that produced it.
func (e *APIError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

// BadRequest returns a 400 error. Use it for anything the client could fix by
// sending a different request: unparsable parameters, malformed bodies,
// geometry that fails validation.
func BadRequest(message string, err error) *APIError {
	return &APIError{Status: http.StatusBadRequest, Code: "bad_request", Message: message, Err: err}
}

// NotFound returns a 404 error for an addressable thing that does not exist:
// an unknown feature, an unknown route.
func NotFound(message string, err error) *APIError {
	return &APIError{Status: http.StatusNotFound, Code: "not_found", Message: message, Err: err}
}

// Conflict returns a 409 error for a request that is well formed but collides
// with existing state, such as inserting an id the store already holds.
func Conflict(message string, err error) *APIError {
	return &APIError{Status: http.StatusConflict, Code: "conflict", Message: message, Err: err}
}

// TooLarge returns a 413 error for a request or a result that exceeds a
// configured ceiling: an oversized body, a query matching more features than
// the response cap allows, a store at capacity.
func TooLarge(message string, err error) *APIError {
	return &APIError{Status: http.StatusRequestEntityTooLarge, Code: "too_large", Message: message, Err: err}
}

// Internal returns a 500 error. The message is generic on purpose; the cause
// belongs in the log, not in the response.
func Internal(message string, err error) *APIError {
	return &APIError{Status: http.StatusInternalServerError, Code: "internal", Message: message, Err: err}
}

// errorBody is the wire shape of a failure: {"error":{"code":…,"message":…}}.
type errorBody struct {
	Error errorDetail `json:"error"`
}

// errorDetail carries the two client-facing fields of a failure.
type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// WriteError renders err as a JSON failure and sets the matching status.
//
// An *APIError is written as it stands. Any other error is classified by the
// sentinel it wraps, checked with errors.Is so that wrapped causes still map
// correctly:
//
//	store.ErrNotFound          404
//	store.ErrDuplicate         409
//	store.ErrFull              413
//	service.ErrTooManyResults  413
//	tile.ErrZoomRange          400
//	tile.ErrTileRange          400
//	geom.ErrBadPolyline        400
//
// Anything else is a 500 with a generic message, because an unclassified error
// is by definition one the client cannot act on.
func WriteError(w http.ResponseWriter, err error) {
	apiErr := classify(err)

	body, mErr := json.Marshal(errorBody{Error: errorDetail{
		Code:    apiErr.Code,
		Message: apiErr.Message,
	}})
	if mErr != nil {
		// The body is two plain strings, so this is unreachable in practice;
		// fall back to a fixed payload rather than write a partial one.
		body = []byte(`{"error":{"code":"internal","message":"error encoding failed"}}`)
		apiErr.Status = http.StatusInternalServerError
	}

	h := w.Header()
	h.Set("Content-Type", contentTypeJSON)
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(apiErr.Status)
	_, _ = w.Write(body)
	_, _ = w.Write([]byte("\n"))
}

// classify maps an arbitrary error onto the APIError that describes it.
func classify(err error) *APIError {
	if err == nil {
		return Internal("unknown error", nil)
	}

	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr
	}

	switch {
	case errors.Is(err, store.ErrNotFound):
		return NotFound("feature not found", err)
	case errors.Is(err, store.ErrDuplicate):
		return Conflict("feature already exists", err)
	case errors.Is(err, store.ErrFull):
		return TooLarge("store is at capacity", err)
	case errors.Is(err, service.ErrTooManyResults):
		return TooLarge("query matched more features than the response cap", err)
	case errors.Is(err, tile.ErrZoomRange):
		return BadRequest("zoom out of range", err)
	case errors.Is(err, tile.ErrTileRange):
		return BadRequest("tile coordinate out of range", err)
	case errors.Is(err, geom.ErrBadPolyline):
		return BadRequest("malformed encoded polyline", err)
	default:
		return Internal("internal error", err)
	}
}
