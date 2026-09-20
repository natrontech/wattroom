package storetest_test

import (
	"context"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// A duplicate key on a fixture is the one database error whose cause is not
// in the code being tested, and whose recovery is a command nothing prints.
// Without the sentence below a maintainer reads "duplicate key value
// violates unique constraint" and has no reason to reach for
// `make dev-db-drop`, which is the only thing that clears what a killed run
// left behind. This fails silently if it regresses: the insert still errors,
// just uselessly.
func TestADuplicateFixtureSaysHowToRecover(t *testing.T) {
	st := storetest.Open(t)
	owner, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
		DisplayName: "storetest", FtpWatts: 200, WeightKg: 75,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", owner.ID)
	})

	slug := testx.Slug("storetest-duplicate")
	room, err := st.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Slug: slug, Name: "Storetest", OwnerID: owner.ID,
	})
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from rooms where id = $1", room.ID)
	})

	_, err = st.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Slug: slug, Name: "Storetest again", OwnerID: owner.ID,
	})
	if err == nil {
		t.Fatal("the second room took the same slug — rooms_slug_key is gone")
	}
	if !strings.Contains(err.Error(), "make dev-db-drop") {
		t.Errorf("a duplicate key does not name the recovery: %v", err)
	}
	if !strings.Contains(err.Error(), "23505") {
		t.Errorf("the original error was swallowed: %v", err)
	}
}
