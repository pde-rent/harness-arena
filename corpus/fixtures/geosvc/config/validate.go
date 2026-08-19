package config

import (
	"errors"
	"fmt"
	"strings"
)

// Error is a single validation failure, naming the offending field.
type Error struct {
	Field  string
	Reason string
}

func (e Error) Error() string { return fmt.Sprintf("config: %s: %s", e.Field, e.Reason) }

// Errors is the accumulated result of validating a Config.
type Errors []Error

func (es Errors) Error() string {
	parts := make([]string, len(es))
	for i, e := range es {
		parts[i] = e.Error()
	}
	return strings.Join(parts, "; ")
}

// ErrNoErrors is returned by AsError when the slice is empty; callers should
// not see it because AsError returns a nil error in that case.
var ErrNoErrors = errors.New("config: no validation errors")

// AsError returns es as an error, or nil when es is empty.
func (es Errors) AsError() error {
	if len(es) == 0 {
		return nil
	}
	return es
}

// Validate checks the whole configuration and returns every problem it finds
// rather than stopping at the first.
func (c Config) Validate() error {
	var es Errors
	es = append(es, c.Server.validate()...)
	es = append(es, c.Index.validate()...)
	es = append(es, c.Cache.validate()...)
	es = append(es, c.Store.validate()...)
	es = append(es, c.Metrics.validate()...)
	return es.AsError()
}

func (s ServerConfig) validate() Errors {
	var es Errors
	if s.Addr == "" {
		es = append(es, Error{"server.addr", "must not be empty"})
	}
	if s.ReadTimeout <= 0 {
		es = append(es, Error{"server.readTimeout", "must be positive"})
	}
	if s.WriteTimeout <= 0 {
		es = append(es, Error{"server.writeTimeout", "must be positive"})
	}
	if s.MaxBodyBytes <= 0 {
		es = append(es, Error{"server.maxBodyBytes", "must be positive"})
	}
	if s.MaxFeaturesPerResponse <= 0 {
		es = append(es, Error{"server.maxFeaturesPerResponse", "must be positive"})
	}
	if s.BasePath != "" && !strings.HasPrefix(s.BasePath, "/") {
		es = append(es, Error{"server.basePath", "must start with a slash"})
	}
	if strings.HasSuffix(s.BasePath, "/") {
		es = append(es, Error{"server.basePath", "must not end with a slash"})
	}
	return es
}

func (i IndexConfig) validate() Errors {
	var es Errors
	if !i.Region.Valid() {
		es = append(es, Error{"index.region", "must be a valid non-empty box"})
	}
	if i.Zoom < 0 || i.Zoom > 22 {
		es = append(es, Error{"index.zoom", "must be between 0 and 22"})
	}
	if i.FeaturesPerTile <= 0 {
		es = append(es, Error{"index.featuresPerTile", "must be positive"})
	}
	switch i.Kind {
	case "rtree", "grid":
	default:
		es = append(es, Error{"index.kind", `must be "rtree" or "grid"`})
	}
	if i.Kind == "grid" && i.GridCells <= 0 {
		es = append(es, Error{"index.gridCells", "must be positive when kind is grid"})
	}
	if i.QueryBufferMeters < 0 {
		es = append(es, Error{"index.queryBufferMeters", "must not be negative"})
	}
	return es
}

func (c CacheConfig) validate() Errors {
	var es Errors
	switch c.Kind {
	case "lru", "segmented":
	default:
		es = append(es, Error{"cache.kind", `must be "lru" or "segmented"`})
	}
	if c.Entries <= 0 {
		es = append(es, Error{"cache.entries", "must be positive"})
	}
	if c.TileBudgetBytes <= 0 {
		es = append(es, Error{"cache.tileBudgetBytes", "must be positive"})
	}
	if c.Shards <= 0 || c.Shards&(c.Shards-1) != 0 {
		es = append(es, Error{"cache.shards", "must be a positive power of two"})
	}
	if c.TTL < 0 {
		es = append(es, Error{"cache.ttl", "must not be negative"})
	}
	return es
}

func (s StoreConfig) validate() Errors {
	var es Errors
	if s.SegmentBytes <= 0 {
		es = append(es, Error{"store.segmentBytes", "must be positive"})
	}
	if s.SyncEvery < 0 {
		es = append(es, Error{"store.syncEvery", "must not be negative"})
	}
	if s.MaxFeatures <= 0 {
		es = append(es, Error{"store.maxFeatures", "must be positive"})
	}
	if s.CompactRatio <= 0 || s.CompactRatio >= 1 {
		es = append(es, Error{"store.compactRatio", "must be between 0 and 1 exclusive"})
	}
	return es
}

func (m MetricsConfig) validate() Errors {
	var es Errors
	if m.Enabled && m.Namespace == "" {
		es = append(es, Error{"metrics.namespace", "must not be empty when metrics are enabled"})
	}
	for i := 1; i < len(m.HistogramBuckets); i++ {
		if m.HistogramBuckets[i] <= m.HistogramBuckets[i-1] {
			es = append(es, Error{"metrics.histogramBuckets", "must be strictly increasing"})
			break
		}
	}
	return es
}
