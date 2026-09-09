// The pad: which clip sits on which key, its name, and the edits a rider
// makes to a clip once it is theirs. The clips themselves — list, upload,
// delete, serve — stay in board.go.
package board

import (
	"net/http"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// editJSON is the edit applied at playback (#934, ADR-0033) — never baked into
// the audio, so it stays re-editable and costs no second copy.
type editJSON struct {
	StartMillis int `json:"startMs"`
	// 0 means "to the end of the source": a clip uploaded before the editor
	// existed has no end to record.
	EndMillis int     `json:"endMs"`
	GainDb    float64 `json:"gainDb"`
	FadeInMs  int     `json:"fadeInMs"`
	FadeOutMs int     `json:"fadeOutMs"`
}

type padJSON struct {
	// null takes the clip off the board and leaves it in the library.
	Pad *int `json:"pad"`
}

// handlePad assigns a clip to a pad. Whatever was on that pad is bumped to the
// library first, so the unique index cannot refuse the write and the rider
// never has to clear a pad before reusing it.
func (s *Service) handlePad(w http.ResponseWriter, r *http.Request) {
	me, ok := s.me(w, r)
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such clip.")
		return
	}
	var body padJSON
	if err := httpx.DecodeStrict(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a pad.")
		return
	}
	var pad *int16
	if body.Pad != nil {
		if *body.Pad < 1 || *body.Pad > MaxPad {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"A pad is numbered from 1 to "+strconv.Itoa(MaxPad)+".", "pad")
			return
		}
		slot := int16(*body.Pad)
		pad = &slot
		if err := s.store.Queries.ClearBoardPad(r.Context(), db.ClearBoardPadParams{UserID: me.ID, Pad: &slot}); err != nil {
			httpx.Fail(w, s.log, "clear board pad", err, "The pad could not be set.", "user", store.UUIDString(me.ID))
			return
		}
	}
	n, err := s.store.Queries.SetBoardClipPad(r.Context(), db.SetBoardClipPadParams{ID: id, UserID: me.ID, Pad: pad})
	if err != nil {
		httpx.Fail(w, s.log, "set board pad", err, "The pad could not be set.", "user", store.UUIDString(me.ID))
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such clip.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleEdit stores the trim, gain and fades. Nothing is re-encoded: the
// source bytes stay exactly as uploaded, every listener already decodes the
// whole file, and these numbers are applied when it plays (ADR-0033).
func (s *Service) handleEdit(w http.ResponseWriter, r *http.Request) {
	me, ok := s.me(w, r)
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such clip.")
		return
	}
	var body editJSON
	if err := httpx.DecodeStrict(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not an edit.")
		return
	}
	source, err := s.store.Queries.GetBoardClipSource(r.Context(), db.GetBoardClipSourceParams{ID: id, UserID: me.ID})
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such clip.")
		return
	}
	if msg, field := checkEdit(body, int(source)); msg != "" {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", msg, field)
		return
	}
	n, err := s.store.Queries.SetBoardClipEdit(r.Context(), db.SetBoardClipEditParams{
		ID: id, UserID: me.ID,
		StartMs: int32(body.StartMillis), EndMs: int32(body.EndMillis), //nolint:gosec // bounded by checkEdit
		GainDb:    float32(body.GainDb),
		FadeInMs:  int32(body.FadeInMs),  //nolint:gosec // bounded by checkEdit
		FadeOutMs: int32(body.FadeOutMs), //nolint:gosec // bounded by checkEdit
	})
	if err != nil {
		httpx.Fail(w, s.log, "set board clip edit", err, "The edit could not be saved.", "user", store.UUIDString(me.ID))
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such clip.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// checkEdit is the whole rule set, in one place so a test can walk it: the
// kept span sits inside the source, is not longer than SPEC's ceiling, and the
// fades fit inside what they fade.
func checkEdit(e editJSON, sourceMillis int) (message, field string) {
	if e.StartMillis < 0 || e.StartMillis >= sourceMillis {
		return "The clip starts outside the audio.", "startMs"
	}
	end := e.EndMillis
	if end == 0 || end > sourceMillis {
		end = sourceMillis
	}
	kept := end - e.StartMillis
	if kept <= 0 {
		return "The clip has to keep some audio.", "endMs"
	}
	if kept > MaxClipMillis {
		return "A clip can be at most 60 seconds. Move a handle in.", "endMs"
	}
	if e.FadeInMs < 0 || e.FadeOutMs < 0 || e.FadeInMs+e.FadeOutMs > kept {
		return "The fades are longer than the clip.", "fadeInMs"
	}
	if e.GainDb < -MaxGainDb || e.GainDb > MaxGainDb {
		return "Gain is limited to 12 dB either way.", "gainDb"
	}
	return "", ""
}

type keyJSON struct {
	// null clears the binding, leaving a clip that is tapped and never fired.
	Key *string `json:"key"`
}

// handleKey binds one key to one clip. Whatever held that key is unbound
// first, so a rider moving a key never has to clear the old one — the same
// courtesy handlePad does for pads.
type nameJSON struct {
	Name string `json:"name"`
}

// A clip's name was set once, from the uploaded file's stem, and a bad one
// could only be fixed by uploading the file again (#981). The bound and the
// refusal are the upload's, word for word: one rule, said one way.
func (s *Service) handleName(w http.ResponseWriter, r *http.Request) {
	me, ok := s.me(w, r)
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such clip.")
		return
	}
	var body nameJSON
	if err := httpx.DecodeStrict(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a name.")
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || utf8.RuneCountInString(name) > maxNameRunes {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A clip needs a name, up to 32 characters.", "name")
		return
	}
	n, err := s.store.Queries.SetBoardClipName(r.Context(), db.SetBoardClipNameParams{ID: id, UserID: me.ID, Name: name})
	if err != nil {
		httpx.Fail(w, s.log, "set board name", err, "The name could not be changed.", "user", store.UUIDString(me.ID))
		return
	}
	// Somebody else's clip is not found rather than forbidden: the id of a
	// clip you cannot see is not yours to have confirmed.
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such clip.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleKey(w http.ResponseWriter, r *http.Request) {
	me, ok := s.me(w, r)
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such clip.")
		return
	}
	var body keyJSON
	if err := httpx.DecodeStrict(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a key.")
		return
	}
	if body.Key != nil {
		normalised, valid := NormaliseKey(*body.Key)
		if !valid {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"A key is one character — a letter, a digit or a symbol.", "key")
			return
		}
		body.Key = &normalised
		if err := s.store.Queries.ClearBoardKey(r.Context(), db.ClearBoardKeyParams{UserID: me.ID, Key: &normalised}); err != nil {
			httpx.Fail(w, s.log, "clear board key", err, "The key could not be set.", "user", store.UUIDString(me.ID))
			return
		}
	}
	n, err := s.store.Queries.SetBoardClipKey(r.Context(), db.SetBoardClipKeyParams{ID: id, UserID: me.ID, Key: body.Key})
	if err != nil {
		httpx.Fail(w, s.log, "set board key", err, "The key could not be set.", "user", store.UUIDString(me.ID))
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such clip.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// NormaliseKey is the one place a key's shape is decided: exactly one
// printable character, lower-cased so "Q" and "q" are the same binding rather
// than two that shadow each other.
//
// Whitespace is refused because a pad bound to the space bar would fire every
// time the rider scrolled the room with it.
func NormaliseKey(raw string) (string, bool) {
	lowered := strings.ToLower(raw)
	runes := []rune(lowered)
	if len(runes) != 1 {
		return "", false
	}
	if unicode.IsSpace(runes[0]) || !unicode.IsPrint(runes[0]) {
		return "", false
	}
	return lowered, true
}
