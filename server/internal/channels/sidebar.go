package channels

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The sidebar's one fetch (#2444, ADR-0058 amending ADR-0010's radar): for
// every crew the rider is in, its channels as they may enter them — who is in
// each voice channel and what is running there, how much is unread in each
// text channel. Membership-filtered all the way down: a private channel that
// does not name the rider is absent, and so are its people.
//
// At GET /api/crews/live rather than the /api/live the issue names: that path
// is the landing page's public online count (main.go), which answers anyone.

type liveCrewJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon,omitempty"`
	// The caller's own role: owner | admin | member.
	Role     string            `json:"role"`
	Channels []liveChannelJSON `json:"channels"`
}

type liveChannelJSON struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Name    string `json:"name"`
	Private bool   `json:"private,omitempty"`
	// A voice channel's: who is connected, in the hub's order.
	Occupants []occupantJSON `json:"occupants,omitempty"`
	// A voice channel's running session (#2438), if one is.
	Session *protocol.LiveSession `json:"session,omitempty"`
	// A text channel's: lines from others since the rider last read it.
	Unread int `json:"unread,omitempty"`
	// A text channel's last line, while it has unread (#2457): what the
	// crew read announces, and where its reply goes.
	Last *lastLineJSON `json:"last,omitempty"`
}

// occupantJSON is presence and nothing more (ADR-0010's radar): a name and
// the states a tile already shows everyone in the channel — never a number.
type occupantJSON struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Voice  bool   `json:"voice,omitempty"`
	Camera bool   `json:"camera,omitempty"`
	Riding bool   `json:"riding,omitempty"`
	Away   bool   `json:"away,omitempty"`
}

type lastLineJSON struct {
	From   string `json:"from"`
	FromID string `json:"fromId"`
	Text   string `json:"text"`
	// The line was an image (#279) — it has no text to preview.
	HasImage bool  `json:"hasImage,omitempty"`
	At       int64 `json:"at"`
}

func (s *Service) handleCrewsLive(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	crews, err := s.store.Queries.ListCrewsFor(r.Context(), user.ID)
	if err != nil {
		httpx.Fail(w, s.log, "list crews failed", err, "Your crews could not be loaded.")
		return
	}
	out := make([]liveCrewJSON, 0, len(crews))
	for _, c := range crews {
		role := "member"
		switch {
		case c.Owned:
			role = "owner"
		case c.Admin:
			role = "admin"
		}
		crew, err := s.liveCrew(r.Context(), c.ID, user.ID, role)
		if err != nil {
			httpx.Fail(w, s.log, "crew live read failed", err, "Your crews could not be loaded.", "crew", store.UUIDString(c.ID))
			return
		}
		crew.Name, crew.Icon = c.Name, c.Icon
		out = append(out, crew)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"crews": out})
}

// liveCrew is one crew as the rider may see it right now.
func (s *Service) liveCrew(ctx context.Context, crewID, userID pgtype.UUID, role string) (liveCrewJSON, error) {
	out := liveCrewJSON{ID: store.UUIDString(crewID), Role: role, Channels: []liveChannelJSON{}}
	channels, err := s.enterable(ctx, crewID, userID, role)
	if err != nil {
		return out, err
	}
	var texts []pgtype.UUID
	for _, c := range channels {
		if c.Kind == kindText {
			texts = append(texts, c.ID)
		}
	}
	unread := map[pgtype.UUID]int{}
	if len(texts) > 0 {
		rows, err := s.store.Queries.UnreadByChannel(ctx, db.UnreadByChannelParams{UserID: userID, ChannelIds: texts})
		if err != nil {
			return out, err
		}
		for _, row := range rows {
			unread[row.ChannelID] = int(row.Unread)
		}
	}
	last, err := s.lastLines(ctx, unread)
	if err != nil {
		return out, err
	}
	for _, c := range channels {
		entry := liveChannelJSON{ID: store.UUIDString(c.ID), Kind: c.Kind, Name: c.Name, Private: c.Private}
		if c.Kind == kindText {
			entry.Unread = unread[c.ID]
			entry.Last = last[c.ID]
		} else if s.live != nil {
			id := store.UUIDString(c.ID)
			entry.Occupants = occupantsOf(s.live.Presence(id))
			if session, running := s.live.LiveSession(id); running {
				entry.Session = &session
			}
		}
		out.Channels = append(out.Channels, entry)
	}
	return out, nil
}

// lastLines is the last line of every channel with unread, by channel.
func (s *Service) lastLines(ctx context.Context, unread map[pgtype.UUID]int) (map[pgtype.UUID]*lastLineJSON, error) {
	out := map[pgtype.UUID]*lastLineJSON{}
	ids := make([]pgtype.UUID, 0, len(unread))
	for id := range unread {
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.store.Queries.LastLineByChannel(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.ChannelID] = &lastLineJSON{
			From: row.DisplayName, FromID: store.UUIDString(row.UserID), Text: row.Text,
			HasImage: row.ImageID.Valid, At: row.CreatedAt.Time.UnixMilli(),
		}
	}
	return out, nil
}

// occupantsOf reads the hub's presence as people. Voice and camera arrive by
// display name (the LiveKit webhook's word for a participant), so they are
// matched by name, as the room's rail always has; riding and away by id.
// ponytail: the hub's order, not speaking-last — nothing server-side knows
// who spoke last, which is LiveKit's client-side level; order by it when the
// hub learns it.
func occupantsOf(p protocol.ChannelPresence) []occupantJSON {
	set := func(values []string) map[string]bool {
		out := make(map[string]bool, len(values))
		for _, v := range values {
			out[v] = true
		}
		return out
	}
	voice, cameras, riding, away := set(p.Voice), set(p.Cameras), set(p.RidingIDs), set(p.AwayIDs)
	out := make([]occupantJSON, 0, len(p.RiderIDs))
	for i, id := range p.RiderIDs {
		name := ""
		if i < len(p.Riders) {
			name = p.Riders[i]
		}
		out = append(out, occupantJSON{
			ID: id, Name: name, Voice: voice[name], Camera: cameras[name],
			Riding: riding[id], Away: away[id],
		})
	}
	return out
}
