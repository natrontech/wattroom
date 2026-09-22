package playlists

import (
	"context"
	"math/rand/v2"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Autoplay implements hub.AutoplaySource (#627): read once per join-onto-an-
// idle-deck, entirely outside the hub's lock. The settings are the voice
// channel's own (ADR-0058, #2439), set on the channel by the crew's owner or
// an admin. One source, three orders (#1429): the active crew playlist,
// walked in list order, freshly shuffled once per trigger, or — "smart"
// (#269) — its library tracks drawn by this channel's history, weighted
// since #270 toward the cadence `mood` says the session is turning right
// now. Smart with no active playlist, or one holding no library track, draws
// from the whole libraries of the riders who may enter the channel instead.
func (s *Service) Autoplay(ctx context.Context, channel string, mood hub.SessionMood) (tracks []protocol.JukeboxCommand, ok bool) {
	channelID, err := store.ParseUUID(channel)
	if err != nil {
		return nil, false
	}
	ch, err := s.store.Queries.GetChannel(ctx, channelID)
	if err != nil || !ch.AutoplayEnabled {
		return nil, false
	}
	var rows []db.ListPlaylistTracksRow
	if ch.AutoplayPlaylistID.Valid {
		if rows, err = s.store.Queries.ListPlaylistTracks(ctx, ch.AutoplayPlaylistID); err != nil {
			s.log.Error("autoplay: list playlist tracks failed", "channel", channel, "err", err)
			return nil, false
		}
	}
	switch ch.AutoplayOrder {
	case "smart":
		var only []pgtype.UUID
		for _, row := range rows {
			if row.TrackID.Valid {
				only = append(only, row.TrackID)
			}
		}
		tracks = s.smartShuffle(ctx, ch.ID, mood, only)
	case "shuffled":
		tracks = commandsFromTracks(rows)
		// A party-playlist shuffle, not a security control — crypto/rand
		// would cost a syscall per swap for no one keeping score.
		rand.Shuffle(len(tracks), func(i, j int) { tracks[i], tracks[j] = tracks[j], tracks[i] }) //nolint:gosec
	default:
		tracks = commandsFromTracks(rows)
	}
	if len(tracks) == 0 {
		return nil, false
	}
	return tracks, true
}
