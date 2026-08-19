package metrics

import (
	"bufio"
	"fmt"
	"io"
	"math"
	"sort"
	"sync"

	"geosvc/config"
)

// Registry owns every instrument of one process and hands them out by name.
//
// Instruments are created on first use and returned unchanged afterwards, so
// looking one up twice with the same name yields the same pointer. Lookup takes
// a mutex, which is why callers are expected to resolve their instruments once
// at construction and then use the returned pointers directly on the hot path.
//
// A Registry is safe for concurrent use by multiple goroutines. The zero value
// is not usable; build one with NewRegistry.
type Registry struct {
	mu         sync.Mutex
	cfg        config.MetricsConfig
	buckets    []float64
	counters   map[string]*Counter
	gauges     map[string]*Gauge
	histograms map[string]*Histogram
}

// NewRegistry returns a registry configured by cfg.
//
// The histogram bucket bounds are copied out of cfg, so later changes to the
// caller's slice do not affect the registry. When cfg.Enabled is false the
// registry still creates and updates real instruments; only publication is
// suppressed. See the package documentation for why.
func NewRegistry(cfg config.MetricsConfig) *Registry {
	buckets := make([]float64, len(cfg.HistogramBuckets))
	copy(buckets, cfg.HistogramBuckets)
	return &Registry{
		cfg:        cfg,
		buckets:    buckets,
		counters:   make(map[string]*Counter),
		gauges:     make(map[string]*Gauge),
		histograms: make(map[string]*Histogram),
	}
}

// Enabled reports whether this registry publishes what it collects. Callers do
// not need to consult it before recording; it exists for endpoints that decide
// whether to expose a metrics route at all.
func (r *Registry) Enabled() bool { return r.cfg.Enabled }

// Namespace returns the prefix applied to every stored metric name.
func (r *Registry) Namespace() string { return r.cfg.Namespace }

// qualify returns the stored name for a caller-supplied name: the configured
// namespace and the name joined by an underscore, or the name unchanged when
// no namespace is configured.
func (r *Registry) qualify(name string) string {
	if r.cfg.Namespace == "" {
		return name
	}
	return r.cfg.Namespace + "_" + name
}

// Counter returns the counter registered under name, creating it on first use.
// The same pointer is returned for every later call with the same name.
func (r *Registry) Counter(name string) *Counter {
	key := r.qualify(name)
	r.mu.Lock()
	defer r.mu.Unlock()
	if c, ok := r.counters[key]; ok {
		return c
	}
	c := &Counter{}
	r.counters[key] = c
	return c
}

// Gauge returns the gauge registered under name, creating it on first use. The
// same pointer is returned for every later call with the same name.
func (r *Registry) Gauge(name string) *Gauge {
	key := r.qualify(name)
	r.mu.Lock()
	defer r.mu.Unlock()
	if g, ok := r.gauges[key]; ok {
		return g
	}
	g := &Gauge{}
	r.gauges[key] = g
	return g
}

// Histogram returns the histogram registered under name, creating it on first
// use with the bucket bounds from the registry's configuration. The same
// pointer is returned for every later call with the same name.
func (r *Registry) Histogram(name string) *Histogram {
	key := r.qualify(name)
	r.mu.Lock()
	defer r.mu.Unlock()
	if h, ok := r.histograms[key]; ok {
		return h
	}
	h := NewHistogram(r.buckets)
	r.histograms[key] = h
	return h
}

// Names returns every registered instrument name, sorted. The three kinds keep
// separate name spaces, so the same name may be registered as more than one
// kind; such a name is still listed once.
func (r *Registry) Names() []string {
	r.mu.Lock()
	seen := make(map[string]struct{}, len(r.counters)+len(r.gauges)+len(r.histograms))
	for name := range r.counters {
		seen[name] = struct{}{}
	}
	for name := range r.gauges {
		seen[name] = struct{}{}
	}
	for name := range r.histograms {
		seen[name] = struct{}{}
	}
	r.mu.Unlock()

	out := make([]string, 0, len(seen))
	for name := range seen {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// Reset zeroes every registered instrument without unregistering it, so
// pointers callers already hold stay valid. Gauges are set to zero and
// histograms keep their bucket layout.
func (r *Registry) Reset() {
	r.mu.Lock()
	counters := make([]*Counter, 0, len(r.counters))
	for _, c := range r.counters {
		counters = append(counters, c)
	}
	gauges := make([]*Gauge, 0, len(r.gauges))
	for _, g := range r.gauges {
		gauges = append(gauges, g)
	}
	histograms := make([]*Histogram, 0, len(r.histograms))
	for _, h := range r.histograms {
		histograms = append(histograms, h)
	}
	r.mu.Unlock()

	for _, c := range counters {
		c.Reset()
	}
	for _, g := range gauges {
		g.Set(0)
	}
	for _, h := range histograms {
		h.Reset()
	}
}

// HistogramSnapshot is one histogram's state at snapshot time. Buckets are
// per-bucket counts ordered by upper bound and ending with the +Inf bucket.
type HistogramSnapshot struct {
	Count   uint64
	Sum     float64
	Buckets []Bucket
}

// Snapshot is the state of every published instrument at one instant. The maps
// are always non-nil, so callers may range over them without a nil check, and
// they are owned by the caller.
//
// The snapshot is not atomic across instruments: each instrument is read
// individually, so counters read late may include events a gauge read early did
// not see. That is acceptable for reporting and avoids stopping the world.
type Snapshot struct {
	Counters   map[string]uint64
	Gauges     map[string]float64
	Histograms map[string]HistogramSnapshot
}

// Snapshot returns the current value of every instrument. A disabled registry
// publishes nothing and returns an empty snapshot even though its instruments
// have been counting all along.
func (r *Registry) Snapshot() Snapshot {
	snap := Snapshot{
		Counters:   make(map[string]uint64),
		Gauges:     make(map[string]float64),
		Histograms: make(map[string]HistogramSnapshot),
	}
	if !r.cfg.Enabled {
		return snap
	}

	r.mu.Lock()
	counters := make(map[string]*Counter, len(r.counters))
	for name, c := range r.counters {
		counters[name] = c
	}
	gauges := make(map[string]*Gauge, len(r.gauges))
	for name, g := range r.gauges {
		gauges[name] = g
	}
	histograms := make(map[string]*Histogram, len(r.histograms))
	for name, h := range r.histograms {
		histograms[name] = h
	}
	r.mu.Unlock()

	for name, c := range counters {
		snap.Counters[name] = c.Value()
	}
	for name, g := range gauges {
		snap.Gauges[name] = g.Value()
	}
	for name, h := range histograms {
		h.mu.Lock()
		snap.Histograms[name] = HistogramSnapshot{
			Count:   h.count,
			Sum:     h.sum,
			Buckets: h.bucketsLocked(),
		}
		h.mu.Unlock()
	}
	return snap
}

// WriteText writes the registry in a Prometheus-ish text format: one "# TYPE"
// line per metric followed by its samples, counters first, then gauges, then
// histograms, each group sorted by name. Floats are formatted with %g and the
// +Inf bucket is written as "+Inf", so the output is deterministic and can be
// compared byte for byte between runs.
//
// A disabled registry writes nothing and returns nil. The first write error is
// returned and stops the output.
func (r *Registry) WriteText(w io.Writer) error {
	snap := r.Snapshot()

	bw := bufio.NewWriter(w)
	for _, name := range sortedCounterNames(snap.Counters) {
		fmt.Fprintf(bw, "# TYPE %s counter\n", name)
		fmt.Fprintf(bw, "%s %d\n", name, snap.Counters[name])
	}
	for _, name := range sortedGaugeNames(snap.Gauges) {
		fmt.Fprintf(bw, "# TYPE %s gauge\n", name)
		fmt.Fprintf(bw, "%s %g\n", name, snap.Gauges[name])
	}
	for _, name := range sortedHistogramNames(snap.Histograms) {
		h := snap.Histograms[name]
		fmt.Fprintf(bw, "# TYPE %s histogram\n", name)
		var cum uint64
		for _, b := range h.Buckets {
			cum += b.Count
			fmt.Fprintf(bw, "%s_bucket{le=\"%s\"} %d\n", name, formatBound(b.UpperBound), cum)
		}
		fmt.Fprintf(bw, "%s_sum %g\n", name, h.Sum)
		fmt.Fprintf(bw, "%s_count %d\n", name, h.Count)
	}
	if err := bw.Flush(); err != nil {
		return err
	}
	return nil
}

// formatBound renders a bucket bound for the text format, spelling the overflow
// bucket "+Inf" rather than letting %g print "+Inf" inconsistently.
func formatBound(v float64) string {
	if math.IsInf(v, 1) {
		return "+Inf"
	}
	return fmt.Sprintf("%g", v)
}

// sortedCounterNames returns the map's keys in sorted order.
func sortedCounterNames(m map[string]uint64) []string {
	out := make([]string, 0, len(m))
	for name := range m {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// sortedGaugeNames returns the map's keys in sorted order.
func sortedGaugeNames(m map[string]float64) []string {
	out := make([]string, 0, len(m))
	for name := range m {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// sortedHistogramNames returns the map's keys in sorted order.
func sortedHistogramNames(m map[string]HistogramSnapshot) []string {
	out := make([]string, 0, len(m))
	for name := range m {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}
