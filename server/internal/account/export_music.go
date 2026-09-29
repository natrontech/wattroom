package account

import (
	"encoding/json"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The rider's sound: the playlists they built, the shelf they uploaded, and
// the soundboard they cut from their own clips.

func (x *export) playlists() category {
	return category{"playlists.json", []string{"playlists"}, func() (any, error) {
		rows, err := x.q.ExportUserPlaylists(x.ctx, x.user.ID)
		return mapRows(rows, err, func(row db.ExportUserPlaylistsRow) any {
			return map[string]any{"name": row.Name, "createdAt": row.CreatedAt.Time,
				"tracks": json.RawMessage(row.Tracks)}
		})
	}}
}

func (x *export) tracks() category {
	return x.bounded("tracks.json", []string{"tracks"}, func() (any, int, error) {
		// The music the rider uploaded (#1089): the rows of their own
		// shelf, which since #1095 is exactly the part of the pool they
		// can see. Every field they typed, plus what the file measured,
		// plus the content address so a row still names its file.
		//
		// Never the audio. ADR-0015's copyright fence has no public share
		// links to audio files, and the ADR already answered this for
		// backups — "metadata is; files are re-uploadable, so v1 excludes
		// them" — which is the same question with the same answer. It is
		// also the only version that stays inside the export's shape:
		// this archive is built whole in memory and a shelf is 2 GB.
		rows, err := x.q.ExportUserTracks(x.ctx, db.ExportUserTracksParams{
			UploadedBy: x.user.ID, Lim: maxExportRows,
		})
		out, err := mapRows(rows, err, func(row db.ExportUserTracksRow) any {
			var bpm any
			if row.Bpm != nil {
				bpm = *row.Bpm
			}
			return map[string]any{"title": row.Title, "artist": row.Artist,
				"album": row.Album, "tags": row.Tags, "bpm": bpm,
				"durationMs": row.DurationMs, "sizeBytes": row.SizeBytes,
				"uploadedAt": row.CreatedAt.Time, "contentAddress": row.Sha256}
		})
		return out, len(rows), err
	})
}

func (x *export) soundboard() category {
	return x.bounded("soundboard.json", []string{"board_clips"}, func() (any, int, error) {
		// The soundboard the rider built (#2089): every clip in their
		// library, the name they typed, the pad and key they bound it to,
		// and the trim they set — what ClipsFace draws, which is what
		// they see.
		//
		// The audio is here too, under uploads/soundboard/ (#2090,
		// ADR-0053). ADR-0015's "metadata is; files are re-uploadable"
		// is about somebody else's recording and does not reach a clip
		// the rider trimmed themselves. The id names the file, because a
		// clip is served by its id and nothing else. Bounded by SPEC's
		// 100 MB per rider, which is what lets an archive built whole in
		// memory carry them.
		rows, err := x.q.ExportUserBoardClips(x.ctx, db.ExportUserBoardClipsParams{
			UserID: x.user.ID, Lim: maxExportRows,
		})
		for _, row := range rows {
			x.clipIDs = append(x.clipIDs, row.ID)
		}
		out, err := mapRows(rows, err, func(row db.ExportUserBoardClipsRow) any {
			// end_ms is stored as 0 for "to the end of the file", the way
			// keptMillis reads it — so a 500 ms clip exported a literal
			// endMs of 0 and read like one that plays nothing. This is a
			// file a person opens: the trim says null for the end it does
			// not cut, and playsMs is the length the strip shows.
			end, plays := any(nil), row.DurationMs-row.StartMs
			if row.EndMs > 0 {
				end, plays = row.EndMs, row.EndMs-row.StartMs
			}
			return map[string]any{"clip": store.UUIDString(row.ID), "name": row.Name,
				"pad": row.Pad, "key": row.Key, "durationMs": row.DurationMs,
				"sizeBytes": row.SizeBytes, "startMs": row.StartMs, "endMs": end,
				"playsMs": plays, "gainDb": row.GainDb, "fadeInMs": row.FadeInMs,
				"fadeOutMs": row.FadeOutMs, "uploadedAt": row.CreatedAt.Time}
		})
		return out, len(rows), err
	})
}
