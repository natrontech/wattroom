package emoji

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/budget"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// What an upload refuses, and with which of errors.md's codes.
func TestUploadRefusals(t *testing.T) {
	w := setup(t)
	w.add(t, "bob", "gg")

	for _, tc := range []struct {
		name, who, emoji string
		body             []byte
		status           int
		code, field      string
		says             string
	}{
		{"no name", "cara", "", png(64), http.StatusBadRequest, "validation_error", "name", "a–z"},
		{"one character", "cara", "g", png(64), http.StatusBadRequest, "validation_error", "name", "2–32"},
		{"uppercase", "cara", "Parrot", png(64), http.StatusBadRequest, "validation_error", "name", ""},
		{"a space", "cara", "party parrot", png(64), http.StatusBadRequest, "validation_error", "name", ""},
		{"colons are the key, not the name", "cara", ":parrot:", png(64), http.StatusBadRequest, "validation_error", "name", ""},
		{"too long", "cara", strings.Repeat("a", protocol.MaxEmojiNameChars+1), png(64), http.StatusBadRequest, "validation_error", "name", ""},
		{"too big", "cara", "huge", png(protocol.MaxEmojiBytes + 1), http.StatusBadRequest, "validation_error", "", "256 KB"},
		{"not an image", "cara", "svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
			http.StatusBadRequest, "validation_error", "", "PNG"},
		{"empty body", "cara", "empty", nil, http.StatusBadRequest, "validation_error", "", ""},
		{"a name the crew has", "cara", "gg", png(64), http.StatusConflict, "conflict", "name", ":gg:"},
		{"signed out", "", "fine", png(64), http.StatusUnauthorized, "unauthorized", "", ""},
		{"not in the crew", "dave", "fine", png(64), http.StatusNotFound, "not_found", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, body := w.upload(t, tc.who, tc.emoji, tc.body)
			if status != tc.status || body["error"] != tc.code {
				t.Fatalf("%d %v, want %d %s", status, body, tc.status, tc.code)
			}
			if tc.field != "" && body["field"] != tc.field {
				t.Errorf("field = %v, want %s", body["field"], tc.field)
			}
			if msg, _ := body["message"].(string); !strings.Contains(msg, tc.says) {
				t.Errorf("message %q does not say %q", msg, tc.says)
			}
		})
	}

	// The cap is inclusive, and the same name in another crew is its own.
	w.add(t, "cara", "big")
	if status, body := w.upload(t, "cara", "exact", png(protocol.MaxEmojiBytes)); status != http.StatusCreated {
		t.Errorf("exactly the cap: %d %v", status, body)
	}
	if got := w.names(t, "bob"); len(got) != 3 {
		t.Errorf("a refusal left a row behind: %v", got)
	}
	other := testx.Crew(t, w.st, "Other Crew", w.users.ByToken["dave"].ID)
	if rec := w.do(t, http.MethodPost, "dave", "/api/crews/"+store.UUIDString(other)+"/emoji?name=gg", png(64)); rec.Code != http.StatusCreated {
		t.Errorf("a name another crew has: %d %s", rec.Code, rec.Body.String())
	}
}

// fill puts n emoji in the crew straight through the store — the ceiling's
// setup, not what is under test.
func (w world) fill(t *testing.T, n int) {
	t.Helper()
	if _, err := w.st.Pool.Exec(t.Context(), `
		insert into crew_emoji (crew_id, user_id, name, mime, bytes)
		select $1, $2, 'fill_' || g, 'image/png', '\x00'::bytea from generate_series(1, $3::int) g`,
		w.crew, w.users.ByToken["bob"].ID, n); err != nil {
		t.Fatalf("fill: %v", err)
	}
}

// A crew holds protocol.MaxCrewEmoji, refused as a ceiling (docs/SPEC.md
// "Shelf ceilings"): 429, the number, and the way out — never a wait.
func TestCrewEmojiCeiling(t *testing.T) {
	w := setup(t)
	w.fill(t, protocol.MaxCrewEmoji-1)
	last := w.add(t, "cara", "fiftieth")

	status, body := w.upload(t, "cara", "one_more", png(64))
	if status != http.StatusTooManyRequests || body["error"] != "rate_limited" {
		t.Fatalf("past the cap: %d %v, want 429 rate_limited", status, body)
	}
	msg, _ := body["message"].(string)
	if !strings.Contains(msg, fmt.Sprint(protocol.MaxCrewEmoji)) || !strings.Contains(msg, "Delete one") {
		t.Errorf("the refusal does not name the number and the remedy: %q", msg)
	}

	if rec := w.do(t, http.MethodDelete, "cara", w.path("/"+last), nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}
	w.add(t, "cara", "one_more")
}

// The ceiling holds under a burst (#1413's shape): with one slot left, members
// adding at the same moment land exactly one. Without the crew's row locked
// each counts forty-nine and each inserts.
func TestCrewEmojiCeilingHoldsUnderABurst(t *testing.T) {
	w := setup(t)
	w.fill(t, protocol.MaxCrewEmoji-1)

	const burst = 8
	statuses := make([]int, burst)
	var wg sync.WaitGroup
	for i := range burst {
		wg.Go(func() {
			who := []string{"alice", "bob", "cara"}[i%3]
			statuses[i] = w.do(t, http.MethodPost, who, w.path(fmt.Sprintf("?name=burst_%d", i)), png(64)).Code
		})
	}
	wg.Wait()
	created := 0
	for _, s := range statuses {
		switch s {
		case http.StatusCreated:
			created++
		case http.StatusTooManyRequests:
		default:
			t.Errorf("a burst upload answered %d", s)
		}
	}
	if created != 1 {
		t.Fatalf("%d uploads landed in the last slot, want exactly 1 (%v)", created, statuses)
	}
	if got := w.names(t, "bob"); len(got) != protocol.MaxCrewEmoji {
		t.Fatalf("the crew holds %d, want %d", len(got), protocol.MaxCrewEmoji)
	}
}

// The per-account upload budget is a rate, not a ceiling: 429 with a wait.
func TestUploadBudget(t *testing.T) {
	w := setup(t)
	w.svc.uploads = budget.New[pgtype.UUID](1, time.Hour)
	w.add(t, "bob", "first")
	status, body := w.upload(t, "bob", "second", png(64))
	if status != http.StatusTooManyRequests || body["error"] != "rate_limited" {
		t.Fatalf("over the budget: %d %v", status, body)
	}
	// Per account: cara's hour is her own.
	w.add(t, "cara", "hers")
}
