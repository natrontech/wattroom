package channels

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

const (
	kindText  = "text"
	kindVoice = "voice"
)

// mayEnter is THE gate (ADR-0058, docs/SPEC.md "Roles & permissions"): a
// member of the crew who is not banned walks into an open channel; a private
// one admits the crew's owner, its admins and the members named into it.
// crewRole is what CrewRoleOf answers — "" for somebody the crew has never
// heard of. Every door into a channel asks this and nothing re-derives it.
func mayEnter(crewRole string, private, named bool) bool {
	switch crewRole {
	case "owner", "admin":
		return true
	case "member":
		return !private || named
	default: // "", "banned"
		return false
	}
}

// administers: the crew's owner and admins keep its channels (docs/SPEC.md).
func administers(crewRole string) bool { return crewRole == "owner" || crewRole == "admin" }

const notFound = "No channel lives here."

// crewFor resolves /api/crews/{id} for a signed-in member. A crew the caller
// is not in — or is banned from — is a 404, never a 403: saying "you may not"
// about a crew they cannot see would confirm it exists (ADR-0056's rule).
func (s *Service) crewFor(w http.ResponseWriter, r *http.Request) (pgtype.UUID, db.User, string, bool) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return pgtype.UUID{}, db.User{}, "", false
	}
	crewID, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No crew lives here.")
		return pgtype.UUID{}, db.User{}, "", false
	}
	role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: crewID, UserID: user.ID})
	if err != nil {
		httpx.Fail(w, s.log, "crew role lookup failed", err, "The crew could not be loaded.")
		return pgtype.UUID{}, db.User{}, "", false
	}
	if role == "" || role == "banned" {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No crew lives here.")
		return pgtype.UUID{}, db.User{}, "", false
	}
	return crewID, user, role, true
}

// channelFor resolves /api/channels/{id} for somebody who may enter it. A
// channel the caller may not enter is a 404 like one that does not exist: a
// private channel's existence is part of what its gate keeps.
func (s *Service) channelFor(w http.ResponseWriter, r *http.Request) (db.Channel, db.User, string, bool) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return db.Channel{}, db.User{}, "", false
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", notFound)
		return db.Channel{}, db.User{}, "", false
	}
	channel, err := s.store.Queries.GetChannel(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", notFound)
		return db.Channel{}, db.User{}, "", false
	}
	if err != nil {
		httpx.Fail(w, s.log, "channel lookup failed", err, "The channel could not be loaded.")
		return db.Channel{}, db.User{}, "", false
	}
	role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: channel.CrewID, UserID: user.ID})
	if err != nil {
		httpx.Fail(w, s.log, "crew role lookup failed", err, "The channel could not be loaded.")
		return db.Channel{}, db.User{}, "", false
	}
	named := false
	if channel.Private && role == "member" {
		if named, err = s.store.Queries.IsNamedInChannel(r.Context(), db.IsNamedInChannelParams{
			ChannelID: channel.ID, UserID: user.ID,
		}); err != nil {
			httpx.Fail(w, s.log, "channel membership lookup failed", err, "The channel could not be loaded.")
			return db.Channel{}, db.User{}, "", false
		}
	}
	if !mayEnter(role, channel.Private, named) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", notFound)
		return db.Channel{}, db.User{}, "", false
	}
	return channel, user, role, true
}

// requireAdmin refuses a member who may see the channel but not keep it.
func requireAdmin(w http.ResponseWriter, role string) bool {
	if administers(role) {
		return true
	}
	httpx.WriteError(w, http.StatusForbidden, "forbidden", "Only the crew's owner and admins manage its channels.")
	return false
}

// RequireText is the one gate chat stands behind (#2435): channelFor, plus
// the channel being a text one — a voice channel has no text of its own
// (ADR-0058, decision 4), so its chat is a 404 like a channel that is not
// there. The role comes back for the moderation a crew admin holds.
func (s *Service) RequireText(w http.ResponseWriter, r *http.Request) (db.Channel, db.User, string, bool) {
	channel, user, role, ok := s.channelFor(w, r)
	if !ok {
		return db.Channel{}, db.User{}, "", false
	}
	if channel.Kind != kindText {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "A voice channel keeps no chat — its crew's chat channels do.")
		return db.Channel{}, db.User{}, "", false
	}
	return channel, user, role, true
}

// Administers reports whether a crew role keeps the crew's channels — and so
// moderates their chat and marks their announcements (ADR-0058).
func Administers(crewRole string) bool { return administers(crewRole) }

// RequireCrew is crewFor for another package's crew-scoped read (#2435): a
// signed-in, unbanned member, or a 404.
func (s *Service) RequireCrew(w http.ResponseWriter, r *http.Request) (pgtype.UUID, db.User, string, bool) {
	return s.crewFor(w, r)
}

// RequireVoice is RequireText's twin for a voice channel's deck (#2439): the
// channel's gate, plus the channel being a voice one — a text channel has no
// jukebox — so a text channel's queue is a 404 like a channel that is not
// there.
func (s *Service) RequireVoice(w http.ResponseWriter, r *http.Request) (db.Channel, db.User, string, bool) {
	channel, user, role, ok := s.channelFor(w, r)
	if !ok {
		return db.Channel{}, db.User{}, "", false
	}
	if channel.Kind != kindVoice {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "A chat channel has no jukebox — its crew's voice channels do.")
		return db.Channel{}, db.User{}, "", false
	}
	return channel, user, role, true
}
