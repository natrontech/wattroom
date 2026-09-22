package rooms

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
)

// LiveWhere is the hub's presence half: who is online, in which voice
// channel, and who is pedalling.
type LiveWhere interface {
	WhereIs(userIDs []string) map[string]string
	Riding(userIDs []string) map[string]bool
	PresenceChanged()
}

// RoomWhere answers WhereIs in room slugs for the readers that still link to
// a room — the friends panel and the rider page, whose visibility checks are
// made of rooms in common (#2436). The hub names a voice channel; a channel
// no room became reads as online-but-in-no-room, the narrow side of what
// those readers may show. Goes when #2444 answers presence per crew.
type RoomWhere struct {
	Live  LiveWhere
	Store *store.Store
}

func (p RoomWhere) WhereIs(userIDs []string) map[string]string {
	where := p.Live.WhereIs(userIDs)
	ids := make([]pgtype.UUID, 0, len(where))
	for _, channel := range where {
		if id, err := store.ParseUUID(channel); err == nil {
			ids = append(ids, id)
		}
	}
	slugs := make(map[string]string, len(ids))
	if len(ids) > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		rows, err := p.Store.Queries.RoomSlugsOfVoiceChannels(ctx, ids)
		if err == nil {
			for _, row := range rows {
				slugs[store.UUIDString(row.VoiceChannelID)] = row.Slug
			}
		}
	}
	for user, channel := range where {
		where[user] = slugs[channel]
	}
	return where
}

func (p RoomWhere) Riding(userIDs []string) map[string]bool { return p.Live.Riding(userIDs) }

func (p RoomWhere) PresenceChanged() { p.Live.PresenceChanged() }

// ByRoomSlug keeps a room link's live doors open while the web still speaks
// rooms (#2436): `/ws/rooms/{slug}` and `/api/rooms/{slug}/av-token` resolve
// the room's voice channel and hand over to the channel's own door, which
// decides who enters. A slug that names nothing hands over an empty id, and
// that door refuses it the way it refuses any channel that is not there.
//
// It still reads a ROOM ban, which the channel's door cannot: the rooms API
// writes them until #2446, and a rider banned from a room after the backfill
// turned the old ones into crew bans must not walk back in through its
// channel (ADR-0058: nobody reaches what they could not before). Goes with
// the room pages (#2449, #2446).
func (s *Service) ByRoomSlug(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		channel := ""
		if room, err := s.store.Queries.GetRoomBySlug(r.Context(), strings.ToLower(r.PathValue("slug"))); err == nil {
			user, signedIn := s.users.User(r)
			if !signedIn || !s.isBanned(r, room, user) {
				channel = s.store.VoiceChannelOf(r.Context(), room.ID)
			}
		}
		r.SetPathValue("id", channel)
		next(w, r)
	}
}
