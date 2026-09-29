package audience_test

import (
	"context"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/audience"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// Who each kind of change concerns, read from the store (#2324): ana's crew
// holds cam; fin is ana's friend outside it; sol is a stranger to both, and
// is in nobody's audience.
func TestAudiencesNameWhoAChangeConcernsAndNoStranger(t *testing.T) {
	st := storetest.Open(t)
	ctx := t.Context()
	who := map[string]pgtype.UUID{}
	for _, name := range []string{"ana", "cam", "fin", "sol"} {
		u, err := st.Queries.CreateUser(ctx, db.CreateUserParams{DisplayName: name, FtpWatts: 200, WeightKg: 75})
		if err != nil {
			t.Fatal(err)
		}
		who[name] = u.ID
		t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID) })
	}
	crew := testx.Crew(t, st, "Tuesday", who["ana"], who["cam"])
	open, err := store.ParseUUID(testx.Voice(t, st, crew, "Lounge", false))
	if err != nil {
		t.Fatal(err)
	}
	// A private channel ana is in by owning the crew; cam is not named.
	gated, err := store.ParseUUID(testx.Voice(t, st, crew, "Coaching", true))
	if err != nil {
		t.Fatal(err)
	}
	pair := db.CreateFriendRequestParams{RequesterID: who["ana"], AddresseeID: who["fin"]}
	if _, err := st.Queries.CreateFriendRequest(ctx, pair); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Queries.AcceptFriendRequest(ctx, db.AcceptFriendRequestParams(pair)); err != nil {
		t.Fatal(err)
	}

	names := func(ids []string, err error) []string {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		var out []string
		for name, id := range who {
			if slices.Contains(ids, store.UUIDString(id)) {
				out = append(out, name)
			}
		}
		slices.Sort(out)
		return out
	}
	for _, c := range []struct {
		change string
		got    []string
		want   []string
	}{
		// Her status line, coming online: herself, her friend, her crew.
		{"ana's own change", names(audience.Rider(ctx, st.Queries, who["ana"])), []string{"ana", "cam", "fin"}},
		// Joining the lounge: whoever may enter it, and her friend's list.
		{"ana joins the lounge", names(audience.Channel(ctx, st.Queries, open, who["ana"])), []string{"ana", "cam", "fin"}},
		// A gated channel's roster is for who may enter it (#2821): not cam.
		{"ana joins the private channel", names(audience.Channel(ctx, st.Queries, gated, who["ana"])), []string{"ana", "fin"}},
		// A crew edit: its members — and a rider on their way out, named.
		{"the crew changes", names(audience.Crew(ctx, st.Queries, crew)), []string{"ana", "cam"}},
		{"a rider is banned", names(audience.Crew(ctx, st.Queries, crew, who["sol"])), []string{"ana", "cam", "sol"}},
		// A friendship: the two of them.
		{"a friendship changes", names(audience.Pair(who["ana"], who["fin"]), nil), []string{"ana", "fin"}},
	} {
		if !slices.Equal(c.got, c.want) {
			t.Errorf("%s: told %v, want %v", c.change, c.got, c.want)
		}
	}

	// A hidden pair is on neither's friends list (#3202), so neither is told.
	if _, err := st.Queries.HideRider(ctx, db.HideRiderParams{Blocker: who["fin"], Blocked: who["ana"]}); err != nil {
		t.Fatal(err)
	}
	if got := names(audience.Rider(ctx, st.Queries, who["ana"])); slices.Contains(got, "fin") {
		t.Errorf("a friend who hid ana is still told about her: %v", got)
	}
}
