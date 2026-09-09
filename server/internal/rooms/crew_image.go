package rooms

import (
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// A crew's logo (#1237): one small blob on the crew row, set by the owner or
// an admin, drawn by the switcher, the crew page and the door before the icon
// or the initial. Members read it by id; the door reads it by code, since the
// person at the door is not in the crew yet.

// crewImageURL is the one place the address is written. Empty when there is
// no image, so a client draws the icon and never a broken <img>.
func crewImageURL(id pgtype.UUID, has bool) string {
	if !has {
		return ""
	}
	return "/api/crews/" + store.UUIDString(id) + "/image"
}

func crewDoorImageURL(code string, has bool) string {
	if !has {
		return ""
	}
	return "/api/crew-doors/" + code + "/image"
}

// handleSetCrewImage: the same trust boundary as a pasted chat image — bounded
// read, type sniffed from the bytes, four types.
func (s *Service) handleSetCrewImage(w http.ResponseWriter, r *http.Request) {
	crew, _, role, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	if !administers(role) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Only the crew's owner or an admin can change its picture.")
		return
	}
	data, mime, ok := httpx.ReadImageUpload(w, r)
	if !ok {
		return
	}
	if err := s.store.Queries.SetCrewImage(r.Context(), db.SetCrewImageParams{ID: crew.ID, ImageMime: &mime, Image: data}); err != nil {
		s.log.Error("crew image save failed", "err", err, "crew", store.UUIDString(crew.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The picture could not be saved.")
		return
	}
	s.changed()
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"imageUrl": crewImageURL(crew.ID, true)})
}

func (s *Service) handleClearCrewImage(w http.ResponseWriter, r *http.Request) {
	crew, _, role, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	if !administers(role) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Only the crew's owner or an admin can change its picture.")
		return
	}
	if err := s.store.Queries.ClearCrewImage(r.Context(), crew.ID); err != nil {
		s.log.Error("crew image clear failed", "err", err, "crew", store.UUIDString(crew.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The picture could not be removed.")
		return
	}
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}

// handleCrewImage serves the logo to the crew's people.
func (s *Service) handleCrewImage(w http.ResponseWriter, r *http.Request) {
	crew, _, _, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	s.serveCrewImage(w, r, crew.ID)
}

// handleCrewDoorImage serves it to whoever holds the code — the door shows
// the crew's face before the join, and the code is the secret that gates it.
func (s *Service) handleCrewDoorImage(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(strings.TrimSpace(r.PathValue("code")))
	crew, err := s.store.Queries.GetCrewByCode(r.Context(), &code)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			s.log.Error("crew door image lookup failed", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The image could not be loaded.")
			return
		}
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such image.")
		return
	}
	s.serveCrewImage(w, r, crew.ID)
}

func (s *Service) serveCrewImage(w http.ResponseWriter, r *http.Request, id pgtype.UUID) {
	img, err := s.store.Queries.GetCrewImage(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && img.ImageMime == nil) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such image.")
		return
	}
	if err != nil {
		s.log.Error("crew image read failed", "err", err, "crew", store.UUIDString(id))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The picture could not be loaded.")
		return
	}
	httpx.ServeImage(w, r, *img.ImageMime, img.Image, img.ImageSetAt.Time)
}
