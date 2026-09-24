// Reading a conversation: the thread with its pages, the heads — one line
// per peer for the sidebar — and the reader's own read cursor. Split from
// dms.go, which keeps the writes.
package dms

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/status"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func (s *Service) handleThread(w http.ResponseWriter, r *http.Request) {
	me, peer, ok := s.peer(w, r)
	if !ok {
		return
	}
	after := time.Unix(0, 0)
	if raw := r.URL.Query().Get("after"); raw != "" {
		if ms, err := strconv.ParseInt(raw, 10, 64); err == nil {
			after = time.UnixMilli(ms)
		}
	}
	rows, err := s.store.Queries.ListDms(r.Context(), db.ListDmsParams{
		Column1: me.ID, Column2: peer,
		CreatedAt: pgtype.Timestamptz{Time: after, Valid: true},
	})
	if err != nil {
		httpx.Fail(w, s.log, "list dms", err, "Messages could not be loaded.")
		return
	}
	// The full pair's reactions, independent of `after`: a reaction on a
	// message already loaded on the client must still surface on the next
	// poll, which the incremental message fetch above would otherwise miss
	// if reactions rode along on individual message rows instead. Returned
	// at the top level and replaced wholesale by the client on every poll.
	reactionRows, err := s.store.Queries.ListDmReactions(r.Context(), db.ListDmReactionsParams{
		Column1: me.ID, Column2: peer, UserID: me.ID,
	})
	if err != nil {
		httpx.Fail(w, s.log, "list dm reactions", err, "Messages could not be loaded.")
		return
	}
	counts := map[string]map[string]int{}
	mine := map[string][]string{}
	for _, row := range reactionRows {
		id := store.UUIDString(row.MessageID)
		if counts[id] == nil {
			counts[id] = map[string]int{}
		}
		counts[id][row.Emoji] = int(row.Total)
		if row.Mine {
			mine[id] = append(mine[id], row.Emoji)
		}
	}
	type messageJSON struct {
		ID   string `json:"id"`
		Mine bool   `json:"mine"`
		Text string `json:"text"`
		// A pasted image's blob id (#285); "" when the message is text only.
		ImageID string `json:"imageId,omitempty"`
		At      int64  `json:"at"`
		// When the sender last rewrote it (#865); absent for a line as sent.
		EditedAt int64 `json:"editedAt,omitempty"`
		// When the sender took it back (#2418). The row survives so the other
		// side is told at all — a poll merges by id and can never say "gone" —
		// and the words and the picture left with the delete.
		DeletedAt int64 `json:"deletedAt,omitempty"`
		// When a temporary line runs out (#2644); absent for one that stays.
		ExpiresAt int64 `json:"expiresAt,omitempty"`
		// A poke (#2721): the line says who and when; Text is what they added.
		Poke bool `json:"poke,omitempty"`
	}
	out := make([]messageJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, messageJSON{
			ID: store.UUIDString(row.ID), Mine: row.SenderID == me.ID,
			Text: row.Text, ImageID: store.UUIDString(row.ImageID),
			At: row.CreatedAt.Time.UnixMilli(), EditedAt: store.Millis(row.EditedAt),
			DeletedAt: store.Millis(row.DeletedAt),
			ExpiresAt: store.Millis(row.ExpiresAt),
			Poke:      row.Poke,
		})
	}
	// Edits ride separately from the incremental fetch for the same reason
	// reactions do, and one more: an edit leaves created_at alone, so `after`
	// would hide the new text of a line the reader is already looking at.
	editRows, err := s.store.Queries.ListDmEdits(r.Context(), db.ListDmEditsParams{
		Column1: me.ID, Column2: peer,
	})
	if err != nil {
		httpx.Fail(w, s.log, "list dm edits", err, "Messages could not be loaded.")
		return
	}
	edits := make(map[string]protocol.ChatEdit, len(editRows))
	for _, row := range editRows {
		id := store.UUIDString(row.ID)
		edits[id] = protocol.ChatEdit{MessageID: id, Text: row.Text, EditedAt: store.Millis(row.EditedAt)}
	}
	// Tombstones ride separately for the same reason edits do (#2418):
	// deleting does not move created_at, so a reader looking at the line
	// would never be told by the messages page alone.
	deletedRows, err := s.store.Queries.ListDmDeleted(r.Context(), db.ListDmDeletedParams{
		Column1: me.ID, Column2: peer,
	})
	if err != nil {
		httpx.Fail(w, s.log, "list dm deleted", err, "Messages could not be loaded.")
		return
	}
	deleted := make([]string, 0, len(deletedRows))
	for _, id := range deletedRows {
		deleted = append(deleted, store.UUIDString(id))
	}
	// Where the "N new" divider goes; zero when they never read it. The
	// reader's own cursor, so it is theirs to see and nobody else's.
	var readAt int64
	if stamp, err := s.store.Queries.GetDmReadAt(r.Context(), db.GetDmReadAtParams{
		UserID: me.ID, PeerID: peer,
	}); err == nil && stamp.Valid {
		readAt = stamp.Time.UnixMilli()
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.log.Warn("dm read stamp", "err", err)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"messages": out, "reactions": counts, "myReacts": mine, "edits": edits,
		"deleted": deleted, "readAt": readAt,
	})
}

// handleRead moves the reader's cursor to now (#2711): what clears the dot on
// every device they are signed in on. Nothing about it reaches the peer.
func (s *Service) handleRead(w http.ResponseWriter, r *http.Request) {
	me, peer, ok := s.peer(w, r)
	if !ok {
		return
	}
	if err := s.store.Queries.MarkDmRead(r.Context(), db.MarkDmReadParams{UserID: me.ID, PeerID: peer}); err != nil {
		httpx.Fail(w, s.log, "mark dm read", err, "That conversation could not be marked read.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleHeads(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListDmHeads(r.Context(), me.ID)
	if err != nil {
		httpx.Fail(w, s.log, "list dm heads", err, "Messages could not be loaded.")
		return
	}
	type headJSON struct {
		PeerID   string `json:"peerId"`
		PeerName string `json:"peerName"`
		// Peer avatar + lifetime XP (#253) for the thread rows.
		PeerAvatarURL *string `json:"peerAvatarUrl,omitempty"`
		PeerTotalXp   int64   `json:"peerTotalXp"`
		// Their status line (ADR-0060); null for none. Heads are accepted
		// friends only, which is who sees a status (ADR-0012).
		PeerStatusLine *protocol.StatusLine `json:"peerStatusLine"`
		Text           string               `json:"text"`
		// Whether the latest line was an image, so the list can preview it as
		// something rather than as a blank (#285).
		HasImage bool `json:"hasImage,omitempty"`
		// The latest line is a poke (#2721), announced as one.
		Poke bool  `json:"poke,omitempty"`
		Mine bool  `json:"mine"`
		At   int64 `json:"at"`
		// The peer said something since I last read it, on any device.
		Unread bool `json:"unread,omitempty"`
	}
	out := make([]headJSON, 0, len(rows))
	now := time.Now()
	for _, row := range rows {
		out = append(out, headJSON{
			PeerID: store.UUIDString(row.PeerID), PeerName: row.DisplayName,
			PeerAvatarURL:  row.AvatarUrl,
			PeerTotalXp:    row.TotalXp,
			PeerStatusLine: status.Of(row.StatusEmoji, row.StatusEmojiID, row.StatusText, row.StatusExpiresAt, now),
			Text:           row.Text, HasImage: row.ImageID.Valid,
			Poke:   row.Poke,
			Mine:   row.SenderID == me.ID,
			At:     row.CreatedAt.Time.UnixMilli(),
			Unread: row.Unread,
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"conversations": out})
}
