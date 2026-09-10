package notify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/natrontech/wattroom/server/internal/budget"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
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
	st := storetest.Open(t)

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
			"update users set email = $2, email_verified_at = now(), notify_planned = $3 where id = $1",
			set.u.ID, set.u.DisplayName+"@example.test", set.notify); err != nil {
			t.Fatalf("set email: %v", err)
		}
	}

	room, err := st.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Slug: "notify-test", Name: "Velvet Hammer", OwnerID: h.planner.ID,
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

// sent is how many mails the fake has taken, read under the lock: a test
// that polls for the first one races the handler otherwise (CI on #1645).
func (f *fakeResend) sent() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.payloads)
}

// subjectsTo is every subject the fake was asked to send to one address.
// remindDue works across rooms, so a test of it cannot assume it is the only
// thing writing to the shared test database.
func (f *fakeResend) subjectsTo(address string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for _, p := range f.payloads {
		if to, ok := p["to"].([]any); ok && len(to) == 1 && to[0] == address {
			out = append(out, fmt.Sprint(p["subject"]))
		}
	}
	return out
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
	s.sessionMail(t.Context(), h.room, "Sweet Spot 2×20", starts, h.planner.ID, sessionPlanned)

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

	// Both parts go out together (#838), and the HTML one carries the room
	// link on its button and the workout as the line that glows.
	html := fmt.Sprint(p["html"])
	for _, want := range []string{
		"https://wattroom.example/r/notify-test",
		"Sweet Spot 2×20",
		"#ff3d8b",
		"/api/notify/unsubscribe?u=" + store.UUIDString(h.optIn.ID),
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("html part misses %q: %s", want, html)
		}
	}
}

// A ban keeps the membership row (ADR-0013), and this query is the one that
// reaches OUTSIDE the app. Without the guard a rider thrown out of a room goes
// on receiving its session mail in their inbox, with no way to stop it from
// inside a room they can no longer open — ADR-0030 governs what leaves as
// mail, and this was not it. Sibling of #1110, found by the audit in #1113.
func TestSessionMailSkipsABannedMember(t *testing.T) {
	h := setup(t)
	fake := &fakeResend{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()

	s := service(h, srv.URL)
	starts := time.Date(2026, 9, 1, 19, 0, 0, 0, time.Local)
	s.sessionMail(t.Context(), h.room, "Sweet Spot 2\u00d720", starts, h.planner.ID, sessionPlanned)
	if len(fake.payloads) != 1 {
		t.Fatalf("sent %d before the ban, want 1 — test proves nothing", len(fake.payloads))
	}

	if _, err := h.store.Queries.UpdateMembershipRole(t.Context(), db.UpdateMembershipRoleParams{
		RoomID: h.room.ID, UserID: h.optIn.ID, Role: "banned",
	}); err != nil {
		t.Fatalf("ban: %v", err)
	}

	fake.payloads = nil
	s.sessionMail(t.Context(), h.room, "Sweet Spot 2\u00d720", starts, h.planner.ID, sessionPlanned)
	if len(fake.payloads) != 0 {
		t.Errorf("mailed a banned member: %v", fake.payloads[0]["to"])
	}
}

// The crew's ban, not the room's (#1904): the membership row stays as it
// was and only visible_rooms knows, so the targets query has to ask it.
func TestSessionMailSkipsACrewBannedMember(t *testing.T) {
	h := setup(t)
	fake := &fakeResend{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	s := service(h, srv.URL)
	starts := time.Date(2026, 9, 1, 19, 0, 0, 0, time.Local)

	code := "CRWBAN"
	crew, err := h.store.Queries.CreateCrew(t.Context(), db.CreateCrewParams{
		Name: "Crew", OwnerID: h.planner.ID, Code: &code,
	})
	if err != nil {
		t.Fatalf("crew: %v", err)
	}
	// LIFO with the harness's room cleanup: the room lets go of the crew
	// first, or the crew's delete is refused and the room's slug is left
	// behind for the next test to trip on.
	t.Cleanup(func() {
		_, _ = h.store.Pool.Exec(context.Background(), "update rooms set crew_id = null where id = $1", h.room.ID)
		_, _ = h.store.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID)
	})
	if _, err := h.store.Pool.Exec(t.Context(), "update rooms set crew_id = $2 where id = $1", h.room.ID, crew.ID); err != nil {
		t.Fatalf("place room in crew: %v", err)
	}
	s.sessionMail(t.Context(), h.room, "Sweet Spot", starts, h.planner.ID, sessionPlanned)
	if len(fake.payloads) != 1 {
		t.Fatalf("sent %d before the ban, want 1 — test proves nothing", len(fake.payloads))
	}

	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.optIn.ID, Role: "banned",
	}); err != nil {
		t.Fatalf("crew ban: %v", err)
	}
	fake.payloads = nil
	s.sessionMail(t.Context(), h.room, "Sweet Spot", starts, h.planner.ID, sessionPlanned)
	if len(fake.payloads) != 0 {
		t.Errorf("mailed a crew-banned member: %v", fake.payloads[0]["to"])
	}
}

func TestSessionRescheduledSaysMoved(t *testing.T) {
	h := setup(t)
	fake := &fakeResend{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()

	s := service(h, srv.URL)
	starts := time.Date(2026, 9, 2, 18, 30, 0, 0, time.Local)
	s.sessionMail(t.Context(), h.room, "Sweet Spot 2×20", starts, h.planner.ID, sessionMoved)

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

// The mail the other two owed the room (#839). Same audience and same switch;
// what differs is that nothing in it glows, because there is nothing live left
// to mark (ADR-0005).
func TestSessionCancelledSaysItIsNotHappening(t *testing.T) {
	h := setup(t)
	fake := &fakeResend{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()

	s := service(h, srv.URL)
	starts := time.Date(2026, 9, 3, 19, 0, 0, 0, time.Local)
	s.sessionMail(t.Context(), h.room, "Sweet Spot 2×20", starts, h.planner.ID, sessionCancelled)

	if len(fake.payloads) != 1 {
		t.Fatalf("sent %d emails, want exactly 1", len(fake.payloads))
	}
	p := fake.payloads[0]
	if subject := fmt.Sprint(p["subject"]); !strings.HasPrefix(subject, "Cancelled: ") {
		t.Fatalf("subject %q misses the Cancelled: prefix", subject)
	}
	text := fmt.Sprint(p["text"])
	if !strings.Contains(text, "cancelled a planned session") {
		t.Fatalf("body %q does not say the plan is off", text)
	}
	// "Ride it here" is a lie in a mail about a session that is not happening.
	if strings.Contains(text, "Ride it here") {
		t.Fatalf("a cancellation still invited the rider to ride it: %q", text)
	}
	html := fmt.Sprint(p["html"])
	if !strings.Contains(html, "It is not happening.") {
		t.Fatalf("html part does not say the plan is off: %s", html)
	}
	// The lead is the only magenta in a session mail's body, and a cancelled
	// session is the opposite of live data.
	if strings.Contains(html, "#ff3d8b;\">Sweet Spot") {
		t.Fatalf("a cancelled session still glowed: %s", html)
	}
}

// One mail, two riders, two clocks (#858). The time used to be formatted once
// for the whole room, which is what made it the server's zone rather than
// anybody's — so this is the test that fails if it ever moves back out of the
// per-target loop.
func TestSessionMailUsesEachRidersZone(t *testing.T) {
	h := setup(t)
	fake := &fakeResend{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()

	for _, set := range []struct {
		user db.User
		zone string
	}{{h.optIn, "Europe/Zurich"}, {h.optOut, "America/New_York"}} {
		if _, err := h.store.Pool.Exec(t.Context(),
			"update users set notify_planned = true, timezone = $2 where id = $1",
			set.user.ID, set.zone); err != nil {
			t.Fatalf("set zone: %v", err)
		}
	}

	s := service(h, srv.URL)
	// 17:00 UTC: 19:00 in Zurich, 13:00 in New York.
	starts := time.Date(2026, 9, 8, 17, 0, 0, 0, time.UTC)
	s.sessionMail(t.Context(), h.room, "Sweet Spot 2×20", starts, h.planner.ID, sessionPlanned)

	for _, want := range []struct {
		user db.User
		hour string
	}{{h.optIn, "19:00"}, {h.optOut, "13:00"}} {
		got := fake.subjectsTo(want.user.DisplayName + "@example.test")
		if len(got) != 1 {
			t.Fatalf("%s got %d mails, want 1", want.user.DisplayName, len(got))
		}
		if !strings.Contains(got[0], want.hour) {
			t.Fatalf("%s was told %q, want their own %s", want.user.DisplayName, got[0], want.hour)
		}
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
	err := s.send(t.Context(), mail{To: "x@example.test", Subject: "s", Text: "t", Unsub: "https://u"})
	// The status is the error and the body is kept aside (#1643): what gets
	// logged never carries the provider's words, which can name an address.
	var refused *sendError
	if !errors.As(err, &refused) || !strings.Contains(refused.Detail(), "invalid from") || strings.Contains(err.Error(), "invalid from") {
		t.Fatalf("err = %v, want the status alone with the detail aside", err)
	}
}

// The template is the only place rider-written text reaches an inbox as
// markup — a room name, a workout name — and the button href is the only
// place a link does. Both are escaped by html/template; this is what fails
// if someone reaches for text/template because it was "just a mail".
func TestMailRenderEscapesRiderText(t *testing.T) {
	out, err := mail{
		Subject: "s",
		Heading: "Kelly's <script>alert(1)</script> room",
		Lead:    "2×20 <b>bold</b>",
		Body:    []string{"tea & biscuits"},
		Action:  "Open the room",
		URL:     "javascript:alert(1)",
		BaseURL: "https://wattroom.example",
	}.render()
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	for _, unwanted := range []string{"<script>", "<b>bold", "javascript:alert"} {
		if strings.Contains(out, unwanted) {
			t.Fatalf("rendered mail carries %q unescaped: %s", unwanted, out)
		}
	}
	for _, want := range []string{"&lt;script&gt;", "tea &amp; biscuits"} {
		if !strings.Contains(out, want) {
			t.Fatalf("rendered mail misses %q: %s", want, out)
		}
	}
}

// A mail with nothing live in it has no Lead, and then nothing but the mark
// is magenta (ADR-0005). The confirmation is the one such mail today.
func TestMailWithoutLeadRendersNoButton(t *testing.T) {
	out, err := mail{Subject: "s", Heading: "Confirm your email address", BaseURL: "https://wattroom.example"}.render()
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if strings.Contains(out, "Turn them off") {
		t.Fatal("a mail with no unsubscribe link still rendered the bulk footer")
	}
	if strings.Contains(out, "border-radius:9px") {
		t.Fatal("a mail with no action still rendered a button")
	}
}

func verifiedUser(address string) db.User {
	return db.User{Email: &address, EmailVerifiedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true}}
}

// The security class is unconditional (ADR-0030) — no unsubscribe header, no
// setting — but it is not unaddressed: an account with no verified address
// hears nothing, because an unverified one is someone's typo until proven
// otherwise.
func TestAccountAlertOnlyReachesAVerifiedAddress(t *testing.T) {
	pending := "typo@example.test"
	for _, tc := range []struct {
		name string
		user db.User
		want bool
	}{
		{"verified", verifiedUser("rider@example.test"), true},
		{"no address at all", db.User{}, false},
		{"address still unverified", db.User{Email: &pending}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, ok := alertMail(tc.user, "A passkey was added to your account", "line", "Check your account", "https://wattroom.example/profile")
			if ok != tc.want {
				t.Fatalf("sendable = %v, want %v", ok, tc.want)
			}
			if !ok {
				return
			}
			if m.To != *tc.user.Email {
				t.Fatalf("addressed to %q, want %q", m.To, *tc.user.Email)
			}
			if m.Unsub != "" {
				t.Fatal("a security alert carried an unsubscribe link — the alarm has no off switch")
			}
		})
	}
}

// The purge receipt is the one alert with nothing to check afterwards, so it
// carries no button and none of the "if that was not you" reassurance that
// assumes an account still exists.
func TestAccountDeletedReceiptHasNothingToPress(t *testing.T) {
	m, ok := alertMail(verifiedUser("rider@example.test"), "Your WattRoom account was deleted", "It is gone.", "", "")
	if !ok {
		t.Fatal("no receipt for a verified address")
	}
	if m.Action != "" || m.URL != "" {
		t.Fatalf("receipt offered %q -> %q", m.Action, m.URL)
	}
	if len(m.Body) != 1 {
		t.Fatalf("receipt body = %q, want just the line", m.Body)
	}
}

// A room name with a line break in it used to write its own lines under the
// operator's signature — in the subject, which becomes a header, and in the
// text part (#1640). The HTML part was already safe.
func TestSessionMailCollapsesControlCharacters(t *testing.T) {
	h := setup(t)
	fake := &fakeResend{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	s := service(h, srv.URL)
	room := h.room
	room.Name = "Velvet\r\nBcc: victim@example.test\nHammer"
	s.sessionMail(t.Context(), room, "Openers\x00", time.Date(2026, 9, 1, 19, 0, 0, 0, time.Local), h.planner.ID, sessionPlanned)
	if len(fake.payloads) != 1 {
		t.Fatalf("sent %d", len(fake.payloads))
	}
	subject := fmt.Sprint(fake.payloads[0]["subject"])
	text := fmt.Sprint(fake.payloads[0]["text"])
	if strings.ContainsAny(subject, "\r\n\x00") || !strings.Contains(subject, "Velvet Bcc: victim@example.test Hammer") {
		t.Fatalf("subject %q", subject)
	}
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "Bcc:") {
			t.Fatalf("the text part grew a line of the room's making: %q", text)
		}
	}
}

// The per-room ceiling (#1639): a coach rescheduling in a loop mailed every
// member each time.
func TestSessionMailCeilingPerRoom(t *testing.T) {
	h := setup(t)
	s := service(h, "http://127.0.0.1:1")
	s.sessions = budget.New[pgtype.UUID](2, time.Hour)
	for i := 0; i < 2; i++ {
		if !s.allowSessionMail(h.room) {
			t.Fatalf("mail %d should be allowed", i)
		}
	}
	if s.allowSessionMail(h.room) {
		t.Fatal("the third is over the ceiling")
	}
	other := h.room
	other.ID = pgtype.UUID{Bytes: [16]byte{9}, Valid: true}
	if !s.allowSessionMail(other) {
		t.Fatal("another room has its own window")
	}
}

// ADR-0030: security mail does not come from the bulk sender's address
// (#1642), so a filter on the bulk sender cannot catch the alarm.
func TestAlarmsShipFromTheirOwnSender(t *testing.T) {
	h := setup(t)
	fake := &fakeResend{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	s := service(h, srv.URL)
	s.alertFrom = "WattRoom security <alerts@example.test>"
	// The opted-in member is the one the harness gave a verified address.
	rider, err := h.store.Queries.GetUser(t.Context(), h.optIn.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := alertMail(rider, "h", "l", "", ""); !ok {
		t.Fatalf("the harness's member has no verified address: %v", rider.Email)
	}
	s.AccountAlert(rider, "A passkey was added", "one line")
	deadline := time.Now().Add(3 * time.Second)
	for fake.sent() == 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.payloads) != 1 || fmt.Sprint(fake.payloads[0]["from"]) != s.alertFrom {
		t.Fatalf("alarm from %v, want the alarm's own sender", fake.payloads)
	}
}
