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
