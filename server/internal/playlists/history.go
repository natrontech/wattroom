package playlists

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// smartShuffleBatch is how many pool tracks one smart-autoplay refill queues
// (docs/SPEC.md). Small on purpose: the deck re-triggers autoplay every time
// it runs dry (#676), so a short batch re-weights against a fresher history
// instead of committing the room to an hour chosen an hour ago.
const smartShuffleBatch = 10

// TrackEnded implements hub.TrackHistory (#269): one pool track the deck
// played through or skipped past, recorded room-scoped. Best-effort — a lost
// line costs one nudge in a weighting, and the deck has already moved on, so
// nothing here is worth failing a rider's command over.
func (s *Service) TrackEnded(ctx context.Context, slug, trackID, queuedBy string, skipped bool) {
	track, err := store.ParseUUID(trackID)
	if err != nil {
		return
	}
	room, err := s.store.Queries.GetRoomBySlug(ctx, slug)
	if err != nil {
		s.log.Error("track history: room lookup failed", "room", slug, "err", err)
		return
	}
	// Autoplay queued it, so nobody did: the column stays null rather than
	// crediting the room's taste to whoever happened to be listening.
	var by pgtype.UUID
	if queuedBy != "" {
		if id, err := store.ParseUUID(queuedBy); err == nil {
			by = id
		}
	}
	if err := s.store.Queries.RecordTrackPlay(ctx, db.RecordTrackPlayParams{
		TrackID: track, RoomID: room.ID, QueuedBy: by, Skipped: skipped,
	}); err != nil {
		s.log.Error("track history: record failed", "room", slug, "track", trackID, "err", err)
	}
}

// smartShuffle is the pool half of autoplay (#269): a weighted draw over
// every track in the pool, penalised by what THIS room played recently and
// keeps skipping, and since #270 boosted toward the cadence the room's
// timeline is asking for. Empty (and silent) when the pool is empty — a room set to
// smart with nothing uploaded simply has nothing to play, the same answer an
// empty active playlist already gives.
func (s *Service) smartShuffle(ctx context.Context, roomID pgtype.UUID, slug string, mood hub.SessionMood) []protocol.JukeboxCommand {
	// 0 rpm is "no session, or a block that asks for nothing in particular",
	// and the query reads it as "no BPM preference" (#270).
	rpm, _ := targetCadence(mood)
	rows, err := s.store.Queries.SmartShuffleTracks(ctx, db.SmartShuffleTracksParams{
		RoomID: roomID, Lim: smartShuffleBatch,
		TargetRpm: rpm, BpmTolerance: bpmTolerance, BpmBoost: bpmBoost,
	})
	if err != nil {
		s.log.Error("smart shuffle failed", "room", slug, "err", err)
		return nil
	}
	cmds := make([]protocol.JukeboxCommand, 0, len(rows))
	for _, t := range rows {
		id := store.UUIDString(t.ID)
		// Why this track and not another: the draw is random and cannot be
		// explained after the fact, so the weight is said here or nowhere.
		s.log.Debug("smart shuffle picked", "room", slug, "track", id, "weight", t.Weight, "targetRpm", rpm)
		cmds = append(cmds, protocol.JukeboxCommand{
			Action: "add", TrackID: id, Title: t.Title, Artist: t.Artist,
		})
	}
	return cmds
}
