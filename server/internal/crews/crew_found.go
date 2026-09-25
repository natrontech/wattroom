package crews

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/natrontech/wattroom/server/internal/channels"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// cleanCrewName trims a crew name and reports whether it is one
// (docs/SPEC.md "Names"): 1 to MaxCrewNameChars characters, on one line.
func cleanCrewName(raw string) (string, bool) {
	name := strings.TrimSpace(raw)
	return name, name != "" && utf8.RuneCountInString(name) <= protocol.MaxCrewNameChars && !hasControl(name)
}

var crewNameRule = fmt.Sprintf("A crew name has to be 1-%d characters on one line.", protocol.MaxCrewNameChars)

var errFoundingCap = errors.New("founding cap reached")

// handleFoundCrew starts a crew by name (#2480): the caller owns it, and it
// opens with a text and a voice channel, so there is somewhere to talk and
// somewhere to ride from the first second. docs/SPEC.md caps founding at
// MaxFoundedCrews, counted with the rider's row locked in the transaction
// that inserts — room creation's lesson (#1413): a count read outside it
// lets a burst of parallel starts each see room for one more.
func (s *Service) handleFoundCrew(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to start a crew.")
	if !ok {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	name, ok := cleanCrewName(req.Name)
	if !ok {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", crewNameRule, "name")
		return
	}
	var crew db.Crew
	var err error
	// The code is the crew's invite (#1236) and the unique index is the check;
	// a collision aborts the transaction, so the whole founding retries.
	for attempt := 0; ; attempt++ {
		err = s.store.WithUserLocked(r.Context(), user.ID, func(q *db.Queries) error {
			founded, err := q.CountFoundedCrews(r.Context(), user.ID)
			if err != nil {
				return err
			}
			if founded >= protocol.MaxFoundedCrews {
				return errFoundingCap
			}
			code := randomCode(protocol.CrewCodeLen)
			crew, err = q.FoundCrew(r.Context(), db.FoundCrewParams{Name: name, OwnerID: user.ID, Code: &code})
			if err != nil {
				return err
			}
			return channels.OpenFirst(r.Context(), q, crew.ID)
		})
		if !isUniqueViolation(err) || attempt >= 3 {
			break
		}
	}
	if errors.Is(err, errFoundingCap) {
		httpx.WriteCeiling(w, fmt.Sprintf(
			"You already own the %d crews you founded — the most a rider starts. Hand one on to start another.",
			protocol.MaxFoundedCrews))
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "found crew failed", err, "The crew could not be started. Try again.", "user", store.UUIDString(user.ID))
		return
	}
	s.changed()
	httpx.WriteJSON(w, http.StatusCreated, crewRefJSON{
		Id: store.UUIDString(crew.ID), Name: crew.Name, Code: *crew.Code,
		Founded: true, Role: "owner", Named: true,
	})
}
