// Package account is export-all and delete (#35): the two ends of the locked
// privacy promise. Export hands the rider everything as a zip; delete purges
// the account and lets the schema's cascades take rides (sample blobs and the
// heart rate inside them — ADR-0008), sessions, identities, memberships and
// medals with it, structurally rather than by cleanup job.
package account

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/natrontech/wattroom/server/internal/httpx"
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

type Service struct {
	store    *store.Store
	sessions Sessions
	log      *slog.Logger
	alerter  Alerter
}

func New(st *store.Store, sessions Sessions, log *slog.Logger) *Service {
	return &Service{store: st, sessions: sessions, log: log}
}

// SetAlerter wires the notify capability in after construction, the shape
// auth.SetMailer already uses.
func (s *Service) SetAlerter(a Alerter) { s.alerter = a }

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/me/export", s.handleExport)
	mux.HandleFunc("DELETE /api/me", s.handleDelete)
}

// handleExport streams a zip of everything WattRoom holds about the rider —
// an export they can open, not a database dump they cannot.
//
// The scope is not a product choice (#696). Two rights apply and they differ:
//
//   - Access — GDPR Art. 15, revFADP Art. 25 — covers everything the
//     controller holds about the person, including what we derived (XP,
//     trophies). No machine-readable format is required, only an intelligible
//     one; the deadline is one month (GDPR Art. 12(3)) / 30 days (FADP
//     Art. 25(7)).
//   - Portability — GDPR Art. 20, revFADP Art. 28 — is narrower: data the
//     rider PROVIDED, processed automatically on consent or a contract, and it
//     must be "structured, commonly used and machine-readable". WP29's
//     WP242rev.01 reads "provided" as covering observed data (what they did
//     here), not inferred data.
//
// This export satisfies both by being the wider one in the stricter format:
// every category below as indented JSON in a zip, served immediately.
//
// Third-party data is the hard part, and the rule here is: EXPORT ONLY WHAT
// THE RIDER CAN ALREADY SEE IN THE APP, attributed by display name and
// nothing else. GDPR Art. 20(4) says the right "shall not adversely affect
// the rights and freedoms of others", and WP29 warns equally against reading
// that so strictly that anything touching another person is withheld. So:
// their own room-chat lines but not the room's (someone else's line is that
// person's data, not theirs); whole DM threads, which are as much about them
// as about the peer and which they can already read; a friend's display name
// but never their email, id, or a single watt of anyone else's ride.
//
// Not legal advice — a lawyer should confirm the reading before it is relied
// on. The provisions are cited so the next person can check rather than
// re-derive.
func (s *Service) handleExport(w http.ResponseWriter, r *http.Request) {
	user, ok := s.sessions.RequireUser(w, r, "Sign in to export your data.")
	if !ok {
		return
	}
	rides, err := s.store.Queries.ListUserRidesFull(r.Context(), user.ID)
	if err != nil {
		s.log.Error("export query failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The export could not be built. Try again.")
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf("attachment; filename=%q", "wattroom-export-"+time.Now().UTC().Format("2006-01-02")+".zip"))
	archive := zip.NewWriter(w)
	defer func() { _ = archive.Close() }()

	writeJSON := func(name string, v any) bool {
		f, err := archive.Create(name)
		if err != nil {
			return false
		}
		enc := json.NewEncoder(f)
		enc.SetIndent("", "  ")
		return enc.Encode(v) == nil
	}

	profile := map[string]any{
		"displayName":   user.DisplayName,
		"ftpWatts":      user.FtpWatts,
		"weightKg":      user.WeightKg,
		"createdAt":     user.CreatedAt.Time,
		"email":         user.Email,
		"notifyPlanned": user.NotifyPlanned,
		"accentPalette": user.AccentPalette,
		"colorScheme":   user.ColorScheme,
	}
	if !writeJSON("profile.json", profile) {
		return
	}

	summaries := make([]map[string]any, 0, len(rides))
	for _, ride := range rides {
		summaries = append(summaries, map[string]any{
			"workoutName": ride.WorkoutName,
			"startedAt":   ride.StartedAt.Time,
			"seconds":     ride.Seconds,
			"avgWatts":    ride.AvgWatts,
			"kj":          ride.Kj,
			"execution":   ride.Execution,
			"ftpWatts":    ride.FtpWatts,
			"xp":          ride.Xp,
			"curve":       json.RawMessage(ride.Curve),
		})
	}
	if !writeJSON("rides.json", summaries) {
		return
	}

	// Everything else the account holds (#696). One query per category, each
	// user-scoped and each mapped to the keys a person reads rather than the
	// column names a database uses — this is a file the rider opens. A
	// category that fails to read loses itself, not the export: someone
	// entitled to their data should get what we could gather, not a 500.
	for _, cat := range []struct {
		name string
		rows func() (any, error)
	}{
		{"chat.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserChat(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserChatRow) any {
				return map[string]any{"room": row.RoomName, "roomSlug": row.RoomSlug,
					"text": row.Text, "at": row.CreatedAt.Time}
			})
		}},
		{"messages.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserDms(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserDmsRow) any {
				return map[string]any{"with": row.PeerName, "fromMe": row.SentByMe,
					"text": row.Text, "at": row.CreatedAt.Time}
			})
		}},
		{"friends.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserFriends(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserFriendsRow) any {
				return map[string]any{"name": row.PeerName, "iAsked": row.IAsked,
					"status": row.Status, "since": row.CreatedAt.Time}
			})
		}},
		{"playlists.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserPlaylists(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserPlaylistsRow) any {
				return map[string]any{"name": row.Name, "createdAt": row.CreatedAt.Time,
					"tracks": json.RawMessage(row.Tracks)}
			})
		}},
		{"planned-sessions.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserRsvps(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserRsvpsRow) any {
				return map[string]any{"room": row.RoomName, "workoutName": row.WorkoutName,
					"startsAt": row.StartsAt.Time, "saidYesAt": row.CreatedAt.Time}
			})
		}},
		{"rooms.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserRooms(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserRoomsRow) any {
				return map[string]any{"name": row.Name, "slug": row.Slug,
					"role": row.Role, "joinedAt": row.JoinedAt.Time}
			})
		}},
		{"workouts.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserWorkouts(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserWorkoutsRow) any {
				return map[string]any{"name": row.Name, "author": row.Author,
					"createdAt": row.CreatedAt.Time, "workout": json.RawMessage(row.Definition)}
			})
		}},
		{"xp.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserXp(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserXpRow) any {
				return map[string]any{"amount": row.Amount, "source": row.Source,
					"about": row.Ref, "at": row.At.Time}
			})
		}},
		{"trophies.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserAchievements(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserAchievementsRow) any {
				return map[string]any{"trophy": row.Key, "earnedAt": row.EarnedAt.Time}
			})
		}},
	} {
		rows, err := cat.rows()
		if err != nil {
			s.log.Error("export category failed", "category", cat.name, "err", err)
			continue
		}
		if !writeJSON(cat.name, rows) {
			return
		}
	}

	// One blob at a time: read, stream into the zip, let it go. Held together
	// in one slice, a rider's whole history is in memory at once — and that
	// number grows every month they keep riding (#894).
	for _, ride := range rides {
		blob, err := s.store.Queries.GetRideSamples(r.Context(), db.GetRideSamplesParams{
			ID: ride.ID, UserID: user.ID,
		})
		if err != nil {
			continue // one unreadable ride loses its samples, not the export
		}
		name := fmt.Sprintf("samples/%s-%s.json",
			ride.StartedAt.Time.UTC().Format("2006-01-02-1504"), store.UUIDString(ride.ID)[:8])
		f, err := archive.Create(name)
		if err != nil {
			return
		}
		zr, err := gzip.NewReader(bytes.NewReader(blob))
		if err != nil {
			continue // a corrupt blob loses one ride's samples, not the export
		}
		// The blob was written by us and is size-bounded at write time; copy is fine.
		_, _ = io.Copy(f, zr) //nolint:gosec // own bounded data
		_ = zr.Close()
	}
}

// handleDelete is the purge. The confirmation lives client-side (a typed
// phrase); the server's job is to be certain who is asking and delete once.
func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	user, ok := s.sessions.RequireUser(w, r, "Sign in first.")
	if !ok {
		return
	}
	if err := s.store.Queries.DeleteUser(r.Context(), user.ID); err != nil {
		s.log.Error("account delete failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The deletion did not complete. Nothing was removed — try again.")
		return
	}
	// Log the fact, never the identity details: the account is gone.
	s.log.Info("account deleted", "user", store.UUIDString(user.ID))
	// The receipt goes to the address on the row read before the purge — after
	// it there is no row, and the mail would have no recipient. Fire-and-forget
	// inside notify, so a mail provider cannot fail a deletion that already
	// committed.
	if s.alerter != nil {
		s.alerter.AccountDeleted(user)
	}
	w.WriteHeader(http.StatusNoContent)
}

// mapRows turns a query's rows into the shape the export writes: the reader's
// vocabulary, not the schema's. An empty result is an empty array rather than
// null — a rider with no playlists should read "none", not "unknown".
func mapRows[R any](rows []R, err error, one func(R) any) (any, error) {
	if err != nil {
		return nil, err
	}
	out := make([]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, one(row))
	}
	return out, nil
}
