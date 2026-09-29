package friends

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// acrossHidden settles an ask between a hidden pair before it is made
// (#3202). The rider who hid the other is told why, with the way back. The
// rider who was hidden is never told: their ask is stored and answered as any
// sent request is, and stays pending in front of them — it never reaches the
// other side's list (`friendship_visible`). otherHid says the ask is that one,
// so a row that already stood between them is not answered with a conflict
// either.
func (s *Service) acrossHidden(w http.ResponseWriter, r *http.Request, me, target pgtype.UUID) (otherHid, ok bool) {
	hid, err := s.store.Queries.HiddenBetween(r.Context(), db.HiddenBetweenParams{Viewer: me, Other: target})
	if err != nil {
		httpx.Fail(w, s.log, "hidden lookup", err, "The request could not be sent. Try again.", "user", store.UUIDString(me))
		return false, false
	}
	if hid.ViewerHid {
		httpx.WriteError(w, http.StatusConflict, "conflict",
			"You hid this rider. Show them again from Hidden riders in Settings first.")
		return false, false
	}
	return hid.OtherHid, true
}
