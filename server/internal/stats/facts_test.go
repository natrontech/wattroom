package stats

import (
	"testing"
	"time"
)

func TestFacts(t *testing.T) {
	at := time.Date(2026, 9, 2, 6, 30, 0, 0, time.UTC)
	tests := []struct {
		name  string
		ftp   int
		watts []int
		want  RideFacts
	}{
		{
			name:  "no ftp counts seconds only",
			ftp:   0,
			watts: []int{300, 300, 300},
			want:  RideFacts{StartedAt: at, Seconds: 3},
		},
		{
			// FTP 200: 180 is 90 % (nothing), 190 is 95 % (above sweet spot),
			// 200 is FTP (threshold too), 242 is 121 % (Z6 as well).
			name:  "zone edges are inclusive where SPEC says so",
			ftp:   200,
			watts: []int{180, 190, 200, 242, 0},
			want: RideFacts{
				StartedAt: at, Seconds: 5,
				AboveFtpSec: 2, Z6Sec: 1, AboveSweetSpotSec: 3,
			},
		},
		{
			// 188 W at FTP 200 is exactly 94 % — the sweet spot's ceiling,
			// which is still sweet spot, not above it.
			name:  "the sweet spot ceiling is not above it",
			ftp:   200,
			watts: []int{188},
			want:  RideFacts{StartedAt: at, Seconds: 1},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Facts(at, tt.ftp, tt.watts); got != tt.want {
				t.Fatalf("Facts = %+v, want %+v", got, tt.want)
			}
		})
	}
}
