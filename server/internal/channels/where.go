package channels

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Place is where a rider stands, as far as a viewer may be told (#2516): a
// voice channel and the crew it belongs to. The friends panel and a rider's
// page carry it, and it is the address the web links to.
type Place struct {
	CrewID      string `json:"crewId"`
	CrewName    string `json:"crewName"`
	ChannelID   string `json:"channelId"`
	ChannelName string `json:"channelName"`
}

// PlacesFor names, for one viewer, where the riders in `where` are — the
// hub's WhereIs answer, user → voice channel id, "" for online in none. A
// rider comes back only when the viewer may enter their channel
// (`visible_channels`, the rule every door into a channel asks); one they may
// not is absent, never shown shut, because a channel's name and its crew are
// part of what its gate keeps. One query, however many riders are asked about
// (#687).
func PlacesFor(ctx context.Context, q *db.Queries, viewer pgtype.UUID, where map[string]string) (map[string]Place, error) {
	ids := make([]pgtype.UUID, 0, len(where))
	for _, channel := range where {
		if id, err := store.ParseUUID(channel); err == nil {
			ids = append(ids, id)
		}
	}
	places := make(map[string]Place, len(ids))
	if len(ids) == 0 {
		return places, nil
	}
	rows, err := q.VoiceChannelsVisibleTo(ctx, db.VoiceChannelsVisibleToParams{Viewer: viewer, ChannelIds: ids})
	if err != nil {
		return nil, fmt.Errorf("channels: places: %w", err)
	}
	byChannel := make(map[string]Place, len(rows))
	for _, row := range rows {
		channel := store.UUIDString(row.ChannelID)
		byChannel[channel] = Place{
			CrewID: store.UUIDString(row.CrewID), CrewName: row.CrewName,
			ChannelID: channel, ChannelName: row.ChannelName,
		}
	}
	for user, channel := range where {
		if place, ok := byChannel[channel]; ok {
			places[user] = place
		}
	}
	return places, nil
}
