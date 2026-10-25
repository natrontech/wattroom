// The bounds on reading an upload's ID3v2 tag (#4148). The reader,
// dhowden/tag, does work that grows with the square of what a crafted file
// controls, in two places: it renames each repeated frame by counting up from
// _0 every time (id3v2.go:331-335), and Genre() runs a regexp once per "(n)"
// in the genre frame (id3v2genre). Measured on a laptop: 5,000 repeated
// frames took 0.6 s and one 16 KiB genre frame 29 s. A 48 MB upload has room
// for millions of frames, or a genre frame the size of the file.
//
// So the frame headers are walked first, and the reader is asked only about a
// tag inside both ceilings. A tag outside them is not refused: the title falls
// back to the filename, as it does for any tag that cannot be read.
package tracks

import (
	"bufio"
	"errors"
	"io"

	"github.com/dhowden/tag"
)

const (
	// A real tag carries tens of frames: a title, an artist, a few comments,
	// a picture or two. The reader takes 2 ms over 256 repeats of one frame.
	maxTagFrames = 256

	// A genre frame names a genre or a few ("Synthwave/Italo Disco" is 21
	// bytes). Genre() takes 2 ms over 256 bytes of "(n)" references.
	maxGenreBytes = 256
)

var errTagOutOfBounds = errors.New("the ID3v2 tag is over the frame or genre ceiling")

// readTag is tag.ReadFrom on the upload from its first byte, asked only
// inside the ceilings.
func readTag(f io.ReadSeeker) (tag.Metadata, error) {
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	if !tagWithinBounds(f) {
		return nil, errTagOutOfBounds
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	return tag.ReadFrom(buffered(f))
}

// tagWithinBounds reports whether r holds no ID3v2 tag, or one inside
// maxTagFrames and maxGenreBytes. It reads the bytes the reader reads, in its
// order: the extended header, the unsynchronisation filter and each frame's
// compression, data-length and encryption fields. A frame the walk skips is
// then never one the reader stores; a v2.4 frame can claim 1,000 bytes and
// hold 2.
//
// A tag the walk cannot finish is one the reader fails on too, so it is
// reported out of bounds: the outcome is the filename either way.
func tagWithinBounds(r io.Reader) bool {
	br := bufio.NewReader(r)
	head := make([]byte, 10)
	if _, err := io.ReadFull(br, head); err != nil || string(head[:3]) != "ID3" {
		return true // the MP3 gate put a frame sync here, so no ID3v2 reading follows
	}
	version, flags := head[3], head[5]
	if version < 2 || version > 4 {
		return false
	}
	size := chunked7(head[6:10])
	offset := 10
	if flags&0x40 != 0 && version > 2 {
		ext := make([]byte, 4)
		if _, err := io.ReadFull(br, ext); err != nil {
			return false
		}
		n := bigEndian(ext)
		if version == 4 {
			n = chunked7(ext) - 4
		}
		if n < 0 {
			return false
		}
		if _, err := br.Discard(n); err != nil {
			return false
		}
		offset += n
	}
	var frames io.Reader = br
	if flags&0x80 != 0 {
		frames = &unsynchronised{r: br}
	}

	header := make([]byte, 10)
	if version == 2 {
		header = header[:6]
	}
	field := make([]byte, 4)
	for count := 1; offset < size; count++ {
		if _, err := io.ReadFull(frames, header); err != nil {
			return false
		}
		name, n := string(header[:4]), 0
		switch version {
		case 2:
			name, n = string(header[:3]), bigEndian(header[3:6])
		case 3:
			n = bigEndian(header[4:8])
		case 4:
			n = chunked7(header[4:8])
		}
		if n == 0 {
			return true // padding: the reader stops here
		}
		offset += len(header) + n
		if version > 2 {
			f := header[9]
			compressed, encrypted, sized := f&0x80 != 0, f&0x40 != 0, false
			if version == 4 {
				compressed, encrypted, sized = f&0x08 != 0, f&0x04 != 0, f&0x01 != 0
			}
			if compressed && version == 4 && !sized {
				return false
			}
			if compressed && version == 3 {
				if _, err := io.ReadFull(frames, field); err != nil {
					return false
				}
				n -= 4
			}
			if sized {
				if _, err := io.ReadFull(frames, field); err != nil {
					return false
				}
				n = chunked7(field)
			}
			if encrypted {
				if _, err := io.ReadFull(frames, field[:1]); err != nil {
					return false
				}
				n--
			}
			if n < 0 {
				return false
			}
		}
		if count > maxTagFrames {
			return false
		}
		if (name == "TCON" || name == "TCO") && n > maxGenreBytes {
			return false
		}
		// Past the tag's end the reader takes this one frame or none, then stops.
		if offset >= size {
			return true
		}
		if _, err := io.CopyN(io.Discard, frames, int64(n)); err != nil {
			return false
		}
	}
	return true
}

// chunked7 is the reader's "synchsafe" integer, seven bits a byte without
// masking the eighth, so a crafted byte over 0x7F walks as the reader reads it.
func chunked7(b []byte) int {
	n := 0
	for _, x := range b {
		n = n<<7 | int(x)
	}
	return n
}

func bigEndian(b []byte) int {
	n := 0
	for _, x := range b {
		n = n<<8 | int(x)
	}
	return n
}

// unsynchronised drops the 0x00 after each 0xFF, as the reader's
// unsynchroniser does over everything after the tag's header.
type unsynchronised struct {
	r  *bufio.Reader
	ff bool
}

func (u *unsynchronised) Read(p []byte) (int, error) {
	i := 0
	for i < len(p) {
		b, err := u.r.ReadByte()
		if err != nil {
			return i, err
		}
		if u.ff && b == 0x00 {
			u.ff = false
			continue
		}
		p[i] = b
		i++
		u.ff = b == 0xFF
	}
	return i, nil
}

// bufferedFile is the upload behind a read buffer, for the reader: its
// unsynchroniser asks for one byte per call, which off the bare file is one
// syscall per byte. An 8 MB unsynchronised tag took 12 s that way; behind
// the buffer, 16 MB takes 0.7 s.
type bufferedFile struct {
	f  io.ReadSeeker
	br *bufio.Reader
}

func buffered(f io.ReadSeeker) *bufferedFile { return &bufferedFile{f: f, br: bufio.NewReader(f)} }

func (b *bufferedFile) Read(p []byte) (int, error) { return b.br.Read(p) }

// Seek moves the file and empties the buffer, counting a relative move from
// where the reader stands rather than from where the buffer filled to.
func (b *bufferedFile) Seek(offset int64, whence int) (int64, error) {
	if whence == io.SeekCurrent {
		offset -= int64(b.br.Buffered())
	}
	pos, err := b.f.Seek(offset, whence)
	b.br.Reset(b.f)
	return pos, err
}
