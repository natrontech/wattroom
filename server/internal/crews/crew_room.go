package crews

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/wallet"
)

type sightingJSON struct {
	Kind   string    `json:"kind"`
	SeenAt time.Time `json:"seenAt"`
}

// handleCrewSightings: the visitors the crew's room has seen, for its members.
func (s *Service) handleCrewSightings(w http.ResponseWriter, r *http.Request) {
	crew, _, _, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListCrewSightings(r.Context(), crew.ID)
	if err != nil {
		httpx.Fail(w, s.log, "sightings failed", err, "The album could not be loaded.", "crew", store.UUIDString(crew.ID))
		return
	}
	out := make([]sightingJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, sightingJSON{Kind: row.Kind, SeenAt: row.SeenAt.Time})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"sightings": out})
}

// handleAddCrewSighting: a member's screen saw a visitor. The room's visitors
// are a function of the clock, so a client can claim one it did not see. It
// costs nothing: an album entry is paint, and the set is closed.
func (s *Service) handleAddCrewSighting(w http.ResponseWriter, r *http.Request) {
	crew, _, _, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	var req struct {
		Kind string `json:"kind"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	if !slices.Contains(protocol.LoungeVisitors, req.Kind) {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "That visitor is not in the album.")
		return
	}
	if _, err := s.store.Queries.AddCrewSighting(r.Context(), db.AddCrewSightingParams{CrewID: crew.ID, Kind: req.Kind}); err != nil {
		httpx.Fail(w, s.log, "sighting failed", err, "The album could not be written.", "crew", store.UUIDString(crew.ID))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// roomFurnishing is what the room has: what the crew owns, what is up in each
// slot, and the price list.
func (s *Service) roomFurnishing(ctx context.Context, crew pgtype.UUID) (map[string]any, error) {
	items, err := s.store.Queries.ListCrewRoomItems(ctx, crew)
	if err != nil {
		return nil, err
	}
	picks, err := roomPicks(ctx, s.store.Queries, crew)
	if err != nil {
		return nil, err
	}
	// Never null: the client lists these, and a crew with nothing has an empty list.
	if items == nil {
		items = []string{}
	}
	return map[string]any{"owned": items, "picks": picks, "shop": protocol.RoomItems}, nil
}

// setRoomPick writes one slot of the room's picks.
func setRoomPick(ctx context.Context, q *db.Queries, crew pgtype.UUID, slot, item string) error {
	picks, err := roomPicks(ctx, q, crew)
	if err != nil {
		return err
	}
	if item == "" {
		delete(picks, slot)
	} else {
		picks[slot] = item
	}
	next, err := json.Marshal(picks)
	if err != nil {
		return err
	}
	return q.SetCrewRoomPicks(ctx, db.SetCrewRoomPicksParams{CrewID: crew, Picks: next})
}

// roomPicks reads what is up in each slot; no row is the room as it came.
func roomPicks(ctx context.Context, q *db.Queries, crew pgtype.UUID) (map[string]string, error) {
	picks := map[string]string{}
	raw, err := q.CrewRoomPicks(ctx, crew)
	if errors.Is(err, pgx.ErrNoRows) {
		return picks, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &picks); err != nil {
		return nil, err
	}
	return picks, nil
}

var (
	errRoomOwned = errors.New("already in the room")
	errRoomShort = errors.New("not enough Batzen")
)

// handleBuyRoomItem: a member pays for something from their own wallet, and it
// goes up in the room for the whole crew.
func (s *Service) handleBuyRoomItem(w http.ResponseWriter, r *http.Request) {
	crew, user, _, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	id := r.PathValue("item")
	item, known := protocol.RoomItems[id]
	if !known {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "There is no such thing in the shop.")
		return
	}
	var balance, need int64
	err := s.store.WithUserLocked(r.Context(), user.ID, func(q *db.Queries) error {
		owned, err := q.CrewOwnsRoomItem(r.Context(), db.CrewOwnsRoomItemParams{CrewID: crew.ID, Item: id})
		if err != nil {
			return err
		}
		if owned {
			return errRoomOwned
		}
		held, err := wallet.Balance(r.Context(), q, user.ID)
		if err != nil {
			return err
		}
		if held < int64(item.Price) {
			need = int64(item.Price) - held
			return errRoomShort
		}
		if err := q.AddCrewRoomItem(r.Context(), db.AddCrewRoomItemParams{CrewID: crew.ID, Item: id, BoughtBy: user.ID}); err != nil {
			return err
		}
		if err := wallet.Spend(r.Context(), q, user.ID, "room:"+store.UUIDString(crew.ID)+":"+id, item.Price); err != nil {
			return err
		}
		balance = held - int64(item.Price)
		return setRoomPick(r.Context(), q, crew.ID, item.Slot, id)
	})
	switch {
	case errors.Is(err, errRoomOwned):
		httpx.WriteError(w, http.StatusConflict, "conflict", "Your crew already has this. Pick it instead.")
		return
	case errors.Is(err, errRoomShort):
		httpx.WriteError(w, http.StatusConflict, "conflict",
			fmt.Sprintf("You need %d more Batzen. Every minute ridden at your FTP earns one.", need))
		return
	case err != nil:
		httpx.Fail(w, s.log, "room purchase failed", err, "That could not be bought. Try again.", "crew", store.UUIDString(crew.ID))
		return
	}
	s.changed(r.Context(), crew.ID)
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"balance": balance})
}

// handlePickRoomItem: any member changes what is up in a slot, from what the
// crew owns. "" puts back what the room came with.
func (s *Service) handlePickRoomItem(w http.ResponseWriter, r *http.Request) {
	crew, _, _, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	var req struct {
		Slot string `json:"slot"`
		Item string `json:"item"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	if req.Item != "" {
		item, known := protocol.RoomItems[req.Item]
		if !known || item.Slot != req.Slot {
			httpx.WriteError(w, http.StatusBadRequest, "validation_error", "That does not go there.")
			return
		}
		owned, err := s.store.Queries.CrewOwnsRoomItem(r.Context(), db.CrewOwnsRoomItemParams{CrewID: crew.ID, Item: req.Item})
		if err != nil {
			httpx.Fail(w, s.log, "room pick failed", err, "The room could not be changed.", "crew", store.UUIDString(crew.ID))
			return
		}
		if !owned {
			httpx.WriteError(w, http.StatusConflict, "conflict", "Your crew does not have this yet.")
			return
		}
	}
	if err := setRoomPick(r.Context(), s.store.Queries, crew.ID, req.Slot, req.Item); err != nil {
		httpx.Fail(w, s.log, "room pick failed", err, "The room could not be changed.", "crew", store.UUIDString(crew.ID))
		return
	}
	s.changed(r.Context(), crew.ID)
	w.WriteHeader(http.StatusNoContent)
}
