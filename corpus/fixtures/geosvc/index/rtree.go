package index

import (
	"sort"

	"geosvc/geom"
)

// RTreeMaxEntries is the branching factor of the R-tree: the largest number of
// children a node may hold before it splits. In a fully packed tree every node
// therefore holds exactly this many children, so the number of nodes at one
// level is the number of nodes at the level below it divided by this constant,
// rounded up.
const RTreeMaxEntries = 16

// RTreeMinEntries is the smallest number of children a node keeps after a
// split. It is a quarter of the maximum, which keeps splits cheap without
// letting the tree get too sparse.
const RTreeMinEntries = RTreeMaxEntries / 4

// NodeResidentBytes is the memory one R-tree node occupies once it is built:
// its own bounding box, the child slice header sized at RTreeMaxEntries, and
// the leaf flag and length bookkeeping.
//
// Capacity planning multiplies this constant by the total number of nodes in
// the tree, leaves included, to get the node share of index-resident memory.
const NodeResidentBytes = 320

type rnode struct {
	box      geom.BBox
	leaf     bool
	entries  []Entry
	children []*rnode
}

func (n *rnode) size() int {
	if n.leaf {
		return len(n.entries)
	}
	return len(n.children)
}

func (n *rnode) recompute() {
	b := geom.EmptyBBox()
	if n.leaf {
		for _, e := range n.entries {
			b = b.Union(e.Box)
		}
	} else {
		for _, c := range n.children {
			b = b.Union(c.box)
		}
	}
	n.box = b
}

// RTree is a bounding-box R-tree with quadratic node splitting.
//
// It is the default index. Lookups by id go through a side map so Remove does
// not have to descend the tree twice.
type RTree struct {
	root  *rnode
	byID  map[string]Entry
	count int
}

// NewRTree returns an empty R-tree.
func NewRTree() *RTree {
	return &RTree{
		root: &rnode{box: geom.EmptyBBox(), leaf: true},
		byID: make(map[string]Entry),
	}
}

// Kind implements Index.
func (t *RTree) Kind() string { return KindRTree }

// Len implements Index.
func (t *RTree) Len() int { return t.count }

// Bounds implements Index.
func (t *RTree) Bounds() geom.BBox { return t.root.box }

// Insert implements Index. Inserting an id that is already present removes the
// old entry first, so an id never appears twice in a search result.
func (t *RTree) Insert(e Entry) error {
	if err := validateEntry(e); err != nil {
		return err
	}
	if _, ok := t.byID[e.ID]; ok {
		t.Remove(e.ID)
	}
	t.insert(e)
	t.byID[e.ID] = e
	t.count++
	return nil
}

func (t *RTree) insert(e Entry) {
	path := []*rnode{}
	n := t.root
	for {
		path = append(path, n)
		if n.leaf {
			break
		}
		n = chooseSubtree(n, e.Box)
	}
	leaf := path[len(path)-1]
	leaf.entries = append(leaf.entries, e)

	for i := len(path) - 1; i >= 0; i-- {
		p := path[i]
		p.recompute()
		if p.size() <= RTreeMaxEntries {
			continue
		}
		sibling := splitNode(p)
		if i == 0 {
			root := &rnode{children: []*rnode{p, sibling}}
			root.recompute()
			t.root = root
			break
		}
		parent := path[i-1]
		parent.children = append(parent.children, sibling)
		parent.recompute()
	}
}

func chooseSubtree(n *rnode, box geom.BBox) *rnode {
	best := n.children[0]
	bestEnl := best.box.Enlargement(box)
	for _, c := range n.children[1:] {
		enl := c.box.Enlargement(box)
		if enl < bestEnl || (enl == bestEnl && c.box.Area() < best.box.Area()) {
			best, bestEnl = c, enl
		}
	}
	return best
}

// splitNode moves roughly half of n's children into a fresh sibling and
// returns it. Both nodes are left with recomputed boxes.
func splitNode(n *rnode) *rnode {
	sibling := &rnode{leaf: n.leaf}
	if n.leaf {
		boxes := make([]geom.BBox, len(n.entries))
		for i, e := range n.entries {
			boxes[i] = e.Box
		}
		left, right := quadraticSplit(boxes)
		keep := make([]Entry, 0, len(left))
		move := make([]Entry, 0, len(right))
		for _, i := range left {
			keep = append(keep, n.entries[i])
		}
		for _, i := range right {
			move = append(move, n.entries[i])
		}
		n.entries, sibling.entries = keep, move
	} else {
		boxes := make([]geom.BBox, len(n.children))
		for i, c := range n.children {
			boxes[i] = c.box
		}
		left, right := quadraticSplit(boxes)
		keep := make([]*rnode, 0, len(left))
		move := make([]*rnode, 0, len(right))
		for _, i := range left {
			keep = append(keep, n.children[i])
		}
		for _, i := range right {
			move = append(move, n.children[i])
		}
		n.children, sibling.children = keep, move
	}
	n.recompute()
	sibling.recompute()
	return sibling
}

// quadraticSplit partitions the given boxes into two index groups, seeding
// each group with the pair of boxes whose combined box wastes the most area.
func quadraticSplit(boxes []geom.BBox) (left, right []int) {
	if len(boxes) < 2 {
		idx := make([]int, len(boxes))
		for i := range boxes {
			idx[i] = i
		}
		return idx, nil
	}
	seedA, seedB := 0, 1
	worst := -1.0
	for i := 0; i < len(boxes); i++ {
		for j := i + 1; j < len(boxes); j++ {
			waste := boxes[i].Union(boxes[j]).Area() - boxes[i].Area() - boxes[j].Area()
			if waste > worst {
				worst, seedA, seedB = waste, i, j
			}
		}
	}
	left = []int{seedA}
	right = []int{seedB}
	boxL, boxR := boxes[seedA], boxes[seedB]
	for k := range boxes {
		if k == seedA || k == seedB {
			continue
		}
		remaining := len(boxes) - k - 1
		switch {
		case len(left)+remaining < RTreeMinEntries:
			left = append(left, k)
			boxL = boxL.Union(boxes[k])
		case len(right)+remaining < RTreeMinEntries:
			right = append(right, k)
			boxR = boxR.Union(boxes[k])
		case boxL.Enlargement(boxes[k]) <= boxR.Enlargement(boxes[k]):
			left = append(left, k)
			boxL = boxL.Union(boxes[k])
		default:
			right = append(right, k)
			boxR = boxR.Union(boxes[k])
		}
	}
	return left, right
}

// Remove implements Index. The tree is rebuilt from the surviving entries,
// which keeps the structure balanced at the cost of a linear rebuild; removals
// are rare compared with inserts in this service.
func (t *RTree) Remove(id string) bool {
	if _, ok := t.byID[id]; !ok {
		return false
	}
	delete(t.byID, id)
	survivors := make([]Entry, 0, len(t.byID))
	for _, e := range t.byID {
		survivors = append(survivors, e)
	}
	sort.Slice(survivors, func(i, j int) bool { return survivors[i].ID < survivors[j].ID })
	t.root = &rnode{box: geom.EmptyBBox(), leaf: true}
	t.count = 0
	for _, e := range survivors {
		t.insert(e)
		t.count++
	}
	return true
}

// Search implements Index.
func (t *RTree) Search(b geom.BBox) []Entry {
	out := make([]Entry, 0, 16)
	var walk func(n *rnode)
	walk = func(n *rnode) {
		if n == nil || !n.box.Intersects(b) {
			return
		}
		if n.leaf {
			for _, e := range n.entries {
				if e.Box.Intersects(b) {
					out = append(out, e)
				}
			}
			return
		}
		for _, c := range n.children {
			walk(c)
		}
	}
	walk(t.root)
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// NodeCount returns the number of nodes currently allocated in the tree,
// leaves included.
func (t *RTree) NodeCount() int {
	var count func(n *rnode) int
	count = func(n *rnode) int {
		if n == nil {
			return 0
		}
		total := 1
		for _, c := range n.children {
			total += count(c)
		}
		return total
	}
	return count(t.root)
}

// Height returns the number of levels in the tree. An empty tree has height 1.
func (t *RTree) Height() int {
	h := 1
	n := t.root
	for !n.leaf && len(n.children) > 0 {
		h++
		n = n.children[0]
	}
	return h
}
