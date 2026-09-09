package store

// The crew cutover's invariants (#1106) are the only ones in this repo that a
// green suite on a FRESH database says nothing about. Every other test starts
// from a fully migrated schema, which is exactly the state that cannot tell
// you whether the migration preserved what was already there — and what was
// already there is `/r/{slug}` links in emails nobody can recall, ICS feeds in
// calendar apps that cannot be asked to re-subscribe, and bans that must not
// lapse. So this test migrates up to the release BEFORE the crew, writes the
// old world with raw SQL, finishes migrating, and looks.
//
// It runs on a scratch database of its own. `wattroom_test` is shared by every
// worktree and is always fully migrated; stepping it backwards would break
// whoever else is running `make test` at the time.

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// The crew migration. Everything below it is the world as it shipped; UpTo
// stops one short of it, whatever else lands in between.
const crewMigrationVersion int64 = 20260908145114

func cutoverDSN(t *testing.T) string {
	t.Helper()
	if dsn := os.Getenv("WATTROOM_TEST_DB"); dsn != "" {
		return dsn
	}
	return "postgres://wattroom:wattroom@localhost:5432/wattroom_test" //nolint:gosec // compose test credentials
}

// scratchDB creates an empty database beside the test one and hands back a DSN
// for it, dropping it on cleanup.
func scratchDB(t *testing.T) string {
	t.Helper()
	u, err := url.Parse(cutoverDSN(t))
	if err != nil {
		t.Skipf("unparseable DSN: %v", err)
	}
	name := fmt.Sprintf("wattroom_cutover_%d", time.Now().UnixNano())

	admin := *u
	admin.Path = "/postgres"
	sqldb, err := sql.Open("pgx", admin.String())
	if err != nil {
		t.Skipf("no database available: %v", err)
	}
	defer func() { _ = sqldb.Close() }()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := sqldb.ExecContext(ctx, "create database "+name); err != nil {
		t.Skipf("cannot create a scratch database: %v", err)
	}
	t.Cleanup(func() {
		db2, err := sql.Open("pgx", admin.String())
		if err != nil {
			return
		}
		defer func() { _ = db2.Close() }()
		// A context of its own: the test's is cancelled by the time cleanup
		// runs, and a scratch database that outlives the run is litter in
		// every `psql -l` afterwards.
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer dropCancel()
		_, _ = db2.ExecContext(dropCtx, "drop database if exists "+name+" with (force)")
	})

	scratch := *u
	scratch.Path = "/" + name
	return scratch.String()
}

// TestTheCutoverKeepsWhatWasAlreadyThere writes a room the way the release
// before the crew wrote one, migrates over it, and checks the four things
// #1106 says riders cannot be told about if they break.
func TestTheCutoverKeepsWhatWasAlreadyThere(t *testing.T) {
	dsn := scratchDB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("scratch pool: %v", err)
	}
	defer pool.Close()

	goose.SetBaseFS(migrations)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("goose dialect: %v", err)
	}
	sqldb := stdlib.OpenDBFromPool(pool)
	defer func() { _ = sqldb.Close() }()

	// The world as it shipped, one version short of the crew.
	if err := goose.UpToContext(ctx, sqldb, "migrations", crewMigrationVersion-1); err != nil {
		t.Fatalf("migrate to the pre-crew release: %v", err)
	}

	var ownerID, memberID, bannedID, roomID, icsToken string
	row := pool.QueryRow(ctx, `insert into users (display_name) values ('Owner') returning id`)
	if err := row.Scan(&ownerID); err != nil {
		t.Fatalf("owner: %v", err)
	}
	for _, u := range []struct {
		name string
		into *string
	}{{"Member", &memberID}, {"Banned", &bannedID}} {
		if err := pool.QueryRow(ctx,
			`insert into users (display_name) values ($1) returning id`, u.name).Scan(u.into); err != nil {
			t.Fatalf("%s: %v", u.name, err)
		}
	}
	if err := pool.QueryRow(ctx,
		`insert into rooms (code, slug, name, owner_id) values ('ABC123', 'sunday-sufferfest', 'Sunday Sufferfest', $1)
		 returning id, ics_token`, ownerID).Scan(&roomID, &icsToken); err != nil {
		t.Fatalf("room: %v", err)
	}
	for _, m := range []struct{ user, role string }{
		{ownerID, "owner"}, {memberID, "member"}, {bannedID, "banned"},
	} {
		if _, err := pool.Exec(ctx,
			`insert into memberships (room_id, user_id, role) values ($1, $2, $3)`,
			roomID, m.user, m.role); err != nil {
			t.Fatalf("membership %s: %v", m.role, err)
		}
	}

	// ... and now the release that adds the crew.
	if err := goose.UpContext(ctx, sqldb, "migrations"); err != nil {
		t.Fatalf("migrate over the existing world: %v", err)
	}

	t.Run("the share link still resolves", func(t *testing.T) {
		// Emails already sent say /r/sunday-sufferfest and nothing can recall
		// them (notify.go, og.go). The slug stays globally unique, not
		// per-crew, so this lookup must still find exactly the same room.
		var got string
		if err := pool.QueryRow(ctx, `select id from rooms where slug = 'sunday-sufferfest'`).Scan(&got); err != nil {
			t.Fatalf("slug lookup: %v", err)
		}
		if got != roomID {
			t.Fatalf("slug resolves to %s, want the room it always did (%s)", got, roomID)
		}
	})

	// The 6-char room code used to be asserted here too. It stopped being a
	// door in 2026.09.51 (ADR-0038 amended, #1236) and the column went two
	// releases later (#1282); the slug and the ICS token are what emails and
	// calendars still hold.

	t.Run("the ICS token minted before still authorises", func(t *testing.T) {
		// A calendar app cannot sign in and cannot be asked to re-subscribe,
		// so the token it holds has to keep working (00016_room_ics_token).
		var got string
		if err := pool.QueryRow(ctx,
			`select id from rooms where ics_token = $1`, icsToken).Scan(&got); err != nil {
			t.Fatalf("ics lookup: %v", err)
		}
		if got != roomID {
			t.Fatalf("ics token resolves to %s, want %s", got, roomID)
		}
	})

	t.Run("the room lands in a crew, private, owned by its owner", func(t *testing.T) {
		var crewID, crewOwner string
		var crewVisible bool
		if err := pool.QueryRow(ctx,
			`select r.crew_id, c.owner_id, r.crew_visible from rooms r
			 join crews c on c.id = r.crew_id where r.id = $1`,
			roomID).Scan(&crewID, &crewOwner, &crewVisible); err != nil {
			t.Fatalf("crew lookup: %v", err)
		}
		if crewOwner != ownerID {
			t.Fatalf("crew owned by %s, want the room's owner %s", crewOwner, ownerID)
		}
		// ADR-0038's first amendment: existing rooms migrate PRIVATE, or
		// everyone in room A can suddenly see rooms B and C they had no code
		// for the day before, in the release that introduces the concept.
		if crewVisible {
			t.Fatal("a migrated room came back crew-visible; ADR-0038 lands existing rooms private")
		}
	})

	t.Run("nobody loses the access they had", func(t *testing.T) {
		if !canSee(ctx, t, pool, memberID, roomID) {
			t.Fatal("a member of the room before the migration cannot see it after")
		}
		if !canSee(ctx, t, pool, ownerID, roomID) {
			t.Fatal("the room's owner cannot see it after the migration")
		}
	})

	t.Run("a ban made before the migration still denies", func(t *testing.T) {
		if canSee(ctx, t, pool, bannedID, roomID) {
			t.Fatal("a rider banned before the migration is readmitted by it")
		}
	})
}

// canSee asks the one expression every gate now goes through.
func canSee(ctx context.Context, t *testing.T, pool *pgxpool.Pool, user, room string) bool {
	t.Helper()
	var ok bool
	if err := pool.QueryRow(ctx,
		`select exists (select 1 from visible_rooms where user_id = $1 and room_id = $2)`,
		user, room).Scan(&ok); err != nil {
		t.Fatalf("visible_rooms: %v", err)
	}
	return ok
}
