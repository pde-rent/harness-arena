package index

import (
	"fmt"

	"geosvc/config"
)

// NewIndex builds the index implementation named by the configuration.
func NewIndex(cfg config.IndexConfig) (Index, error) {
	switch cfg.Kind {
	case KindRTree:
		return NewRTree(), nil
	case KindGrid:
		return NewGridIndex(cfg.Region, cfg.GridCells), nil
	default:
		return nil, fmt.Errorf("index: unknown index kind %q", cfg.Kind)
	}
}

// NewFeatureCache builds the feature cache implementation named by the
// configuration, sized by cfg.Entries.
func NewFeatureCache(cfg config.CacheConfig) (FeatureCache, error) {
	switch cfg.Kind {
	case "lru":
		return NewLRUCache(cfg.Entries), nil
	case "segmented":
		return NewSegmentedCache(cfg.Entries), nil
	default:
		return nil, fmt.Errorf("index: unknown cache kind %q", cfg.Kind)
	}
}

// NewTileCacheFromConfig builds the rendered-tile cache from configuration.
func NewTileCacheFromConfig(cfg config.CacheConfig) *TileCache {
	return NewTileCache(cfg.TileBudgetBytes)
}

// Compile-time proof that both feature caches satisfy the interface.
var (
	_ FeatureCache = (*LRUCache)(nil)
	_ FeatureCache = (*SegmentedCache)(nil)
	_ Index        = (*RTree)(nil)
	_ Index        = (*GridIndex)(nil)
)
