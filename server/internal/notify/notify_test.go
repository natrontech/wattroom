package notify

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type harness struct {
	store   *store.Store
	room    db.Room
	planner db.User // coach who plans — never emailed
	optIn   db.User // email + notify_planned on
	optOut  db.User // email set, notify_planned off
}

func setup(t *testing.T) *harness {
	t.Helper()
	dsn := os.Getenv("WATTROOM_TEST_DB")
	if dsn == "" {
		dsn = "postgres://wattroom:wattroom@localhost:5432/wattroom_test" //nolint:gosec // compose test credentials — NEVER the dev db, tests delete users
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	st, err := store.Open(ctx, dsn)
	if err != nil {
		t.Skipf("no database available: %v", err)
	}
	t.Cleanup(st.Close)

	h := &harness{store: st}
	for i, u := range []*db.User{&h.planner, &h.optIn, &h.optOut} {
		created, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
			DisplayName: fmt.Sprintf("rider-%d", i), FtpWatts: 200, WeightKg: 75,
		})
		if err != nil {
			t.Fatalf("create user: %v", err)
		}
		*u = created
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", created.ID)
		})
	}
	for _, set := range []struct {
		u      db.User
		notify bool
	}{{h.optIn, true}, {h.optOut, false}} {
		if _, err := st.Pool.Exec(t.Context(),
			"update users set email = $2, notify_planned = $3 where id = $1",
			set.u.ID, set.u.DisplayName+"@example.test", set.notify); err != nil {
			t.Fatalf("set email: %v", err)
		}
	}

	room, err := st.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Code: "NTFY42", Slug: "notify-test", Name: "Velvet Hammer", OwnerID: h.planner.ID,
	})
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	h.room = room
	for _, m := range []struct {
		u    db.User
		role string
	}{{h.planner, "owner"}, {h.optIn, "member"}, {h.optOut, "member"}} {
		if err := st.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{
			RoomID: room.ID, UserID: m.u.ID, Role: m.role,
		}); err != nil {
			t.Fatalf("membership: %v", err)
		}
	}
	return h
}

// fakeResend records every send so the test can assert who got mailed what.
type fakeResend struct {
	mu       sync.Mutex
	payloads []map[string]any
}

func (f *fakeResend) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var p map[string]any
		_ = json.NewDecoder(r.Body).Decode(&p)
		f.mu.Lock()
		f.payloads = append(f.payloads, p)
		f.mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}
}

func service(h *harness, apiURL string) *Service {
	return &Service{
		store: h.store, log: slog.New(slog.DiscardHandler),
		baseURL: "https://wattroom.example", from: "WattRoom <t@example.test>",
		key: "test-key", apiURL: apiURL, httpc: &http.Client{Timeout: 5 * time.Second},
	}
}

func TestSessionPlannedMailsOptedInMembersOnly(t *testing.T) {
	h := setup(t)
	fake := &fakeResend{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()

	s := service(h, srv.URL)
	starts := time.Date(2026, 9, 1, 19, 0, 0, 0, time.Local)
	s.sessionMail(t.Context(), h.room, "Sweet Spot 2×20", starts, h.planner.ID, false)

	if len(fake.payloads) != 1 {
		t.Fatalf("sent %d emails, want exactly 1 (opt-in member only)", len(fake.payloads))
	}
	p := fake.payloads[0]
	to := fmt.Sprint(p["to"])
	if !strings.Contains(to, h.optIn.DisplayName+"@example.test") {
		t.Fatalf("mailed %s, want the opted-in member", to)
	}
	subject := fmt.Sprint(p["subject"])
	if !strings.Contains(subject, "Velvet Hammer") || !strings.Contains(subject, "Sweet Spot 2×20") {
		t.Fatalf("subject %q misses room or workout", subject)
	}
	text := fmt.Sprint(p["text"])
	if !strings.Contains(text, "https://wattroom.example/r/notify-test") {
		t.Fatalf("body misses the room link: %q", text)
	}
	if !strings.Contains(text, "/api/notify/unsubscribe?u="+store.UUIDString(h.optIn.ID)) {
		t.Fatalf("body misses the unsubscribe link: %q", text)
	}
}

func TestSessionRescheduledSaysMoved(t *testing.T) {
	h := setup(t)
	fake := &fakeResend{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()

	s := service(h, srv.URL)
	starts := time.Date(2026, 9, 2, 18, 30, 0, 0, time.Local)
	s.sessionMail(t.Context(), h.room, "Sweet Spot 2×20", starts, h.planner.ID, true)

	if len(fake.payloads) != 1 {
		t.Fatalf("sent %d emails, want exactly 1", len(fake.payloads))
	}
	p := fake.payloads[0]
	if subject := fmt.Sprint(p["subject"]); !strings.HasPrefix(subject, "Moved: ") {
		t.Fatalf("subject %q misses the Moved: prefix", subject)
	}
	if text := fmt.Sprint(p["text"]); !strings.Contains(text, "moved a planned session to") {
		t.Fatalf("body %q does not say the plan moved", text)
	}
}

func TestUnsubscribe(t *testing.T) {
	h := setup(t)
	s := service(h, "http://unused.invalid")
	mux := http.NewServeMux()
	s.Register(mux)

	var token string
	if err := h.store.Pool.QueryRow(t.Context(),
		"select unsub_token from users where id = $1", h.optIn.ID).Scan(&token); err != nil {
		t.Fatalf("read token: %v", err)
	}
	link := "/api/notify/unsubscribe?u=" + store.UUIDString(h.optIn.ID) + "&t=" + token

	// The GET from the mail client only confirms — scanners prefetch GETs.
	get := httptest.NewRecorder()
	mux.ServeHTTP(get, httptest.NewRequestWithContext(t.Context(), "GET", link, nil))
	if get.Code != 200 || !strings.Contains(get.Body.String(), "method=\"post\"") {
		t.Fatalf("GET = %d %q, want a confirm form", get.Code, get.Body.String())
	}
	var still bool
	_ = h.store.Pool.QueryRow(t.Context(), "select notify_planned from users where id = $1", h.optIn.ID).Scan(&still)
	if !still {
		t.Fatal("GET already unsubscribed — it must not mutate")
	}

	// Wrong token flips nothing.
	bad := httptest.NewRecorder()
	mux.ServeHTTP(bad, httptest.NewRequestWithContext(t.Context(), "POST",
		"/api/notify/unsubscribe?u="+store.UUIDString(h.optIn.ID)+"&t="+store.UUIDString(h.room.ID), nil))
	if bad.Code != 404 {
		t.Fatalf("wrong token = %d, want 404", bad.Code)
	}

	post := httptest.NewRecorder()
	mux.ServeHTTP(post, httptest.NewRequestWithContext(t.Context(), "POST", link, nil))
	if post.Code != 200 {
		t.Fatalf("POST = %d, want 200", post.Code)
	}
	_ = h.store.Pool.QueryRow(t.Context(), "select notify_planned from users where id = $1", h.optIn.ID).Scan(&still)
	if still {
		t.Fatal("notify_planned still on after unsubscribe")
	}

	missing := httptest.NewRecorder()
	mux.ServeHTTP(missing, httptest.NewRequestWithContext(t.Context(), "POST", "/api/notify/unsubscribe?u=nope", nil))
	if missing.Code != 400 {
		t.Fatalf("mangled link = %d, want 400", missing.Code)
	}
}

func TestSendReportsAPIFailure(t *testing.T) {
	h := setup(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"message":"invalid from"}`, http.StatusUnprocessableEntity)
	}))
	defer srv.Close()
	s := service(h, srv.URL)
	err := s.send(t.Context(), "x@example.test", "s", "t", "https://u")
	if err == nil || !strings.Contains(err.Error(), "invalid from") {
		t.Fatalf("err = %v, want the API detail surfaced", err)
	}
}
