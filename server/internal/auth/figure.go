package auth

// The rider's figure (ADR-0073, #3342): build, height and skin, chosen on one
// skippable card and edited later in the garage (#3159). Never derived from
// weight (ADR-0048), never in the wardrobe (ADR-0069). A null field is the
// neutral figure's value, which the client owns.

import (
	"errors"
	"io"
	"net/http"
	"slices"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

var figureBuilds = []string{"slim", "athletic", "strong"}

// FigureChoice is what the rider picked; nil is "not chosen".
type FigureChoice struct {
	Build    *string `json:"build"`
	HeightCm *int    `json:"heightCm"`
	Skin     *int    `json:"skin"`
}

// FigureOf is exported because the account export carries it as the row holds it.
func FigureOf(u db.User) FigureChoice {
	f := FigureChoice{Build: u.Build}
	if u.HeightCm != nil {
		h := int(*u.HeightCm)
		f.HeightCm = &h
	}
	if u.Skin != nil {
		k := int(*u.Skin)
		f.Skin = &k
	}
	return f
}

// handleSetFigure answers the card: a field present is set, a field absent
// keeps what the row holds, so an empty body is a skip. Both stamp
// figure_asked_at.
func (s *Service) handleSetFigure(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	var req FigureChoice
	// A body-less PUT is a skip too.
	if err := httpx.DecodeStrict(r, &req); err != nil && !errors.Is(err, io.EOF) {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	refuse := func(msg, field string) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", msg, field)
	}
	if req.Build != nil && !slices.Contains(figureBuilds, *req.Build) {
		refuse("Pick slim, athletic or strong.", "build")
		return
	}
	if req.HeightCm != nil && (*req.HeightCm < protocol.MinFigureHeightCm || *req.HeightCm > protocol.MaxFigureHeightCm) {
		refuse("Height has to be between 1.50 and 2.05 m.", "heightCm")
		return
	}
	if req.Skin != nil && (*req.Skin < 0 || *req.Skin >= protocol.SkinSwatches) {
		refuse("Pick one of the skin tones offered.", "skin")
		return
	}
	cur := FigureOf(user)
	if req.Build == nil {
		req.Build = cur.Build
	}
	if req.HeightCm == nil {
		req.HeightCm = cur.HeightCm
	}
	if req.Skin == nil {
		req.Skin = cur.Skin
	}
	params := db.SetUserFigureParams{ID: user.ID, Build: req.Build}
	if req.HeightCm != nil {
		h := int16(*req.HeightCm) //nolint:gosec // bounded to 150-205 above
		params.HeightCm = &h
	}
	if req.Skin != nil {
		k := int16(*req.Skin) //nolint:gosec // bounded to 0-7 above
		params.Skin = &k
	}
	updated, err := s.store.Queries.SetUserFigure(r.Context(), params)
	if err != nil {
		httpx.Fail(w, s.log, "figure update failed", err, "Your figure could not be saved. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s.fullMe(r.Context(), updated))
}
