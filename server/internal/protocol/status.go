package protocol

// StatusLine is a rider's own line (ADR-0060): what shows beside their name
// wherever their name shows. Absent is no status; one whose ExpiresAt has
// passed is never sent.
type StatusLine struct {
	// A Unicode emoji, or a crew emoji's `:name:`.
	Emoji string `json:"emoji,omitempty"`
	// The crew emoji's picture, at /api/emoji/{EmojiID}. Absent for a Unicode
	// emoji, and for a crew emoji the crew has since deleted — that one shows
	// its :name:.
	EmojiID string `json:"emojiId,omitempty"`
	Text    string `json:"text,omitempty"`
	// When it clears, RFC 3339; absent is "don't clear".
	ExpiresAt string `json:"expiresAt,omitempty"`
}
