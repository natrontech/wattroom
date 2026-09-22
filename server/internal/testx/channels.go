package testx

import (
	"context"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// VoiceChannel is the voice channel a fixture room became (#2436) — what the
// hub hands its keepers now, and so what a test of a keeper has to hand it.
// A room made straight through the store has no crew and so no channels; it
// gets a private crew of its own first (crew_visible false: nobody new sees
// the room), then the channels AdoptRoomChannels gives every new room. The
// crew goes at cleanup, and the channels with it.
func VoiceChannel(t testing.TB, st *store.Store, room db.Room) string {
	t.Helper()
	ctx := context.Background()
	// Read again: the caller's copy predates any placement an earlier call made.
	room, err := st.Queries.GetRoomByID(ctx, room.ID)
	if err != nil {
		t.Fatalf("fixture room: %v", err)
	}
	if !room.CrewID.Valid {
		crew, err := st.Queries.CreateCrew(ctx, db.CreateCrewParams{Name: room.Name, OwnerID: room.OwnerID, Code: CrewCode()})
		if err != nil {
			t.Fatalf("fixture crew: %v", err)
		}
		t.Cleanup(func() {
			// The room first: its crew cannot go while it points there.
			_, _ = st.Pool.Exec(context.Background(), "delete from rooms where id = $1", room.ID)
			_, _ = st.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID)
		})
		if err := st.Queries.PlaceRoomInCrew(ctx, db.PlaceRoomInCrewParams{ID: room.ID, CrewID: crew.ID}); err != nil {
			t.Fatalf("fixture crew placement: %v", err)
		}
	}
	if err := st.Queries.AdoptRoomChannels(ctx, room.ID); err != nil {
		t.Fatalf("fixture channels: %v", err)
	}
	channel := st.VoiceChannelOf(ctx, room.ID)
	if channel == "" {
		t.Fatal("fixture room has no voice channel")
	}
	return channel
}
