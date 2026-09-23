package account

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// Everything a rider does in a crew made after M9 reaches their export
// (#2554). Such a crew has no room at all, and six export queries still
// joined `rooms` — so a text channel's lines, their reactions and pictures, a
// plan on the crew's Schedule, the answer to it and the session's recap all
// fell out of the zip without a word.
func TestExportCarriesWhatARiderDidInACrewsChannels(t *testing.T) {
	h := setup(t)
	ctx := t.Context()
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}

	crew, err := h.store.Queries.CreateCrew(ctx, db.CreateCrewParams{
		Name: "Velvet Hammer", OwnerID: h.id("bob"), Code: testx.CrewCode(),
	})
	if err != nil {
		t.Fatalf("crew: %v", err)
	}
	t.Cleanup(func() {
		_, _ = h.store.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID)
	})
	if err := h.store.Queries.SetCrewRole(ctx, db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.id("alice"), Role: "member",
	}); err != nil {
		t.Fatalf("membership: %v", err)
	}
	// Her two switches on the crew membership (#2432): no mail, on the board.
	if _, err := h.store.Queries.SetCrewPrefs(ctx, db.SetCrewPrefsParams{
		CrewID: crew.ID, UserID: h.id("alice"), Notify: false, OnBoard: true,
	}); err != nil {
		t.Fatalf("prefs: %v", err)
	}
	channel := func(kind, name string, private bool) db.Channel {
		c, err := h.store.Queries.CreateChannel(ctx, db.CreateChannelParams{
			CrewID: crew.ID, Kind: kind, Name: name, Private: private, MaxChannels: protocol.MaxCrewTextChannels,
		})
		if err != nil {
			t.Fatalf("channel %s: %v", name, err)
		}
		return c
	}
	text := channel("text", "Banter", false)
	voice := channel("voice", "Pain Cave", false)
	secret := channel("text", "Coaches", true)

	// A line of hers with a picture, a reaction of hers on it and on bob's.
	image, err := h.store.Queries.SaveChannelImage(ctx, db.SaveChannelImageParams{
		ChannelID: text.ID, UserID: h.id("alice"), Mime: "image/png", Bytes: []byte("png"),
	})
	if err != nil {
		t.Fatalf("image: %v", err)
	}
	mine, err := h.store.Queries.SaveChannelMessage(ctx, db.SaveChannelMessageParams{
		ChannelID: text.ID, UserID: h.id("alice"), Text: "saddle up at seven", ImageID: image, CreatedAt: now,
	})
	if err != nil {
		t.Fatalf("line: %v", err)
	}
	his, err := h.store.Queries.SaveChannelMessage(ctx, db.SaveChannelMessageParams{
		ChannelID: text.ID, UserID: h.id("bob"), Text: "bobs channel line", CreatedAt: now,
	})
	if err != nil {
		t.Fatalf("bob's line: %v", err)
	}
	for id, emoji := range map[pgtype.UUID]string{mine: "skull", his: "flame"} {
		if n, err := h.store.Queries.AddChannelReaction(ctx, db.AddChannelReactionParams{
			MessageID: id, UserID: h.id("alice"), Emoji: emoji, ChannelID: text.ID,
		}); err != nil || n != 1 {
			t.Fatalf("reaction %s: %d %v", emoji, n, err)
		}
	}

	// A plan she put on the crew's calendar, and her answer to bob's.
	if _, err := h.store.Queries.CreateCrewPlan(ctx, db.CreateCrewPlanParams{
		CrewID: crew.ID, ChannelID: voice.ID, WorkoutName: "Her Threshold",
		WorkoutJson: []byte(`{"steps":[]}`), CreatedBy: h.id("alice"),
		StartsAt: pgtype.Timestamptz{Time: time.Now().Add(48 * time.Hour), Valid: true},
	}); err != nil {
		t.Fatalf("her plan: %v", err)
	}
	bobs, err := h.store.Queries.CreateCrewPlan(ctx, db.CreateCrewPlanParams{
		CrewID: crew.ID, ChannelID: voice.ID, WorkoutName: "Bobs Openers",
		WorkoutJson: []byte(`{"steps":[]}`), CreatedBy: h.id("bob"),
		StartsAt: pgtype.Timestamptz{Time: time.Now().Add(72 * time.Hour), Valid: true},
	})
	if err != nil {
		t.Fatalf("bob's plan: %v", err)
	}
	if err := h.store.Queries.SetRsvp(ctx, db.SetRsvpParams{
		SessionID: bobs.ID, UserID: h.id("alice"), Going: true,
	}); err != nil {
		t.Fatalf("rsvp: %v", err)
	}

	// A session she rode in the voice channel. Recent, for #2080's reason.
	started := time.Now().Add(-2 * time.Hour)
	riders, err := json.Marshal([]map[string]any{{
		"id": store.UUIDString(h.id("alice")), "rider": "alice",
		"from": started.UnixMilli(), "to": started.Add(time.Hour).UnixMilli(), "rode": true,
	}})
	if err != nil {
		t.Fatalf("riders: %v", err)
	}
	var session pgtype.UUID
	if err := session.Scan("7f0c5d1e-0000-4000-8000-000000002554"); err != nil {
		t.Fatalf("session id: %v", err)
	}
	if _, err := h.store.Queries.SaveSessionRecap(ctx, db.SaveSessionRecapParams{
		SessionID: session, ChannelID: voice.ID, Workout: "Channel Sweet Spot", Riders: riders,
		StartedAt: pgtype.Timestamptz{Time: started, Valid: true},
		EndedAt:   pgtype.Timestamptz{Time: started.Add(time.Hour), Valid: true},
	}); err != nil {
		t.Fatalf("recap: %v", err)
	}

	// Named into the private channel, and naming carol into it herself.
	for who, by := range map[string]string{"alice": "bob", "carol": "alice"} {
		if err := h.store.Queries.NameChannelMember(ctx, db.NameChannelMemberParams{
			ChannelID: secret.ID, UserID: h.id(who), AddedBy: h.id(by),
		}); err != nil {
			t.Fatalf("name %s: %v", who, err)
		}
	}

	files := h.exportFiles(t, "alice")

	for name, wants := range map[string][]string{
		"chat.json":                 {"saddle up at seven", "\"channel\": \"Banter\"", "\"crew\": \"Velvet Hammer\""},
		"reactions.json":            {"skull", "flame", "\"on\": \"channel\"", "\"place\": \"Banter\""},
		"images.json":               {store.UUIDString(image), "\"on\": \"channel\""},
		"sessions-i-scheduled.json": {"Her Threshold", "\"channel\": \"Pain Cave\""},
		"planned-sessions.json":     {"Bobs Openers", "\"answer\": \"in\"", "\"crew\": \"Velvet Hammer\""},
		"sessions.json":             {"Channel Sweet Spot", "\"channel\": \"Pain Cave\""},
		"crews.json":                {"Velvet Hammer", "\"notify\": false", "\"onBoard\": true"},
		"channel-members.json":      {"\"toMe\"", "\"iNamed\"", "\"channel\": \"Coaches\"", "carol"},
	} {
		body, ok := files[name]
		if !ok {
			t.Errorf("the export has no %s", name)
			continue
		}
		for _, want := range wants {
			if !strings.Contains(body, want) {
				t.Errorf("%s does not carry %s:\n%s", name, want, body)
			}
		}
	}

	// Other people's data stays where it was: bob's line is not hers, and
	// the person she named is named by display name, never by id.
	for _, name := range []string{"chat.json", "reactions.json"} {
		if strings.Contains(files[name], "bobs channel line") {
			t.Errorf("%s carries another rider's line:\n%s", name, files[name])
		}
	}
	if strings.Contains(files["channel-members.json"], store.UUIDString(h.id("carol"))) {
		t.Errorf("channel-members.json carries another rider's account id:\n%s", files["channel-members.json"])
	}
	if !strings.Contains(files["manifest.json"], "\"complete\": true") {
		t.Errorf("a category failed to read:\n%s", files["manifest.json"])
	}
}
