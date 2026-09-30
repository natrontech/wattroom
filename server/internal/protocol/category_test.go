package protocol

import "testing"

func TestCategory(t *testing.T) {
	if Category(320, 80) != "A" || Category(330, 100) != "B" ||
		Category(260, 100) != "C" || Category(200, 100) != "D" {
		t.Fatal("category thresholds")
	}
	if Category(300, 0) != "D" {
		t.Fatal("zero weight must not divide")
	}
}

func TestSuggestFTP(t *testing.T) {
	// 0.95 × 300 = 285 > 265 × 1.02 = 270.3 → suggest 285.
	if got, ok := SuggestFTP(300, 265); !ok || got != 285 {
		t.Fatalf("suggest: %d %v", got, ok)
	}
	// 0.95 × 280 = 266, within 2 % of 265 → silence.
	if _, ok := SuggestFTP(280, 265); ok {
		t.Fatal("suggested inside the tolerance")
	}
	if _, ok := SuggestFTP(0, 265); ok {
		t.Fatal("suggested from no data")
	}
}

// A race's FTP is the profile's, or the 90-day best 20's suggestion when that
// is higher (ADR-0067), and its Category comes from it: a profile FTP set low
// cannot drop a rider a bracket.
func TestRaceFtpAndCategory(t *testing.T) {
	for _, c := range []struct {
		name         string
		ftp, best20m int
		wantFtp      int
		wantCategory string
	}{
		{"no rides: the profile's", 200, 0, 200, "C"},
		{"a best 20 above it: the suggestion", 200, 300, 285, "A"},
		{"a best 20 inside the 2 %: the profile's", 285, 300, 285, "A"},
		{"a profile set above the rides: as claimed", 320, 300, 320, "A"},
	} {
		r := Rider{FtpWatts: c.ftp, WeightKg: 70, Best20mWatts: c.best20m}
		if got := RaceFtp(r); got != c.wantFtp {
			t.Errorf("%s: race FTP %d, want %d", c.name, got, c.wantFtp)
		}
		if got := RaceCategory(r); got != c.wantCategory {
			t.Errorf("%s: Category %s, want %s", c.name, got, c.wantCategory)
		}
	}
}
