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

// countsJSON is what the rider has done, as counts rather than as XP —
// tallies' four social counts plus the sessions they were in voice for.
//
// THE RIDER'S OWN ONLY. These are the same integers `have()` judges Lounge
// Lizard, DJ, Crew Chief and Sprint Snob from, so serving them to a room-mate
// would hand back precisely the progress ADR-0027 strips one field below —
// and, for a badge already earned, "the value that earned it", which that ADR
// forbids in the same breath. write() zeroes the struct for anyone else; see
// #1025 for the question of whether it should.
type countsJSON struct {
	VoiceMinutes int64 `json:"voiceMinutes"`
	// Group sessions the rider was in voice for at least half of — what
	// events.go actually records, and not the same thing as sessions ridden.
	VoiceSessions int64 `json:"voiceSessions"`
	Coached       int64 `json:"coached"`
	SprintWins    int64 `json:"sprintWins"`
	TracksPlayed  int64 `json:"tracksPlayed"`
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
	Counts       countsJSON        `json:"counts"`
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
			// Riding XP is the rides still here plus the rides that were
			// ridden and then deleted (#1452, ADR-0047) — both are work done
			// on a bike, and adding the offsetting rows here is what keeps
			// this hand-summed Total equal to `user_total_xp`, which is what
			// every level on every other surface is computed from.
			Rides:        t.rideXp + t.bySource[sourceRideDeleted].Amount,
			Lounge:       t.bySource[sourceLounge].Amount,
			Sessions:     t.bySource[sourceSession].Amount,
			Achievements: t.bySource[sourceAchievement].Amount,
		},
		Counts: countsJSON{
			VoiceMinutes:  t.voiceMinutes(),
			VoiceSessions: t.voiceSessions(),
			Coached:       t.coached(),
			SprintWins:    t.sprintWins(),
			TracksPlayed:  t.tracksPlayed(),
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
	// RequireUser (#1983): User() treats a database failure as signed-out,
	// and "unauthorized" is the one code the app never retries.
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	s.write(w, r, user.ID, user.ID)
}

// handleRider shows another rider's case to the people who could already see
// them ride: room-mates and friends. Anyone else gets a 404, not a 403 — the
// id itself is not for confirming.
func (s *Service) handleRider(w http.ResponseWriter, r *http.Request) {
	viewer, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
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
			httpx.Fail(w, s.log, "trophies visibility check failed", err, "The trophy case could not be loaded.")
			return
		}
		if !shares {
			httpx.WriteError(w, http.StatusNotFound, "not_found", "No rider by that id in your rooms or friends.")
			return
		}
	}
	s.write(w, r, rider, viewer.ID)
}

// write renders a trophy case. self says whether the viewer IS the rider:
// progress toward an unearned badge is the rider's own business (ADR-0027),
// and this endpoint used to hand "3 of 5 rides before 07:00" to any
// room-mate. An earned badge is a fact about a rider and travels; how far
// along they are on the rest is their current week, and does not.
func (s *Service) write(w http.ResponseWriter, r *http.Request, userID, viewer pgtype.UUID) {
	out, err := s.Trophies(r.Context(), userID)
	if err != nil {
		httpx.Fail(w, s.log, "trophies failed", err, "The trophy case could not be loaded.")
		return
	}
	self := userID == viewer
	if !self {
		// A medal stays in the room it was won in (ADR-0024, ADR-0027): the
		// tally used to be lifetime, across every room, which told a
		// room-mate you ride in rooms they cannot see (#1649). The rider
		// endpoint scopes the same medals; this is that query.
		shared, err := s.store.Queries.CountRiderMedalsInCommon(r.Context(),
			db.CountRiderMedalsInCommonParams{Rider: userID, Viewer: viewer})
		if err != nil {
			httpx.Fail(w, s.log, "scoped medal tally failed", err, "The trophy case could not be loaded.")
			return
		}
		out.Medals = medalsJSON{}
		for _, row := range shared {
			switch row.Kind {
			case "diesel":
				out.Medals.Diesel = row.Count
			case "metronome":
				out.Medals.Metronome = row.Count
			case "hammer":
				out.Medals.Hammer = row.Count
			case "lanterne_rouge":
				out.Medals.LanterneRouge = row.Count
			}
		}
		for i := range out.Achievements {
			out.Achievements[i].Progress = nil
		}
		// The counts ARE that progress for the four social badges — the same
		// integers, from the same map — so stripping one and not the other
		// would leave the strip above decorative (#993 review).
		out.Counts = countsJSON{}
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}
