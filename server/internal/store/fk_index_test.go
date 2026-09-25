package store_test

import (
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

// unindexedForeignKeys names every foreign key with no index whose leading
// columns are exactly its own. Without one, deleting the parent row — a
// channel, an account — scans the whole child table for what to cascade or
// null, and a filter on the column does the same.
const unindexedForeignKeys = `
select c.conrelid::regclass::text || '(' || string_agg(a.attname, ', ' order by k.i) || ')'
from pg_constraint c
cross join lateral unnest(c.conkey) with ordinality as k(attnum, i)
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
where c.contype = 'f'
  and not exists (
    select 1 from pg_index x
    where x.indrelid = c.conrelid
      and (string_to_array(x.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)] @> c.conkey
      and (string_to_array(x.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)] <@ c.conkey)
group by c.oid, c.conrelid
order by 1`

// Every foreign key is indexed (#891, #2841). #891 indexed rides.room_id;
// the move to channels added rides.channel_id without one, and 30 more had
// gathered beside it — rides and medals are the tables that grow for ever.
// A new foreign key fails here until its migration adds the index too.
func TestEveryForeignKeyIsIndexed(t *testing.T) {
	st := storetest.Open(t)
	rows, err := st.Pool.Query(t.Context(), unindexedForeignKeys)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var missing []string
	for rows.Next() {
		var fk string
		if err := rows.Scan(&fk); err != nil {
			t.Fatal(err)
		}
		missing = append(missing, fk)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(missing) > 0 {
		t.Errorf("%d foreign keys have no index leading with their columns — add one in the migration that adds the key:\n  %s",
			len(missing), strings.Join(missing, "\n  "))
	}
}
