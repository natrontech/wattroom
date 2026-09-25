package account

import (
	"context"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// The last of the row, and the board (#2863): the crew a rider chose as home,
// the invite they have not taken up, a status worn as a crew's own picture,
// whether they were asked for an address — and the pins they wrote, which no
// category read at all. Each is something we hold about them and the export
// claims Art. 15's scope.
func TestExportCarriesTheHomeCrewTheInviteAndThePinsTheRiderWrote(t *testing.T) {
	h := setup(t)
	ctx := t.Context()

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
	if _, err := h.store.Queries.SetUserHomeCrew(ctx, db.SetUserHomeCrewParams{
		ID: h.id("alice"), HomeCrewID: crew.ID,
	}); err != nil {
		t.Fatalf("home crew: %v", err)
	}
	invite := "INV2863"
	if err := h.store.Queries.SetPendingCrewCode(ctx, db.SetPendingCrewCodeParams{
		ID: h.id("alice"), PendingCrewCode: &invite,
	}); err != nil {
		t.Fatalf("pending invite: %v", err)
	}
	emoji, err := h.store.Queries.CreateCrewEmoji(ctx, db.CreateCrewEmojiParams{
		CrewID: crew.ID, UserID: h.id("alice"), Name: "hammer", Mime: "image/png", Bytes: []byte("png"),
	})
	if err != nil {
		t.Fatalf("crew emoji: %v", err)
	}
	shortcode := ":hammer:"
	if err := h.store.Queries.SetUserStatus(ctx, db.SetUserStatusParams{
		ID: h.id("alice"), Emoji: &shortcode, EmojiID: emoji.ID,
	}); err != nil {
		t.Fatalf("status: %v", err)
	}
	for who, title := range map[string]string{"alice": "Her door code", "bob": "Bobs server password"} {
		if _, err := h.store.Queries.CreateCrewPin(ctx, db.CreateCrewPinParams{
			CrewID: crew.ID, Title: title, Body: "body of " + title,
			CreatedBy: h.id(who), MaxPins: protocol.MaxCrewPins,
		}); err != nil {
			t.Fatalf("pin by %s: %v", who, err)
		}
	}

	h.reread(t, "alice")

	files := h.exportFiles(t, "alice")

	for name, wants := range map[string][]string{
		"profile.json": {`"homeCrew": "Velvet Hammer"`, `"pendingInvite": "INV2863"`,
			`"emojiIsCrewPicture": true`, `"emailRequired": `},
		"pins.json": {`"crew": "Velvet Hammer"`, `"title": "Her door code"`, `"body": "body of Her door code"`,
			`"createdAt"`, `"updatedAt"`},
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
	// Bob's pin is his writing, not hers — the rule chat.json follows.
	if strings.Contains(files["pins.json"], "Bobs server password") {
		t.Errorf("pins.json carries another rider's pin:\n%s", files["pins.json"])
	}
	if !strings.Contains(files["manifest.json"], `"complete": true`) {
		t.Errorf("a category failed to read:\n%s", files["manifest.json"])
	}
}
