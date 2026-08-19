// Package metrics is a tiny dependency-free instrument registry.
//
// The registry owns three instrument kinds — counters, gauges and histograms —
// and hands each of them out by name. Every instrument is created on first use
// and returned unchanged afterwards, so a caller may look one up once during
// construction and keep the pointer for the lifetime of the process. All
// instruments are safe for concurrent use by multiple goroutines.
//
// # Disabled registries
//
// When config.MetricsConfig.Enabled is false the registry still hands out live
// instrument objects: real counters that really count, real histograms that
// really observe. Nothing is stubbed out and no method turns into a no-op.
// What changes is publication — Snapshot and WriteText report an empty result
// for a disabled registry, so the numbers are collected but never leave the
// process.
//
// That trade is deliberate. The alternative, a no-op instrument behind an
// interface, would put a nil check or a dynamic dispatch on every Inc and every
// Observe, which is exactly the code that sits inside the request path. Handing
// out concrete pointers keeps the hot path branch-free: the caller calls
// (*Counter).Inc, which is one atomic add, whether or not anyone will ever read
// the value. The cost of a disabled registry is therefore a few atomics per
// request rather than a conditional per instrument, and callers never have to
// write "if reg.Enabled()" around their instrumentation.
//
// # Naming
//
// Instrument names are stored with the configured namespace prefixed as
// "namespace_name". An empty namespace stores the name unchanged. Names are
// reported sorted by Names, Snapshot and WriteText so that output is stable
// across runs and can be diffed.
//
// # Clocks
//
// Timers never read the clock implicitly. StartTimer takes the time source as
// an argument so that tests can drive latency histograms from a fake clock and
// so that a caller batching many observations can reuse one time.Now result.
package metrics
