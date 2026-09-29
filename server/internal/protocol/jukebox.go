package protocol

// JukeboxCommand is any member's jukebox action — the matrix defaults
// play/pause/skip to members, and adding is everyone's.
type JukeboxCommand struct {
	// "unplayable" is "ended" for a track nobody could play (#2834): the deck
	// moves on, and it counts as a skip.
	Action  string `json:"action"` // "add" | "remove" | "vote" | "move" | "play" | "pause" | "skip" | "back" | "skipPlaylist" | "seek" | "ended" | "unplayable" | "restore"
	VideoID string `json:"videoId,omitempty"`
	Title   string `json:"title,omitempty"`
	// For "add": queue a whole YouTube playlist as one entry (#615). The
	// client resolves the tracks — the server still knows nothing about
	// YouTube, it just holds the list the paste produced.
	PlaylistID    string         `json:"playlistId,omitempty"`
	PlaylistTitle string         `json:"playlistTitle,omitempty"`
	Tracks        []JukeboxTrack `json:"tracks,omitempty"`
	// For "add": a track from the pool rather than a YouTube video (#267).
	// Mutually exclusive with VideoID; Title and Artist ride along for
	// display, because the deck carries no metadata of its own.
	TrackID string `json:"trackId,omitempty"`
	Artist  string `json:"artist,omitempty"`
	// The track's tempo, when its tags say (#1431): read off the library
	// row by whoever adds it, shown on the queue row, and matched against
	// the block's cadence while a session runs. 0 = untagged.
	Bpm int `json:"bpm,omitempty"`
	// For "add" of a library track: its length as the server measured it at
	// upload (#1509), so the deck can draw a seek bar before — or without —
	// any client's <audio> reporting one. 0 = unknown.
	DurationMs int `json:"durationMs,omitempty"`
	// For "remove" | "vote" | "move": which queue entry (#286). Video ids
	// are not unique — the same track queued twice is two entries, and
	// addressing by video used to hit the wrong one.
	EntryID string `json:"entryId,omitempty"`
	// For "move": the entry's new index in the queue, clamped to it.
	Index int `json:"index,omitempty"`
	// For "seek": the new shared playhead. For "add": start the entry here
	// (a pasted ?t= timestamp) — 0 means the beginning, like any URL.
	PositionSec float64 `json:"positionSec,omitempty"`
	// For "ended": the anchor the client was playing against. Every client
	// (and tab) reports the end — the epoch match makes N echoes advance
	// the queue exactly once even when the same video is queued twice.
	AnchorMs int64 `json:"anchorMs,omitempty"`
	// "restore" takes no fields: it puts back whatever the last "remove" or
	// "skipPlaylist" dropped, within its ~10s grace window (#660) — the
	// undo button on that command's own toast, and the only thing that
	// sends it.
}

// JukeboxTrack is one video inside a queued playlist (#615). Ids and titles
// both ride the wire: the client resolves them once when the playlist is
// pasted, and the server needs the title for the now-playing timeline line.
type JukeboxTrack struct {
	VideoID string `json:"videoId"`
	Title   string `json:"title"`
}

type JukeboxEntry struct {
	// Unique within the voice channel, server-assigned: what
	// remove/vote/move address (#286).
	ID string `json:"id"`
	// What is on the deck RIGHT NOW. For a playlist entry (#615) this is
	// Tracks[Index] and changes as the entry plays through — which is why
	// the whole client playback path needed no playlist branch of its own.
	VideoID string `json:"videoId"`
	Title   string `json:"title"`
	AddedBy string `json:"addedBy"`
	// Where playback begins when this entry reaches the deck (?t= paste).
	StartSec float64 `json:"startSec,omitempty"`
	// Upvotes float an entry above lower-voted ones (#286). The voters are
	// rider ids, not a count — scoped to the channel like every other live
	// field, and the only way a client renders "you voted" from truth, not
	// from its own click. The count is len(voters); nothing to keep in sync.
	Voters []string `json:"voters,omitempty"`
	// Set when the entry is a whole YouTube playlist queued as one thing
	// (#615) — a playlist takes ONE queue slot, so a paste cannot own the
	// channel's 50 and the vote order keeps meaning something.
	PlaylistID    string `json:"playlistId,omitempty"`
	PlaylistTitle string `json:"playlistTitle,omitempty"`
	// The playlist in order, resolved by the client that pasted it. Empty
	// for a single video: len(Tracks) > 0 is what makes an entry a playlist.
	Tracks []JukeboxTrack `json:"tracks,omitempty"`
	// Which track is on the deck. Only ever moves within [0, len(Tracks)):
	// running off the end advances to the next QUEUE entry rather than
	// wrapping — a playlist plays once through and never restarts itself.
	Index int `json:"index,omitempty"`
	// A track from the self-hosted pool (#267, ADR-0015) instead of a
	// YouTube video: the id the client fetches audio for. VideoID is empty
	// on such an entry, and `TrackID != ""` is what makes an entry a pool
	// track — the deck's rules do not otherwise care where audio comes from.
	//
	// RMF's tile rules bind only while a YouTube entry plays (WATTROOM.md),
	// which is the whole reason a pool track may be audio-only.
	TrackID string `json:"trackId,omitempty"`
	// Display only, resolved by whoever queued it: the server holds no
	// track metadata on the deck, the same way it holds no YouTube titles.
	Artist string `json:"artist,omitempty"`
	// Tempo of a library entry, 0 when untagged (#1431).
	Bpm int `json:"bpm,omitempty"`
	// Length of a library entry in milliseconds (#1509): measured by the
	// server at upload, so every client — muted, sitting out, still loading
	// — draws the same seek bar. 0 for a video, whose length only a player
	// that loaded it knows.
	DurationMs int `json:"durationMs,omitempty"`
}

// JukeboxState is the server's truth about what plays where. Clients chase the
// anchor: position = PositionSec, plus SERVER time since AnchorMs while
// playing — a client's own wall clock is skewed by seconds and applying it
// here is what made the jukebox "not synced" (#286). Clients estimate the
// offset from ServerTick.At and translate.
// The audio itself is local per rider — their iframe, their volume — and never
// enters the voice path (SPEC voice channel audio defaults).
type JukeboxState struct {
	Queue       []JukeboxEntry `json:"queue"`
	Current     *JukeboxEntry  `json:"current,omitempty"`
	Playing     bool           `json:"playing"`
	PositionSec float64        `json:"positionSec"`
	AnchorMs    int64          `json:"anchorMs"`
	// What the channel just played, newest first (#286) — the deck's short
	// memory, so "put that on again" is one tap and nobody retypes a link.
	History []JukeboxEntry `json:"history"`
}
