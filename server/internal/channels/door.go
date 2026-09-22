package channels

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/av"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
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
	role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: ch.CrewID, UserID: user.ID})
	if err != nil {
		return protocol.Rider{}, "", fmt.Errorf("channels: authorize crew role: %w", err)
	}
	named := false
	if ch.Private && role == "member" {
		if named, err = s.store.Queries.IsNamedInChannel(r.Context(), db.IsNamedInChannelParams{
			ChannelID: ch.ID, UserID: user.ID,
		}); err != nil {
			return protocol.Rider{}, "", fmt.Errorf("channels: authorize named: %w", err)
		}
	}
	if !mayEnter(role, ch.Private, named) {
		return protocol.Rider{}, "", av.ErrNotMember
	}
	// The level rides with the rest of the channel-visible identity (#690);
	// unreadable XP joins at zero rather than not at all.
	xp, err := s.store.Queries.UserTotalXp(r.Context(), user.ID)
	if err != nil {
		s.log.Warn("total xp unavailable for roster", "err", err, "channel", id)
		xp = 0
	}
	return protocol.Rider{
		ID:       store.UUIDString(user.ID),
		Name:     user.DisplayName,
		Role:     LiveRole(role),
		FtpWatts: int(user.FtpWatts),
		WeightKg: int(user.WeightKg),
		TotalXp:  xp,
	}, store.UUIDString(ch.ID), nil
}

// LiveRole is the crew role as a voice channel carries it — the door's
// answer, and what a crew role change re-roles open sockets to. The crew's
// own words (#2438); anything else, a ban included, is a member here, since
// a banned rider never reaches the door.
func LiveRole(crewRole string) string {
	switch crewRole {
	case "owner", "admin":
		return crewRole
	default:
		return "member"
	}
}
