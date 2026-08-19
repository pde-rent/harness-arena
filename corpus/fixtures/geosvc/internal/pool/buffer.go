package pool

import (
	"bytes"
	"math/bits"
	"sync"
	"sync/atomic"
)

const (
	// maxRetainedBytes is the largest buffer capacity a BufferPool will keep.
	// A buffer that grew past it is dropped on Put instead of being retained,
	// so one huge response cannot pin megabytes of scratch space for the rest
	// of the process's life. The ceiling is deliberately generous: it is well
	// above a normal encoded tile and well below a size worth holding onto.
	//
	// ponytail: a fixed ceiling, not a per-pool one; make it a field on
	// BufferPool if a caller ever needs a different budget.
	maxRetainedBytes = 1 << 20 // 1 MiB

	// defaultInitialSize is used when NewBufferPool is given a non-positive
	// size, so that a zero from configuration still yields a usable pool.
	defaultInitialSize = 4 << 10 // 4 KiB

	// maxRetainedSliceBytes is the BytesPool equivalent of maxRetainedBytes.
	maxRetainedSliceBytes = 1 << 20 // 1 MiB

	// minSliceBytes is the smallest capacity BytesPool hands out. Rounding tiny
	// requests up to it keeps the number of distinct sizes in the pool small.
	minSliceBytes = 64
)

// BufferPool hands out reusable *bytes.Buffer values for encoding paths.
//
// The zero value is not usable; build one with NewBufferPool. A BufferPool is
// safe for concurrent use by multiple goroutines. See the package
// documentation for the rules a borrower must follow.
type BufferPool struct {
	pool        sync.Pool
	initialSize int
	gets        atomic.Uint64
	puts        atomic.Uint64
	discards    atomic.Uint64
}

// NewBufferPool returns a pool whose freshly allocated buffers start with
// initialSize bytes of capacity. A non-positive initialSize is replaced by a
// 4 KiB default, and a size above the retention ceiling is capped at it, since
// a buffer larger than the ceiling could never be returned to the pool.
func NewBufferPool(initialSize int) *BufferPool {
	if initialSize <= 0 {
		initialSize = defaultInitialSize
	}
	if initialSize > maxRetainedBytes {
		initialSize = maxRetainedBytes
	}
	p := &BufferPool{initialSize: initialSize}
	p.pool.New = func() any {
		return bytes.NewBuffer(make([]byte, 0, p.initialSize))
	}
	return p
}

// Get returns a buffer with no contents, either one that was returned earlier
// or a freshly allocated one. The buffer is reset before it is returned, so the
// caller always starts from an empty buffer with some capacity already in hand.
//
// The caller must return the buffer with Put, from the same goroutine, and must
// not use it afterwards.
func (p *BufferPool) Get() *bytes.Buffer {
	p.gets.Add(1)
	b, ok := p.pool.Get().(*bytes.Buffer)
	if !ok || b == nil {
		return bytes.NewBuffer(make([]byte, 0, p.initialSize))
	}
	b.Reset()
	return b
}

// Put returns a buffer to the pool. A nil buffer is ignored, and a buffer whose
// capacity has grown past maxRetainedBytes is dropped rather than retained, so
// that one oversized response does not pin memory forever; the drop is counted
// in the discards statistic.
//
// After Put the caller must not touch the buffer or anything backed by its
// storage. Copy out whatever has to survive first.
func (p *BufferPool) Put(b *bytes.Buffer) {
	if b == nil {
		return
	}
	p.puts.Add(1)
	if b.Cap() > maxRetainedBytes {
		p.discards.Add(1)
		return
	}
	b.Reset()
	p.pool.Put(b)
}

// Stats returns the cumulative number of Get calls, Put calls and buffers
// dropped for exceeding the retention ceiling. The three counters are read
// independently, so a report taken during heavy use may show puts slightly
// behind gets even when every borrower is well behaved.
func (p *BufferPool) Stats() (gets, puts, discards uint64) {
	return p.gets.Load(), p.puts.Load(), p.discards.Load()
}

// WithBuffer borrows a buffer, calls fn with it and returns it to the pool,
// even if fn panics. It is the safe way to use a BufferPool: the buffer cannot
// escape the call and cannot be forgotten.
//
// fn must not retain the buffer or any slice of its bytes after it returns.
// WithBuffer returns fn's error unchanged, and returns nil when fn is nil.
func WithBuffer(p *BufferPool, fn func(*bytes.Buffer) error) error {
	if p == nil || fn == nil {
		return nil
	}
	b := p.Get()
	defer p.Put(b)
	return fn(b)
}

// BytesPool hands out reusable byte slices in power-of-two sizes.
//
// Requests are rounded up to the next power of two so that the pool holds a
// small, fixed number of size classes instead of one bucket per distinct
// length. Each size class has its own sync.Pool, which keeps a large request
// from consuming a slice that a small one could have used.
//
// The zero value is usable and is safe for concurrent use by multiple
// goroutines.
type BytesPool struct {
	mu      sync.Mutex
	classes map[int]*sync.Pool
}

// Get returns a slice of length n whose capacity is n rounded up to the next
// power of two, with a floor of 64 bytes. A non-positive n yields a nil slice.
// The contents are not zeroed: the caller must write before it reads.
//
// The caller must return the slice with Put, from the same goroutine, and must
// not use it afterwards.
func (p *BytesPool) Get(n int) []byte {
	if n <= 0 {
		return nil
	}
	size := sizeClass(n)
	if size > maxRetainedSliceBytes {
		// Too large to be worth pooling; hand back a one-off allocation, which
		// Put will then decline to retain.
		return make([]byte, n, size)
	}
	if b, ok := p.class(size).Get().(*[]byte); ok && b != nil && cap(*b) >= n {
		return (*b)[:n]
	}
	return make([]byte, n, size)
}

// Put returns a slice to the pool. Slices that are empty, that are not a
// power-of-two size class, or whose capacity exceeds the retention ceiling are
// dropped rather than retained, so odd-sized and oversized slices cannot
// fragment the pool or pin memory.
//
// After Put the caller must not read from or write to the slice.
func (p *BytesPool) Put(b []byte) {
	c := cap(b)
	if c < minSliceBytes || c > maxRetainedSliceBytes {
		return
	}
	if c != NextPow2(c) {
		return
	}
	full := b[:0:c]
	p.class(c).Put(&full)
}

// class returns the sync.Pool for one size class, creating it on first use.
func (p *BytesPool) class(size int) *sync.Pool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.classes == nil {
		p.classes = make(map[int]*sync.Pool)
	}
	if sp, ok := p.classes[size]; ok {
		return sp
	}
	sp := &sync.Pool{}
	p.classes[size] = sp
	return sp
}

// sizeClass returns the capacity a request of n bytes is served from: n rounded
// up to the next power of two, with a floor of minSliceBytes.
func sizeClass(n int) int {
	if n < minSliceBytes {
		return minSliceBytes
	}
	return NextPow2(n)
}

// NextPow2 returns the smallest power of two greater than or equal to n. It
// returns 1 for any n below 1, and returns n unchanged when n is already a
// power of two. If rounding up would overflow an int, the largest representable
// power of two is returned rather than a wrapped negative value.
func NextPow2(n int) int {
	if n <= 1 {
		return 1
	}
	if n&(n-1) == 0 {
		return n
	}
	shift := bits.UintSize - bits.LeadingZeros(uint(n))
	if shift >= bits.UintSize-1 {
		return 1 << (bits.UintSize - 2)
	}
	return 1 << shift
}
