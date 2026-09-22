package store

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// RoomOfVoiceChannel is the room a voice channel came from (#2436): the hub
// hands its keepers a channel id, and those that still write room_id resolve
// it here until their own M9 issue re-keys them. A channel no room became —
// one made in the channels API — answers pgx.ErrNoRows, which each keeper
// already treats as "no such room". Goes with room_channels (#2433).
func (s *Store) RoomOfVoiceChannel(ctx context.Context, channelID string) (db.Room, error) {
	id, err := ParseUUID(channelID)
	if err != nil {
		return db.Room{}, err
	}
	return s.Queries.RoomOfVoiceChannel(ctx, id)
}

// VoiceChannelOf is the other direction, for the rooms-era callers that
// address the hub: "" when the room has no voice channel, which every hub
// method reads as a channel nobody is in.
func (s *Store) VoiceChannelOf(ctx context.Context, roomID pgtype.UUID) string {
	id, err := s.Queries.VoiceChannelOfRoom(ctx, roomID)
	if err != nil {
		return ""
	}
	return UUIDString(id)
}
