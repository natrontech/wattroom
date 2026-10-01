package protocol

import (
	"testing"
	"time"
)

// ADR-0067: the numbers a race scores are the rider's own and settled. A
// weight changed in the fortnight before the flag, one not confirmed in 90
// days, or a number nobody chose, still races — unranked.
func TestARaceRidesAFreshOrUnansweredNumberUnranked(t *testing.T) {
	flag := time.Date(2026, 10, 1, 18, 0, 0, 0, time.UTC)
	daysBefore := func(n int) int64 { return flag.AddDate(0, 0, -n).UnixMilli() }
	tests := []struct {
		name string
		edit func(*Rider)
		want string
	}{
		{"numbers the rider answered for place", func(*Rider) {}, ""},
		{"a ramp-measured FTP places", func(r *Rider) { r.FtpSource = "ramp" }, ""},
		{"a weight changed 13 days before the flag", func(r *Rider) {
			r.WeightChangedAt, r.WeightConfirmedAt = daysBefore(13), daysBefore(13)
		}, UnrankedFreshWeight},
		{"a weight changed 14 days before the flag places", func(r *Rider) {
			r.WeightChangedAt, r.WeightConfirmedAt = daysBefore(14), daysBefore(14)
		}, ""},
		{"a weight never changed since it was recorded places", func(r *Rider) { r.WeightChangedAt = 0 }, ""},
		{"the default FTP", func(r *Rider) { r.FtpSource = SourceDefault }, UnrankedDefaultFtp},
		{"an FTP with no source word", func(r *Rider) { r.FtpSource = "" }, UnrankedDefaultFtp},
		{"the default weight", func(r *Rider) { r.WeightSource = SourceDefault }, UnrankedDefaultWeight},
		{"a weight confirmed 89 days before places", func(r *Rider) { r.WeightConfirmedAt = daysBefore(89) }, ""},
		{"a weight confirmed 90 days before", func(r *Rider) {
			r.WeightChangedAt, r.WeightConfirmedAt = daysBefore(120), daysBefore(90)
		}, UnrankedUnconfirmedWeight},
		{"a weight never confirmed", func(r *Rider) { r.WeightConfirmedAt = 0 }, UnrankedUnconfirmedWeight},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := Rider{
				FtpSource: "manual", WeightSource: "manual",
				WeightChangedAt: daysBefore(30), WeightConfirmedAt: daysBefore(30),
			}
			tt.edit(&r)
			if got := Unranked(r, flag); got != tt.want {
				t.Fatalf("Unranked = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestSourceOfReadsANullAsNobodyAnswered(t *testing.T) {
	ramp, empty := "ramp", ""
	for _, tt := range []struct {
		stored *string
		want   string
	}{{nil, SourceDefault}, {&empty, SourceDefault}, {&ramp, "ramp"}} {
		if got := SourceOf(tt.stored); got != tt.want {
			t.Errorf("SourceOf(%v) = %q, want %q", tt.stored, got, tt.want)
		}
	}
}
