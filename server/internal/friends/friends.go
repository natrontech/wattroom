// Package friends is ADR-0012 made small: mutual friendship formed only
// by exchanging friend codes, presence that never pierces a channel's gate.
// The server stores who is friends with whom; "where they are" is answered
// live from the hub and persisted nowhere.
package friends

import (
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/natrontech/wattroom/server/internal/budget"
	"github.com/natrontech/wattroom/server/internal/channels"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// UserSource resolves the signed-in user — same shape rooms consumes.
type UserSource interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// PresenceSource answers "which voice channel is this user in right now" —
// defined here where it is consumed, implemented by the hub. PresenceChanged
// pings every lobby socket: a request, an acceptance or a removal reaches the
// other side now rather than on their next fallback poll (#876).
type PresenceSource interface {
	WhereIs(userIDs []string) map[string]string
	// Who is pedalling right now, of the ids asked about (ADR-0012's third
	// state). Standing in a voice channel is not riding in it, and WhereIs
	// cannot tell them apart.
	Riding(userIDs []string) map[string]bool
	PresenceChanged()
}

type Service struct {
	store    *store.Store
	users    UserSource
	presence PresenceSource
	log      *slog.Logger
	// How many asks one account may make an hour (#1652): the friend-code
	// door answered a guess with 404, 409 or a name, unmetered, and
	// ADR-0012 rests on the code being unguessable in practice.
	asks *budget.Budget[pgtype.UUID]
}

const (
	asksPerWindow = 20
	askWindow     = time.Hour
)

func New(st *store.Store, users UserSource, presence PresenceSource, log *slog.Logger) *Service {
	return &Service{store: st, users: users, presence: presence, log: log,
		asks: budget.New[pgtype.UUID](asksPerWindow, askWindow)}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/friends", s.handleList)
	mux.HandleFunc("POST /api/friends", s.handleRequest)
	mux.HandleFunc("POST /api/friends/{id}/accept", s.handleAccept)
	mux.HandleFunc("DELETE /api/friends/{id}", s.handleDelete)
	// The undo of a dismissal (#1652): their ask comes back as it was.
	mux.HandleFunc("POST /api/friends/{id}/restore", s.handleRestore)
}

type friendJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Avatar + lifetime XP (#253) — same facts the rooms roster shows.
	AvatarURL *string `json:"avatarUrl,omitempty"`
	TotalXp   int64   `json:"totalXp"`
	// accepted | pending_in (they asked me) | pending_out (I asked them)
	Status string `json:"status"`
	// When the row was created, unix ms — the client announces a request or an
	// acceptance once per row, in one tab, off this (#876).
	At int64 `json:"at"`
	// Presence — accepted friends only (ADR-0012). Online means "app open"
	// (the lobby socket, #251 — Slack's green dot), InVoice that they are in
	// some voice channel, and Channel — the channel and its crew — is there
	// ONLY when the viewer may enter that channel (ADR-0058), the same shape
	// a rider's page carries.
	//
	// Riding is the third state the ADR's 2026-09-09 amendment names and the
	// panel used to be blind to (#1743): pedalling inside the hub's window,
	// not merely standing in a voice channel. It says nothing about WHAT they
	// are pushing — watts never leave the session — and it is named without
	// naming the channel, which is what makes "riding elsewhere" sayable for
	// a channel the viewer may not enter.
	Online  bool            `json:"online,omitempty"`
	InVoice bool            `json:"inVoice,omitempty"`
	Riding  bool            `json:"riding,omitempty"`
	Channel *channels.Place `json:"channel,omitempty"`
}

// declineJSON is an ask that was dismissed, on its way to the one rider it
// concerns. No status, no row in the panel — it is a sentence, said once.
type declineJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	At   int64  `json:"at"`
}

// handleList is the whole panel in one GET: friends with presence, plus my
// own friend code — the thing I hand out so people can ask me.
func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListFriendships(r.Context(), me.ID)
	if err != nil {
		httpx.Fail(w, s.log, "list friendships", err, "Your friends could not be loaded.", "user", store.UUIDString(me.ID))
		return
	}

	accepted := make([]string, 0, len(rows))
	for _, row := range rows {
		if row.Status == "accepted" {
			accepted = append(accepted, store.UUIDString(row.ID))
		}
	}
	where := s.presence.WhereIs(accepted)
	riding := s.presence.Riding(accepted)

	// Hoisted out of the per-friend loop (#687): every channel an online
	// friend is in, resolved against what the viewer may enter in one query.
	places, err := channels.PlacesFor(r.Context(), s.store.Queries, me.ID, where)
	if err != nil {
		httpx.Fail(w, s.log, "friends' places", err, "Your friends could not be loaded.", "user", store.UUIDString(me.ID))
		return
	}

	friends := make([]friendJSON, 0, len(rows))
	for _, row := range rows {
		entry := friendJSON{
			ID: store.UUIDString(row.ID), Name: row.DisplayName,
			AvatarURL: row.AvatarUrl,
			TotalXp:   row.TotalXp, At: row.CreatedAt.Time.UnixMilli(),
		}
		switch {
		case row.Status == "accepted":
			entry.Status = "accepted"
			// Present in the map = online (lobby socket); a value is the voice
			// channel they are in.
			channel, online := where[entry.ID]
			entry.Online = online
			entry.InVoice = channel != ""
			// Gated on being in a channel, not merely on the riding map: the
			// two answers are taken back to back, so a friend who left between
			// them reads as gone rather than as pedalling nowhere.
			entry.Riding = channel != "" && riding[entry.ID]
			// Named only for a viewer who may enter it — the gate holds.
			if place, ok := places[entry.ID]; ok {
				entry.Channel = &place
			}
		case row.RequesterID == me.ID:
			entry.Status = "pending_out"
		default:
			entry.Status = "pending_in"
		}
		friends = append(friends, entry)
	}

	// What became of the asks that are no longer here (#876). Mine alone —
	// the rider who dismissed one never sees that they did.
	declineRows, err := s.store.Queries.ListFriendDeclines(r.Context(), me.ID)
	if err != nil {
		httpx.Fail(w, s.log, "list friend declines", err, "Your friends could not be loaded.", "user", store.UUIDString(me.ID))
		return
	}
	declines := make([]declineJSON, 0, len(declineRows))
	for _, row := range declineRows {
		declines = append(declines, declineJSON{
			ID: store.UUIDString(row.ID), Name: row.DisplayName,
			At: row.DeclinedAt.Time.UnixMilli(),
		})
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"friends": friends, "code": me.FriendCode, "declines": declines,
	})
}

func (s *Service) handleRequest(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	if s.asks != nil && !s.asks.Spend(me.ID) {
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
			"That is a lot of friend requests in one hour. Wait an hour, then try again.")
		return
	}
	var body struct {
		Code string `json:"code"`
		// A rider's page (ADR-0024) asks by id — allowed only across a
		// shared room, so the code itself never has to travel.
		UserID string `json:"userId"`
	}
	if err := httpx.DecodeStrict(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "Send a JSON body with a friend code or a rider id.")
		return
	}
	var target pgtype.UUID
	if body.UserID != "" {
		id, err := store.ParseUUID(body.UserID)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a rider id.")
			return
		}
		if id == me.ID {
			httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That would be you.")
			return
		}
		// A shared channel is the formation gate here (ADR-0012's original
		// rule, ADR-0058's boundary): none in common, no request — and no
		// confirmation that the id exists.
		shared, err := s.store.Queries.SharesChannel(r.Context(), db.SharesChannelParams{Rider: id, Viewer: me.ID})
		if err != nil {
			httpx.Fail(w, s.log, "channels in common lookup", err, "The request could not be sent. Try again.", "user", store.UUIDString(me.ID))
			return
		}
		if !shared {
			httpx.WriteError(w, http.StatusNotFound, "not_found", "No rider there that you share a room with — ask them for their code instead.")
			return
		}
		target = id
	} else {
		// The formation gate (ADR-0012 amendment): knowing someone's code IS
		// the permission to ask them.
		code := strings.ToUpper(strings.TrimSpace(body.Code))
		if code == "" {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "Enter a friend code.", "code")
			return
		}
		user, err := s.store.Queries.GetUserByFriendCode(r.Context(), code)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			httpx.Fail(w, s.log, "friend code lookup", err, "The request could not be sent. Try again.", "user", store.UUIDString(me.ID))
			return
		}
		if err != nil {
			// Friend codes are eight characters; a crew's invite code is six
			// (rooms/crews.go). The one people paste into the wrong box is
			// the crew's, and "double-check it with them" sends them back to
			// a friend who gave them the right code for a different door.
			if len(code) == protocol.CrewCodeLen {
				httpx.WriteFieldError(w, http.StatusNotFound, "not_found", "That looks like a crew's code — a crew is joined from Home. Friend codes are eight characters.", "code")
				return
			}
			httpx.WriteFieldError(w, http.StatusNotFound, "not_found", "No rider has that code — double-check it with them.", "code")
			return
		}
		if user.ID == me.ID {
			httpx.WriteFieldError(w, http.StatusBadRequest, "invalid_request", "That is your own code.", "code")
			return
		}
		target = user.ID
	}
	err := s.store.Queries.CreateFriendRequest(r.Context(), db.CreateFriendRequestParams{
		RequesterID: me.ID, AddresseeID: target,
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		httpx.WriteError(w, http.StatusConflict, "conflict", "There is already a request or friendship with them.")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "create friend request", err, "The request could not be sent.", "user", store.UUIDString(me.ID))
		return
	}
	s.clearDeclines(r, me.ID, target)
	s.presence.PresenceChanged()
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) handleAccept(w http.ResponseWriter, r *http.Request) {
	me, target, ok := s.pair(w, r)
	if !ok {
		return
	}
	// Only the addressee accepts — target is the requester here.
	n, err := s.store.Queries.AcceptFriendRequest(r.Context(), db.AcceptFriendRequestParams{
		RequesterID: target, AddresseeID: me.ID,
	})
	if err != nil {
		httpx.Fail(w, s.log, "accept friend request", err, "The request could not be accepted.", "user", store.UUIDString(me.ID))
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No pending request from them.")
		return
	}
	s.clearDeclines(r, me.ID, target)
	s.presence.PresenceChanged()
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleRestore undoes a dismissal (#1652): the pending ask from them is put
// back as it was and the tombstone that told them goes. Only the addressee
// can, which is the person who dismissed it.
//
// And only where there WAS one (#2225): the insert used to run unconditionally
// and `status` defaults to 'pending', so it did not restore a request, it made
// one — from anybody, to the caller. Accepting it needs nothing else, so two
// calls befriended a rider who was never asked, without the code ADR-0012
// makes the permission to ask. The tombstone is the record that this rider
// dismissed that ask, so it is what the undo is allowed to read.
func (s *Service) handleRestore(w http.ResponseWriter, r *http.Request) {
	me, target, ok := s.pair(w, r)
	if !ok {
		return
	}
	n, err := s.store.Queries.RestoreFriendRequest(r.Context(), db.RestoreFriendRequestParams{
		RequesterID: target, AddresseeID: me.ID,
	})
	if err != nil {
		httpx.Fail(w, s.log, "restore friend request", err, "That could not be undone.", "user", store.UUIDString(me.ID))
		return
	}
	if n == 0 {
		// Nothing was written: either there is no dismissal to undo, or the
		// pair is connected again already — a second press of one undo toast,
		// which has nothing left to do and is not an error.
		_, err := s.store.Queries.GetFriendship(r.Context(), db.GetFriendshipParams{
			RequesterID: me.ID, AddresseeID: target,
		})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			httpx.WriteError(w, http.StatusNotFound, "not_found", "No dismissed request from them.")
			return
		case err != nil:
			httpx.Fail(w, s.log, "restore friend request", err, "That could not be undone.", "user", store.UUIDString(me.ID))
			return
		}
	}
	s.clearDeclines(r, me.ID, target)
	s.presence.PresenceChanged()
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	me, target, ok := s.pair(w, r)
	if !ok {
		return
	}
	// Which of the three this is decides whether anyone hears about it
	// (ADR-0012 amendment, #876): dismissing THEIR pending ask leaves a
	// tombstone so they learn the answer. Cancelling my own ask and
	// unfriending stay silent, as they always were. Read before the delete —
	// afterwards there is nothing left to tell them apart.
	row, err := s.store.Queries.GetFriendship(r.Context(), db.GetFriendshipParams{
		RequesterID: me.ID, AddresseeID: target,
	})
	dismissal := err == nil && row.Status == "pending" && row.AddresseeID == me.ID

	n, err := s.store.Queries.DeleteFriendship(r.Context(), db.DeleteFriendshipParams{
		RequesterID: me.ID, AddresseeID: target,
	})
	if err != nil {
		httpx.Fail(w, s.log, "delete friendship", err, "That could not be removed.", "user", store.UUIDString(me.ID))
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "You are not connected to them.")
		return
	}
	if dismissal {
		if err := s.store.Queries.NoteFriendDecline(r.Context(), db.NoteFriendDeclineParams{
			RequesterID: target, AddresseeID: me.ID,
		}); err != nil {
			// The dismissal itself stood; only the telling failed.
			s.log.Error("note friend decline", "err", err, "user", store.UUIDString(me.ID))
		}
	}
	s.presence.PresenceChanged()
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// clearDeclines wipes the pair's tombstone once they are talking again — an
// ask, or an acceptance, in either direction. An old dismissal must not
// resurface on a device that had never heard it.
func (s *Service) clearDeclines(r *http.Request, a, b pgtype.UUID) {
	if err := s.store.Queries.ClearFriendDeclines(r.Context(), db.ClearFriendDeclinesParams{
		RequesterID: a, AddresseeID: b,
	}); err != nil {
		s.log.Error("clear friend declines", "err", err, "user", store.UUIDString(a))
	}
}

// pair does the boundary work every mutating handler shares: auth, a valid
// target id, and target-is-not-me.
func (s *Service) pair(w http.ResponseWriter, r *http.Request) (db.User, pgtype.UUID, bool) {
	me, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return db.User{}, pgtype.UUID{}, false
	}
	target, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a user id.")
		return db.User{}, pgtype.UUID{}, false
	}
	if target == me.ID {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That would be you.")
		return db.User{}, pgtype.UUID{}, false
	}
	return me, target, true
}
