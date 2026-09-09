package auth

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// Ten passkeys per account (#1415): the eleventh is a 429, before any
// ceremony begins.
func TestPasskeyRegistrationRefusesPastTheCap(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)
	for i := 0; i < maxPasskeys; i++ {
		addPasskey(t, s, user, fmt.Sprintf("cap-%d", i), fmt.Sprintf("key %d", i))
	}
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/auth/passkey/register/start", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	s.handlePasskeyRegisterStart(w, req)
	if w.Code != http.StatusTooManyRequests || !strings.Contains(w.Body.String(), `"rate_limited"`) {
		t.Fatalf("the eleventh passkey: %d %s, want 429 rate_limited", w.Code, w.Body.String())
	}
}

// The handoff map refuses past its ceiling instead of growing (#1415).
func TestHandoffsRefusePastTheCap(t *testing.T) {
	h := &handoffs{}
	later := time.Now().Add(time.Hour)
	for i := 0; i < handoffMax; i++ {
		if !h.put(fmt.Sprintf("tok-%d", i), handoff{userID: pgtype.UUID{Valid: true}, nonce: "n", expires: later}) {
			t.Fatalf("refused at %d, under the cap", i)
		}
	}
	if h.put("one-more", handoff{expires: later}) {
		t.Fatal("the map grew past its cap")
	}
	// Expired entries make room again.
	h.byTok["tok-0"] = handoff{expires: time.Now().Add(-time.Minute)}
	if !h.put("after-sweep", handoff{expires: later}) {
		t.Fatal("an expired entry did not free its slot")
	}
}
