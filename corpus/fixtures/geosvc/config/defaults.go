package config

import (
	"time"

	"geosvc/geom"
)

// DefaultRegion is the extent a process indexes when nothing else is
// configured. It is deliberately a whole metropolitan area rather than a
// single city centre so that a default deployment is a realistic size.
var DefaultRegion = geom.BBox{
	MinLat: 52.20,
	MinLon: 12.90,
	MaxLat: 52.80,
	MaxLon: 13.90,
}

// Default returns the configuration a process uses when the operator supplies
// nothing. It always passes Validate.
func Default() Config {
	return Config{
		Server: ServerConfig{
			Addr:                   "127.0.0.1:8080",
			ReadTimeout:            5 * time.Second,
			WriteTimeout:           10 * time.Second,
			MaxBodyBytes:           1 << 20,
			MaxFeaturesPerResponse: 1000,
			BasePath:               "/v1",
		},
		Index: IndexConfig{
			Region:            DefaultRegion,
			Zoom:              14,
			FeaturesPerTile:   24,
			Kind:              "rtree",
			GridCells:         64,
			QueryBufferMeters: 25,
		},
		Cache: CacheConfig{
			Kind:            "segmented",
			Entries:         512,
			TileBudgetBytes: 1 << 20,
			Shards:          8,
			TTL:             0,
		},
		Store: StoreConfig{
			Path:         "",
			SegmentBytes: 16 << 20,
			SyncEvery:    256,
			MaxFeatures:  1 << 20,
			CompactRatio: 0.35,
		},
		Metrics: MetricsConfig{
			Enabled:          true,
			Namespace:        "geosvc",
			HistogramBuckets: []float64{1, 5, 10, 25, 50, 100, 250, 500, 1000},
		},
	}
}

// DefaultServer returns just the server section of Default.
func DefaultServer() ServerConfig { return Default().Server }

// DefaultIndex returns just the index section of Default.
func DefaultIndex() IndexConfig { return Default().Index }

// DefaultCache returns just the cache section of Default.
func DefaultCache() CacheConfig { return Default().Cache }
