package store

// 20260925212007_board_off_members_off_board (#2820): a rider who joined a
// crew whose board was off was told nobody would see their numbers, and still
// got on_board = true from the column default. The migration takes them off;
// a crew whose board is on keeps everyone where they are.

import (
	"context"
	"testing"
	"time"
)

const boardOffMembersVersion int64 = 20260925212007

func TestBoardOffCrewsTakeTheirMembersOffTheBoard(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	pool := scratchPool(ctx, t)
	migrateScratchTo(ctx, t, pool, boardOffMembersVersion-1)

	user := func(name string) string {
		return insertID(ctx, t, pool, `insert into users (display_name) values ($1) returning id`, name)
	}
	var (
		owner    = user("Owner")
		quiet    = user("Joined the board-off crew")
		ranked   = user("Joined the board-on crew")
		refusing = user("Banned from the board-off crew")
		off      = insertID(ctx, t, pool, `insert into crews (name, owner_id, code) values ('Quiet', $1, 'QUIETC') returning id`, owner)
		on       = insertID(ctx, t, pool, `insert into crews (name, owner_id, code, board_enabled) values ('Ranked', $1, 'RANKED', true) returning id`, owner)
	)
	for _, r := range []struct{ crew, user, role string }{
		{off, quiet, "member"}, {off, refusing, "banned"}, {on, ranked, "member"},
	} {
		if _, err := pool.Exec(ctx, `insert into crew_roles (crew_id, user_id, role) values ($1, $2, $3)`, r.crew, r.user, r.role); err != nil {
			t.Fatalf("crew role: %v", err)
		}
	}

	migrateScratchTo(ctx, t, pool, boardOffMembersVersion)

	onBoard := func(crew, user string) bool {
		t.Helper()
		var b bool
		if err := pool.QueryRow(ctx, `select on_board from crew_roles where crew_id = $1 and user_id = $2`, crew, user).Scan(&b); err != nil {
			t.Fatalf("read on_board: %v", err)
		}
		return b
	}
	if onBoard(off, quiet) {
		t.Error("a member of a board-off crew is still on its board")
	}
	if !onBoard(on, ranked) {
		t.Error("a member of a board-on crew was taken off the board they are ranked on")
	}
	if !onBoard(off, refusing) {
		t.Error("a banned row was rewritten; the migration touches members and admins only")
	}
}
