package config

import (
	"time"

	"geosvc/geom"
)

// Config is the whole configuration of one geosvc process.
type Config struct {
	Server  ServerConfig
	Index   IndexConfig
	Cache   CacheConfig
	Store   StoreConfig
	Metrics MetricsConfig
}

// ServerConfig covers the HTTP listener and its timeouts.
type ServerConfig struct {
	// Addr is the listen address in host:port form.
	Addr string
	// ReadTimeout bounds how long a request may take to arrive in full.
	ReadTimeout time.Duration
	// WriteTimeout bounds how long a handler may take to produce a response.
	WriteTimeout time.Duration
	// MaxBodyBytes is the largest request body the API will read.
	MaxBodyBytes int64
	// MaxFeaturesPerResponse caps how many features one query may return.
	MaxFeaturesPerResponse int
	// BasePath is prefixed to every route, without a trailing slash.
	BasePath string
}

// IndexConfig describes the region the process indexes and how densely.
type IndexConfig struct {
	// Region is the geographic extent the process is responsible for. The
	// sizing model assumes the whole region is indexed at Zoom.
	Region geom.BBox
	// Zoom is the tile zoom level at which the region is decomposed. Every
	// tile that intersects Region at this zoom is an indexed tile.
	Zoom int
	// FeaturesPerTile is the planning figure for how many features an indexed
	// tile holds. Capacity planning multiplies it by the number of tiles that
	// cover Region at Zoom to get the number of indexed features.
	FeaturesPerTile int
	// Kind selects the index implementation: "rtree" or "grid".
	Kind string
	// GridCells is the number of cells per axis used when Kind is "grid".
	GridCells int
	// QueryBufferMeters is added to every query box before it is evaluated so
	// that features straddling a boundary are still returned.
	QueryBufferMeters float64
}

// CacheConfig covers both cache layers: the per-feature cache in front of the
// index and the rendered-tile cache in front of the store.
type CacheConfig struct {
	// Kind selects the feature cache implementation: "lru" or "segmented".
	Kind string
	// Entries is the capacity of the feature cache, counted in entries. Both
	// feature cache implementations take this number as their capacity.
	Entries int
	// TileBudgetBytes is the memory budget of the rendered-tile cache. The
	// tile cache holds as many whole tiles as fit in this budget.
	TileBudgetBytes int64
	// Shards is the number of independent lock domains the feature cache is
	// split into. It must be a power of two.
	Shards int
	// TTL bounds how long a cached entry may be served after it was written.
	// Zero disables expiry.
	TTL time.Duration
}

// StoreConfig covers the feature store and its append log.
type StoreConfig struct {
	// Path is the directory holding the append log. Empty means memory only.
	Path string
	// SegmentBytes is the size at which the append log rolls to a new segment.
	SegmentBytes int64
	// SyncEvery is the number of appended records between fsyncs.
	SyncEvery int
	// MaxFeatures caps how many features the in-memory store will hold.
	MaxFeatures int
	// CompactRatio is the dead-record fraction at which compaction runs.
	CompactRatio float64
}

// MetricsConfig covers the metrics registry.
type MetricsConfig struct {
	// Enabled turns collection on. When false the registry hands out no-op
	// instruments and costs nothing on the hot path.
	Enabled bool
	// Namespace is prefixed to every metric name.
	Namespace string
	// HistogramBuckets are the upper bounds, in milliseconds, of the latency
	// histogram buckets.
	HistogramBuckets []float64
}
