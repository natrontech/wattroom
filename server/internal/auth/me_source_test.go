package auth

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// nextSource is the whole provenance rule (#1484), and the case that matters
// most is the boring one: a PATCH that carries the numbers back unchanged —
// the Strava toggle, the email form — must not promote the app's guess to the
// rider's answer.
func TestNextSource(t *testing.T) {
	t.Parallel()
	manual, ramp := sourceManual, sourceRamp
	for name, tc := range map[string]struct {
		current string
		claim   *string
		changed bool
		want    string
	}{
		"untouched default stands":      {sourceDefault, nil, false, sourceDefault},
		"a changed value is the rider":  {sourceDefault, nil, true, sourceManual},
		"a claim wins over no change":   {sourceDefault, &manual, false, sourceManual},
		"a ramp test says so":           {sourceDefault, &ramp, true, sourceRamp},
		"an answer is never re-guessed": {sourceManual, nil, false, sourceManual},
		"a ramp number typed over":      {sourceRamp, nil, true, sourceManual},
	} {
		if got := nextSource(tc.current, tc.claim, tc.changed); *got != tc.want {
			t.Errorf("%s: got %q, want %q", name, *got, tc.want)
		}
	}
}

// The column is nullable because expand/contract required it (ADR-0019), so
// an absent word has to read as the honest one: nobody answered.
func TestSourceOfTreatsNothingAsDefault(t *testing.T) {
	t.Parallel()
	set := sourceRamp
	empty := ""
	for name, tc := range map[string]struct {
		stored *string
		want   string
	}{
		"null":  {nil, sourceDefault},
		"empty": {&empty, sourceDefault},
		"set":   {&set, sourceRamp},
	} {
		if got := sourceOf(tc.stored); got != tc.want {
			t.Errorf("%s: got %q, want %q", name, got, tc.want)
		}
	}
}

// A new account rides on 200 W and 75 kg that nobody chose (#1484), and the
// row has to say so — it is what the first-run ask and Home's label read.
func TestNewAccountNumbersAreMarkedUnchosen(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	if got := sourceOf(user.FtpSource); got != sourceDefault {
		t.Errorf("ftp_source on a fresh account = %q, want %q", got, sourceDefault)
	}
	if got := sourceOf(user.WeightSource); got != sourceDefault {
		t.Errorf("weight_source on a fresh account = %q, want %q", got, sourceDefault)
	}
}

func TestProfileSourcesThroughTheAPI(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	rec := httptest.NewRecorder()
	if err := s.startSession(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil), user.ID); err != nil {
		t.Fatalf("start session: %v", err)
	}
	cookie := rec.Result().Cookies()[0]

	call := func(t *testing.T, method, body string) (int, meResponse) {
		t.Helper()
		var reader io.Reader
		if body != "" {
			reader = strings.NewReader(body)
		}
		req := httptest.NewRequestWithContext(t.Context(), method, "/api/me", reader)
		req.AddCookie(cookie)
		w := httptest.NewRecorder()
		if method == http.MethodGet {
			s.handleMe(w, req)
		} else {
			s.handleUpdateMe(w, req)
		}
		var got meResponse
		if w.Code == http.StatusOK {
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode response: %v", err)
			}
		}
		return w.Code, got
	}

	// GET carries both words, so a client can tell a placeholder from a
	// measurement before printing one as the other.
	code, me := call(t, http.MethodGet, "")
	if code != http.StatusOK || me.FtpSource != sourceDefault || me.WeightSource != sourceDefault {
		t.Fatalf("GET /api/me = %d %+v, want both sources %q", code, me, sourceDefault)
	}

	// An unrelated save that round-trips the same numbers leaves them
	// unanswered — this is the Strava toggle and the email form.
	code, me = call(t, http.MethodPatch, `{"displayName":"renamed","ftpWatts":200,"weightKg":75}`)
	if code != http.StatusOK || me.FtpSource != sourceDefault || me.WeightSource != sourceDefault {
		t.Fatalf("unchanged numbers = %d %+v, want both still %q", code, me, sourceDefault)
	}

	// Changing one answers that one and only that one.
	code, me = call(t, http.MethodPatch, `{"displayName":"renamed","ftpWatts":250,"weightKg":75}`)
	if code != http.StatusOK || me.FtpSource != sourceManual || me.WeightSource != sourceDefault {
		t.Fatalf("changed FTP = %d %+v, want ftp %q and weight %q", code, me, sourceManual, sourceDefault)
	}

	// The first-run ask claims outright: keeping the prefilled 75 kg IS the
	// rider's answer, and nothing about the value says so.
	code, me = call(t, http.MethodPatch,
		`{"displayName":"renamed","ftpWatts":250,"weightKg":75,"weightSource":"manual"}`)
	if code != http.StatusOK || me.WeightSource != sourceManual {
		t.Fatalf("claimed weight = %d %+v, want weight %q", code, me, sourceManual)
	}

	// The ramp test's own save.
	code, me = call(t, http.MethodPatch,
		`{"displayName":"renamed","ftpWatts":300,"weightKg":75,"ftpSource":"ramp"}`)
	if code != http.StatusOK || me.FtpSource != sourceRamp {
		t.Fatalf("ramp save = %d %+v, want ftp %q", code, me, sourceRamp)
	}

	// The stored row agrees with the response.
	stored, err := s.store.Queries.GetUser(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("re-read user: %v", err)
	}
	if sourceOf(stored.FtpSource) != sourceRamp || sourceOf(stored.WeightSource) != sourceManual {
		t.Fatalf("row disagrees with the API: %+v", stored)
	}
}

// Nothing talks its way back into "nobody chose this", and a refusal names
// the field so the form can show it inline (.claude/rules/errors.md).
func TestProfileSourceClaimsAreBounded(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	rec := httptest.NewRecorder()
	if err := s.startSession(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil), user.ID); err != nil {
		t.Fatalf("start session: %v", err)
	}
	cookie := rec.Result().Cookies()[0]

	for field, body := range map[string]string{
		"ftpSource":    `{"displayName":"x","ftpWatts":250,"weightKg":80,"ftpSource":"default"}`,
		"weightSource": `{"displayName":"x","ftpWatts":250,"weightKg":80,"weightSource":"guessed"}`,
	} {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/api/me", strings.NewReader(body))
		req.AddCookie(cookie)
		w := httptest.NewRecorder()
		s.handleUpdateMe(w, req)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d, want 400", field, w.Code)
			continue
		}
		var got struct {
			Error   string `json:"error"`
			Message string `json:"message"`
			Field   string `json:"field"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Errorf("%s: decode error body: %v", field, err)
			continue
		}
		if got.Error != "validation_error" || got.Field != field || got.Message == "" {
			t.Errorf("%s: refusal was %+v", field, got)
		}
	}

	// A refused claim writes nothing.
	stored, err := s.store.Queries.GetUser(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("re-read user: %v", err)
	}
	if sourceOf(stored.FtpSource) != sourceDefault || stored.FtpWatts != 200 {
		t.Fatalf("a refused claim changed the row: %+v", stored)
	}
}
