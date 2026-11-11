package rides

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/tokens"
)

// The photos a rider takes on a ride (docs/spec/riding.md "The ride's
// pictures"): the world drawn at a moment they chose with the phone remote's
// Photo, the O key or a controller's snap. The riding screen draws them as
// the world closes and puts them here once the ride is saved, so the ride's
// page offers them after it, on the phone as on the desk.
//
// They follow the ride: owner-only on every read, absent rather than
// forbidden to anyone else, and gone with the ride. A shared ride carries
// numbers (WATTROOM.md), so sharing a ride with friends shares no photo.

// photoViews are the two pictures of one photo, as the closing card names
// them: you on the road, and the same moment from the Overhead camera.
var photoViews = map[string]bool{"world": true, "overhead": true}

func (s *Service) registerPhotos(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/rides/{id}/photos", s.handleListPhotos)
	mux.HandleFunc("PUT /api/rides/{id}/photos/{n}/{view}", s.handlePutPhoto)
	mux.HandleFunc("GET /api/rides/{id}/photos/{n}/{view}", s.handleGetPhoto)
	mux.HandleFunc("DELETE /api/rides/{id}/photos/{n}", s.handleDeletePhoto)
}

type photoJSON struct {
	N     int      `json:"n"`
	Views []string `json:"views"`
	// When it reached the server, which is when the ride's page could first show it.
	SavedAt string `json:"savedAt"`
}

// photoTarget reads the ride, the photo's number and, when the route has one,
// its view off the path, answering the request itself when any is not one.
// A personal token is refused first: a photo is drawn from the ride's road,
// and route geometry never reaches an AI (ADR-0063), which is who reads
// through a token.
func (s *Service) photoTarget(w http.ResponseWriter, r *http.Request, withView bool) (db.User, pgtype.UUID, int16, string, bool) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return db.User{}, pgtype.UUID{}, 0, "", false
	}
	if tokens.Bearer(r) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden",
			"A personal token reads ride summaries only — a ride's photos stay on your account.")
		return db.User{}, pgtype.UUID{}, 0, "", false
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a ride id.")
		return db.User{}, pgtype.UUID{}, 0, "", false
	}
	var n int16
	if raw := r.PathValue("n"); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 16)
		if err != nil || v < 1 || v > protocol.MaxRidePhotos {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				fmt.Sprintf("A ride keeps up to %d photos, numbered 1 to %d.", protocol.MaxRidePhotos, protocol.MaxRidePhotos), "n")
			return db.User{}, pgtype.UUID{}, 0, "", false
		}
		n = int16(v)
	}
	view := r.PathValue("view")
	if withView && !photoViews[view] {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A photo has two views: world and overhead.", "view")
		return db.User{}, pgtype.UUID{}, 0, "", false
	}
	return user, id, n, view, true
}

func (s *Service) handleListPhotos(w http.ResponseWriter, r *http.Request) {
	user, id, _, _, ok := s.photoTarget(w, r, false)
	if !ok {
		return
	}
	// Asked of the ride first, so a ride that is not yours is a 404 and
	// not an empty list that would confirm nothing yet say nothing either.
	own, err := s.store.Queries.RideIsOwn(r.Context(), db.RideIsOwnParams{RideID: id, UserID: user.ID})
	if err != nil {
		httpx.Fail(w, s.log, "ride photos read failed", err, "The ride's photos could not be loaded.", "ride", store.UUIDString(id))
		return
	}
	if !own {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That ride is not one of yours.")
		return
	}
	rows, err := s.store.Queries.ListRidePhotos(r.Context(), db.ListRidePhotosParams{RideID: id, UserID: user.ID})
	if err != nil {
		httpx.Fail(w, s.log, "ride photos read failed", err, "The ride's photos could not be loaded.", "ride", store.UUIDString(id))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"photos": photosOf(rows)})
}

// photosOf folds the rows, one per view, into one entry per photo in
// number order, dated by its latest view.
func photosOf(rows []db.ListRidePhotosRow) []photoJSON {
	out := []photoJSON{}
	for _, row := range rows {
		at := row.CreatedAt.Time.UTC().Format(time.RFC3339)
		if len(out) == 0 || out[len(out)-1].N != int(row.N) {
			out = append(out, photoJSON{N: int(row.N), Views: []string{}, SavedAt: at})
		}
		last := &out[len(out)-1]
		last.Views = append(last.Views, row.View)
		if at > last.SavedAt {
			last.SavedAt = at
		}
	}
	return out
}

func (s *Service) handlePutPhoto(w http.ResponseWriter, r *http.Request) {
	user, id, n, view, ok := s.photoTarget(w, r, true)
	if !ok {
		return
	}
	data, mime, ok := httpx.ReadImageUpload(w, r)
	if !ok {
		return
	}
	if mime != "image/jpeg" {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"A ride photo is a JPEG, as the world draws it.")
		return
	}
	held, err := s.store.Queries.RiderPhotoBytes(r.Context(), db.RiderPhotoBytesParams{
		UserID: user.ID, RideID: id, N: n, View: view,
	})
	if err != nil {
		httpx.Fail(w, s.log, "ride photo ceiling read failed", err, "The photo could not be saved. Try again.", "ride", store.UUIDString(id))
		return
	}
	if held+int64(len(data)) > protocol.MaxRiderPhotoBytes {
		httpx.WriteError(w, http.StatusConflict, "conflict",
			fmt.Sprintf("Your ride photos fill your %d MB. Delete some on older rides' pages to keep new ones.",
				protocol.MaxRiderPhotoBytes>>20))
		return
	}
	put, err := s.store.Queries.PutRidePhoto(r.Context(), db.PutRidePhotoParams{
		N: n, View: view, Bytes: data, SizeBytes: int32(len(data)), //nolint:gosec // bounded by MaxImageBytes
		RideID: id, UserID: user.ID,
	})
	if err != nil {
		httpx.Fail(w, s.log, "ride photo save failed", err, "The photo could not be saved. Try again.", "ride", store.UUIDString(id))
		return
	}
	if put == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That ride is not one of yours.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleGetPhoto(w http.ResponseWriter, r *http.Request) {
	user, id, n, view, ok := s.photoTarget(w, r, true)
	if !ok {
		return
	}
	row, err := s.store.Queries.GetRidePhoto(r.Context(), db.GetRidePhotoParams{
		RideID: id, UserID: user.ID, N: n, View: view,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That photo is not one of yours.")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "ride photo read failed", err, "That photo could not be loaded.", "ride", store.UUIDString(id))
		return
	}
	// The URL is stable and a retried upload replaces the bytes, so the
	// browser revalidates on the time they were saved.
	httpx.ServeImage(w, r, "image/jpeg", row.Bytes, row.CreatedAt.Time)
}

func (s *Service) handleDeletePhoto(w http.ResponseWriter, r *http.Request) {
	user, id, n, _, ok := s.photoTarget(w, r, false)
	if !ok {
		return
	}
	gone, err := s.store.Queries.DeleteRidePhoto(r.Context(), db.DeleteRidePhotoParams{RideID: id, UserID: user.ID, N: n})
	if err != nil {
		httpx.Fail(w, s.log, "ride photo delete failed", err, "The photo could not be deleted. It is still there — try again.", "ride", store.UUIDString(id))
		return
	}
	if gone == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That photo is not one of yours.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
