package testx

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Crew founds a crew for a test, owned by owner, with members in it as plain
// members — no channels yet, and no room behind it: a crew founded since M9.
// It goes at cleanup and takes its channels with it. Made after its people,
// it goes before them, which crews.owner_id (ON DELETE RESTRICT) needs.
func Crew(t testing.TB, st *store.Store, name string, owner pgtype.UUID, members ...pgtype.UUID) pgtype.UUID {
	t.Helper()
	ctx := context.Background()
	crew, err := st.Queries.CreateCrew(ctx, db.CreateCrewParams{Name: name, OwnerID: owner, Code: CrewCode()})
	if err != nil {
		t.Fatalf("fixture crew: %v", err)
	}
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID) })
	for _, member := range members {
		if err := st.Queries.SetCrewRole(ctx, db.SetCrewRoleParams{CrewID: crew.ID, UserID: member, Role: "member"}); err != nil {
			t.Fatalf("fixture crew member: %v", err)
		}
	}
	return crew.ID
}

// Voice makes a voice channel in the crew and returns its id — the key the
// hub knows it by, and so what a fake of WhereIs answers. A private one
// admits the crew's owner, its admins and the members named here (ADR-0058).
func Voice(t testing.TB, st *store.Store, crew pgtype.UUID, name string, private bool, named ...pgtype.UUID) string {
	t.Helper()
	ctx := context.Background()
	channel, err := st.Queries.CreateChannel(ctx, db.CreateChannelParams{
		CrewID: crew, Kind: "voice", Name: name, Private: private, MaxChannels: 100,
	})
	if err != nil {
		t.Fatalf("fixture voice channel: %v", err)
	}
	for _, user := range named {
		if err := st.Queries.NameChannelMember(ctx, db.NameChannelMemberParams{ChannelID: channel.ID, UserID: user}); err != nil {
			t.Fatalf("fixture channel member: %v", err)
		}
	}
	return store.UUIDString(channel.ID)
}

// Text makes a text channel in the crew and returns its id — Voice's twin,
// for a test that needs somewhere to write (#2558: where a room's chat was).
func Text(t testing.TB, st *store.Store, crew pgtype.UUID, name string) pgtype.UUID {
	t.Helper()
	channel, err := st.Queries.CreateChannel(context.Background(), db.CreateChannelParams{
		CrewID: crew, Kind: "text", Name: name, MaxChannels: 100,
	})
	if err != nil {
		t.Fatalf("fixture text channel: %v", err)
	}
	return channel.ID
}
