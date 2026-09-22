// Package channels is a crew's text and voice channels (ADR-0058, #2434):
// list, create, rename, reorder, gate and delete them, and name members into
// a private one. Durable data only. What is live in a voice channel — who is
// in the call, the session running there — is the hub's (#2436, #2438).
package channels

import (
	"log/slog"
	"net/http"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// UserSource is what channels needs from auth — defined here, where it is
// consumed, and satisfied by *auth.Service.
type UserSource interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// Pinger is the lobby ping (#570): a channel changes because somebody else
// changed it, and the ping is how every other client hears and re-fetches.
// Satisfied by the hub. Optional: without it nobody hears until they reload.
type Pinger interface {
	PresenceChanged()
}

type Service struct {
	store *store.Store
	users UserSource
	log   *slog.Logger
	lobby Pinger
}

func New(st *store.Store, users UserSource, log *slog.Logger) *Service {
	return &Service{store: st, users: users, log: log}
}

// SetPinger wires the hub in after construction.
func (s *Service) SetPinger(p Pinger) { s.lobby = p }

// changed pings every lobby socket; the ping carries no data.
// ponytail: one ping for every crew, not just this crew's members — the lobby
// has no per-crew routing yet (#2444), and a channel edit is a rare event.
func (s *Service) changed() {
	if s.lobby != nil {
		s.lobby.PresenceChanged()
	}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/crews/{id}/channels", s.handleList)
	mux.HandleFunc("POST /api/crews/{id}/channels", s.handleCreate)
	mux.HandleFunc("PATCH /api/channels/{id}", s.handleUpdate)
	mux.HandleFunc("DELETE /api/channels/{id}", s.handleDelete)
	mux.HandleFunc("PUT /api/channels/{id}/members/{userID}", s.handleNameMember)
	mux.HandleFunc("DELETE /api/channels/{id}/members/{userID}", s.handleUnnameMember)
}

type memberJSON struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl,omitempty"`
}

type autoplayJSON struct {
	Enabled bool   `json:"enabled"`
	Order   string `json:"order"`
	// A playlist of the crew's; absent when none is chosen.
	PlaylistID string `json:"playlistId,omitempty"`
}

type channelJSON struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	Position int32  `json:"position"`
	Private  bool   `json:"private"`
	// A voice channel's; a text channel has no deck and makes no sound.
	SoundPack string        `json:"soundPack,omitempty"`
	Autoplay  *autoplayJSON `json:"autoplay,omitempty"`
	// A private channel's named members. The crew's owner and admins enter
	// by role and are not listed.
	Members []memberJSON `json:"members,omitempty"`
}

func toJSON(c db.Channel, members []memberJSON) channelJSON {
	out := channelJSON{
		ID: store.UUIDString(c.ID), Kind: c.Kind, Name: c.Name,
		Position: c.Position, Private: c.Private,
	}
	if c.Kind == kindVoice {
		out.SoundPack = c.SoundPack
		out.Autoplay = &autoplayJSON{Enabled: c.AutoplayEnabled, Order: c.AutoplayOrder}
		if c.AutoplayPlaylistID.Valid {
			out.Autoplay.PlaylistID = store.UUIDString(c.AutoplayPlaylistID)
		}
	}
	if c.Private {
		out.Members = members
	}
	return out
}

// handleList: the crew's channels the caller may enter, text first. A private
// channel that does not name them is left out entirely rather than shown
// shut: a channel's existence is part of what its gate keeps (#2444 draws the
// same line for presence).
func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	crewID, user, role, ok := s.crewFor(w, r)
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListCrewChannels(r.Context(), crewID)
	if err != nil {
		httpx.Fail(w, s.log, "list channels failed", err, "The channels could not be loaded.", "crew", store.UUIDString(crewID))
		return
	}
	named, err := s.store.Queries.NamedChannelsFor(r.Context(), db.NamedChannelsForParams{CrewID: crewID, UserID: user.ID})
	if err != nil {
		httpx.Fail(w, s.log, "list named channels failed", err, "The channels could not be loaded.", "crew", store.UUIDString(crewID))
		return
	}
	isNamed := map[string]bool{}
	for _, id := range named {
		isNamed[store.UUIDString(id)] = true
	}
	memberRows, err := s.store.Queries.ListChannelMembers(r.Context(), crewID)
	if err != nil {
		httpx.Fail(w, s.log, "list channel members failed", err, "The channels could not be loaded.", "crew", store.UUIDString(crewID))
		return
	}
	members := map[string][]memberJSON{}
	for _, m := range memberRows {
		id := store.UUIDString(m.ChannelID)
		members[id] = append(members[id], memberJSON{
			ID: store.UUIDString(m.ID), DisplayName: m.DisplayName, AvatarURL: m.AvatarUrl,
		})
	}
	out := []channelJSON{}
	for _, c := range rows {
		id := store.UUIDString(c.ID)
		if mayEnter(role, c.Private, isNamed[id]) {
			out = append(out, toJSON(c, members[id]))
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"channels": out})
}
