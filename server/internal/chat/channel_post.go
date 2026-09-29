package chat

// Posting to a text channel: a line, a pasted picture, and the pruning that
// keeps the log bounded. Split from channel_chat.go (#3358).

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func (s *Service) handleChannelPost(w http.ResponseWriter, r *http.Request) {
	channel, me, _, ok := s.channels.RequireText(w, r)
	if !ok || s.overLine(w, me.ID) {
		return
	}
	var req struct {
		Text    string `json:"text"`
		ImageID string `json:"imageId"`
		// A temporary line's timer in seconds (#2644); absent for one that stays.
		ExpiresIn int `json:"expiresIn"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	text := strings.TrimSpace(req.Text)
	if tooLong(w, text) || httpx.BadTimer(w, req.ExpiresIn) {
		return
	}
	if text == "" && req.ImageID == "" {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "Say something first.", "text")
		return
	}
	var img pgtype.UUID
	if req.ImageID != "" {
		var err error
		if img, err = store.ParseUUID(req.ImageID); err != nil {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That image could not be attached.", "imageId")
			return
		}
		// Asked first (#1987): the insert refuses a foreign image the way it
		// refuses a fault, and a stale id deserves an answer the client can act on.
		ours, err := s.store.Queries.ChatImageInChannel(r.Context(), db.ChatImageInChannelParams{ID: img, ChannelID: channel.ID})
		if err != nil {
			httpx.Fail(w, s.log, "chat image lookup", err, "The message could not be sent. Try again.", "channel", store.UUIDString(channel.ID))
			return
		}
		if !ours {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That picture is not in this channel — attach it again.", "imageId")
			return
		}
	}
	at := time.Now().UnixMilli()
	expires := store.ExpiresAt(time.UnixMilli(at), req.ExpiresIn)
	id, err := s.store.Queries.SaveChannelMessage(r.Context(), db.SaveChannelMessageParams{
		ChannelID: channel.ID, UserID: me.ID, Text: text, ImageID: img,
		CreatedAt: pgtype.Timestamptz{Time: time.UnixMilli(at), Valid: true},
		ExpiresAt: expires,
	})
	if err != nil {
		httpx.Fail(w, s.log, "save channel chat", err, "The message could not be sent. Try again.", "channel", store.UUIDString(channel.ID))
		return
	}
	s.pruneChannelSampled(channel.ID)
	// Saying something is reading up to it.
	s.markChannelRead(r.Context(), channel, me, id)
	s.changedIn(r.Context(), channel)
	httpx.WriteJSON(w, http.StatusOK, protocol.ChatLine{
		ID: store.UUIDString(id), From: me.DisplayName, FromID: store.UUIDString(me.ID),
		Text: text, ImageID: req.ImageID, At: at, ExpiresAt: store.Millis(expires),
	})
}

// pruneChannelSampled bounds a channel: 500 lines, and the images nothing
// points at, one write in sixteen and off the request — every save used to
// pay a delete-with-subquery that stalled the sender (audit #219). The prune
// outlives the request on purpose, bounded by its own timeout.
func (s *Service) pruneChannelSampled(channelID pgtype.UUID) {
	if time.Now().UnixNano()%16 != 0 {
		return
	}
	safego.Go(s.log, "channel chat prune", func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.store.Queries.PruneChannelChat(ctx, channelID); err != nil {
			s.log.Warn("prune channel chat", "err", err, "channel", store.UUIDString(channelID))
		}
		if err := s.store.Queries.PruneChannelImages(ctx, channelID); err != nil {
			s.log.Warn("prune channel images", "err", err, "channel", store.UUIDString(channelID))
		}
	})
}

func (s *Service) handleChannelImageUpload(w http.ResponseWriter, r *http.Request) {
	channel, me, _, ok := s.channels.RequireText(w, r)
	if !ok {
		return
	}
	if !s.uploads.Spend(me.ID) {
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
			"That is a lot of pictures in one hour — a moment, then attach it again.")
		return
	}
	data, mime, ok := httpx.ReadImageUpload(w, r)
	if !ok {
		return
	}
	id, err := s.store.Queries.SaveChannelImage(r.Context(), db.SaveChannelImageParams{
		ChannelID: channel.ID, UserID: me.ID, Mime: mime, Bytes: data,
	})
	if err != nil {
		httpx.Fail(w, s.log, "save channel image", err, "The image could not be saved.", "channel", store.UUIDString(channel.ID))
		return
	}
	s.pruneChannelSampled(channel.ID)
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"id": store.UUIDString(id)})
}

func (s *Service) handleChannelImage(w http.ResponseWriter, r *http.Request) {
	channel, _, _, ok := s.channels.RequireText(w, r)
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("img"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such image.")
		return
	}
	img, err := s.store.Queries.GetChannelImage(r.Context(), db.GetChannelImageParams{ID: id, ChannelID: channel.ID})
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such image.")
		return
	}
	httpx.ServeImmutableImage(w, img.Mime, img.Bytes)
}
