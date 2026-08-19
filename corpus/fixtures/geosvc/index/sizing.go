package index

// This file holds the capacity-planning model. It is pure arithmetic over the
// constants in this package: nothing here inspects a live index.

// LeafNodeCount returns how many leaf nodes an R-tree needs to hold the given
// number of features when every leaf is filled to RTreeMaxEntries. The last
// leaf may be partially filled, so the division rounds up.
func LeafNodeCount(features int) int {
	if features <= 0 {
		return 0
	}
	return ceilDiv(features, RTreeMaxEntries)
}

// TotalNodeCount returns the total number of nodes in a packed R-tree holding
// the given number of features, leaves included.
//
// The leaves are counted by LeafNodeCount. Above them, each level holds the
// number of nodes at the level below divided by RTreeMaxEntries and rounded
// up, and levels are added until a level holds exactly one node, the root.
// A tree whose leaf count is already one has that leaf as its root and so has
// exactly one node.
func TotalNodeCount(features int) int {
	leaves := LeafNodeCount(features)
	if leaves == 0 {
		return 0
	}
	total := leaves
	level := leaves
	for level > 1 {
		level = ceilDiv(level, RTreeMaxEntries)
		total += level
	}
	return total
}

// LevelSizes returns the node count of each level from the leaves up to the
// root, so operators can see the shape of the tree they are planning.
func LevelSizes(features int) []int {
	leaves := LeafNodeCount(features)
	if leaves == 0 {
		return nil
	}
	sizes := []int{leaves}
	level := leaves
	for level > 1 {
		level = ceilDiv(level, RTreeMaxEntries)
		sizes = append(sizes, level)
	}
	return sizes
}

func ceilDiv(a, b int) int {
	if b <= 0 {
		return 0
	}
	return (a + b - 1) / b
}
