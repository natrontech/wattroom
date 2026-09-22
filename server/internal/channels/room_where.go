package channels

import (
	"context"
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
// a room — the friends panel and the rider page (#2436). The hub names a
// voice channel; a channel no room became reads as online-but-in-no-room, the
// narrow side of what those readers may show. Their `/r/{slug}` links land on
// the channel through #2458's redirect; the adapter goes when those readers
// name channels, and with room_channels (#2433) at the latest. Moved here
// from the rooms package it outlived (#2446).
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
