package friends

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// A parting is one ask's permission, for the ask budget's hour (#2842).
func TestAPartingIsOneAskInsideTheHour(t *testing.T) {
	a, b := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}, pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	now := time.Unix(1_000_000, 0)
	var p partings
	p.note(a, b, now)
	if p.take(b, a, now) {
		t.Fatal("the rider who was parted from holds the permission")
	}
	if !p.take(a, b, now.Add(askWindow-time.Second)) {
		t.Fatal("the undo inside the hour was refused")
	}
	if p.take(a, b, now) {
		t.Fatal("one parting asked twice")
	}
	p.note(a, b, now)
	if p.take(a, b, now.Add(askWindow)) {
		t.Fatal("a parting outlived its hour")
	}
}
