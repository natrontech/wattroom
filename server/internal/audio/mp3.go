package audio

import (
	"bufio"
	"bytes"
	"io"
)

// MP3 is the one upload format the app accepts (#877 for soundboard clips,
// #266 for the music pool): every browser decodes it, and its frame headers
// carry enough to measure a file without a decoder — which is what lets the
// length rule live on the server, where a rule belongs, rather than in a
// number the uploading browser hands us.

// Layer III frame sizes, indexed [version][bitrate index]. Index 0 is "free"
// and 15 is reserved; both are refused rather than guessed at.
var bitrates = map[int][16]int{
	3: {0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1}, // MPEG 1
	2: {0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1},     // MPEG 2
	0: {0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1},     // MPEG 2.5
}

var sampleRates = map[int][4]int{
	3: {44100, 48000, 32000, -1},
	2: {22050, 24000, 16000, -1},
	0: {11025, 12000, 8000, -1},
}

// DurationMillis walks an MP3's frames and adds up how long they last.
//
// Frame by frame rather than by reading a Xing header: a VBR file without one
// would otherwise measure as whatever its first frame implies, and a hostile
// file could simply lie in the header. Roughly 38 frames a second, so a
// minute of audio is a few thousand cheap iterations.
//
// Reports ok=false when the bytes are not an MP3 we can measure — no frame
// found where one must be, or a header using a reserved value.
func DurationMillis(data []byte) (ms int, ok bool) {
	return DurationMillisFrom(bytes.NewReader(data))
}

// DurationMillisFrom is the same walk over a stream, holding one frame at a
// time: a 48 MB track is measured off disk rather than out of a 48 MB slice
// (#2862).
func DurationMillisFrom(r io.Reader) (ms int, ok bool) {
	br := bufio.NewReader(r)
	if head, err := br.Peek(10); err == nil && string(head[:3]) == "ID3" {
		if _, err := br.Discard(id3Size(head)); err != nil {
			return 0, false // a tag that claims more than the file holds
		}
	}
	samples, rate := 0, 0
	frames := 0
	for {
		head, err := br.Peek(4)
		if err != nil {
			break
		}
		size, frameSamples, frameRate, valid := frameAt(head)
		if !valid {
			break
		}
		// A frame that does not fit what is left is not counted.
		if n, _ := br.Discard(size); n < size {
			break
		}
		samples += frameSamples
		rate = frameRate
		frames++
	}
	if frames == 0 || rate == 0 {
		return 0, false
	}
	return samples * 1000 / rate, true
}

// LooksLikeMP3 reports whether head, the first bytes of a body, can begin a
// file DurationMillis would measure: an ID3 tag or a frame header. An upload
// asks it before reading the rest, so junk is refused at its first bytes.
func LooksLikeMP3(head []byte) bool {
	if len(head) >= 3 && string(head[:3]) == "ID3" {
		return true
	}
	_, _, _, ok := frameAt(head)
	return ok
}

// frameAt reads one frame header. It does not scan for the next sync word:
// a file whose frames do not sit end to end is not one we will measure, and
// resynchronising would let junk between frames read as audio.
func frameAt(b []byte) (size, samples, rate int, ok bool) {
	if len(b) < 4 || b[0] != 0xFF || b[1]&0xE0 != 0xE0 {
		return 0, 0, 0, false
	}
	version := int(b[1] >> 3 & 0x03) // 3 = MPEG 1, 2 = MPEG 2, 0 = MPEG 2.5
	layer := int(b[1] >> 1 & 0x03)   // 1 = Layer III
	if layer != 1 || version == 1 {
		return 0, 0, 0, false
	}
	bitrate := bitrates[version][b[2]>>4&0x0F] * 1000
	rate = sampleRates[version][b[2]>>2&0x03]
	if bitrate <= 0 || rate <= 0 {
		return 0, 0, 0, false
	}
	padding := int(b[2] >> 1 & 0x01)
	// MPEG 1 Layer III carries 1152 samples a frame, MPEG 2 and 2.5 carry 576
	// — and the frame-length constant halves with them.
	samples, coefficient := 1152, 144
	if version != 3 {
		samples, coefficient = 576, 72
	}
	size = coefficient*bitrate/rate + padding
	if size < 4 {
		return 0, 0, 0, false
	}
	return size, samples, rate, true
}

// id3Size is how many bytes an ID3v2 tag occupies, header included, so the
// first frame is where the walk starts. The size is syncsafe — seven bits per
// byte, so the length can never contain a byte that looks like a frame sync.
func id3Size(head []byte) int {
	n := head[6:10]
	size := int(n[0]&0x7F)<<21 | int(n[1]&0x7F)<<14 | int(n[2]&0x7F)<<7 | int(n[3]&0x7F)
	skip := 10 + size
	if head[5]&0x10 != 0 {
		skip += 10 // a footer, present only when the flag says so
	}
	return skip
}
