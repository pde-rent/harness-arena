// Package pool holds reusable scratch buffers for the encoding paths.
//
// Encoding a tile or a feature collection allocates a working buffer, fills it
// and writes it out. Doing that per request makes the garbage collector do work
// that is entirely avoidable, because the buffers are all the same shape and
// all die at the end of the request. This package keeps them alive in
// sync.Pool instead: a handler takes a buffer, encodes into it and gives it
// back before it returns.
//
// # Rules for borrowed objects
//
// Two rules make pooling safe, and neither can be checked by the compiler.
//
// First, a pooled object must be returned by the same goroutine that took it,
// on the same call path, and ideally through a deferred Put right after the
// Get. A buffer handed to another goroutine outlives the frame that borrowed
// it, and the borrower then has no way to know when it is safe to return.
// WithBuffer exists so that the common case cannot get this wrong.
//
// Second, nothing may be retained after Put. Put makes the object available to
// any other goroutine immediately, so a slice of the buffer's bytes, a string
// built with unsafe over its storage, or the *bytes.Buffer pointer itself all
// become dangling references the moment Put is called. Anything that must
// survive the Put has to be copied out first; bytes.Buffer.String and
// append([]byte(nil), b.Bytes()...) both copy.
//
// # Ceilings
//
// Both pools refuse to retain objects that have grown past a ceiling, so that a
// single oversized response cannot pin a large allocation for the lifetime of
// the process. Oversized objects are simply dropped and collected normally.
//
// Nothing in this package is required for correctness. Every pool may be
// bypassed by allocating directly, and a Get from a pool that has nothing to
// hand out just allocates.
package pool
