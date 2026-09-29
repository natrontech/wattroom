// Package account is export-all and delete (#35): the two ends of the locked
// privacy promise. Export hands the rider everything as a zip; delete purges
// the account and lets the schema's cascades take rides (sample blobs and the
// heart rate inside them — ADR-0008), sessions, identities, crew roles and
// medals with it, structurally rather than by cleanup job.
package account

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/inflight"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Sessions is what account needs from auth: who is asking, and the ability to
// end their session after the purge.
type Sessions interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// Alerter is what account needs from notify: the receipt for a purge (#840,
// ADR-0030). Absent — no mail capability on this server — the deletion simply
// goes unannounced, the same capability gating the rest of the app uses.
type Alerter interface {
	AccountDeleted(user db.User)
}

// CrewReleaser is what the purge needs from rooms (ADR-0038, second
// amendment): crews.owner_id is ON DELETE RESTRICT, so every crew the rider
// owns is handed on or removed before the row goes. Inside the purge's own
// transaction, so a transfer that fails leaves the account exactly as it was.
// What it hands back runs after the commit: the successors' open sockets
// taking their new role (#2808).
type CrewReleaser interface {
	ReleaseCrews(ctx context.Context, q *db.Queries, user pgtype.UUID) (handedOn func(context.Context), err error)
}

// GrantRevoker hands a third-party grant back — the seam auth uses for a
// disconnect (server/internal/strava). A purge that dropped our row while
// Strava still listed the app told the rider something untrue (#1825).
type GrantRevoker interface {
	RevokeGrant(ctx context.Context, ident db.Identity) error
}

// Live is the hub, as far as a purge reaches it (#2807): the cascade takes
// the sessions, and closes none of the sockets or calls they opened.
type Live interface {
	DropUser(userID string, keep []byte)
}

type Service struct {
	store    *store.Store
	sessions Sessions
	log      *slog.Logger
	alerter  Alerter
	crews    CrewReleaser
	revoker  GrantRevoker
	reaper   BlobReaper
	live     Live
	// One export in flight per account (#1554). inflight.go.
	exports *inflight.Set
}

// SetStravaRevoker wires the uploader in after construction, like SetCrews.
// Absent, a delete still purges the row.
func (s *Service) SetStravaRevoker(r GrantRevoker) { s.revoker = r }

// BlobReaper takes uploaded audio off disk once no row points at it (#1897).
type BlobReaper interface {
	RemoveBlobs(shas []string)
}

// SetTrackReaper wires the tracks service in after construction, like the rest.
func (s *Service) SetTrackReaper(r BlobReaper) { s.reaper = r }

// SetLive wires the hub in after construction. Absent, a delete still purges
// the rows.
func (s *Service) SetLive(l Live) { s.live = l }

func New(st *store.Store, sessions Sessions, log *slog.Logger) *Service {
	return &Service{store: st, sessions: sessions, log: log, exports: &inflight.Set{}}
}

// SetAlerter wires the notify capability in after construction, the shape
// auth.SetMailer already uses.
func (s *Service) SetAlerter(a Alerter) { s.alerter = a }

// SetCrews wires the crew hand-over in; without it a rider who owns a crew
// cannot be purged, which the RESTRICT makes loud rather than silent.
func (s *Service) SetCrews(c CrewReleaser) { s.crews = c }

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/me/export", s.handleExport)
	mux.HandleFunc("DELETE /api/me", s.handleDelete)
}
