package crews

import (
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The crew's door (ADR-0038 amended, #1236): what a share link shows, the
// join by code, and leaving. Split from crews.go (#1234).

// handleCrewDoor is what a share link shows before the join (#1236): the
// crew's name and icon, and nothing else — not its id, not its channels, not
// its people, and not how many of them there are. ADR-0038's amendment authorises
// the name and what joining shows; ADR-0039 refused a headcount to a stranger
// as "a separate disclosure", and the count shipped here anyway (#1399). A
// code is a secret, so an unknown one and a malformed one read the same.
func (s *Service) handleCrewDoor(w http.ResponseWriter, r *http.Request) {
	if s.throttleDoor(w, r) {
		return
	}
	code := strings.ToUpper(strings.TrimSpace(r.PathValue("code")))
	crew, err := s.store.Queries.GetCrewByCode(r.Context(), &code)
	if err != nil {
		// A wrong code and a database that could not be asked are different
		// answers: the second used to read as the first, which hid the
		// client's own retry (audit 2026-09-09).
		if !errors.Is(err, pgx.ErrNoRows) {
			httpx.Fail(w, s.log, "crew door lookup failed", err, "The door could not be opened. Try again.")
			return
		}
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No crew has that code. Check it with whoever shared it.")
		return
	}
	// Whether the crew keeps a weekly board (ADR-0036 as amended by
	// ADR-0058): the one crew surface that publishes a number from one
	// member's rides, so the door says so before anyone walks in (#1651).
	// Only the fact — the rows stay behind the membership.
	out := map[string]any{
		"name": crew.Name, "icon": crew.Icon,
		"imageUrl":     crewDoorImageURL(code, crew.HasImage),
		"boardEnabled": crew.BoardEnabled,
	}
	// Someone already in the crew who follows its own link again gets the
	// way in rather than a Join that would do nothing: the id and the
	// headcount are theirs to know, and only then — the roster on the crew's
	// own page shows both already.
	if user, signedIn := s.users.User(r); signedIn {
		role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: crew.ID, UserID: user.ID})
		switch {
		case err != nil:
		case role == "banned":
			// Said at the door rather than on the click: a ban survives the
			// code (docs/SPEC.md), so the Join it withholds would only have
			// been refused (audit 2026-09-09).
			out["banned"] = true
		case role != "":
			out["inCrew"] = true
			out["id"] = store.UUIDString(crew.ID)
			out["members"], _ = s.store.Queries.CountCrewMembers(r.Context(), crew.ID)
		default:
			// A signed-in stranger at the door holds an invite (#2144). The
			// read used to record it here; it says so instead, and the client
			// posts the remember below — a GET that wrote let any page set a
			// rider's pending invite by linking them at it (#2248).
			out["invited"] = true
		}
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// handleRememberCrewDoor keeps the invite the door just showed (#2144) on the
// account, because the tab holding the deep link is not the tab a new
// account's email confirmation opens. /api/me hands it back while the rider is
// in no crew, and the join clears it.
//
// It is a POST because it writes (#2248). RequireUser only asks for the Origin
// on a mutating verb — a SameSite=Lax cookie rides a cross-site top-level
// navigation — so the same write on the door's GET was one any page could
// perform for a signed-in rider by linking them at it, steering which crew a
// brand-new account is pointed at after sign-up.
func (s *Service) handleRememberCrewDoor(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to keep this invite.")
	if !ok {
		return
	}
	if s.throttleDoor(w, r) {
		return
	}
	code := strings.ToUpper(strings.TrimSpace(r.PathValue("code")))
	crew, err := s.store.Queries.GetCrewByCode(r.Context(), &code)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			httpx.Fail(w, s.log, "crew door lookup failed", err, "The invite could not be kept. Try again.")
			return
		}
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No crew has that code. Check it with whoever shared it.")
		return
	}
	role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: crew.ID, UserID: user.ID})
	if err != nil {
		httpx.Fail(w, s.log, "crew role lookup failed", err, "The invite could not be kept. Try again.", "crew", store.UUIDString(crew.ID))
		return
	}
	if role != "" {
		// Nothing to keep: a member is already in, and a banned rider is not
		// coming in. Not a refusal either — the door said so first.
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := s.store.Queries.SetPendingCrewCode(r.Context(), db.SetPendingCrewCodeParams{ID: user.ID, PendingCrewCode: &code}); err != nil {
		httpx.Fail(w, s.log, "pending crew invite not recorded", err, "The invite could not be kept. Try again.", "crew", store.UUIDString(crew.ID))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleJoinCrew is the one way in (ADR-0038 amended, #1236). Joining stores
// a member row and nothing else: metrics stay visible only to people who
// actually enter a voice channel, and a new member has entered none yet. A
// ban is a row too and wins the conflict, so a banned rider is refused, not
// readmitted.
func (s *Service) handleJoinCrew(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to join a crew.")
	if !ok {
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	if s.throttleDoor(w, r) {
		return
	}
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	crew, err := s.store.Queries.GetCrewByCode(r.Context(), &code)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			httpx.Fail(w, s.log, "crew code lookup failed", err, "Joining did not work. Try again.")
			return
		}
		// A crew's code is six characters; a friend code is eight
		// (friends.go), and the one pasted into the wrong box is a friend's.
		if len(code) == 8 {
			httpx.WriteFieldError(w, http.StatusNotFound, "not_found", "That looks like a friend code — friends are added on the Friends page. A crew's code is six characters.", "code")
			return
		}
		httpx.WriteFieldError(w, http.StatusNotFound, "not_found", "No crew has that code. Check it with whoever shared it.", "code")
		return
	}
	role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: crew.ID, UserID: user.ID})
	if err != nil {
		httpx.Fail(w, s.log, "crew role lookup failed", err, "Joining did not work. Try again.", "crew", store.UUIDString(crew.ID))
		return
	}
	if role == "banned" {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "This crew removed you.")
		return
	}
	if role == "" {
		if err := s.store.Queries.JoinCrew(r.Context(), db.JoinCrewParams{CrewID: crew.ID, UserID: user.ID}); err != nil {
			httpx.Fail(w, s.log, "crew join failed", err, "Joining did not work. Try again.", "crew", store.UUIDString(crew.ID))
			return
		}
		s.log.Info("crew joined", "crew", store.UUIDString(crew.ID), "rider", store.UUIDString(user.ID))
		// The invite is answered (#2144): a rider who leaves again must not
		// be sent back to this door from every landing.
		_ = s.store.Queries.SetPendingCrewCode(r.Context(), db.SetPendingCrewCodeParams{ID: user.ID})
		s.changed()
		// The role AFTER the join: the row just written (audit 2026-09-09).
		role = "member"
	}
	httpx.WriteJSON(w, http.StatusOK, crewRefJSON{Id: store.UUIDString(crew.ID), Name: crew.Name, Icon: crew.Icon, Role: role})
}

// handleLeaveCrew takes the member row and the private channels the rider was
// named into in one move (#1228, #1236). The owner cannot leave — a crew is
// never ownerless — so they hand it on first (#1208). Sockets in the crew's
// voice channels are severed the way a ban severs them.
//
// One transaction (#2079): a leave that failed halfway left a rider with a
// crew role and none of what it opens, or the reverse. The last one out of a
// crew with nothing left in it takes the crew in the same transaction
// (DeleteCrewIfEmpty, #2837) — a crew with a channel never goes this way,
// because its channels are what it holds (ADR-0058, #2502).
//
// The evictions stay AFTER the commit: they close live sockets, which no
// rollback can reopen.
func (s *Service) handleLeaveCrew(w http.ResponseWriter, r *http.Request) {
	crew, user, role, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	if role == "owner" {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "You own this crew — hand it to someone first, then leave.")
		return
	}
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		httpx.Fail(w, s.log, "crew leave begin failed", err, "Leaving did not work. Try again.", "crew", store.UUIDString(crew.ID))
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	q := s.store.Queries.WithTx(tx)
	// The voice channels to sever the rider from once this commits.
	voice, _ := q.ListChannelIDsOfKind(r.Context(), db.ListChannelIDsOfKindParams{CrewID: crew.ID, Kind: "voice"})
	err = q.LeaveCrewChannels(r.Context(), db.LeaveCrewChannelsParams{CrewID: crew.ID, UserID: user.ID})
	if err == nil {
		err = q.LeaveCrewRole(r.Context(), db.LeaveCrewRoleParams{CrewID: crew.ID, UserID: user.ID})
	}
	var swept int64
	if err == nil {
		swept, err = q.DeleteCrewIfEmpty(r.Context(), crew.ID)
	}
	if err != nil {
		httpx.Fail(w, s.log, "crew leave failed", err, "Leaving did not work. Try again.", "crew", store.UUIDString(crew.ID))
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Fail(w, s.log, "crew leave commit failed", err, "Leaving did not work. Try again.", "crew", store.UUIDString(crew.ID))
		return
	}
	// Durable rows gone; the sockets are the hub's and close after the commit
	// — a rollback cannot reopen one.
	for _, id := range voice {
		s.evict(store.UUIDString(id), store.UUIDString(user.ID))
	}
	s.log.Info("crew left", "crew", store.UUIDString(crew.ID), "rider", store.UUIDString(user.ID), "crewDeleted", swept > 0)
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}
