// The signed-in rider's own record: /api/me and the writes to it.
package auth

import (
	"context"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type meResponse struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	// The sign-in provider's photo until the rider uploads one (#1353); then
	// /api/riders/{id}/avatar?v=<set time>, so a replaced picture is a new
	// address everywhere.
	AvatarURL *string `json:"avatarUrl,omitempty"`
	// Lifetime XP — the level and its ring derive from this (docs/SPEC.md).
	TotalXp  int64 `json:"totalXp"`
	FtpWatts int16 `json:"ftpWatts"`
	WeightKg int16 `json:"weightKg"`
	// The FTP auto-detect prompt (#26): filled when the 90-day curve outgrows
	// the setting. A suggestion, never an application — FTP moves every
	// workout's difficulty (docs/SPEC.md).
	SuggestedFtp int `json:"suggestedFtp,omitempty"`
	// Whether LiveKit is configured — the client hides voice/cam controls
	// instead of serving 404s on click (#219, capability gating).
	AvEnabled bool `json:"avEnabled"`
	// Whether GIF search is configured (#878) — same gating, for the
	// composer's picker button.
	GifsEnabled bool `json:"gifsEnabled"`
	// The evidence behind the suggestion, for the prompt's copy.
	Best20m int `json:"best20m,omitempty"`
	// Which providers this account signs in with. Drives the profile's
	// connect rows (#719), so an absent one is an offer, not just copy.
	Providers []string `json:"providers,omitempty"`
	// Auto-upload rides to the rider's own Strava (#34, default true).
	StravaUpload bool `json:"stravaUpload"`
	// Email notifications for planned sessions (#117): the address is typed
	// in on the profile, the opt-in defaults off, and MailAvailable hides the
	// section entirely on servers that cannot send.
	Email         *string `json:"email,omitempty"`
	NotifyPlanned bool    `json:"notifyPlanned"`
	MailAvailable bool    `json:"mailAvailable,omitempty"`
	// The address as a recovery attribute (#781, ADR-0029). EmailVerified is
	// the only one of the three that means "this rider can be reached";
	// EmailPending is an address awaiting its link, and EmailRequired marks an
	// account onboarded with the requirement — new accounts must confirm,
	// older ones are asked.
	EmailVerified bool    `json:"emailVerified"`
	EmailPending  *string `json:"emailPending,omitempty"`
	EmailRequired bool    `json:"emailRequired"`
	// Appearance follows the account (#326). Nil: no device has chosen yet;
	// "": the default, chosen. The client tells the two apart.
	AccentPalette *string `json:"accentPalette"`
	ColorScheme   *string `json:"colorScheme"`
	// The IANA zone the browser last reported (#858). The client compares it
	// with what this device says and reports a difference; nil means nothing
	// has yet, and email falls back to the server's zone.
	Timezone *string `json:"timezone,omitempty"`
}

func (s *Service) handleMe(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s.fullMe(r.Context(), user))
}

func (s *Service) handleUpdateMe(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}

	var req struct {
		DisplayName string `json:"displayName"`
		FtpWatts    int16  `json:"ftpWatts"`
		WeightKg    int16  `json:"weightKg"`
		// Pointer: absent keeps the current value — a client that predates
		// the field must not silently switch uploads off.
		StravaUpload  *bool   `json:"stravaUpload"`
		Email         *string `json:"email"`
		NotifyPlanned *bool   `json:"notifyPlanned"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That profile update could not be read.")
		return
	}
	// Same bounds as the schema CHECKs and the web store — one source, docs/SPEC.md.
	switch {
	case len(req.DisplayName) == 0 || len(req.DisplayName) > 60:
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"Display name has to be 1-60 characters.", "displayName")
		return
	case req.FtpWatts < 50 || req.FtpWatts > 600:
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"FTP has to be between 50 and 600 W.", "ftpWatts")
		return
	case req.WeightKg < 30 || req.WeightKg > 200:
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"Weight has to be between 30 and 200 kg.", "weightKg")
		return
	}

	stravaUpload := user.StravaUpload
	if req.StravaUpload != nil {
		stravaUpload = *req.StravaUpload
	}
	// The address is a two-step ceremony now (#781): this stores a pending
	// address and mails a link, and only the confirm handler moves it across.
	// The profile write below never touches `email`; clearing goes through
	// ClearUserEmail after it.
	clearing := req.Email != nil && strings.TrimSpace(*req.Email) == ""
	current := user
	if req.Email != nil && !clearing {
		var ok bool
		if current, ok = s.emailUpdate(r.Context(), w, user, *req.Email); !ok {
			return
		}
	}
	hasEmail := current.Email != nil && !clearing
	notify := user.NotifyPlanned
	if req.NotifyPlanned != nil {
		notify = *req.NotifyPlanned
	}
	// Nothing to send to and nothing on the way: the opt-in cannot stand. A
	// pending address keeps it, so ticking the box while confirming does not
	// silently untick itself — ListRoomNotifyTargets skips a null address
	// anyway, so the setting is inert until the link is followed.
	if !hasEmail && current.EmailPending == nil {
		notify = false
	}
	updated, err := s.store.Queries.UpdateUserProfile(r.Context(), db.UpdateUserProfileParams{
		ID: user.ID, DisplayName: req.DisplayName, FtpWatts: req.FtpWatts,
		WeightKg: req.WeightKg, StravaUpload: stravaUpload,
		NotifyPlanned: notify,
	})
	if err != nil {
		s.log.Error("profile update failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Your profile could not be saved. Try again.")
		return
	}
	if clearing {
		if updated, ok = s.clearEmail(r.Context(), w, updated); !ok {
			return
		}
	}
	// The client replaces its whole `me` with this response — it has to be as
	// complete as GET /api/me, or providers/AV/FTP-suggestion/XP vanish on save.
	httpx.WriteJSON(w, http.StatusOK, s.fullMe(r.Context(), updated))
}

// handleSetAvatar takes the rider's own picture (#1353): the same trust
// boundary as a pasted chat image and a crew's picture — bounded read, type
// sniffed from the bytes. The response is the full `me`, like every other
// write to the record, so the client swaps its copy and every surface draws
// the new address.
func (s *Service) handleSetAvatar(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	data, mime, ok := httpx.ReadImageUpload(w, r)
	if !ok {
		return
	}
	setAt := time.Now()
	url := "/api/riders/" + store.UUIDString(user.ID) + "/avatar?v=" + strconv.FormatInt(setAt.UnixMilli(), 10)
	updated, err := s.store.Queries.SetUserAvatar(r.Context(), db.SetUserAvatarParams{
		ID: user.ID, Mime: mime, Image: data,
		SetAt:     pgtype.Timestamptz{Time: setAt, Valid: true},
		AvatarUrl: &url,
	})
	if err != nil {
		s.log.Error("avatar save failed", "err", err, "user", store.UUIDString(user.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The picture could not be saved.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s.fullMe(r.Context(), updated))
}

// maxPaletteChoice bounds the stored palette choice: the client's own JSON
// ({"kind":"preset","identity":"tron"}) is under 40 bytes; anything near this
// is junk.
const maxPaletteChoice = 120

// handleUpdateAppearance stores the theme identity and the scheme toggle on
// the account (#326), so the next device shows the same room. Both stay
// opaque to the server beyond bounds — the palette is the client's choice
// JSON, the scheme "", "dark" or "light". Absent keeps the current value; ""
// is the default chosen on purpose, distinct from never chosen (null), which
// the client reads as "push what this device has".
func (s *Service) handleUpdateAppearance(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	var req struct {
		AccentPalette *string `json:"accentPalette"`
		ColorScheme   *string `json:"colorScheme"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That appearance update could not be read.")
		return
	}
	palette := user.AccentPalette
	if req.AccentPalette != nil {
		if len(*req.AccentPalette) > maxPaletteChoice {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"That palette choice is not one the app makes.", "accentPalette")
			return
		}
		palette = req.AccentPalette
	}
	scheme := user.ColorScheme
	if req.ColorScheme != nil {
		switch *req.ColorScheme {
		case "", "dark", "light":
			scheme = req.ColorScheme
		default:
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"Scheme has to be dark, light, or empty for auto.", "colorScheme")
			return
		}
	}
	updated, err := s.store.Queries.UpdateUserAppearance(r.Context(), db.UpdateUserAppearanceParams{
		ID: user.ID, AccentPalette: palette, ColorScheme: scheme,
	})
	if err != nil {
		s.log.Error("appearance update failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Your appearance could not be saved. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s.fullMe(r.Context(), updated))
}

// fullMe is the complete GET/PATCH /api/me body: toMe plus the fields that
// need extra queries or service config.
func (s *Service) fullMe(ctx context.Context, user db.User) meResponse {
	response := s.toMe(user)
	response.AvEnabled = s.avEnabled
	response.GifsEnabled = s.gifsEnabled
	if best, err := s.store.Queries.Best20mIn90Days(ctx, user.ID); err == nil {
		if suggested, ok := stats.SuggestFTP(int(best), int(user.FtpWatts)); ok {
			response.SuggestedFtp = suggested
			response.Best20m = int(best)
		}
	}
	if providers, err := s.store.Queries.ListUserProviders(ctx, user.ID); err == nil {
		response.Providers = providers
	}
	if xp, err := s.store.Queries.UserTotalXp(ctx, user.ID); err == nil {
		response.TotalXp = xp
	}
	return response
}

func (s *Service) toMe(u db.User) meResponse {
	return meResponse{
		StravaUpload:  u.StravaUpload,
		ID:            store.UUIDString(u.ID),
		DisplayName:   u.DisplayName,
		AvatarURL:     u.AvatarUrl,
		FtpWatts:      u.FtpWatts,
		WeightKg:      u.WeightKg,
		Email:         u.Email,
		NotifyPlanned: u.NotifyPlanned,
		MailAvailable: s.mailer != nil,
		EmailVerified: u.EmailVerifiedAt.Valid,
		EmailPending:  u.EmailPending,
		EmailRequired: u.EmailRequired,
		AccentPalette: u.AccentPalette,
		ColorScheme:   u.ColorScheme,
		Timezone:      u.Timezone,
	}
}

// validEmail accepts only a bare RFC 5322 address — no display-name forms.
func validEmail(e string) bool {
	a, err := mail.ParseAddress(e)
	return err == nil && a.Address == e
}
