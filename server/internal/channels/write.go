package channels

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// capOf is how many channels of a kind one crew may hold, and whether the
// kind is one at all.
func capOf(kind string) (int32, bool) {
	switch kind {
	case kindText:
		return protocol.MaxCrewTextChannels, true
	case kindVoice:
		return protocol.MaxCrewVoiceChannels, true
	}
	return 0, false
}

// cleanName trims a channel name and reports whether it is one: 1 to
// protocol.MaxChannelNameChars characters, on one line.
func cleanName(raw string) (string, bool) {
	name := strings.TrimSpace(raw)
	if name == "" || utf8.RuneCountInString(name) > protocol.MaxChannelNameChars ||
		strings.ContainsFunc(name, unicode.IsControl) {
		return "", false
	}
	return name, true
}

// firstName is what a crew's first channels are called (#2480): a text and a
// voice channel of one name, the pair every room became (ADR-0058).
const firstName = "Lounge"

// OpenFirst gives a crew being founded its first text and voice channel, in
// the founding's transaction — a crew with nowhere to talk or ride is one its
// founder lands in and cannot use.
func OpenFirst(ctx context.Context, q *db.Queries, crewID pgtype.UUID) error {
	for _, kind := range []string{kindText, kindVoice} {
		limit, _ := capOf(kind)
		if _, err := q.CreateChannel(ctx, db.CreateChannelParams{
			CrewID: crewID, Kind: kind, Name: firstName, MaxChannels: limit,
		}); err != nil {
			return err
		}
	}
	return nil
}

var nameRule = fmt.Sprintf("A channel name has to be 1–%d characters on one line.", protocol.MaxChannelNameChars)

func (s *Service) handleCreate(w http.ResponseWriter, r *http.Request) {
	crewID, _, role, ok := s.crewFor(w, r)
	if !ok || !requireAdmin(w, role) {
		return
	}
	var req struct {
		Kind    string `json:"kind"`
		Name    string `json:"name"`
		Private bool   `json:"private"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	limit, ok := capOf(req.Kind)
	if !ok {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A channel is a chat channel or a voice channel.", "kind")
		return
	}
	name, ok := cleanName(req.Name)
	if !ok {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", nameRule, "name")
		return
	}
	row, err := s.store.Queries.CreateChannel(r.Context(), db.CreateChannelParams{
		CrewID: crewID, Kind: req.Kind, Name: name, Private: req.Private, MaxChannels: limit,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		plural := "voice channels"
		if req.Kind == kindText {
			plural = "chat channels" // a rider's word for a text channel (#2696)
		}
		httpx.WriteCeiling(w, fmt.Sprintf("A crew holds at most %d %s — delete one to make room.", limit, plural))
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "create channel failed", err, "The channel could not be created.", "crew", store.UUIDString(crewID))
		return
	}
	s.changed()
	httpx.WriteJSON(w, http.StatusCreated, toJSON(row, []memberJSON{}))
}

type autoplayPatch struct {
	Enabled *bool   `json:"enabled"`
	Order   *string `json:"order"`
	// "" chooses none.
	PlaylistID *string `json:"playlistId"`
}

type channelPatch struct {
	Name      *string        `json:"name"`
	Position  *int32         `json:"position"`
	Private   *bool          `json:"private"`
	SoundPack *string        `json:"soundPack"`
	Autoplay  *autoplayPatch `json:"autoplay"`
}

// handleUpdate: any of name, position, gate, sound pack and autoplay, in one
// transaction. Absent fields keep their value.
func (s *Service) handleUpdate(w http.ResponseWriter, r *http.Request) {
	channel, _, role, ok := s.channelFor(w, r)
	if !ok || !requireAdmin(w, role) {
		return
	}
	var req channelPatch
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	next, ok := s.merge(w, r.Context(), channel, req)
	if !ok {
		return
	}
	updated, err := s.save(r.Context(), channel, next, req.Position)
	if err != nil {
		httpx.Fail(w, s.log, "update channel failed", err, "The channel could not be saved.", "channel", store.UUIDString(channel.ID))
		return
	}
	members, ok := s.membersOf(w, r.Context(), updated)
	if !ok {
		return
	}
	s.changed()
	httpx.WriteJSON(w, http.StatusOK, toJSON(updated, members))
}

// merge validates a patch against the channel it changes and returns the row
// to write, answering the refusal itself.
func (s *Service) merge(w http.ResponseWriter, ctx context.Context, c db.Channel, req channelPatch) (db.UpdateChannelParams, bool) {
	next := db.UpdateChannelParams{
		ID: c.ID, Name: c.Name, Private: c.Private, SoundPack: c.SoundPack,
		AutoplayEnabled: c.AutoplayEnabled, AutoplayOrder: c.AutoplayOrder, AutoplayPlaylistID: c.AutoplayPlaylistID,
	}
	refuse := func(message, field string) (db.UpdateChannelParams, bool) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", message, field)
		return db.UpdateChannelParams{}, false
	}
	if req.Name != nil {
		name, ok := cleanName(*req.Name)
		if !ok {
			return refuse(nameRule, "name")
		}
		next.Name = name
	}
	if req.Position != nil && *req.Position < 0 {
		return refuse("A position counts from 0.", "position")
	}
	if req.Private != nil {
		next.Private = *req.Private
	}
	if (req.SoundPack != nil || req.Autoplay != nil) && c.Kind != kindVoice {
		return refuse("Only a voice channel has a deck and makes sounds.", "kind")
	}
	if req.SoundPack != nil {
		if *req.SoundPack != "base" && *req.SoundPack != "silent" {
			return refuse("A sound pack is base or silent.", "soundPack")
		}
		next.SoundPack = *req.SoundPack
	}
	if a := req.Autoplay; a != nil {
		if a.Enabled != nil {
			next.AutoplayEnabled = *a.Enabled
		}
		if a.Order != nil {
			if !slices.Contains([]string{"ordered", "shuffled", "smart"}, *a.Order) {
				return refuse("Autoplay plays ordered, shuffled or smart.", "autoplay.order")
			}
			next.AutoplayOrder = *a.Order
		}
		if a.PlaylistID != nil {
			next.AutoplayPlaylistID = pgtype.UUID{}
			if *a.PlaylistID != "" {
				id, err := store.ParseUUID(*a.PlaylistID)
				theirs := false
				if err == nil {
					theirs, err = s.store.Queries.IsCrewPlaylist(ctx, db.IsCrewPlaylistParams{ID: id, CrewID: c.CrewID})
					if err != nil {
						httpx.Fail(w, s.log, "playlist lookup failed", err, "The channel could not be saved.")
						return db.UpdateChannelParams{}, false
					}
				}
				if !theirs {
					return refuse("Autoplay plays one of this crew's playlists.", "autoplay.playlistId")
				}
				next.AutoplayPlaylistID = id
			}
		}
	}
	return next, true
}

// save writes a merged patch, and a move when there is one, as one change: a
// rename that lands without the reorder it came with is a list nobody asked
// for.
func (s *Service) save(ctx context.Context, c db.Channel, next db.UpdateChannelParams, position *int32) (db.Channel, error) {
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return db.Channel{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.store.Queries.WithTx(tx)
	if position != nil {
		if err := reorder(ctx, q, c, *position); err != nil {
			return db.Channel{}, err
		}
	}
	updated, err := q.UpdateChannel(ctx, next)
	if err != nil {
		return db.Channel{}, err
	}
	return updated, tx.Commit(ctx)
}

// reorder moves a channel to position `to` within its crew's list of its
// kind — clamped to the end — and renumbers the list from 0, so positions
// stay a gapless sequence whatever order the moves arrive in.
func reorder(ctx context.Context, q *db.Queries, c db.Channel, to int32) error {
	ids, err := q.ListChannelIDsOfKind(ctx, db.ListChannelIDsOfKindParams{CrewID: c.CrewID, Kind: c.Kind})
	if err != nil {
		return err
	}
	ids = slices.DeleteFunc(ids, func(id pgtype.UUID) bool { return id == c.ID })
	ids = slices.Insert(ids, min(int(to), len(ids)), c.ID)
	for i, id := range ids {
		if err := q.SetChannelPosition(ctx, db.SetChannelPositionParams{ID: id, Position: int32(i)}); err != nil { //nolint:gosec // bounded by MaxCrewTextChannels
			return err
		}
	}
	return nil
}

// membersOf is one channel's named members, for a response about it.
func (s *Service) membersOf(w http.ResponseWriter, ctx context.Context, c db.Channel) ([]memberJSON, bool) {
	out := []memberJSON{}
	if !c.Private {
		return out, true
	}
	rows, err := s.store.Queries.ListChannelMembers(ctx, c.CrewID)
	if err != nil {
		httpx.Fail(w, s.log, "list channel members failed", err, "The channel could not be loaded.")
		return nil, false
	}
	for _, m := range rows {
		if m.ChannelID == c.ID {
			out = append(out, memberJSON{ID: store.UUIDString(m.ID), DisplayName: m.DisplayName, AvatarURL: m.AvatarUrl})
		}
	}
	return out, true
}

// handleDelete takes the channel and everything in it — chat, play log,
// recaps. The client asks first (errors.md: destructive, no undo).
func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	channel, _, role, ok := s.channelFor(w, r)
	if !ok || !requireAdmin(w, role) {
		return
	}
	if err := s.store.Queries.DeleteChannel(r.Context(), channel.ID); err != nil {
		httpx.Fail(w, s.log, "delete channel failed", err, "The channel could not be deleted.", "channel", store.UUIDString(channel.ID))
		return
	}
	if channel.Kind == kindVoice && s.live != nil {
		s.live.CloseRoom(store.UUIDString(channel.ID))
	}
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}
