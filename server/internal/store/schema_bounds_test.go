package store_test

import (
	"regexp"
	"strconv"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

// The third copy of every bound is the schema CHECK, and it is the one that
// cannot read the constant: a migration is immutable once it has run anywhere
// (ADR-0019), so widening `protocol.MaxFtpWatts` moves the validator and the
// form and leaves the column where it was. The rider then types a number the
// app accepts and the insert explodes — a 500 at the boundary, which is worse
// than the refusal it replaced. Seen while proving the seam: at 601 the PATCH
// validated and the database refused.
//
// So this asserts the pair the migrations ended up with against the pair the
// code enforces. Read off the live schema rather than the .sql files on
// purpose — a later migration may alter a CHECK, and only the database knows
// which one won.
func TestSchemaChecksMatchTheProtocolBounds(t *testing.T) {
	st := storetest.Open(t)

	for _, want := range []struct {
		table    string
		column   string
		min, max int
	}{
		{"users", "ftp_watts", protocol.MinFtpWatts, protocol.MaxFtpWatts},
		{"users", "weight_kg", protocol.MinWeightKg, protocol.MaxWeightKg},
		{"users", "lthr", protocol.MinLthrBpm, protocol.MaxLthrBpm},
		// The FTP a ramp test produced on its own ride (#1572) carries the
		// same bound in a second table, and its handler reads the same pair.
		{"rides", "ftp_after_watts", protocol.MinFtpWatts, protocol.MaxFtpWatts},
		// The Borg CR10 rating a rider puts on a finished ride (#2328). Its
		// CHECK is the same trap one table over: widening the scale in
		// `protocol` moves the picker and the handler and leaves the column
		// refusing the new number as a 500.
		{"rides", "rpe", protocol.MinRPE, protocol.MaxRPE},
	} {
		t.Run(want.table+"."+want.column, func(t *testing.T) {
			var def string
			err := st.Pool.QueryRow(t.Context(), `
				select pg_get_constraintdef(c.oid)
				from pg_constraint c
				where c.conrelid = $1::regclass
				  and c.contype = 'c'
				  and pg_get_constraintdef(c.oid) like '%' || $2 || '%'
				limit 1`, want.table, want.column).Scan(&def)
			if err != nil {
				t.Fatalf("%s.%s has no CHECK at all — the bound is only in Go now: %v", want.table, want.column, err)
			}
			// Postgres rewrites `between x and y` as two comparisons, so the
			// definition reads `((col >= 50) AND (col <= 600))` whichever way
			// the migration wrote it.
			min, max := bound(t, def, want.column, ">="), bound(t, def, want.column, "<=")
			if min != want.min || max != want.max {
				t.Errorf("%s.%s allows %d–%d, the code enforces %d–%d.\n"+
					"Widening a bound takes an expand migration as well as the constant (ADR-0019); narrowing one needs the rows checked first.\n"+
					"constraint: %s",
					want.table, want.column, min, max, want.min, want.max, def)
			}
		})
	}
}

func bound(t *testing.T, def, column, op string) int {
	t.Helper()
	m := regexp.MustCompile(regexp.QuoteMeta(column) + `\s*` + regexp.QuoteMeta(op) + `\s*\(?(\d+)`).FindStringSubmatch(def)
	if m == nil {
		t.Fatalf("no `%s %s <number>` in the CHECK on users.%s: %s", column, op, column, def)
	}
	n, err := strconv.Atoi(m[1])
	if err != nil {
		t.Fatal(err)
	}
	return n
}
