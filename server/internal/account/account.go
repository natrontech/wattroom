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

type Service struct {
	store    *store.Store
	sessions Sessions
	log      *slog.Logger
}

func New(st *store.Store, sessions Sessions, log *slog.Logger) *Service {
	return &Service{store: st, sessions: sessions, log: log}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/me/export", s.handleExport)
	mux.HandleFunc("DELETE /api/me", s.handleDelete)
}

// handleExport streams a zip: profile.json, rides.json (summaries), and each
// ride's raw 1 Hz samples as its own JSON file, decompressed — an export the
// rider can open, not a database dump they cannot.
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

	for _, ride := range rides {
		name := fmt.Sprintf("samples/%s-%s.json",
			ride.StartedAt.Time.UTC().Format("2006-01-02-1504"), store.UUIDString(ride.ID)[:8])
		f, err := archive.Create(name)
		if err != nil {
			return
		}
		zr, err := gzip.NewReader(bytes.NewReader(ride.Samples))
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
	w.WriteHeader(http.StatusNoContent)
}
