package wardrobe

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// looks are the loadout's keys that are not slots: a look's free choices —
// colours, options, sizes, skin and body — which cost nothing and are owned
// by everyone (the catalogue's rules.priceTheIdea).
var looks = []string{"body", "colours", "opts", "params", "skin"}

// handleOutfit saves what the rider wears: one item per slot, each one they
// own, and the free choices beside them. The client fills a slot left out
// with the starter item, so a loadout names only what it changes.
func (s *Service) handleOutfit(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to dress your rider.")
	if !ok {
		return
	}
	var loadout map[string]json.RawMessage
	if err := httpx.DecodeStrict(r, &loadout); err != nil || loadout == nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "An outfit is a JSON object of slots and their items.")
		return
	}
	owned, err := s.store.Queries.ListOwnedItems(r.Context(), user.ID)
	if err != nil {
		httpx.Fail(w, s.log, "outfit owned items failed", err, "The outfit could not be saved. Try again.")
		return
	}
	if msg := checkLoadout(loadout, owned); msg != "" {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", msg)
		return
	}
	body, err := json.Marshal(loadout)
	if err == nil {
		err = s.store.Queries.SetOutfit(r.Context(), db.SetOutfitParams{UserID: user.ID, Loadout: body})
	}
	if err != nil {
		httpx.Fail(w, s.log, "outfit save failed", err, "The outfit could not be saved. Try again.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// checkLoadout says what is wrong with a loadout, or "" when nothing is.
func checkLoadout(loadout map[string]json.RawMessage, owned []string) string {
	for key, raw := range loadout {
		if slices.Contains(looks, key) {
			continue
		}
		if !slices.Contains(slots, key) {
			return fmt.Sprintf("%q is not a slot.", key)
		}
		var id string
		if json.Unmarshal(raw, &id) != nil {
			return fmt.Sprintf("The %s slot takes one item id.", key)
		}
		it, ok := Lookup(id)
		if !ok || it.Slot != key {
			return fmt.Sprintf("%q is not an item for the %s slot.", id, key)
		}
		if !wearable(it, owned) {
			return fmt.Sprintf("%q is not in your wardrobe yet.", id)
		}
	}
	return ""
}

// wearable says whether a rider who owns these items may put this one on.
func wearable(it Item, owned []string) bool {
	switch it.Kind() {
	case "buy", "earn":
		return it.Starter || slices.Contains(owned, it.ID)
	case "with":
		for _, frame := range strings.Split(strings.TrimPrefix(it.Unlock, "with:"), "|") {
			if f, ok := Lookup(frame); ok && wearable(f, owned) {
				return true
			}
		}
		return false
	}
	// ponytail: crew kit passes for anyone — a loadout names no crew to
	// check it against until the crew kit's design lands (Refs #3161).
	return true
}

// MarkWorn records that the rider's outfit went out on a ride: its bought
// items are theirs to keep from here on, past the undo (docs/SPEC.md
// "Wardrobe"). Called in the transaction that saves the ride.
func MarkWorn(ctx context.Context, q *db.Queries, user pgtype.UUID) error {
	return q.MarkOutfitWorn(ctx, user)
}
