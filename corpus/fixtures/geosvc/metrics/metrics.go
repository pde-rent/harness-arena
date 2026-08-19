package metrics

import (
	"math"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// Counter is a monotonically increasing count. The zero value is ready to use
// and is safe for concurrent use by multiple goroutines.
type Counter struct {
	v atomic.Uint64
}

// Inc adds one to the counter.
func (c *Counter) Inc() { c.v.Add(1) }

// Add adds delta to the counter. Counters only move forward, so a caller that
// wants to record a decrease should use a Gauge instead.
func (c *Counter) Add(delta uint64) { c.v.Add(delta) }

// Value returns the current count.
func (c *Counter) Value() uint64 { return c.v.Load() }

// Reset sets the counter back to zero. It exists for tests and for the
// registry's Reset; production code should let counters run.
func (c *Counter) Reset() { c.v.Store(0) }

// Gauge is a single float64 that may move in either direction, for values such
// as resident entries or bytes in use. The zero value is ready to use and is
// safe for concurrent use by multiple goroutines.
//
// The value is stored as the IEEE-754 bit pattern of the float so that reads
// and writes are single atomic operations.
type Gauge struct {
	bits atomic.Uint64
}

// Set replaces the gauge's value. A NaN is stored as written; readers of a
// gauge should treat NaN as "no sample yet" rather than as a number.
func (g *Gauge) Set(v float64) { g.bits.Store(math.Float64bits(v)) }

// Add adds delta to the gauge, which may be negative. The update is a
// compare-and-swap loop, so concurrent Adds all take effect.
func (g *Gauge) Add(delta float64) {
	for {
		old := g.bits.Load()
		next := math.Float64bits(math.Float64frombits(old) + delta)
		if g.bits.CompareAndSwap(old, next) {
			return
		}
	}
}

// Value returns the gauge's current value.
func (g *Gauge) Value() float64 { return math.Float64frombits(g.bits.Load()) }

// Bucket is one histogram bucket: every observation less than or equal to
// UpperBound and greater than the previous bucket's bound falls in it. Count is
// the number of observations in this bucket alone, not the cumulative count.
type Bucket struct {
	// UpperBound is the inclusive upper bound of the bucket, in the unit of the
	// histogram. The final bucket's bound is +Inf.
	UpperBound float64
	// Count is the number of observations that landed in this bucket.
	Count uint64
}

// Histogram counts observations into a fixed set of buckets and keeps their
// running sum. Bucket bounds are explicit upper bounds expressed in
// milliseconds, which is the unit every latency instrument in the service uses.
//
// A Histogram must be built by NewHistogram; the zero value has no buckets and
// discards everything it is given. It is safe for concurrent use by multiple
// goroutines.
type Histogram struct {
	mu     sync.Mutex
	bounds []float64
	counts []uint64
	count  uint64
	sum    float64
}

// NewHistogram returns a histogram over the given upper bounds, in
// milliseconds. The bounds are copied and sorted, so the caller keeps ownership
// of the slice it passed and need not order it. Duplicate bounds and NaN bounds
// are dropped, and an overflow bucket with an upper bound of +Inf is always
// appended, so a histogram always has at least one bucket. A nil or empty
// bounds slice yields a histogram with only the overflow bucket, which still
// counts and sums correctly.
func NewHistogram(bounds []float64) *Histogram {
	cleaned := make([]float64, 0, len(bounds)+1)
	for _, b := range bounds {
		if math.IsNaN(b) || math.IsInf(b, 1) {
			continue
		}
		cleaned = append(cleaned, b)
	}
	sort.Float64s(cleaned)
	deduped := cleaned[:0]
	for i, b := range cleaned {
		if i > 0 && b == cleaned[i-1] {
			continue
		}
		deduped = append(deduped, b)
	}
	deduped = append(deduped, math.Inf(1))
	return &Histogram{
		bounds: deduped,
		counts: make([]uint64, len(deduped)),
	}
}

// Observe records one observation, in milliseconds. A NaN observation is
// ignored: it belongs in no bucket and would poison the sum.
func (h *Histogram) Observe(v float64) {
	if h == nil || math.IsNaN(v) || len(h.bounds) == 0 {
		return
	}
	i := sort.SearchFloat64s(h.bounds, v)
	if i >= len(h.bounds) {
		i = len(h.bounds) - 1
	}
	h.mu.Lock()
	h.counts[i]++
	h.count++
	h.sum += v
	h.mu.Unlock()
}

// Count returns the number of recorded observations.
func (h *Histogram) Count() uint64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.count
}

// Sum returns the sum of every recorded observation, in milliseconds.
func (h *Histogram) Sum() float64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.sum
}

// Mean returns the arithmetic mean of the observations, or zero when nothing
// has been observed. Unlike Quantile the mean is exact: it comes from the sum,
// not from the buckets.
func (h *Histogram) Mean() float64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.count == 0 {
		return 0
	}
	return h.sum / float64(h.count)
}

// Quantile returns an approximation of the q-quantile, in milliseconds, with q
// in [0,1]; values outside that range are clamped rather than rejected.
//
// The result is approximate by construction. Only bucket counts are kept, not
// the observations, so the value is found by locating the bucket that holds the
// requested rank and interpolating linearly between that bucket's lower and
// upper bounds. The estimate is therefore only as good as the bucket layout:
// inside a wide bucket it assumes a uniform distribution that real latency does
// not have. When the rank falls in the +Inf overflow bucket there is no upper
// bound to interpolate towards, so the largest finite bound is returned, which
// under-reports the tail. Quantile returns zero when nothing has been observed.
func (h *Histogram) Quantile(q float64) float64 {
	if math.IsNaN(q) {
		return 0
	}
	if q < 0 {
		q = 0
	}
	if q > 1 {
		q = 1
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.count == 0 || len(h.bounds) == 0 {
		return 0
	}
	rank := q * float64(h.count)
	var cum uint64
	for i, c := range h.counts {
		if c == 0 {
			continue
		}
		if float64(cum+c) < rank {
			cum += c
			continue
		}
		upper := h.bounds[i]
		if math.IsInf(upper, 1) {
			// Nothing to interpolate towards: fall back to the largest finite
			// bound, or to the mean when the histogram has no finite bounds.
			if i > 0 {
				return h.bounds[i-1]
			}
			return h.sum / float64(h.count)
		}
		lower := 0.0
		if i > 0 {
			lower = h.bounds[i-1]
		}
		frac := (rank - float64(cum)) / float64(c)
		if frac < 0 {
			frac = 0
		}
		if frac > 1 {
			frac = 1
		}
		return lower + (upper-lower)*frac
	}
	return h.bounds[len(h.bounds)-1]
}

// Buckets returns a copy of the histogram's buckets, ordered by upper bound and
// ending with the +Inf overflow bucket. Counts are per bucket, not cumulative.
func (h *Histogram) Buckets() []Bucket {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.bucketsLocked()
}

// bucketsLocked builds the bucket copy; the caller must hold h.mu.
func (h *Histogram) bucketsLocked() []Bucket {
	out := make([]Bucket, len(h.bounds))
	for i, b := range h.bounds {
		out[i] = Bucket{UpperBound: b, Count: h.counts[i]}
	}
	return out
}

// Reset drops every observation and zeroes the sum. The bucket layout is kept.
func (h *Histogram) Reset() {
	h.mu.Lock()
	for i := range h.counts {
		h.counts[i] = 0
	}
	h.count = 0
	h.sum = 0
	h.mu.Unlock()
}

// Timer measures the wall time of one operation and reports it to a histogram
// in milliseconds. A Timer belongs to the goroutine that started it and must
// not be shared; Stop is idempotent, so a deferred Stop next to an explicit one
// is harmless.
type Timer struct {
	h       *Histogram
	now     func() time.Time
	start   time.Time
	stopped bool
	elapsed time.Duration
}

// StartTimer starts a timer that will observe into h when it is stopped.
//
// The clock is injected rather than read implicitly so that callers can drive
// the timer from a test clock or reuse one already-taken timestamp. A nil now
// falls back to time.Now, and a nil histogram is allowed: the timer still
// measures, it simply reports to nobody.
func StartTimer(h *Histogram, now func() time.Time) *Timer {
	if now == nil {
		now = time.Now
	}
	return &Timer{h: h, now: now, start: now()}
}

// Stop ends the measurement, observes the elapsed time into the histogram in
// milliseconds and returns it. Later calls return the same duration without
// observing again. A clock that runs backwards yields a zero duration rather
// than a negative observation.
func (t *Timer) Stop() time.Duration {
	if t == nil {
		return 0
	}
	if t.stopped {
		return t.elapsed
	}
	t.stopped = true
	t.elapsed = t.now().Sub(t.start)
	if t.elapsed < 0 {
		t.elapsed = 0
	}
	if t.h != nil {
		t.h.Observe(float64(t.elapsed) / float64(time.Millisecond))
	}
	return t.elapsed
}
