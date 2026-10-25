package tracks

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/dhowden/tag"
)

// frameOf is one ID3v2 frame: a header of `version` naming `id` and claiming
// `claimed` bytes, with the format flags `flags` (v2.3 and v2.4), then `rest`,
// which is whatever the stream carries after the header.
func frameOf(version byte, id string, claimed int, flags byte, rest []byte) []byte {
	var head []byte
	switch version {
	case 2:
		head = append([]byte(id), byte(claimed>>16), byte(claimed>>8), byte(claimed)) //nolint:gosec // a test size, cut to its three bytes
	case 3:
		head = append([]byte(id), byte(claimed>>24), byte(claimed>>16), byte(claimed>>8), byte(claimed), 0, flags) //nolint:gosec // a test size, cut to its four bytes
	case 4:
		head = append(append([]byte(id), synchsafe(claimed)...), 0, flags)
	}
	return append(head, rest...)
}

func synchsafe(n int) []byte {
	return []byte{byte(n >> 21 & 0x7F), byte(n >> 14 & 0x7F), byte(n >> 7 & 0x7F), byte(n & 0x7F)} //nolint:gosec // masked to 7 bits
}

// tagOf is an ID3v2 tag of `version` with header `flags` around `body`,
// declaring `claimed` bytes of it plus 10 of padding. The reader counts its
// offset from the header's first byte and the size from its last, so it
// never starts a frame in the tag's final 10 bytes.
func tagOf(version, flags byte, claimed int, body []byte) []byte {
	head := append([]byte{'I', 'D', '3', version, 0, flags}, synchsafe(claimed+10)...)
	return append(append(head, body...), make([]byte, 10)...)
}

// plainTag is `frames` back to back in a tag that declares exactly them.
func plainTag(version, flags byte, frames []byte) []byte {
	return tagOf(version, flags, len(frames), frames)
}

func repeat(frame []byte, n int) []byte { return bytes.Repeat(frame, n) }

// The walk counts the frames the reader stores, whatever shape the tag takes
// (#4148): a frame it stepped over would be one the reader renames without
// bound. Each shape is built at the ceiling and one frame over it, and the
// reader is asked as well, so the count checked is the reader's own.
func TestTheTagWalkCountsTheFramesTheReaderStores(t *testing.T) {
	text := []byte{0x00, 'x'} // ISO-8859-1 "x"
	shapes := []struct {
		name  string
		build func(n int) []byte
	}{
		{"v2.2", func(n int) []byte {
			return plainTag(2, 0, repeat(frameOf(2, "TT1", 2, 0, text), n))
		}},
		{"v2.3", func(n int) []byte {
			return plainTag(3, 0, repeat(frameOf(3, "TIT1", 2, 0, text), n))
		}},
		{"v2.4", func(n int) []byte {
			return plainTag(4, 0, repeat(frameOf(4, "TIT1", 2, 0, text), n))
		}},
		{"v2.3 whose size bytes carry the eighth bit", func(n int) []byte {
			// The reader does not mask it: 0x80 0x00 is 16,384 bytes to it,
			// where a synchsafe reading says 0. The frames end in padding.
			head := []byte{'I', 'D', '3', 3, 0, 0, 0, 0, 0x80, 0x00}
			return append(append(head, repeat(frameOf(3, "TIT1", 2, 0, text), n)...), make([]byte, 10)...)
		}},
		{"v2.3 behind an extended header", func(n int) []byte {
			frames := repeat(frameOf(3, "TIT1", 2, 0, text), n)
			// The reader adds the extended header's 6 bytes to its offset,
			// and not the 4 that give its length. The size is cut so the
			// last frame starts 1 byte inside it, as the reader counts.
			ext := []byte{0, 0, 0, 6, 0, 0, 0, 0, 0, 0}
			return tagOf(3, 0x40, 12*n-5, append(ext, frames...))
		}},
		{"v2.3 unsynchronised", func(n int) []byte {
			// 0xFF 0x00 reads as 0xFF: each frame claims 3 bytes and carries 4.
			frames := repeat(frameOf(3, "TIT1", 3, 0, []byte{0x00, 0xFF, 0x00, 'x'}), n)
			return tagOf(3, 0x80, 13*n, frames)
		}},
		{"v2.3 compressed and encrypted", func(n int) []byte {
			// A 4-byte length, then a method byte, then the 2 bytes of text.
			rest := append([]byte{0, 0, 0, 2, 0}, text...)
			return plainTag(3, 0, repeat(frameOf(3, "TIT1", 7, 0xC0, rest), n))
		}},
		{"v2.4 frames that claim more than their data length", func(n int) []byte {
			// Each header claims 1,000 bytes, and its data length says 2: the
			// reader moves its offset by the claim and its stream by the 2.
			rest := append(synchsafe(2), text...)
			return tagOf(4, 0, 1010*n, repeat(frameOf(4, "TIT1", 1000, 0x01, rest), n))
		}},
	}
	for _, s := range shapes {
		t.Run(s.name, func(t *testing.T) {
			for _, n := range []int{maxTagFrames, maxTagFrames + 1} {
				data := s.build(n)
				m, err := tag.ReadFrom(bytes.NewReader(data))
				if err != nil {
					t.Fatalf("%d frames: the reader failed: %v", n, err)
				}
				if got := len(m.Raw()); got != n {
					t.Fatalf("%d frames: the reader stored %d, so the shape is not the one meant", n, got)
				}
				if got, want := tagWithinBounds(bytes.NewReader(data)), n <= maxTagFrames; got != want {
					t.Errorf("%d frames: within bounds = %v, want %v", n, got, want)
				}
			}
		})
	}
}

func TestTheGenreFrameHasACeiling(t *testing.T) {
	genre := func(n int) []byte { return append([]byte{0x00}, bytes.Repeat([]byte{'('}, n-1)...) }
	for _, tc := range []struct {
		name string
		tag  []byte
		want bool
	}{
		{"v2.3 at the ceiling", plainTag(3, 0, frameOf(3, "TCON", maxGenreBytes, 0, genre(maxGenreBytes))), true},
		{"v2.3 one byte over", plainTag(3, 0, frameOf(3, "TCON", maxGenreBytes+1, 0, genre(maxGenreBytes+1))), false},
		{"v2.2 one byte over", plainTag(2, 0, frameOf(2, "TCO", maxGenreBytes+1, 0, genre(maxGenreBytes+1))), false},
		{"v2.4 claiming 2 with a data length one over", tagOf(4, 0, 12,
			frameOf(4, "TCON", 2, 0x01, append(synchsafe(maxGenreBytes+1), genre(maxGenreBytes+1)...))), false},
		{"another text frame of any length", plainTag(3, 0, frameOf(3, "TIT1", 4096, 0, genre(4096))), true},
		{"no ID3v2 tag", song(70, 4), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := tagWithinBounds(bytes.NewReader(tc.tag)); got != tc.want {
				t.Errorf("within bounds = %v, want %v", got, tc.want)
			}
		})
	}
}

// A crafted tag cannot hold an upload (#4148). Before the ceilings, the first
// took about a minute and the second about eight, each holding a core, a pool
// connection and the rider's row lock. A tag over them is not refused: the
// title falls back to the filename.
func TestACraftedTagCannotHoldAnUpload(t *testing.T) {
	h := setup(t)
	// A rider each: one upload past its deadline still holds its rider's slot.
	for _, tc := range []struct {
		name, who string
		seed      byte
		tag       []byte
	}{
		{"fifty thousand repeated frames", "alice", 71, plainTag(3, 0, repeat(frameOf(3, "PRIV", 1, 0, []byte{0}), 50_000))},
		{"a 64 KiB genre frame", "bob", 72, plainTag(3, 0, frameOf(3, "TCON", 64<<10, 0, append([]byte{0x00}, bytes.Repeat([]byte("(1)"), 64<<10/3)...)[:64<<10]))},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data := append(tc.tag, song(tc.seed, 40)...)
			done := make(chan *httptest.ResponseRecorder, 1)
			// Exits when the upload answers. One past the deadline runs on
			// until the test binary exits, which is the failure being shown.
			go func() { done <- h.do(t, tc.who, http.MethodPost, "/api/tracks?name=Crafted.mp3", data) }()
			select {
			case w := <-done:
				if w.Code != http.StatusCreated {
					t.Fatalf("upload: %d %s", w.Code, w.Body.String())
				}
				body := decode(t, w)
				t.Cleanup(func() {
					_, _ = h.store.Pool.Exec(context.Background(), "delete from tracks where id = $1", body["id"])
				})
				if body["title"] != "Crafted" {
					t.Errorf("title = %v, want the filename's", body["title"])
				}
			case <-time.After(10 * time.Second):
				t.Fatal("the upload was still reading its tag after 10 s")
			}
		})
	}
}

// countedReads counts the reads that reach the file.
type countedReads struct {
	io.ReadSeeker
	reads int
}

func (c *countedReads) Read(p []byte) (int, error) {
	c.reads++
	return c.ReadSeeker.Read(p)
}

// The reader's unsynchroniser asks for one byte per call, which off the bare
// file was a syscall per byte (#4148). Behind the buffer the file sees one
// read per 4 KiB, and a tag inside the ceilings is still read.
func TestAnUnsynchronisedTagReachesTheFileAFewKilobytesAtATime(t *testing.T) {
	n := 256 << 10
	frames := append(frameOf(3, "TIT2", 5, 0, []byte("\x00Kept")), frameOf(3, "PRIV", n, 0, make([]byte, n))...)
	f := &countedReads{ReadSeeker: bytes.NewReader(append(plainTag(3, 0x80, frames), song(72, 4)...))}
	m, err := readTag(f)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if m.Title() != "Kept" {
		t.Errorf("title = %q, want the tag's", m.Title())
	}
	if f.reads > n/1024 {
		t.Errorf("%d reads reached the file for a %d KiB tag", f.reads, n>>10)
	}
}
