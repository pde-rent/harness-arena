package store

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"
)

// RecordKind tells a replayer what a log record did to the store.
type RecordKind uint8

// The record kinds the append log can hold.
const (
	// RecordInsert created a feature that was not present.
	RecordInsert RecordKind = iota + 1
	// RecordUpdate replaced an existing feature.
	RecordUpdate
	// RecordDelete removed a feature; only its id is carried.
	RecordDelete
)

// String renders the kind for logs and errors.
func (k RecordKind) String() string {
	switch k {
	case RecordInsert:
		return "insert"
	case RecordUpdate:
		return "update"
	case RecordDelete:
		return "delete"
	default:
		return fmt.Sprintf("record(%d)", uint8(k))
	}
}

// valid reports whether the kind is one this package writes.
func (k RecordKind) valid() bool {
	return k == RecordInsert || k == RecordUpdate || k == RecordDelete
}

// Record is one entry of the append log.
//
// Insert and update records carry the whole feature, so replay needs no other
// source. Delete records carry only the id, and leave Feature nil.
type Record struct {
	// Kind is what the record did.
	Kind RecordKind
	// Seq is the log position, starting at one and increasing by one per
	// appended record.
	Seq uint64
	// Feature is the state written by an insert or update, nil for a delete.
	Feature *Feature
	// ID is the affected feature's identifier. It is always set, including
	// when Feature is present.
	ID string
}

// Validate checks that the record is internally consistent.
func (r Record) Validate() error {
	if !r.Kind.valid() {
		return fmt.Errorf("store: invalid record kind %d", uint8(r.Kind))
	}
	if r.ID == "" {
		return errors.New("store: record id must not be empty")
	}
	switch r.Kind {
	case RecordDelete:
		if r.Feature != nil {
			return errors.New("store: delete record must not carry a feature")
		}
	default:
		if r.Feature == nil {
			return fmt.Errorf("store: %s record must carry a feature", r.Kind)
		}
		if r.Feature.ID != r.ID {
			return fmt.Errorf("store: record id %q does not match feature id %q", r.ID, r.Feature.ID)
		}
	}
	return nil
}

// WAL is an append-only log of store mutations.
//
// It writes through a buffered writer and flushes every syncEvery records, so
// a crash loses at most that many appends. All methods are safe for concurrent
// use; a WAL whose underlying writer is not a file still works, which is what
// lets the store run entirely in memory.
type WAL struct {
	mu        sync.Mutex
	w         io.WriteCloser
	buf       *bufio.Writer
	syncEvery int
	sinceSync int
	seq       uint64
	records   int
	bytes     int64
	closed    bool
}

// NewWAL wraps a writer in an append log.
//
// syncEvery is the number of records between automatic flushes; a value below
// one flushes after every record, which is the safe default for callers that
// have not thought about it.
func NewWAL(w io.WriteCloser, syncEvery int) *WAL {
	if syncEvery < 1 {
		syncEvery = 1
	}
	return &WAL{
		w:         w,
		buf:       bufio.NewWriter(w),
		syncEvery: syncEvery,
	}
}

// OpenWAL opens or creates a log file and wraps it. The file is opened for
// appending, so an existing log is extended rather than replaced.
func OpenWAL(path string, syncEvery int) (*WAL, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, fmt.Errorf("store: open wal %q: %w", path, err)
	}
	w := NewWAL(f, syncEvery)
	if info, err := f.Stat(); err == nil {
		w.bytes = info.Size()
	}
	return w, nil
}

// Append writes one record, assigning it the next sequence number.
//
// The sequence number the record was given is visible to the caller through
// Len; the Seq field of the argument is ignored and overwritten on the copy
// that reaches the log.
func (w *WAL) Append(r Record) error {
	if w == nil {
		return nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return errors.New("store: append to closed wal")
	}
	r.Seq = w.seq + 1
	if err := r.Validate(); err != nil {
		return fmt.Errorf("store: append record: %w", err)
	}
	payload := EncodeRecord(r)
	if err := WriteFrame(w.buf, payload); err != nil {
		return fmt.Errorf("store: append record %d: %w", r.Seq, err)
	}
	w.seq = r.Seq
	w.records++
	w.bytes += FrameBytes(len(payload))
	w.sinceSync++
	if w.sinceSync >= w.syncEvery {
		if err := w.flushLocked(); err != nil {
			return err
		}
	}
	return nil
}

// Len returns the number of records this WAL has appended.
func (w *WAL) Len() int {
	if w == nil {
		return 0
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.records
}

// Bytes returns the log's size on disk, counting framing overhead and any
// bytes the file already held when it was opened.
func (w *WAL) Bytes() int64 {
	if w == nil {
		return 0
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.bytes
}

// Seq returns the sequence number of the last appended record, or zero when
// nothing has been appended.
func (w *WAL) Seq() uint64 {
	if w == nil {
		return 0
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.seq
}

// Flush pushes buffered records to the underlying writer, and fsyncs it when
// it is a file.
func (w *WAL) Flush() error {
	if w == nil {
		return nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return nil
	}
	return w.flushLocked()
}

// flushLocked performs the flush with w.mu already held.
func (w *WAL) flushLocked() error {
	if err := w.buf.Flush(); err != nil {
		return fmt.Errorf("store: flush wal: %w", err)
	}
	w.sinceSync = 0
	if f, ok := w.w.(*os.File); ok {
		if err := f.Sync(); err != nil {
			return fmt.Errorf("store: sync wal: %w", err)
		}
	}
	return nil
}

// Close flushes the log and closes the underlying writer. It is safe to call
// more than once; later calls do nothing.
func (w *WAL) Close() error {
	if w == nil {
		return nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return nil
	}
	w.closed = true
	flushErr := w.flushLocked()
	if err := w.w.Close(); err != nil {
		if flushErr != nil {
			return flushErr
		}
		return fmt.Errorf("store: close wal: %w", err)
	}
	return flushErr
}

// ReplayWAL reads every record from a log, in the order it was written.
//
// A log that ends in a torn record is not an error: the records that were
// written in full are returned and the trailing fragment is discarded, which
// is the expected shape of a log after a crash. Any other damage is reported
// as ErrCorruptFrame along with the records read so far.
func ReplayWAL(r io.Reader) ([]Record, error) {
	var out []Record
	br := bufio.NewReader(r)
	for {
		payload, err := ReadFrame(br)
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if errors.Is(err, ErrShortRead) {
			return out, nil
		}
		if err != nil {
			return out, fmt.Errorf("store: replay wal after %d records: %w", len(out), err)
		}
		rec, err := DecodeRecord(payload)
		if err != nil {
			return out, fmt.Errorf("store: replay wal record %d: %w", len(out)+1, err)
		}
		out = append(out, rec)
	}
}

// ApplyRecords folds a replayed log into the live set of features it
// describes, keyed by id. Later records win, and a delete removes the id.
func ApplyRecords(recs []Record) map[string]*Feature {
	live := make(map[string]*Feature, len(recs))
	for _, rec := range recs {
		switch rec.Kind {
		case RecordDelete:
			delete(live, rec.ID)
		case RecordInsert, RecordUpdate:
			if rec.Feature != nil {
				live[rec.ID] = rec.Feature.Clone()
			}
		}
	}
	return live
}

// LiveRecords returns the shortest log that reproduces the same final state as
// recs, together with the number of records that were dropped as superseded.
// Compaction rewrites a log with the slice this returns.
func LiveRecords(recs []Record) (kept []Record, dropped int) {
	last := make(map[string]int, len(recs))
	for i, rec := range recs {
		last[rec.ID] = i
	}
	kept = make([]Record, 0, len(last))
	for i, rec := range recs {
		if last[rec.ID] != i || rec.Kind == RecordDelete {
			dropped++
			continue
		}
		kept = append(kept, rec)
	}
	for i := range kept {
		kept[i].Seq = uint64(i + 1)
	}
	return kept, dropped
}
