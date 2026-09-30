package auth

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
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

// A new account rides on 200 W and 75 kg that nobody chose (#1484), and the
// row has to say so — it is what the first-run ask and Home's label read.
func TestNewAccountNumbersAreMarkedUnchosen(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	if got := protocol.SourceOf(user.FtpSource); got != sourceDefault {
		t.Errorf("ftp_source on a fresh account = %q, want %q", got, sourceDefault)
	}
	if got := protocol.SourceOf(user.WeightSource); got != sourceDefault {
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

	// The weight's two dates as the row holds them (#3169): a race reads a
	// change inside 14 days, or no answer inside 90, as unranked.
	weightDates := func(t *testing.T) (changed, confirmed bool) {
		t.Helper()
		row, err := s.store.Queries.GetUser(t.Context(), user.ID)
		if err != nil {
			t.Fatalf("re-read user: %v", err)
		}
		return row.WeightChangedAt.Valid, row.WeightConfirmedAt.Valid
	}

	// An unrelated save that round-trips the same numbers leaves them
	// unanswered — this is the Strava toggle and the email form.
	code, me = call(t, http.MethodPatch, `{"displayName":"renamed","ftpWatts":200,"weightKg":75}`)
	if code != http.StatusOK || me.FtpSource != sourceDefault || me.WeightSource != sourceDefault {
		t.Fatalf("unchanged numbers = %d %+v, want both still %q", code, me, sourceDefault)
	}
	if changed, confirmed := weightDates(t); changed || confirmed {
		t.Fatalf("a round-tripped weight was dated: changed %v, confirmed %v", changed, confirmed)
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
	// Answering for an unchanged weight confirms it and changes nothing:
	// this is the commissaire's tap (ADR-0067).
	if changed, confirmed := weightDates(t); changed || !confirmed {
		t.Fatalf("a claimed weight: changed %v, confirmed %v, want only confirmed", changed, confirmed)
	}

	// A new weight is a change and an answer both.
	code, _ = call(t, http.MethodPatch, `{"displayName":"renamed","ftpWatts":250,"weightKg":72}`)
	if changed, confirmed := weightDates(t); code != http.StatusOK || !changed || !confirmed {
		t.Fatalf("a changed weight = %d: changed %v, confirmed %v, want both", code, changed, confirmed)
	}

	// The ramp test's own save.
	code, me = call(t, http.MethodPatch,
		`{"displayName":"renamed","ftpWatts":300,"weightKg":72,"ftpSource":"ramp"}`)
	if code != http.StatusOK || me.FtpSource != sourceRamp {
		t.Fatalf("ramp save = %d %+v, want ftp %q", code, me, sourceRamp)
	}

	// The stored row agrees with the response.
	stored, err := s.store.Queries.GetUser(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("re-read user: %v", err)
	}
	if protocol.SourceOf(stored.FtpSource) != sourceRamp || protocol.SourceOf(stored.WeightSource) != sourceManual {
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
	if protocol.SourceOf(stored.FtpSource) != sourceDefault || stored.FtpWatts != 200 {
		t.Fatalf("a refused claim changed the row: %+v", stored)
	}
}
