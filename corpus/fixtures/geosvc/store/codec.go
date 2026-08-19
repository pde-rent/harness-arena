package store

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"math"
	"sort"

	"geosvc/geom"
)

// codecVersion is the wire version of every payload this file produces. It is
// the first byte of an encoded feature and of an encoded record, so a decoder
// can reject a log written by an incompatible build before it interprets any
// of the bytes that follow.
const codecVersion uint8 = 1

// maxFrameBytes bounds how large a single framed payload may be. A length
// prefix above this value is treated as corruption rather than as a reason to
// allocate, which keeps a damaged log from exhausting memory.
const maxFrameBytes = 1 << 24

// ErrCorruptFrame is returned when a frame's length prefix, checksum or
// payload does not describe a value this codec could have written.
var ErrCorruptFrame = errors.New("store: corrupt frame")

// ErrShortRead is returned when the underlying reader ends in the middle of a
// value. It is distinct from io.EOF, which means a clean end between frames.
var ErrShortRead = errors.New("store: short read")

// crcTable is the checksum polynomial used by WriteFrame and ReadFrame.
var crcTable = crc32.MakeTable(crc32.Castagnoli)

// byteOrder is the fixed endianness of every multi-byte field.
var byteOrder = binary.BigEndian

// EncodeFeature renders a feature as a self-describing byte slice.
//
// The encoding is deterministic: the same feature always produces the same
// bytes, because property keys are written in sorted order. That property is
// what lets the append log be compared and deduplicated byte for byte.
func EncodeFeature(f *Feature) []byte {
	var buf bytes.Buffer
	buf.WriteByte(codecVersion)
	if f == nil {
		buf.WriteByte(0)
		return buf.Bytes()
	}
	buf.WriteByte(1)
	writeString(&buf, f.ID)
	writeString(&buf, f.Layer)
	buf.WriteByte(uint8(f.Kind))
	writeUvarint(&buf, f.Version)

	writeUvarint(&buf, uint64(len(f.Points)))
	for _, p := range f.Points {
		writeFloat(&buf, p.Lat)
		writeFloat(&buf, p.Lon)
	}

	keys := make([]string, 0, len(f.Props))
	for k := range f.Props {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	writeUvarint(&buf, uint64(len(keys)))
	for _, k := range keys {
		writeString(&buf, k)
		writeString(&buf, f.Props[k])
	}
	return buf.Bytes()
}

// DecodeFeature is the inverse of EncodeFeature. It returns ErrCorruptFrame
// when the payload is not a feature this codec wrote, and never panics on
// malformed input.
func DecodeFeature(b []byte) (*Feature, error) {
	r := bytes.NewReader(b)
	f, err := decodeFeatureFrom(r)
	if err != nil {
		return nil, err
	}
	if r.Len() != 0 {
		return nil, fmt.Errorf("store: decode feature: %d trailing bytes: %w", r.Len(), ErrCorruptFrame)
	}
	return f, nil
}

// decodeFeatureFrom reads one feature from r, leaving anything that follows in
// place so an enclosing record can keep reading.
func decodeFeatureFrom(r *bytes.Reader) (*Feature, error) {
	version, err := r.ReadByte()
	if err != nil {
		return nil, fmt.Errorf("store: decode feature version: %w", ErrShortRead)
	}
	if version != codecVersion {
		return nil, fmt.Errorf("store: decode feature: version %d: %w", version, ErrCorruptFrame)
	}
	present, err := r.ReadByte()
	if err != nil {
		return nil, fmt.Errorf("store: decode feature presence: %w", ErrShortRead)
	}
	if present == 0 {
		return nil, nil
	}
	if present != 1 {
		return nil, fmt.Errorf("store: decode feature presence %d: %w", present, ErrCorruptFrame)
	}

	f := &Feature{}
	if f.ID, err = readString(r); err != nil {
		return nil, fmt.Errorf("store: decode feature id: %w", err)
	}
	if f.Layer, err = readString(r); err != nil {
		return nil, fmt.Errorf("store: decode feature layer: %w", err)
	}
	kind, err := r.ReadByte()
	if err != nil {
		return nil, fmt.Errorf("store: decode feature kind: %w", ErrShortRead)
	}
	f.Kind = GeometryKind(kind)
	if f.Version, err = readUvarint(r); err != nil {
		return nil, fmt.Errorf("store: decode feature version counter: %w", err)
	}

	n, err := readUvarint(r)
	if err != nil {
		return nil, fmt.Errorf("store: decode point count: %w", err)
	}
	if n > uint64(r.Len()/16)+1 {
		return nil, fmt.Errorf("store: decode point count %d: %w", n, ErrCorruptFrame)
	}
	if n > 0 {
		f.Points = make(geom.PointSet, 0, n)
		for i := uint64(0); i < n; i++ {
			lat, err := readFloat(r)
			if err != nil {
				return nil, fmt.Errorf("store: decode point %d latitude: %w", i, err)
			}
			lon, err := readFloat(r)
			if err != nil {
				return nil, fmt.Errorf("store: decode point %d longitude: %w", i, err)
			}
			f.Points = append(f.Points, geom.Point{Lat: lat, Lon: lon})
		}
	}

	props, err := readUvarint(r)
	if err != nil {
		return nil, fmt.Errorf("store: decode property count: %w", err)
	}
	if props > uint64(r.Len())+1 {
		return nil, fmt.Errorf("store: decode property count %d: %w", props, ErrCorruptFrame)
	}
	if props > 0 {
		f.Props = make(map[string]string, props)
		for i := uint64(0); i < props; i++ {
			k, err := readString(r)
			if err != nil {
				return nil, fmt.Errorf("store: decode property key: %w", err)
			}
			v, err := readString(r)
			if err != nil {
				return nil, fmt.Errorf("store: decode property %q: %w", k, err)
			}
			f.Props[k] = v
		}
	}
	return f, nil
}

// EncodeRecord renders one append-log record. The record's feature, when it
// has one, is encoded inline with EncodeFeature.
func EncodeRecord(r Record) []byte {
	var buf bytes.Buffer
	buf.WriteByte(codecVersion)
	buf.WriteByte(uint8(r.Kind))
	writeUvarint(&buf, r.Seq)
	writeString(&buf, r.ID)
	buf.Write(EncodeFeature(r.Feature))
	return buf.Bytes()
}

// DecodeRecord is the inverse of EncodeRecord.
func DecodeRecord(b []byte) (Record, error) {
	var rec Record
	r := bytes.NewReader(b)

	version, err := r.ReadByte()
	if err != nil {
		return rec, fmt.Errorf("store: decode record version: %w", ErrShortRead)
	}
	if version != codecVersion {
		return rec, fmt.Errorf("store: decode record: version %d: %w", version, ErrCorruptFrame)
	}
	kind, err := r.ReadByte()
	if err != nil {
		return rec, fmt.Errorf("store: decode record kind: %w", ErrShortRead)
	}
	rec.Kind = RecordKind(kind)
	if !rec.Kind.valid() {
		return rec, fmt.Errorf("store: decode record kind %d: %w", kind, ErrCorruptFrame)
	}
	if rec.Seq, err = readUvarint(r); err != nil {
		return rec, fmt.Errorf("store: decode record seq: %w", err)
	}
	if rec.ID, err = readString(r); err != nil {
		return rec, fmt.Errorf("store: decode record id: %w", err)
	}
	if rec.Feature, err = decodeFeatureFrom(r); err != nil {
		return rec, err
	}
	if r.Len() != 0 {
		return rec, fmt.Errorf("store: decode record: %d trailing bytes: %w", r.Len(), ErrCorruptFrame)
	}
	return rec, nil
}

// WriteFrame writes a length-prefixed, checksummed frame around payload.
//
// The frame is four bytes of length, four bytes of CRC over the payload, then
// the payload itself. ReadFrame verifies both before it returns anything.
func WriteFrame(w io.Writer, payload []byte) error {
	if len(payload) > maxFrameBytes {
		return fmt.Errorf("store: frame of %d bytes exceeds %d: %w", len(payload), maxFrameBytes, ErrCorruptFrame)
	}
	var hdr [8]byte
	byteOrder.PutUint32(hdr[0:4], uint32(len(payload)))
	byteOrder.PutUint32(hdr[4:8], crc32.Checksum(payload, crcTable))
	if _, err := w.Write(hdr[:]); err != nil {
		return fmt.Errorf("store: write frame header: %w", err)
	}
	if _, err := w.Write(payload); err != nil {
		return fmt.Errorf("store: write frame payload: %w", err)
	}
	return nil
}

// ReadFrame reads one frame written by WriteFrame.
//
// It returns io.EOF when r is cleanly positioned at the end of the last frame,
// ErrShortRead when a frame is truncated, and ErrCorruptFrame when the length
// or the checksum does not match the payload.
func ReadFrame(r io.Reader) ([]byte, error) {
	var hdr [8]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		if errors.Is(err, io.EOF) {
			return nil, io.EOF
		}
		if errors.Is(err, io.ErrUnexpectedEOF) {
			return nil, fmt.Errorf("store: read frame header: %w", ErrShortRead)
		}
		return nil, fmt.Errorf("store: read frame header: %w", err)
	}
	length := byteOrder.Uint32(hdr[0:4])
	if length > maxFrameBytes {
		return nil, fmt.Errorf("store: frame length %d exceeds %d: %w", length, maxFrameBytes, ErrCorruptFrame)
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(r, payload); err != nil {
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			return nil, fmt.Errorf("store: read frame payload: %w", ErrShortRead)
		}
		return nil, fmt.Errorf("store: read frame payload: %w", err)
	}
	if want := byteOrder.Uint32(hdr[4:8]); crc32.Checksum(payload, crcTable) != want {
		return nil, fmt.Errorf("store: frame checksum mismatch: %w", ErrCorruptFrame)
	}
	return payload, nil
}

// FrameBytes reports how many bytes WriteFrame would emit for a payload of the
// given size. Callers use it to account for log growth without writing.
func FrameBytes(payloadLen int) int64 { return int64(payloadLen) + 8 }

// writeString writes a length-prefixed string.
func writeString(buf *bytes.Buffer, s string) {
	writeUvarint(buf, uint64(len(s)))
	buf.WriteString(s)
}

// readString reads a string written by writeString.
func readString(r *bytes.Reader) (string, error) {
	n, err := readUvarint(r)
	if err != nil {
		return "", err
	}
	if n > uint64(r.Len()) {
		return "", fmt.Errorf("store: string of %d bytes exceeds %d remaining: %w", n, r.Len(), ErrCorruptFrame)
	}
	if n == 0 {
		return "", nil
	}
	b := make([]byte, n)
	if _, err := io.ReadFull(r, b); err != nil {
		return "", fmt.Errorf("store: read string: %w", ErrShortRead)
	}
	return string(b), nil
}

// writeUvarint writes an unsigned integer in varint form.
func writeUvarint(buf *bytes.Buffer, v uint64) {
	var tmp [binary.MaxVarintLen64]byte
	buf.Write(tmp[:binary.PutUvarint(tmp[:], v)])
}

// readUvarint reads an integer written by writeUvarint.
func readUvarint(r *bytes.Reader) (uint64, error) {
	v, err := binary.ReadUvarint(r)
	if err != nil {
		if errors.Is(err, io.EOF) {
			return 0, fmt.Errorf("store: read varint: %w", ErrShortRead)
		}
		return 0, fmt.Errorf("store: read varint: %w", ErrCorruptFrame)
	}
	return v, nil
}

// writeFloat writes a float64 in its exact IEEE-754 bit pattern, so that a
// round trip reproduces the value rather than a rounded rendering of it.
func writeFloat(buf *bytes.Buffer, f float64) {
	var tmp [8]byte
	byteOrder.PutUint64(tmp[:], math.Float64bits(f))
	buf.Write(tmp[:])
}

// readFloat reads a float written by writeFloat.
func readFloat(r *bytes.Reader) (float64, error) {
	var tmp [8]byte
	if _, err := io.ReadFull(r, tmp[:]); err != nil {
		return 0, fmt.Errorf("store: read float: %w", ErrShortRead)
	}
	return math.Float64frombits(byteOrder.Uint64(tmp[:])), nil
}
