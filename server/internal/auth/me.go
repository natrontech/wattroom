// The signed-in rider's own record: /api/me and the writes to it.
package auth

import (
	"context"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

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
	// Where each of those two came from (#1484): "default" — nobody chose it,
	// the account was created with the app's opening guess; "manual" — the
	// rider set it; "ramp" — a ramp test measured it. Every FTP-relative
	// target, the execution score, the XP bonus, the category and the load all
	// scale from FtpWatts (docs/SPEC.md), so a client has to be able to tell a
	// measurement from a placeholder before it prints one as the other.
	FtpSource    string `json:"ftpSource"`
	WeightSource string `json:"weightSource"`
	// The HR anchor (ADR-0014), on the account since #1571; absent until set.
	Lthr *int16 `json:"lthr,omitempty"`
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
	// When "send again" will send again (#1608): inside the resend window
	// the server answers success and mails nothing, and the gate used to
	// show "Sending…" and then nothing at all.
	EmailResendAt *time.Time `json:"emailResendAt,omitempty"`
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
		// Pointer for the same reason: absent keeps the anchor. Zero clears
		// it — it is out of range anyway, and a JSON null cannot be told
		// from absent here (#1571).
		Lthr *int16 `json:"lthr"`
		// Who is claiming these two numbers (#1484). Absent is the common
		// case and means "read it from the write": a value that differs from
		// the stored one was set by the rider, and one that does not leaves
		// the source alone — so the Strava toggle and the email form, which
		// both PATCH the current FTP back unchanged, cannot promote a
		// placeholder to an answer. Present ("manual"/"ramp") is a client
		// saying so outright: the first-run ask, where keeping the prefilled
		// 200 W IS the rider's answer, and the ramp test's own save.
		FtpSource    *string `json:"ftpSource"`
		WeightSource *string `json:"weightSource"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That profile update could not be read.")
		return
	}
	// Same bounds as the schema CHECKs and the web store — one source, docs/SPEC.md.
	// Trimmed and counted in runes (audit 2026-09-09): a byte count refused
	// a 21-character Cyrillic name, and " " was a valid one.
	req.DisplayName = strings.TrimSpace(req.DisplayName)

	switch {
	case utf8.RuneCountInString(req.DisplayName) == 0 || utf8.RuneCountInString(req.DisplayName) > 60:
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
	case req.Lthr != nil && *req.Lthr != 0 && (*req.Lthr < 100 || *req.Lthr > 210):
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"LTHR has to be between 100 and 210 bpm.", "lthr")
		return
	case !claimableSource(req.FtpSource):
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"An FTP is either set by you or measured by a ramp test.", "ftpSource")
		return
	case !claimableSource(req.WeightSource):
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A weight is either set by you or measured by a ramp test.", "weightSource")
		return
	}
	lthr := user.Lthr
	if req.Lthr != nil {
		lthr = req.Lthr
		if *req.Lthr == 0 {
			lthr = nil
		}
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
		NotifyPlanned: notify, Lthr: lthr,
		FtpSource:    nextSource(sourceOf(user.FtpSource), req.FtpSource, user.FtpWatts != req.FtpWatts),
		WeightSource: nextSource(sourceOf(user.WeightSource), req.WeightSource, user.WeightKg != req.WeightKg),
	})
	if err != nil {
		httpx.Fail(w, s.log, "profile update failed", err, "Your profile could not be saved. Try again.")
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
		httpx.Fail(w, s.log, "avatar save failed", err, "The picture could not be saved.", "user", store.UUIDString(user.ID))
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
		httpx.Fail(w, s.log, "appearance update failed", err, "Your appearance could not be saved. Try again.")
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
		FtpSource:     sourceOf(u.FtpSource),
		WeightSource:  sourceOf(u.WeightSource),
		Lthr:          u.Lthr,
		Email:         u.Email,
		NotifyPlanned: u.NotifyPlanned,
		MailAvailable: s.mailer != nil,
		EmailVerified: u.EmailVerifiedAt.Valid,
		EmailPending:  u.EmailPending,
		EmailRequired: u.EmailRequired,
		EmailResendAt: resendAt(u),
		AccentPalette: u.AccentPalette,
		ColorScheme:   u.ColorScheme,
		Timezone:      u.Timezone,
	}
}

// The provenance of the two profile numbers (#1484), one vocabulary for the
// column CHECK, the API and the client.
const (
	sourceDefault = "default" // nobody chose it: the account was created with it
	sourceManual  = "manual"  // the rider set it, by typing it or accepting a suggestion
	sourceRamp    = "ramp"    // a ramp test measured it
)

// sourceOf reads the column, which is nullable because the migration that
// added it had to be (ADR-0019, expand only). A row with no word on it was
// never answered for — the honest reading, and the one that makes the
// first-run ask appear rather than quietly retire itself.
func sourceOf(stored *string) string {
	if stored == nil || *stored == "" {
		return sourceDefault
	}
	return *stored
}

// claimableSource: a client may claim only the two sources that mean somebody
// answered. "default" is the server's word for an account nobody has answered
// for yet, and nothing can talk its way back into it.
func claimableSource(claim *string) bool {
	return claim == nil || *claim == sourceManual || *claim == sourceRamp
}

// nextSource is the whole rule in one place: an outright claim wins, then a
// changed value is the rider's own, and otherwise the source stands. The last
// branch is what keeps every incidental PATCH of the profile — the Strava
// toggle, the email form, an appearance save that round-trips the numbers —
// from promoting the app's guess to the rider's answer.
func nextSource(current string, claim *string, changed bool) *string {
	next := current
	switch {
	case claim != nil:
		next = *claim
	case changed:
		next = sourceManual
	}
	return &next
}

// validEmail accepts only a bare RFC 5322 address — no display-name forms.
func validEmail(e string) bool {
	a, err := mail.ParseAddress(e)
	return err == nil && a.Address == e
}

// resendAt is when a fresh link can be asked for, or nil once it can (#1608):
// the link was minted emailVerifyTTL before it expires, and the window holds
// emailResendAfter past the minting.
func resendAt(u db.User) *time.Time {
	if u.EmailPending == nil || !u.EmailVerifyExpires.Valid {
		return nil
	}
	at := u.EmailVerifyExpires.Time.Add(-(emailVerifyTTL - emailResendAfter))
	if !at.After(time.Now()) {
		return nil
	}
	return &at
}
