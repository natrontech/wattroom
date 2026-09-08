package audio

import (
	"testing"

	"github.com/natrontech/wattroom/server/internal/audio/audiotest"
)

func TestDurationMillis(t *testing.T) {
	// 1152 samples a frame at 44100 Hz is 26.12 ms; 383 frames ≈ 10 s (383 × 1152 ÷ 44100 = 10.004 s).
	tests := []struct {
		name string
		data []byte
		want int
		ok   bool
	}{
		{"one frame at 128 kbps", audiotest.MP3(1, 9, 0), 26, true},
		{"ten seconds", audiotest.MP3(383, 9, 0), 10004, true},
		{"bitrate does not change length", audiotest.MP3(383, 14, 0), 10004, true},
		{"48 kHz frames are shorter", audiotest.MP3(383, 9, 1), 9192, true},
		{"an ID3 tag is stepped over", append(audiotest.ID3(2048), audiotest.MP3(383, 9, 0)...), 10004, true},
		{"not audio at all", []byte("this is a png, honestly"), 0, false},
		{"empty", nil, 0, false},
		{"a free-bitrate header is refused, not guessed", []byte{0xFF, 0xFB, 0x00, 0x00}, 0, false},
		{"a reserved sample rate is refused", []byte{0xFF, 0xFB, 0x9C, 0x00}, 0, false},
		{"truncated mid-frame", audiotest.MP3(1, 9, 0)[:200], 0, false},
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
	data := append(audiotest.MP3(10, 9, 0), make([]byte, 5000)...)
	got, ok := DurationMillis(data)
	if !ok || got != 261 {
		t.Fatalf("DurationMillis() = %d, %v; want 261, true", got, ok)
	}
}
