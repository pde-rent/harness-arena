// Package httpapi is the HTTP surface of geosvc.
//
// The package owns three things and nothing else: the route table, the wire
// representation of the objects that travel over it, and the middleware chain
// every request passes through. Everything behind the routes is reached
// through a single narrow interface, [Backend], which *service.Service
// satisfies.
//
// # Route table
//
// Every route is mounted under config.ServerConfig.BasePath, written {base}
// below. The base path never carries a trailing slash, so a base of "/v1"
// yields "/v1/healthz" and an empty base yields "/healthz".
//
//	GET    {base}/healthz                 liveness, always 200 when serving
//	GET    {base}/metrics                 registry text exposition
//	GET    {base}/stats                   feature count, index kind, cache stats
//	GET    {base}/query                   bbox query, ?bbox= &layer= &limit=
//	GET    {base}/features/{layer}/{id}   one feature
//	PUT    {base}/features/{layer}/{id}   insert or replace one feature
//	DELETE {base}/features/{layer}/{id}   drop one feature
//	GET    {base}/tiles/{z}/{x}/{y}       one materialised tile
//	POST   {base}/admin/purge             drop every cached entry
//
// A request that matches a route's path but not its method is answered with
// 405 and an Allow header listing the methods that path does accept. A request
// that matches no route at all is answered with 404 in the same JSON error
// shape as every other failure; see [WriteError].
//
// Path parameters are extracted by hand: the base path is stripped, the
// remainder is split on "/" and the segments are read positionally. The router
// deliberately does not use the Go 1.22 pattern wildcards, so it builds and
// behaves identically on the go 1.21 toolchain the module declares.
//
// # The Backend rule
//
// Handlers never touch the index, the caches or the store directly. They may
// only call methods on [Backend]. That is not a style preference, it is what
// keeps the concurrency story sound: the service owns the lock that guards the
// index and the store, and it is the only place where a mutation, its index
// update and the cache invalidations that follow happen as one unit. A handler
// that reached into the store would see state the index has not caught up
// with, and a handler that reached into a cache would serve entries a
// concurrent write had already superseded.
//
// The rule also keeps this package testable without a real service: a fake
// implementing the nine Backend methods is enough to drive every route.
//
// # Encoding
//
// Responses are JSON and deterministic. Feature properties are emitted as a
// JSON object whose keys encoding/json sorts, and features in a query response
// are ordered by id by the service. Two identical requests against an
// unchanged data set therefore produce byte-identical bodies, which makes the
// responses safe to diff in tests and to hash for caching.
package httpapi
