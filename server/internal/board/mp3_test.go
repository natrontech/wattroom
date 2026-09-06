package board

import "testing"

// frame builds one MPEG 1 Layer III header plus its silent payload, so a test
// file is a real one rather than a fixture nobody can read.
func frame(bitrateIndex, rateIndex byte) []byte {
	b := []byte{0xFF, 0xFB, bitrateIndex<<4 | rateIndex<<2, 0x00}
	bitrate := bitrates[3][bitrateIndex] * 1000
	rate := sampleRates[3][rateIndex]
	size := 144*bitrate/rate + 0
	return append(b, make([]byte, size-4)...)
}

func mp3(frames int, bitrateIndex, rateIndex byte) []byte {
	var out []byte
	for range frames {
		out = append(out, frame(bitrateIndex, rateIndex)...)
	}
	return out
}

func id3(size int) []byte {
	tag := []byte{'I', 'D', '3', 3, 0, 0, 0, 0, 0, 0}
	tag[6] = byte(size >> 21 & 0x7F)
	tag[7] = byte(size >> 14 & 0x7F)
	tag[8] = byte(size >> 7 & 0x7F)
	tag[9] = byte(size & 0x7F)
	return append(tag, make([]byte, size)...)
}

func TestDurationMillis(t *testing.T) {
	// 1152 samples a frame at 44100 Hz is 26.12 ms; 383 frames ≈ 10 s (383 × 1152 ÷ 44100 = 10.004 s).
	tests := []struct {
		name string
		data []byte
		want int
		ok   bool
	}{
		{"one frame at 128 kbps", mp3(1, 9, 0), 26, true},
		{"ten seconds", mp3(383, 9, 0), 10004, true},
		{"bitrate does not change length", mp3(383, 14, 0), 10004, true},
		{"48 kHz frames are shorter", mp3(383, 9, 1), 9192, true},
		{"an ID3 tag is stepped over", append(id3(2048), mp3(383, 9, 0)...), 10004, true},
		{"not audio at all", []byte("this is a png, honestly"), 0, false},
		{"empty", nil, 0, false},
		{"a free-bitrate header is refused, not guessed", []byte{0xFF, 0xFB, 0x00, 0x00}, 0, false},
		{"a reserved sample rate is refused", []byte{0xFF, 0xFB, 0x9C, 0x00}, 0, false},
		{"truncated mid-frame", mp3(1, 9, 0)[:200], 0, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := DurationMillis(tt.data)
			if ok != tt.ok || got != tt.want {
				t.Errorf("DurationMillis() = %d, %v; want %d, %v", got, ok, tt.want, tt.ok)
			}
		})
	}
}

// A file that stops being frames partway through measures what it actually
// had, rather than trusting a length somebody wrote in a header.
func TestDurationStopsAtGarbage(t *testing.T) {
	data := append(mp3(10, 9, 0), make([]byte, 5000)...)
	got, ok := DurationMillis(data)
	if !ok || got != 261 {
		t.Fatalf("DurationMillis() = %d, %v; want 261, true", got, ok)
	}
}
