// Package service wires the store, the indexes, the caches and the metrics
// registry into the object the HTTP layer talks to.
//
// It owns every lock ordering decision in the process: the service lock is
// always taken before any store or index lock, and never while a cache lock is
// held. The caches are individually safe for concurrent use, so read paths
// that hit the cache never touch the service lock at all.
package service
