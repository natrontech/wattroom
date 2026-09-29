package account

import (
	"context"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

// notExported is every table holding a rider's rows that the archive leaves
// out, and why. handleExport's doc comment argues each at length; a table
// that turns up here without a reason a person would accept belongs in a
// category instead (GDPR Art. 15).
var notExported = map[string]string{
	"sessions":      "a hash of a sign-in cookie: no screen lists it, and session material is nothing to hand back",
	"channel_reads": "an unread-marker cursor: bookkeeping no screen shows the rider",
	"dm_reads":      "an unread-marker cursor: bookkeeping no screen shows the rider",
	"track_plays":   "read back only as a room's last five titles, the same for everyone in it, with no per-rider view",
}

// userTables is every table with a foreign key to users — the tables a
// rider's rows live in, which Art. 15 hands back and Art. 17 takes.
// ponytail: direct keys only; a table that hangs off rides or crews goes
// with its parent and is that parent's category's business.
func userTables(ctx context.Context, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}) ([]string, error) {
	rows, err := q.Query(ctx, `
		select distinct tc.table_name::text
		from information_schema.table_constraints tc
		join information_schema.constraint_column_usage ccu
		  on ccu.constraint_schema = tc.constraint_schema and ccu.constraint_name = tc.constraint_name
		where tc.constraint_type = 'FOREIGN KEY'
		  and tc.table_schema = current_schema()
		  and ccu.table_name = 'users'
		order by 1`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// uncovered is the tables in the schema that neither a category declares nor
// notExported excuses.
func uncovered(tables []string) []string {
	declared := map[string]bool{}
	for _, cat := range (&export{}).categories() {
		for _, table := range cat.tables {
			declared[table] = true
		}
	}
	var out []string
	for _, table := range tables {
		if !declared[table] && notExported[table] == "" {
			out = append(out, table)
		}
	}
	return out
}

// A new table that holds a rider's rows reaches the export or says why not
// (#3045). Each category used to be added by hand after someone noticed the
// gap, and Ride Worlds adds a dozen rider-owned tables at once.
func TestExportCoversEveryTableThatHoldsARidersRows(t *testing.T) {
	st := storetest.Open(t)
	tables, err := userTables(t.Context(), st.Pool)
	if err != nil {
		t.Fatalf("walk the schema: %v", err)
	}
	if len(tables) == 0 {
		t.Fatal("no table references users: the walk is broken, not the schema")
	}
	for _, table := range uncovered(tables) {
		t.Errorf("%s has a foreign key to users and is in no export category: export it — a category's tables name it — or add it to notExported with the reason a rider would accept", table)
	}
	for table := range notExported {
		if !slices.Contains(tables, table) {
			t.Errorf("notExported names %s, which no longer references users: drop the entry", table)
		}
	}

	// And the walk sees a table the moment it exists: one created inside a
	// transaction that never commits, so no neighbour sharing this database
	// ever meets it.
	tx, err := st.Pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if _, err := tx.Exec(t.Context(),
		`create table export_coverage_probe (user_id uuid not null references users(id) on delete cascade)`); err != nil {
		t.Fatalf("probe table: %v", err)
	}
	probed, err := userTables(t.Context(), tx)
	if err != nil {
		t.Fatalf("walk the schema with the probe: %v", err)
	}
	if got := uncovered(probed); !slices.Contains(got, "export_coverage_probe") {
		t.Errorf("a new table referencing users went unflagged: uncovered = %v", got)
	}
}
