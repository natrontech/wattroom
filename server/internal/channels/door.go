package channels

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/av"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
)

// Authorize is the live door into a voice channel (#2436) — the hub's socket
// and the LiveKit token both ask it, and it answers with mayEnter like every
// other door. A text channel is not a place anyone stands in, so it refuses
// one as it refuses a channel that is not there: av.ErrNotMember, which both
// consumers already read as "not yours".
//
// The rider's Role is the crew's (#2438): coach is not a role but whoever is
// running the channel's session, so the hub reads the role only to let the
// crew's owner and admins end one.
func (s *Service) Authorize(r *http.Request, id string) (protocol.Rider, string, error) {
	user, ok := s.users.User(r)
	if !ok {
		return protocol.Rider{}, "", av.ErrNoSession
	}
	channelID, err := store.ParseUUID(id)
	if err != nil {
		return protocol.Rider{}, "", av.ErrNotMember
	}
	ch, err := s.store.Queries.GetChannel(r.Context(), channelID)
	if errors.Is(err, pgx.ErrNoRows) {
		return protocol.Rider{}, "", av.ErrNotMember
	}
	if err != nil {
		return protocol.Rider{}, "", fmt.Errorf("channels: authorize channel: %w", err)
	}
	if ch.Kind != kindVoice {
		return protocol.Rider{}, "", av.ErrNotMember
	}
	role, admitted, err := s.standing(r.Context(), ch, user.ID)
	if err != nil {
		return protocol.Rider{}, "", fmt.Errorf("channels: authorize: %w", err)
	}
	if !admitted {
		return protocol.Rider{}, "", av.ErrNotMember
	}
	// The level rides with the rest of the channel-visible identity (#690);
	// unreadable XP joins at zero rather than not at all.
	xp, err := s.store.Queries.UserTotalXp(r.Context(), user.ID)
	if err != nil {
		s.log.Warn("total xp unavailable for roster", "err", err, "channel", id)
		xp = 0
	}
	// The look rides with the identity too (#3155), read from the store and
	// never through the wardrobe: cosmetics stay out of what moves anyone.
	// None read joins in the starter kit.
	look, err := s.store.Queries.UserLookHash(r.Context(), user.ID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.log.Warn("look unavailable for roster", "err", err, "channel", id)
	}
	// What a race's flag reads for the race FTP and the Category (#3658),
	// held by the hub and never sent. Unreadable, the race falls back to the
	// profile FTP — a bracket read low, never a rider refused a room.
	best20m, err := s.store.Queries.Best20mIn90Days(r.Context(), user.ID)
	if err != nil {
		s.log.Warn("best 20 min unavailable for roster", "err", err, "channel", id)
		best20m = 0
	}
	rider := store.RiderOf(user)
	rider.Role, rider.TotalXp, rider.Best20mWatts = liveRole(role), xp, int(best20m)
	if look != nil {
		rider.Look = *look
	}
	return rider, store.UUIDString(ch.ID), nil
}

// liveRole is the crew role as a voice channel carries it: the door's answer,
// and what the gate asked again re-roles an open socket to (#2808). The
// crew's own words (#2438); anything else, a ban included, is a member here,
// since a banned rider never reaches the door.
func liveRole(crewRole string) string {
	switch crewRole {
	case "owner", "admin":
		return crewRole
	default:
		return "member"
	}
}
