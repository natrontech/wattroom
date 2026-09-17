package auth

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
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

// Ten passkeys is a ceiling that has to hold when the inserts arrive together
// (#2258). The count used to live at the start of the ceremony and the insert
// at its finish — two statements with a browser prompt between them, which is
// no ceiling at all once two tabs are open. The handler's insert path is
// exercised directly because the finish handler needs a real authenticator.
func TestThePasskeyCapHoldsUnderConcurrentInserts(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	const racers = 16

	var wg sync.WaitGroup
	results := make([]error, racers)
	wg.Add(racers)
	for i := range racers {
		go func() {
			defer wg.Done()
			_, results[i] = s.createPasskeyCapped(t.Context(), db.CreatePasskeyParams{
				CredentialID: []byte(fmt.Sprintf("racer-%d", i)),
				UserID:       user.ID,
				Credential:   []byte("{}"),
				Name:         fmt.Sprintf("racer %d", i),
			})
		}()
	}
	wg.Wait()

	rows, err := s.store.Queries.ListUserPasskeys(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != maxPasskeys {
		t.Errorf("%d passkeys in the table after %d concurrent inserts, want the cap of %d", len(rows), racers, maxPasskeys)
	}
	added, capped := 0, 0
	for _, err := range results {
		switch {
		case err == nil:
			added++
		case errors.Is(err, errPasskeyCap):
			capped++
		default:
			t.Errorf("unexpected error: %v", err)
		}
	}
	if added != maxPasskeys || capped != racers-maxPasskeys {
		t.Errorf("%d added / %d capped, want %d / %d", added, capped, maxPasskeys, racers-maxPasskeys)
	}
}
