package protocol

// ChatLine is one chat message as the HTTP chat answers it (ADR-0010
// amended, #201; off the tick since #2437). Warm-up and phone talk;
// mid-effort stays the cheers' job.
type ChatLine struct {
	// Persisted identity (ADR-0010 amended, #201) — what reactions attach to.
	// Empty when the server runs without a database.
	ID   string `json:"id,omitempty"`
	From string `json:"from"` // filled by the server, like cheers
	// The author's rider id (#219): display names are not unique, and the
	// client's own-message suppression must not mute a namesake.
	FromID string `json:"fromId,omitempty"`
	Text   string `json:"text"`
	// A pasted image (#279): id of a channel-scoped blob the client uploaded
	// via POST /api/channels/{id}/chat/images before sending; rendered from
	// the matching GET. A line may be image-only (empty text).
	ImageID string `json:"imageId,omitempty"`
	At      int64  `json:"at"` // server millis, for ordering only
	// When the author last rewrote this line (#865); 0 for a line as sent.
	// The client renders "edited" off this, so it is a fact about the line
	// and not a separate event to remember.
	EditedAt int64 `json:"editedAt,omitempty"`
	// When a temporary line runs out (#2644), server millis; 0 for a line
	// that stays. Readers drop it by their own clock at that moment — the
	// server stops serving it then and sweeps it within the minute.
	ExpiresAt int64 `json:"expiresAt,omitempty"`
}

// ChatEdit is one line rewritten by its author (#865): the new text lands
// on the line already in the log, rather than arriving as a second message
// that would push the conversation along.
type ChatEdit struct {
	MessageID string `json:"messageId"`
	Text      string `json:"text"`
	EditedAt  int64  `json:"editedAt"`
}

// ChatReactionCount is a changed total, as the toggle answers it — plus who
// changed it and which way (#219), so the actor reconciles their "did I
// react" highlight from the server instead of trusting the click.
type ChatReactionCount struct {
	MessageID string `json:"messageId"`
	Emoji     string `json:"emoji"`
	Count     int    `json:"count"`
	By        string `json:"by,omitempty"` // rider id of the toggler
	Added     bool   `json:"added"`
}

// ChannelEvent is something that happened in a voice channel rather than
// something a rider said (#321): the jukebox changing under everyone is half
// of what happens there, and thirty seconds later "who put this on?" has no
// other answer. Structured, not a sentence — the client owns the wording, so
// the lounge and the dock name a track identically.
//
// Ephemeral by design (ADR-0022): it rides the tick like cheers and is never
// written to the chat table. A month of "now playing" in the backlog is noise.
type ChannelEvent struct {
	// Unique within the voice channel, and stable across re-broadcasts: a
	// growing burst re-sends the SAME id with a higher Count, and clients
	// replace the line in place.
	ID   string `json:"id"`
	Kind string `json:"kind"` // "jukebox" | "session" | "presence"
	// jukebox: "queued" | "removed" | "skipped" | "playing" | "restored"
	// session: "planned" | "moved" | "cancelled" | "started" | "ended" |
	//          "won" | "gameEnded"
	// presence: "joined" | "left" | "away" | "back"
	Verb string `json:"verb"`
	// Who did it. Empty when nobody did — the deck advancing on its own, or
	// a session the clock started.
	Actor string `json:"actor,omitempty"`
	// The title the dock shows, so both surfaces name the same track. Empty
	// on a coalesced burst, which has no single title left to show.
	Track string `json:"track,omitempty"`
	// The workout a session line is about.
	Subject string `json:"subject,omitempty"`
	// When that session is planned for, server millis. 0 on a line with no
	// time of its own ("started", "ended").
	When int64 `json:"when,omitempty"`
	// For "playing": who put this track in the queue.
	QueuedBy string `json:"queuedBy,omitempty"`
	// How many things this one line covers — 1 normally, more when a burst
	// coalesced ("queued 8 tracks", "Ana and 2 others joined"). Eight lines
	// would push the actual conversation off the screen. On "gameEnded" it
	// is instead the round the game reached, which for a collective ramp is
	// the score the whole session rode for.
	Count int   `json:"count"`
	At    int64 `json:"at"` // server millis, for ordering only
}
