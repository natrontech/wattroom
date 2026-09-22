package playlists

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// maxSavedTracks bounds one saved playlist — generous next to the live
// queue's 200 (a playlist is meant to outlast any one queue, a whole
// session's worth of music), still a cap against unbounded storage growth.
const maxSavedTracks = 300

// trackJSON is one saved entry, in the three shapes a JukeboxEntry takes
// (ADR-0045): a video, a pasted YouTube playlist, or a library track
// (trackId set, videoId empty, artist for the row).
type trackJSON struct {
	ID            string                  `json:"id"`
	VideoID       string                  `json:"videoId"`
	Title         string                  `json:"title"`
	PositionSec   float64                 `json:"positionSec,omitempty"`
	PlaylistID    string                  `json:"playlistId,omitempty"`
	PlaylistTitle string                  `json:"playlistTitle,omitempty"`
	Tracks        []protocol.JukeboxTrack `json:"tracks,omitempty"`
	TrackID       string                  `json:"trackId,omitempty"`
	Artist        string                  `json:"artist,omitempty"`
}

// trackJSONFrom reads one saved row. A library entry's title and artist come
// from the track itself — the Music page edits them — so the caller hands in
// what the join found (the insert path has the track row in hand instead).
func trackJSONFrom(t db.PlaylistTrack, trackTitle, trackArtist string) trackJSON {
	out := trackJSON{
		ID: store.UUIDString(t.ID), VideoID: t.VideoID, Title: t.Title,
		PositionSec: float64(t.StartSec),
	}
	if t.TrackID.Valid {
		out.TrackID = store.UUIDString(t.TrackID)
		out.Artist = trackArtist
		if trackTitle != "" {
			out.Title = trackTitle
		}
		return out
	}
	if t.YtPlaylistID != "" {
		out.PlaylistID = t.YtPlaylistID
		out.PlaylistTitle = t.YtPlaylistTitle
		_ = json.Unmarshal(t.Tracks, &out.Tracks)
	}
	return out
}

// rowTrack is the joined list row as the plain table row every other path
// reads — sqlc gives the join its own struct.
func rowTrack(r db.ListPlaylistTracksRow) db.PlaylistTrack {
	return db.PlaylistTrack{
		ID: r.ID, PlaylistID: r.PlaylistID, Position: r.Position,
		VideoID: r.VideoID, Title: r.Title, StartSec: r.StartSec,
		YtPlaylistID: r.YtPlaylistID, YtPlaylistTitle: r.YtPlaylistTitle,
		Tracks: r.Tracks, TrackID: r.TrackID,
	}
}

func clip(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// clampSec bounds a pasted ?t= the way the live queue does (jukebox.go's
// maxSeekSec) — a saved track is validated at write time exactly like a live
// "add", so nothing accepted here could be refused when it is later queued.
func clampSec(v float64) float32 {
	const maxSeekSec = 6 * 3600
	if v < 0 || v != v { // NaN guards itself
		return 0
	}
	if v > maxSeekSec {
		return maxSeekSec
	}
	return float32(v)
}

// trackParams validates one add-track request into what InsertPlaylistTrack
// needs — the same video-id/playlist-id shape check jukebox_entry.go's
// newEntry applies to a live "add", reused via hub's exported validators so
// a track this accepts is never one the live queue would later refuse.
func trackParams(playlistID pgtype.UUID, position int32, cmd protocol.JukeboxCommand) (db.InsertPlaylistTrackParams, bool) {
	if len(cmd.Tracks) > 0 {
		if !hub.ValidYouTubePlaylistID(cmd.PlaylistID) || len(cmd.Tracks) > hub.MaxPlaylistTracks {
			return db.InsertPlaylistTrackParams{}, false
		}
		for _, t := range cmd.Tracks {
			if !hub.ValidVideoID(t.VideoID) {
				return db.InsertPlaylistTrackParams{}, false
			}
		}
		raw, err := json.Marshal(cmd.Tracks)
		if err != nil {
			return db.InsertPlaylistTrackParams{}, false
		}
		return db.InsertPlaylistTrackParams{
			PlaylistID: playlistID, Position: position,
			VideoID: cmd.Tracks[0].VideoID, Title: clip(cmd.Tracks[0].Title, 200),
			YtPlaylistID: cmd.PlaylistID, YtPlaylistTitle: clip(cmd.PlaylistTitle, 200),
			Tracks: raw,
		}, true
	}
	if !hub.ValidVideoID(cmd.VideoID) {
		return db.InsertPlaylistTrackParams{}, false
	}
	return db.InsertPlaylistTrackParams{
		PlaylistID: playlistID, Position: position,
		VideoID: cmd.VideoID, Title: clip(cmd.Title, 200), StartSec: clampSec(cmd.PositionSec),
		Tracks: []byte("[]"),
	}, true
}

// commandsFromTracks replays a saved playlist as the "add" commands that
// produced it — reused by "queue this playlist" and by autoplay, so both
// paths run through jukebox.apply's normal validation and caps exactly like
// a live paste would. A library entry replays as the library add the Music
// page sends (#1080); whether a given rider may then hear it is the audio
// door's question (ADR-0015), asked per fetch, never here.
func commandsFromTracks(tracks []db.ListPlaylistTracksRow) []protocol.JukeboxCommand {
	cmds := make([]protocol.JukeboxCommand, 0, len(tracks))
	for _, t := range tracks {
		if t.TrackID.Valid {
			title := t.TrackTitle
			if title == "" {
				title = t.Title
			}
			cmds = append(cmds, protocol.JukeboxCommand{Action: "add", TrackID: store.UUIDString(t.TrackID), Title: title, Artist: t.TrackArtist, Bpm: int(t.TrackBpm), DurationMs: int(t.TrackDurationMs)})
			continue
		}
		cmd := protocol.JukeboxCommand{Action: "add", VideoID: t.VideoID, Title: t.Title, PositionSec: float64(t.StartSec)}
		if t.YtPlaylistID != "" {
			var resolved []protocol.JukeboxTrack
			_ = json.Unmarshal(t.Tracks, &resolved)
			cmd.PlaylistID, cmd.PlaylistTitle, cmd.Tracks = t.YtPlaylistID, t.YtPlaylistTitle, resolved
		}
		cmds = append(cmds, cmd)
	}
	return cmds
}

func (s *Service) getPlaylistDetail(w http.ResponseWriter, r *http.Request, sc scope) {
	p, ok := s.ownedPlaylist(w, r, sc)
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListPlaylistTracks(r.Context(), p.ID)
	if err != nil {
		httpx.Fail(w, s.log, "list playlist tracks failed", err, "The playlist could not be loaded.")
		return
	}
	tracks := make([]trackJSON, 0, len(rows))
	for _, row := range rows {
		tracks = append(tracks, trackJSONFrom(rowTrack(row), row.TrackTitle, row.TrackArtist))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"id": store.UUIDString(p.ID), "name": p.Name, "tracks": tracks,
	})
}

func (s *Service) handleGetRoomPlaylist(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.roomScope(w, r); ok {
		s.getPlaylistDetail(w, r, sc)
	}
}

func (s *Service) handleGetCrewPlaylist(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.crewScope(w, r, false); ok {
		s.getPlaylistDetail(w, r, sc)
	}
}

func (s *Service) handleGetPersonalPlaylist(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.personalScope(w, r); ok {
		s.getPlaylistDetail(w, r, sc)
	}
}

func (s *Service) addTrack(w http.ResponseWriter, r *http.Request, sc scope) {
	p, ok := s.ownedPlaylist(w, r, sc)
	if !ok {
		return
	}
	var cmd protocol.JukeboxCommand
	if err := httpx.DecodeStrict(r, &cmd); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	next, err := s.store.Queries.NextTrackPosition(r.Context(), p.ID)
	if err != nil {
		httpx.Fail(w, s.log, "next track position failed", err, "That track could not be added. Try again.")
		return
	}
	if int(next) >= maxSavedTracks {
		// A ceiling, so a 429 naming the number and the way out (SPEC:79-81,
		// #2244) — the track being added is not what is wrong.
		httpx.WriteCeiling(w, fmt.Sprintf("This playlist holds %d tracks, the most it can. Remove one to add another.", maxSavedTracks))
		return
	}
	var params db.InsertPlaylistTrackParams
	var library db.Track
	if cmd.TrackID != "" {
		// A library entry (ADR-0045): the track has to be the caller's own —
		// browsing is uploader-only (#1095), so a track they cannot see is one
		// they cannot save. Absent rather than forbidden, like GetTrack.
		id, err := store.ParseUUID(cmd.TrackID)
		if err == nil {
			library, err = s.store.Queries.GetTrack(r.Context(), db.GetTrackParams{ID: id, UploadedBy: sc.user.ID})
		}
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "validation_error", "That track is not in your library — pick it from the Music page and try again.")
			return
		}
		params = db.InsertPlaylistTrackParams{
			PlaylistID: p.ID, Position: next, TrackID: library.ID,
			Title: clip(library.Title, 200), Tracks: []byte("[]"),
		}
	} else if params, ok = trackParams(p.ID, next, cmd); !ok {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "That is not a track this jukebox can play.")
		return
	}
	row, err := s.store.Queries.InsertPlaylistTrack(r.Context(), params)
	if err != nil {
		httpx.Fail(w, s.log, "insert playlist track failed", err, "That track could not be added. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, trackJSONFrom(row, library.Title, library.Artist))
}

func (s *Service) deleteTrack(w http.ResponseWriter, r *http.Request, sc scope) {
	p, ok := s.ownedPlaylist(w, r, sc)
	if !ok {
		return
	}
	trackID, err := store.ParseUUID(r.PathValue("trackID"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That track does not exist.")
		return
	}
	rows, err := s.store.Queries.DeletePlaylistTrack(r.Context(), db.DeletePlaylistTrackParams{ID: trackID, PlaylistID: p.ID})
	if err != nil {
		httpx.Fail(w, s.log, "delete playlist track failed", err, "That track could not be removed. Try again.")
		return
	}
	if rows == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That track does not exist.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleAddRoomTrack(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.roomScope(w, r); ok {
		s.addTrack(w, r, sc)
	}
}

func (s *Service) handleAddCrewTrack(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.crewScope(w, r, false); ok {
		s.addTrack(w, r, sc)
	}
}

func (s *Service) handleAddPersonalTrack(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.personalScope(w, r); ok {
		s.addTrack(w, r, sc)
	}
}

func (s *Service) handleDeleteRoomTrack(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.roomModeratorScope(w, r); ok {
		s.deleteTrack(w, r, sc)
	}
}

func (s *Service) handleDeleteCrewTrack(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.crewScope(w, r, true); ok {
		s.deleteTrack(w, r, sc)
	}
}

func (s *Service) handleDeletePersonalTrack(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.personalScope(w, r); ok {
		s.deleteTrack(w, r, sc)
	}
}

// handleQueuePlaylist appends a playlist's tracks onto the room's voice
// channel's deck (#627) — the room's twin of handleQueuePlaylistIntoChannel,
// until the room goes (#2446). Its gate is the rooms package's (#2242).
func (s *Service) handleQueuePlaylist(w http.ResponseWriter, r *http.Request) {
	room, user, ok := s.members.RequireMember(w, r, "Join the room to use its jukebox.")
	if !ok {
		return
	}
	s.queuePlaylist(w, r, room.CrewID, s.store.VoiceChannelOf(r.Context(), room.ID), user)
}

// handleQueuePlaylistIntoChannel appends a playlist's tracks onto a voice
// channel's deck (#627, #2439), for anyone who may enter it. The playlist
// may be the channel's crew's or the caller's own; one playlist queued into
// two channels plays in each on its own, because each channel is its own
// deck (ADR-0058).
func (s *Service) handleQueuePlaylistIntoChannel(w http.ResponseWriter, r *http.Request) {
	channel, user, _, ok := s.channels.RequireVoice(w, r)
	if !ok {
		return
	}
	s.queuePlaylist(w, r, channel.CrewID, store.UUIDString(channel.ID), user)
}

// queuePlaylist is the shared half: find {playlist} on the crew's shelf or
// the caller's own — either is fine here, unlike edit and delete, which stay
// scope-exclusive — and hand its tracks to the hub's deck for channel.
func (s *Service) queuePlaylist(w http.ResponseWriter, r *http.Request, crew pgtype.UUID, channel string, user db.User) {
	id, err := store.ParseUUID(r.PathValue("playlist"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That playlist does not exist.")
		return
	}
	p, err := s.store.Queries.GetPlaylist(r.Context(), id)
	owns := err == nil && ((p.CrewID.Valid && p.CrewID == crew) || (p.UserID.Valid && p.UserID == user.ID))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !owns) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That playlist does not exist.")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "playlist lookup failed", err, "The playlist could not be loaded.")
		return
	}
	rows, err := s.store.Queries.ListPlaylistTracks(r.Context(), p.ID)
	if err != nil {
		httpx.Fail(w, s.log, "list playlist tracks failed", err, "That playlist could not be queued. Try again.")
		return
	}
	added, ok := s.queueOnto(w, channel, user, commandsFromTracks(rows))
	if !ok {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"queued": added})
}

// queueOnto hands commands to the hub's deck for channel. A channel nobody
// has opened has no deck, and the refusal says what to do about it.
func (s *Service) queueOnto(w http.ResponseWriter, channel string, user db.User, cmds []protocol.JukeboxCommand) (int, bool) {
	if s.live != nil && channel != "" {
		if added, live := s.live.QueuePlaylist(channel, store.UUIDString(user.ID), user.DisplayName, cmds); live {
			return added, true
		}
	}
	httpx.WriteError(w, http.StatusConflict, "conflict", "Open the voice channel to queue into its jukebox.")
	return 0, false
}
