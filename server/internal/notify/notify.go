// Package notify emails riders about planned sessions (#117). Resend is one
// authenticated POST, so the client is stdlib net/http — no SDK. Without
// WATTROOM_RESEND_KEY the constructor returns nil and nothing here exists:
// no dead settings UI, no dead endpoint (capability gating).
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type Service struct {
	store   *store.Store
	log     *slog.Logger
	baseURL string
	from    string
	key     string
	apiURL  string
	httpc   *http.Client
}

func New(st *store.Store, log *slog.Logger, baseURL string) *Service {
	key := os.Getenv("WATTROOM_RESEND_KEY")
	if key == "" {
		return nil
	}
	from := os.Getenv("WATTROOM_MAIL_FROM")
	if from == "" {
		from = "WattRoom <rides@wattroom.ch>"
	}
	return &Service{
		store: st, log: log, baseURL: baseURL, from: from, key: key,
		apiURL: "https://api.resend.com/emails",
		httpc:  &http.Client{Timeout: 15 * time.Second},
	}
}

func (s *Service) Register(mux *http.ServeMux) {
	// GET shows a confirm button instead of flipping the setting: mail
	// scanners prefetch GET links and would unsubscribe riders silently.
	mux.HandleFunc("GET /api/notify/unsubscribe", s.handleUnsubscribeForm)
	mux.HandleFunc("POST /api/notify/unsubscribe", s.handleUnsubscribe)
}

// SessionPlanned emails every opted-in member except the planner. Fire and
// forget: the handler must not wait on a mail provider. The goroutine exits
// when the member list is sent or the one-minute context runs out.
func (s *Service) SessionPlanned(room db.Room, workoutName string, startsAt time.Time, planner pgtype.UUID) {
	s.sessionAsync(room, workoutName, startsAt, planner, false)
}

// SessionRescheduled is SessionPlanned for a plan that moved (#258): same
// audience, subject and body say so.
func (s *Service) SessionRescheduled(room db.Room, workoutName string, startsAt time.Time, planner pgtype.UUID) {
	s.sessionAsync(room, workoutName, startsAt, planner, true)
}

func (s *Service) sessionAsync(room db.Room, workoutName string, startsAt time.Time, planner pgtype.UUID, moved bool) {
	// Guarded (#651): a mail-provider panic must not cost a ride.
	safego.Go(s.log, "session mail "+room.Slug, func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		s.sessionMail(ctx, room, workoutName, startsAt, planner, moved)
	})
}

func (s *Service) sessionMail(ctx context.Context, room db.Room, workoutName string, startsAt time.Time, planner pgtype.UUID, moved bool) {
	targets, err := s.store.Queries.ListRoomNotifyTargets(ctx, db.ListRoomNotifyTargetsParams{
		RoomID: room.ID, ID: planner,
	})
	if err != nil {
		s.log.Error("notify targets query failed", "err", err, "room", room.Slug)
		return
	}
	// ponytail: times render in the server's zone — per-rider zones when riders ask.
	when := startsAt.Local().Format("Mon 2 Jan, 15:04")
	subject := fmt.Sprintf("%s rides %s — %s", room.Name, workoutName, when)
	verb := "has a planned session"
	if moved {
		subject = "Moved: " + subject
		verb = "moved a planned session to"
	}
	for _, t := range targets {
		unsub := fmt.Sprintf("%s/api/notify/unsubscribe?u=%s&t=%s",
			s.baseURL, store.UUIDString(t.ID), store.UUIDString(t.UnsubToken))
		body := fmt.Sprintf(`%s %s:

    %s
    %s

Ride it here: %s/r/%s

You get this because session emails are switched on in your WattRoom
profile. Turn them off: %s`,
			room.Name, verb, workoutName, when, s.baseURL, room.Slug, unsub)
		if err := s.send(ctx, *t.Email, subject, body, unsub); err != nil {
			s.log.Warn("session email failed", "err", err, "room", room.Slug)
		}
	}
}

func (s *Service) send(ctx context.Context, to, subject, text, unsub string) error {
	body := map[string]any{
		"from": s.from, "to": []string{to}, "subject": subject, "text": text,
	}
	// Only bulk mail carries the header. A transactional mail — the address
	// confirmation (#781) — has nothing to unsubscribe from, and pointing the
	// one-click header at a link that does not apply is worse than omitting it.
	if unsub != "" {
		// RFC 8058 one-click: mail clients POST here, which our handler flips.
		body["headers"] = map[string]string{
			"List-Unsubscribe":      "<" + unsub + ">",
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
		}
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.apiURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.key)
	req.Header.Set("Content-Type", "application/json")
	res, err := s.httpc.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("resend: %s: %s", res.Status, detail)
	}
	return nil
}

func unsubParams(r *http.Request) (id, token pgtype.UUID, ok bool) {
	id, err1 := store.ParseUUID(r.URL.Query().Get("u"))
	token, err2 := store.ParseUUID(r.URL.Query().Get("t"))
	return id, token, err1 == nil && err2 == nil
}

// handleUnsubscribeForm answers the emailed link with a plain confirm page —
// the click comes from a mail client, not the SPA.
func (s *Service) handleUnsubscribeForm(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := unsubParams(r); !ok {
		s.unsubOutcome(w, http.StatusBadRequest, "That link is incomplete",
			"Use the link from the email, or switch emails off in your WattRoom profile.")
		return
	}
	// No action attribute: the form posts back to this same URL, query and
	// all — nothing request-derived is ever written into the HTML.
	httpx.WritePage(w, http.StatusOK, "Unsubscribe", httpx.PageBody(
		"Stop WattRoom session emails?",
		"You can turn them back on any time in your profile.",
		`<form method="post"><button>Unsubscribe</button></form>`))
}

// unsubOutcome is the page the click lands on: a mail client sent it, so the
// answer is a page in the app's shell, not JSON (#832).
func (s *Service) unsubOutcome(w http.ResponseWriter, status int, heading, line string) {
	httpx.WritePage(w, status, heading, httpx.PageBody(heading, line,
		httpx.PageLink(s.baseURL+"/profile", "Back to WattRoom")))
}

func (s *Service) handleUnsubscribe(w http.ResponseWriter, r *http.Request) {
	id, token, ok := unsubParams(r)
	if !ok {
		s.unsubOutcome(w, http.StatusBadRequest, "That link is incomplete",
			"Use the link from the email, or switch emails off in your WattRoom profile.")
		return
	}
	rows, err := s.store.Queries.UnsubscribePlanned(r.Context(), db.UnsubscribePlannedParams{
		ID: id, UnsubToken: token,
	})
	if err != nil {
		s.log.Error("unsubscribe failed", "err", err)
		s.unsubOutcome(w, http.StatusInternalServerError, "That did not work",
			"The unsubscribe failed on our side. Try the link again.")
		return
	}
	if rows == 0 {
		s.unsubOutcome(w, http.StatusNotFound, "That link does not match an account",
			"Emails may already be off.")
		return
	}
	s.unsubOutcome(w, http.StatusOK, "Done — no more session emails",
		"Turn them back on any time in your WattRoom profile.")
}

// SendEmailVerification puts the confirm link in front of a rider (#781).
// Package auth owns the ceremony and calls this through its Mailer interface;
// notify owns the transport and the words.
func (s *Service) SendEmailVerification(ctx context.Context, to, link string) error {
	body := fmt.Sprintf(`Confirm this address so WattRoom can get you back into your
account if you ever lose the way you sign in:

%s

The link works once and expires in a day. If you did not add this address to
a WattRoom account, ignore this — nothing happens until someone follows it.`, link)
	return s.send(ctx, to, "Confirm your WattRoom email address", body, "")
}
