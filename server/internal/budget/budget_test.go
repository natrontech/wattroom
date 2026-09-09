package budget

import (
	"testing"
	"time"
)

func TestSpendAndRefund(t *testing.T) {
	b := New[string](2, time.Hour)
	for i := 0; i < 2; i++ {
		if !b.Spend("a") {
			t.Fatalf("spend %d should be free", i)
		}
	}
	if b.Spend("a") {
		t.Fatal("the third spend is over the ceiling")
	}
	if !b.Spend("b") {
		t.Fatal("another key has its own window")
	}
	b.Refund("a")
	if !b.Spend("a") {
		t.Fatal("a refund gives the spend back")
	}
	b.Refund("nobody") // a refund for a key that never spent is nothing
}
