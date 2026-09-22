package crews

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The public crew directory (ADR-0039 as amended by ADR-0058, #2445) and the
// share card a /c/{code} link unfurls to.

// directoryPageSize is one screenful. A list rather than a search (ux.md's
// 95% rule applies to a search box too), and paged rather than unbounded so
// the route cannot become a way to enumerate the instance in one request.
const directoryPageSize = 50

// maxDirectoryOffset keeps ?offset= inside int32 (audit 2026-09-09): past
// it, the narrowing wrapped negative and Postgres refused the read.
const maxDirectoryOffset = 1_000_000

// crewDirectoryEntryJSON is one crew in the directory: a name, a mark and a
// link — ADR-0039's entry rule, carried to the crew by ADR-0058. The code is
// the link, since the door is the only way in; the columns are the
// disclosure decision (see ListListedCrews).
type crewDirectoryEntryJSON struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	Icon     string `json:"icon,omitempty"`
	ImageURL string `json:"imageUrl,omitempty"`
}

// handleCrewDirectory lists crews whose admins chose to be findable.
//
// Signed in, because everything in WattRoom is (ADR-0009) — "opt-in public"
// means opt-in to every rider on the instance, not to the web. A listing
// widens DISCOVERY: what it hands out is the door, and the door's gates —
// a ban survives the code — are the ones every other holder of it meets.
func (s *Service) handleCrewDirectory(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.users.RequireUser(w, r, "Sign in to browse crews."); !ok {
		return
	}
	offset := 0
	if n, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && n > 0 {
		offset = min(n, maxDirectoryOffset)
	}
	rows, err := s.store.Queries.ListListedCrews(r.Context(), db.ListListedCrewsParams{
		Lim: directoryPageSize, Off: int32(offset), //nolint:gosec // offset clamped above
	})
	if err != nil {
		httpx.Fail(w, s.log, "crew directory failed", err, "The directory could not be loaded.")
		return
	}
	out := make([]crewDirectoryEntryJSON, 0, len(rows))
	for _, row := range rows {
		code := *row.Code // the query skips crews without one
		out = append(out, crewDirectoryEntryJSON{
			Code: code, Name: row.Name, Icon: row.Icon, ImageURL: crewDoorImageURL(code, row.HasImage),
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"crews": out})
}

// CrewCard is what a shared /c/{code} link may say about a crew: its name and
// picture, which is exactly what GET /api/crew-doors/{code} tells anyone
// holding the code, session or not. Listed or not — the code is the invite,
// and a link that carries it was shared on purpose.
func (s *Service) CrewCard(ctx context.Context, code string) (name string, image []byte, ok bool) {
	code = strings.ToUpper(strings.TrimSpace(code))
	row, err := s.store.Queries.GetCrewCardByCode(ctx, &code)
	if err != nil {
		return "", nil, false
	}
	return row.Name, row.Image, true
}
