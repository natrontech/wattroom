// Package emoji is a crew's own emoji (#2643): small pictures any member
// uploads, used as a reaction (key `:name:`) and inline in a line as
// `:name:`. Crew-private — only members read one — and the crew's: the
// uploader, the crew's owner and its admins take one down.
//
// The server keeps the pictures and their names. Which reactions a crew
// speaks stays a shape check (protocol.IsReaction), so a `:name:` whose
// picture is gone still reads as its name rather than failing anything.
package emoji

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/budget"
	"github.com/natrontech/wattroom/server/internal/channels"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Crews is the gate every route stands behind: a signed-in, unbanned member
// of the crew in the path, or a 404. Satisfied by *channels.Service.
type Crews interface {
	RequireCrew(w http.ResponseWriter, r *http.Request) (pgtype.UUID, db.User, string, bool)
}

// Lobby is how the crew's other clients hear the set changed (#570), so a
// picker open elsewhere re-fetches. Satisfied by the hub. Optional: without
// it they see a new emoji on their next load.
type Lobby interface {
	PresenceChanged()
}

// uploadsPerHour is chat's picture ceiling (#1982): the crew's cap bounds
// what is kept, and this bounds the churn of adding and deleting under it.
const uploadsPerHour = 60

const noSuchEmoji = "That emoji is not in this crew."

type Service struct {
	store   *store.Store
	crews   Crews
	lobby   Lobby
	log     *slog.Logger
	uploads *budget.Budget[pgtype.UUID]
}

func New(st *store.Store, crews Crews, lobby Lobby, log *slog.Logger) *Service {
	return &Service{
		store: st, crews: crews, lobby: lobby, log: log,
		uploads: budget.New[pgtype.UUID](uploadsPerHour, time.Hour),
	}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/crews/{id}/emoji", s.handleList)
	mux.HandleFunc("POST /api/crews/{id}/emoji", s.handleUpload)
	mux.HandleFunc("GET /api/crews/{id}/emoji/{emojiID}", s.handleImage)
	mux.HandleFunc("DELETE /api/crews/{id}/emoji/{emojiID}", s.handleDelete)
}

type emojiJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Who added it, so the client can offer Delete on the rider's own.
	UserID    string `json:"userId"`
	CreatedAt string `json:"createdAt"`
}

func emojiOf(id pgtype.UUID, name string, userID pgtype.UUID, createdAt pgtype.Timestamptz) emojiJSON {
	return emojiJSON{
		ID: store.UUIDString(id), Name: name, UserID: store.UUIDString(userID),
		CreatedAt: createdAt.Time.Format(time.RFC3339),
	}
}

func (s *Service) changed() {
	if s.lobby != nil {
		s.lobby.PresenceChanged()
	}
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	crew, _, _, ok := s.crews.RequireCrew(w, r)
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListCrewEmoji(r.Context(), crew)
	if err != nil {
		httpx.Fail(w, s.log, "emoji list failed", err, "The crew's emoji could not be loaded.", "crew", store.UUIDString(crew))
		return
	}
	// An array, never null: a crew with none is an empty set, not a failure.
	out := make([]emojiJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, emojiOf(row.ID, row.Name, row.UserID, row.CreatedAt))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"emoji": out})
}

// handleUpload takes the picture as the raw body and its name in the query —
// the soundboard's `?name=` convention, so one request carries both.
func (s *Service) handleUpload(w http.ResponseWriter, r *http.Request) {
	crew, me, _, ok := s.crews.RequireCrew(w, r)
	if !ok {
		return
	}
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if !protocol.IsCustomEmojiName(name) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			fmt.Sprintf("An emoji's name is %d–%d characters of a–z, 0–9 and _.",
				protocol.MinEmojiNameChars, protocol.MaxEmojiNameChars), "name")
		return
	}
	if !s.uploads.Spend(me.ID) {
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
			"That is a lot of emoji in one hour — a moment, then add it again.")
		return
	}
	data, mime, ok := httpx.ReadImageUploadUpTo(w, r, protocol.MaxEmojiBytes,
		fmt.Sprintf("An emoji is capped at %d KB — a small square picture is well under that.", protocol.MaxEmojiBytes>>10))
	if !ok {
		return
	}
	crewID := store.UUIDString(crew)
	// Counted with the crew's row locked, in the transaction that inserts
	// (#1413): two members adding the fiftieth at once would otherwise both
	// count forty-nine.
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		httpx.Fail(w, s.log, "emoji begin failed", err, "The emoji could not be saved. Try again.", "crew", crewID)
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	q := s.store.Queries.WithTx(tx)
	if err := q.LockCrew(r.Context(), crew); err != nil {
		httpx.Fail(w, s.log, "emoji lock failed", err, "The emoji could not be saved. Try again.", "crew", crewID)
		return
	}
	held, err := q.CountCrewEmoji(r.Context(), crew)
	if err != nil {
		httpx.Fail(w, s.log, "emoji count failed", err, "The emoji could not be saved. Try again.", "crew", crewID)
		return
	}
	if held >= protocol.MaxCrewEmoji {
		httpx.WriteCeiling(w, fmt.Sprintf(
			"This crew has %d emoji, the most it can hold. Delete one to add another.", protocol.MaxCrewEmoji))
		return
	}
	row, err := q.CreateCrewEmoji(r.Context(), db.CreateCrewEmojiParams{
		CrewID: crew, UserID: me.ID, Name: name, Mime: mime, Bytes: data,
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		httpx.WriteFieldError(w, http.StatusConflict, "conflict",
			fmt.Sprintf("There is already a :%s: in this crew — pick another name.", name), "name")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "emoji save failed", err, "The emoji could not be saved. Try again.", "crew", crewID)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Fail(w, s.log, "emoji commit failed", err, "The emoji could not be saved. Try again.", "crew", crewID)
		return
	}
	s.changed()
	httpx.WriteJSON(w, http.StatusCreated, emojiOf(row.ID, row.Name, row.UserID, row.CreatedAt))
}

// handleImage serves the picture. An id is never reused and a picture is
// never replaced under it — a new one is a new id — so the browser may keep
// it forever.
func (s *Service) handleImage(w http.ResponseWriter, r *http.Request) {
	crew, _, _, ok := s.crews.RequireCrew(w, r)
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("emojiID"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", noSuchEmoji)
		return
	}
	img, err := s.store.Queries.GetCrewEmojiImage(r.Context(), db.GetCrewEmojiImageParams{ID: id, CrewID: crew})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", noSuchEmoji)
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "emoji image failed", err, "The emoji could not be loaded.", "crew", store.UUIDString(crew))
		return
	}
	httpx.ServeImmutableImage(w, img.Mime, img.Bytes)
}

// handleDelete: the uploader always may; so may the crew's owner and admins,
// who keep the crew (ADR-0058) — a ban severs a griefer and their pictures
// would otherwise stay in everybody's picker.
func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	crew, me, role, ok := s.crews.RequireCrew(w, r)
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("emojiID"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", noSuchEmoji)
		return
	}
	crewID := store.UUIDString(crew)
	uploader, err := s.store.Queries.GetCrewEmojiUploader(r.Context(), db.GetCrewEmojiUploaderParams{ID: id, CrewID: crew})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", noSuchEmoji)
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "emoji lookup failed", err, "The emoji could not be deleted. Try again.", "crew", crewID)
		return
	}
	if uploader != me.ID && !channels.Administers(role) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "You can only delete emoji you added.")
		return
	}
	rows, err := s.store.Queries.DeleteCrewEmoji(r.Context(), db.DeleteCrewEmojiParams{ID: id, CrewID: crew})
	if err != nil {
		httpx.Fail(w, s.log, "emoji delete failed", err, "The emoji could not be deleted. Try again.", "crew", crewID)
		return
	}
	if rows == 0 {
		// Somebody else deleted it between the read and here.
		httpx.WriteError(w, http.StatusNotFound, "not_found", noSuchEmoji)
		return
	}
	// A fact, never the picture: ids only, the way chat logs an admin's delete.
	if uploader != me.ID {
		s.log.Info("crew emoji deleted by a crew admin",
			"crew", crewID, "emoji", store.UUIDString(id), "by", store.UUIDString(me.ID), "uploader", store.UUIDString(uploader))
	}
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}
