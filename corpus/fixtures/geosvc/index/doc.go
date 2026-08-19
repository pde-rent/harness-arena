// Package index holds the spatial indexes and the cache layers that sit in
// front of them.
//
// There are two index implementations behind the Index interface: an R-tree,
// which is the default, and a uniform grid, which is cheaper to build and
// faster for uniformly distributed data. There are likewise two
// implementations behind the FeatureCache interface. Both pairs are selected
// by configuration and constructed through the helpers in factory.go.
//
// The indexes themselves hold identifiers and bounding boxes only; the cache
// layers in this package are the one place that holds whole features, and they
// hold them read-only.
package index

// Kind names used in configuration and reported by the Kind methods.
const (
	KindRTree = "rtree"
	KindGrid  = "grid"
)
