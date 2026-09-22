package channels

import (
	"context"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// enterable is the crew's channels the caller may enter, in the crew's order:
// the one gate every read here applies. A private channel that does not name
// them is left out entirely rather than shown shut — a channel's existence is
// part of what its gate keeps.
func (s *Service) enterable(ctx context.Context, crewID, userID pgtype.UUID, role string) ([]db.Channel, error) {
	rows, err := s.store.Queries.ListCrewChannels(ctx, crewID)
	if err != nil {
		return nil, fmt.Errorf("channels: list: %w", err)
	}
	named, err := s.store.Queries.NamedChannelsFor(ctx, db.NamedChannelsForParams{CrewID: crewID, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("channels: named: %w", err)
	}
	isNamed := map[pgtype.UUID]bool{}
	for _, id := range named {
		isNamed[id] = true
	}
	out := rows[:0]
	for _, c := range rows {
		if mayEnter(role, c.Private, isNamed[c.ID]) {
			out = append(out, c)
		}
	}
	return out, nil
}

// handleLive is what is running in the crew right now (#2438): one entry per
// session counting down, running or paused, in the voice channels the caller
// may enter — a session in a private channel is that channel's to show.
func (s *Service) handleLive(w http.ResponseWriter, r *http.Request) {
	crewID, user, role, ok := s.crewFor(w, r)
	if !ok {
		return
	}
	rows, err := s.enterable(r.Context(), crewID, user.ID, role)
	if err != nil {
		httpx.Fail(w, s.log, "list live sessions failed", err, "What is running could not be loaded.", "crew", store.UUIDString(crewID))
		return
	}
	out := []protocol.LiveSession{}
	for _, c := range rows {
		if c.Kind != kindVoice || s.live == nil {
			continue
		}
		if live, running := s.live.LiveSession(store.UUIDString(c.ID)); running {
			out = append(out, live)
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"sessions": out})
}
