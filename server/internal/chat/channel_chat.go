// A text channel's chat (ADR-0058, #2435): the backlog, posting, editing,
// deleting, reacting, reading, the images a line may carry and the one
// announcement a channel keeps. HTTP only — there is no socket in a text
// channel — and the fan-out is the lobby ping naming the channel, so a client
// looking at it re-fetches that log and nothing else.
package chat

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Channels is the gate chat stands behind: may this caller enter this text
// channel (channels.mayEnter), and what are they to its crew. Satisfied by
// *channels.Service.
type Channels interface {
	RequireText(w http.ResponseWriter, r *http.Request) (db.Channel, db.User, string, bool)
	RequireCrew(w http.ResponseWriter, r *http.Request) (pgtype.UUID, db.User, string, bool)
}

// Lobby is how everyone else hears (#2435): a ping naming the channel whose
// log changed, to the riders who may enter it (#2821). Satisfied by the hub.
// Optional: without it a reader sees new lines on their next load.
type Lobby interface {
	ChannelChanged(channelID string, audience []string)
	ReadChanged(userID string)
}

const noSuchLine = "No such message in this channel."

// RegisterChannels mounts a text channel's chat behind gate.
func (s *Service) RegisterChannels(mux *http.ServeMux, gate Channels, lobby Lobby) {
	s.channels, s.lobby = gate, lobby
	mux.HandleFunc("GET /api/channels/{id}/chat", s.handleChannelBacklog)
	mux.HandleFunc("POST /api/channels/{id}/chat", s.handleChannelPost)
	mux.HandleFunc("PATCH /api/channels/{id}/chat/{msg}", s.handleChannelEdit)
	mux.HandleFunc("DELETE /api/channels/{id}/chat/{msg}", s.handleChannelDelete)
	mux.HandleFunc("POST /api/channels/{id}/chat/reactions", s.handleChannelReact)
	mux.HandleFunc("POST /api/channels/{id}/read", s.handleChannelRead)
	mux.HandleFunc("POST /api/channels/{id}/chat/images", s.handleChannelImageUpload)
	mux.HandleFunc("GET /api/channels/{id}/chat/images/{img}", s.handleChannelImage)
	mux.HandleFunc("PUT /api/channels/{id}/announcement", s.handleSetChannelAnnouncement)
	mux.HandleFunc("DELETE /api/channels/{id}/announcement", s.handleClearChannelAnnouncement)
	mux.HandleFunc("GET /api/crews/{id}/announcement", s.handleCrewAnnouncement)
}

// changedIn tells the lobby sockets of everyone who may enter the channel
// that it moved — nobody else's (#2821).
func (s *Service) changedIn(ctx context.Context, channel db.Channel) {
	if s.lobby == nil {
		return
	}
	id := store.UUIDString(channel.ID)
	// The write is stored whether or not its poster is still connected.
	rows, err := s.store.Queries.ChannelAudience(context.WithoutCancel(ctx), channel.ID)
	if err != nil {
		// The line is stored; readers see it on their next load.
		s.log.Warn("channel audience lookup failed", "channel", id, "err", err)
		return
	}
	audience := make([]string, len(rows))
	for i, userID := range rows {
		audience[i] = store.UUIDString(userID)
	}
	s.lobby.ChannelChanged(id, audience)
}
