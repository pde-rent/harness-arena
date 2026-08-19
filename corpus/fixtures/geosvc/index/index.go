package index

import (
	"errors"

	"geosvc/geom"
)

// ErrEmptyID is returned when an entry is inserted without an identifier.
var ErrEmptyID = errors.New("index: entry id must not be empty")

// ErrBadBox is returned when an entry's bounding box is not a valid box.
var ErrBadBox = errors.New("index: entry box is not valid")

// Entry is one indexed object: an identifier, the box it occupies and the
// layer it belongs to. The feature body itself lives in the store.
type Entry struct {
	ID    string
	Layer string
	Box   geom.BBox
}

// Index is the read/write contract every spatial index implements.
//
// Implementations are not required to be safe for concurrent use; the service
// wraps them in a lock. They are required to be deterministic: the same
// sequence of mutations must produce the same Search results in the same
// order.
type Index interface {
	// Insert adds an entry, replacing any entry with the same id.
	Insert(e Entry) error
	// Remove drops the entry with the given id and reports whether it was
	// present.
	Remove(id string) bool
	// Search returns every entry whose box intersects b, ordered by id.
	Search(b geom.BBox) []Entry
	// Len returns the number of live entries.
	Len() int
	// Bounds returns the box covering every live entry.
	Bounds() geom.BBox
	// Kind returns the implementation name, one of KindRTree or KindGrid.
	Kind() string
}

// Filter narrows a search without the index having to know about layers.
type Filter func(Entry) bool

// LayerFilter returns a Filter accepting only entries in the named layer.
func LayerFilter(layer string) Filter {
	return func(e Entry) bool { return e.Layer == layer }
}

// AnyFilter returns a Filter accepting an entry that any of fs accepts. With
// no arguments it accepts everything.
func AnyFilter(fs ...Filter) Filter {
	if len(fs) == 0 {
		return func(Entry) bool { return true }
	}
	return func(e Entry) bool {
		for _, f := range fs {
			if f(e) {
				return true
			}
		}
		return false
	}
}

// SearchFiltered runs a search and keeps only the entries the filter accepts.
func SearchFiltered(ix Index, b geom.BBox, f Filter) []Entry {
	all := ix.Search(b)
	if f == nil {
		return all
	}
	out := make([]Entry, 0, len(all))
	for _, e := range all {
		if f(e) {
			out = append(out, e)
		}
	}
	return out
}

func validateEntry(e Entry) error {
	if e.ID == "" {
		return ErrEmptyID
	}
	if !e.Box.Valid() {
		return ErrBadBox
	}
	return nil
}
