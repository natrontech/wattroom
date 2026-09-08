// Package audiotest builds real MP3 bytes for tests.
//
// Real frames rather than a recorded fixture: a test file nobody can read is a
// test nobody can change. Two packages need these now — the soundboard's clip
// length rule (#877) and the music pool's uploads (#266) — which is why it is
// a package rather than a helper duplicated in both test files.
package audiotest

// MPEG 1 Layer III, indexed the way the decoder indexes them.
var (
	bitrates    = [16]int{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1}
	sampleRates = [4]int{44100, 48000, 32000, -1}
)

// Frame is one header plus its silent payload.
func Frame(bitrateIndex, rateIndex byte) []byte {
	b := []byte{0xFF, 0xFB, bitrateIndex<<4 | rateIndex<<2, 0x00}
	size := 144 * (bitrates[bitrateIndex] * 1000) / sampleRates[rateIndex]
	return append(b, make([]byte, size-4)...)
}

// MP3 is `frames` identical frames. At bitrate index 9 (128 kbps) and rate
// index 0 (44100 Hz) a frame is 26.12 ms, so 383 frames is about ten seconds.
func MP3(frames int, bitrateIndex, rateIndex byte) []byte {
	var out []byte
	for range frames {
		out = append(out, Frame(bitrateIndex, rateIndex)...)
	}
	return out
}

// ID3 is a v2 tag header of `size` payload bytes, for testing that a parser
// skips it rather than reading a frame out of the middle of it.
func ID3(size int) []byte {
	tag := []byte{'I', 'D', '3', 3, 0, 0, 0, 0, 0, 0}
	tag[6] = byte(size >> 21 & 0x7F)
	tag[7] = byte(size >> 14 & 0x7F)
	tag[8] = byte(size >> 7 & 0x7F)
	tag[9] = byte(size & 0x7F)
	return append(tag, make([]byte, size)...)
}
