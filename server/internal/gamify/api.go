package gamify

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/me/trophies", s.handleMine)
	mux.HandleFunc("GET /api/riders/{id}/trophies", s.handleRider)
}

type xpJSON struct {
	Total        int64 `json:"total"`
	Rides        int64 `json:"rides"`
	Lounge       int64 `json:"lounge"`
	Sessions     int64 `json:"sessions"`
	Achievements int64 `json:"achievements"`
}

// medalsJSON counts by docs/SPEC.md's kinds — the only medals WattRoom has.
type medalsJSON struct {
	Diesel        int64 `json:"diesel"`
	Metronome     int64 `json:"metronome"`
	Hammer        int64 `json:"hammer"`
	LanterneRouge int64 `json:"lanterneRouge"`
}

type progressJSON struct {
	Have int `json:"have"`
	Need int `json:"need"`
}

type achievementJSON struct {
	Key      string `json:"key"`
	EarnedAt string `json:"earnedAt,omitempty"`
	// Absent once earned, and for the ride achievements, which have no count.
	Progress *progressJSON `json:"progress,omitempty"`
}

// Response is the trophy case: where the XP came from, the energy behind
// it, the medals, and every catalogue entry with how far along it is.
type Response struct {
	Xp           xpJSON            `json:"xp"`
	EnergyKj     int64             `json:"energyKj"`
	Medals       medalsJSON        `json:"medals"`
	Achievements []achievementJSON `json:"achievements"`
}

// Trophies assembles one rider's trophy case.
func (s *Service) Trophies(ctx context.Context, userID pgtype.UUID) (Response, error) {
	t, err := s.tally(ctx, userID)
	if err != nil {
		return Response{}, err
	}
	out := Response{
		Xp: xpJSON{
			Rides:        t.rideXp,
			Lounge:       t.bySource[sourceLounge].Amount,
			Sessions:     t.bySource[sourceSession].Amount,
			Achievements: t.bySource[sourceAchievement].Amount,
		},
		EnergyKj: t.kj,
		Medals: medalsJSON{
			Diesel: t.medals["diesel"], Metronome: t.medals["metronome"],
			Hammer: t.medals["hammer"], LanterneRouge: t.medals["lanterne_rouge"],
		},
		Achievements: make([]achievementJSON, 0, len(Catalogue)),
	}
	out.Xp.Total = out.Xp.Rides + out.Xp.Lounge + out.Xp.Sessions + out.Xp.Achievements
	for _, a := range Catalogue {
		entry := achievementJSON{Key: a.Key}
		if at, done := t.earned[a.Key]; done {
			entry.EarnedAt = at.Format(time.RFC3339)
		} else if have, counted := t.have(a.Key); counted {
			entry.Progress = &progressJSON{Have: have, Need: a.Need}
		}
		out.Achievements = append(out.Achievements, entry)
	}
	return out, nil
}

func (s *Service) handleMine(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Not signed in.")
		return
	}
	s.write(w, r, user.ID)
}

// handleRider shows another rider's case to the people who could already see
// them ride: room-mates and friends. Anyone else gets a 404, not a 403 — the
// id itself is not for confirming.
func (s *Service) handleRider(w http.ResponseWriter, r *http.Request) {
	viewer, ok := s.users.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Not signed in.")
		return
	}
	rider, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No rider by that id in your rooms or friends.")
		return
	}
	if rider != viewer.ID {
		shares, err := s.store.Queries.SharesRoomOrFriends(r.Context(),
			db.SharesRoomOrFriendsParams{Viewer: viewer.ID, Rider: rider})
		if err != nil {
			s.log.Error("trophies visibility check failed", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The trophy case could not be loaded.")
			return
		}
		if !shares {
			httpx.WriteError(w, http.StatusNotFound, "not_found", "No rider by that id in your rooms or friends.")
			return
		}
	}
	s.write(w, r, rider)
}

func (s *Service) write(w http.ResponseWriter, r *http.Request, userID pgtype.UUID) {
	out, err := s.Trophies(r.Context(), userID)
	if err != nil {
		s.log.Error("trophies failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The trophy case could not be loaded.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}
