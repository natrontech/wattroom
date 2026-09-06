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

// What a session mail is about. The three share an audience, an opt-in and a
// shape; only the words differ, which is why they share a path (ADR-0030 puts
// all of them behind the one notify_planned switch).
type sessionChange int

const (
	sessionPlanned sessionChange = iota
	sessionMoved
	sessionCancelled
	sessionReminder
)

// SessionPlanned emails every opted-in member except the planner. Fire and
// forget: the handler must not wait on a mail provider. The goroutine exits
// when the member list is sent or the one-minute context runs out.
func (s *Service) SessionPlanned(room db.Room, workoutName string, startsAt time.Time, planner pgtype.UUID) {
	s.sessionAsync(room, workoutName, startsAt, planner, sessionPlanned)
}

// SessionRescheduled is SessionPlanned for a plan that moved (#258): same
// audience, subject and body say so.
func (s *Service) SessionRescheduled(room db.Room, workoutName string, startsAt time.Time, planner pgtype.UUID) {
	s.sessionAsync(room, workoutName, startsAt, planner, sessionMoved)
}

// SessionCancelled is the mail the other two owed the room (#839): riders told
// to turn up at seven were never told the plan was gone. startsAt is when the
// session would have been.
func (s *Service) SessionCancelled(room db.Room, workoutName string, startsAt time.Time, actor pgtype.UUID) {
	s.sessionAsync(room, workoutName, startsAt, actor, sessionCancelled)
}

func (s *Service) sessionAsync(room db.Room, workoutName string, startsAt time.Time, planner pgtype.UUID, change sessionChange) {
	// Guarded (#651): a mail-provider panic must not cost a ride.
	safego.Go(s.log, "session mail "+room.Slug, func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		s.sessionMail(ctx, room, workoutName, startsAt, planner, change)
	})
}

func (s *Service) sessionMail(ctx context.Context, room db.Room, workoutName string, startsAt time.Time, planner pgtype.UUID, change sessionChange) {
	targets, err := s.store.Queries.ListRoomNotifyTargets(ctx, db.ListRoomNotifyTargetsParams{
		RoomID: room.ID, ID: planner,
	})
	if err != nil {
		s.log.Error("notify targets query failed", "err", err, "room", room.Slug)
		return
	}
	// Everything below that names a time is now per rider (#858), so it waits
	// for the loop: only the words that are the same for the whole room are
	// settled here.
	prefix := ""
	verb := "has a planned session"
	// The heading stands on its own, so it cannot end on the dangling "to"
	// that the sentence in the text part needs.
	heading := room.Name + " has a planned session"
	// Where the last line of the text part points. A cancellation has nothing
	// to ride, but the room is still where anything else planned lives.
	closing := "Ride it here"
	switch change {
	case sessionPlanned:
	case sessionReminder:
		// Deliberately relative, and so the one session mail that needs no
		// zone at all: "in an hour" is correct everywhere, and a one-minute
		// tick against a one-hour window keeps it accurate to the minute.
		verb = "rides in an hour"
		heading = room.Name + " rides in an hour"
	case sessionMoved:
		prefix = "Moved: "
		verb = "moved a planned session to"
		heading = room.Name + " moved a planned session"
	case sessionCancelled:
		prefix = "Cancelled: "
		verb = "cancelled a planned session"
		heading = room.Name + " cancelled a planned session"
		closing = "Anything else planned is here"
	}
	for _, t := range targets {
		// The rider's own clock, or the server's when no browser of theirs has
		// reported one yet.
		when := localTime(startsAt, t.Timezone)
		subject := fmt.Sprintf("%s%s rides %s — %s", prefix, room.Name, workoutName, when)
		detail := when
		if change == sessionReminder {
			subject = fmt.Sprintf("%s rides %s in an hour", room.Name, workoutName)
			detail = "in an hour"
		}
		unsub := fmt.Sprintf("%s/api/notify/unsubscribe?u=%s&t=%s",
			s.baseURL, store.UUIDString(t.ID), store.UUIDString(t.UnsubToken))
		text := fmt.Sprintf(`%s %s:

    %s
    %s

%s: %s/r/%s

You get this because session emails are switched on in your WattRoom
profile. Turn them off: %s`,
			room.Name, verb, workoutName, detail, closing, s.baseURL, room.Slug, unsub)
		m := mail{
			To: *t.Email, Subject: subject, Heading: heading,
			Action: "Open the room", URL: s.baseURL + "/r/" + room.Slug,
			Text: text, Unsub: unsub,
		}
		switch change {
		case sessionReminder:
			// The session is about to happen, which is as live as this mail
			// gets, so the workout is what glows. No body: the heading already
			// says "in an hour", and saying it twice on a card this small
			// reads as padding.
			m.Lead = workoutName
		case sessionCancelled:
			// Nothing is happening at that time any more, so nothing glows:
			// watt marks live data, and this mail exists to say there is none
			// (ADR-0005). The session moves out of the lead and into the body.
			m.Body = []string{workoutName + " was planned for " + when + ". It is not happening."}
		case sessionPlanned, sessionMoved:
			// The workout and its time are the live thing this mail is about,
			// so they are what glows.
			m.Lead = workoutName + " — " + when
		}
		if err := s.send(ctx, m); err != nil {
			s.log.Warn("session email failed", "err", err, "room", room.Slug)
		}
	}
}

func (s *Service) send(ctx context.Context, m mail) error {
	m.BaseURL = s.baseURL
	rendered, err := m.render()
	if err != nil {
		return err
	}
	// Both parts in one call (#838): a client that will not render HTML, or a
	// rider who told it not to, still gets the words — and the text part is
	// the copy that was already written and already good.
	body := map[string]any{
		"from": s.from, "to": []string{m.To}, "subject": m.Subject,
		"text": m.Text, "html": rendered,
	}
	// Only bulk mail carries the header. A transactional mail — the address
	// confirmation (#781) — has nothing to unsubscribe from, and pointing the
	// one-click header at a link that does not apply is worse than omitting it.
	if m.Unsub != "" {
		// RFC 8058 one-click: mail clients POST here, which our handler flips.
		body["headers"] = map[string]string{
			"List-Unsubscribe":      "<" + m.Unsub + ">",
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
	text := fmt.Sprintf(`Confirm this address so WattRoom can get you back into your
account if you ever lose the way you sign in:

%s

The link works once and expires in a day. If you did not add this address to
a WattRoom account, ignore this — nothing happens until someone follows it.`, link)
	// No Lead: nothing in this mail is live data, so nothing in it glows.
	return s.send(ctx, mail{
		To: to, Subject: "Confirm your WattRoom email address",
		Heading: "Confirm your email address",
		Body: []string{
			"Confirm this address so WattRoom can get you back into your account if you ever lose the way you sign in.",
			"The link works once and expires in a day. If you did not add this address to a WattRoom account, ignore this — nothing happens until someone follows it.",
		},
		Action: "Confirm this address", URL: link,
		Text: text,
	})
}

// AccountAlert mails a rider that a way into their account changed (#840,
// ADR-0030). One template and one variable line across every trigger — a
// passkey, a provider, the recovery address — because the moment there are two
// security templates there are ten.
//
// Transactional: no unsubscribe header and no setting, since an alarm with an
// off switch is a decoration. Silent when the account holds no verified
// address; an unverified one is someone's typo until proven otherwise, and
// account activity is not something to narrate to it.
//
// The user passed in is whichever row holds the address that should hear about
// this — for a replaced address that is the row as it was *before* the
// replacement, which is the whole point of the alert.
func (s *Service) AccountAlert(user db.User, heading, line string) {
	s.alert(user, heading, line, "Check your account", s.baseURL+"/profile")
}

// AccountDeleted is the receipt for a purge. Same template, but nothing to
// check afterwards and nothing to undo, so it carries no button — the one
// alert whose subject is not something the rider might want to reverse.
func (s *Service) AccountDeleted(user db.User) {
	s.alert(user, "Your WattRoom account was deleted",
		"Your account is gone, and so is every ride, room membership and message that belonged to it. "+
			"Nothing was kept and there is nothing to undo.", "", "")
}

func (s *Service) alert(user db.User, heading, line, action, url string) {
	m, ok := alertMail(user, heading, line, action, url)
	if !ok {
		return
	}
	// Guarded and detached like the session mails: a mail provider must never
	// be on the path of an account action, and must never fail one.
	safego.Go(s.log, "account alert", func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if err := s.send(ctx, m); err != nil {
			// The address, never the account: this log line is about mail.
			s.log.Warn("account alert failed", "err", err)
		}
	})
}

// alertMail builds the alert, or reports that there is nobody to send it to.
// Separate from the sending so the rule that decides who hears about an
// account event is a plain function a test can ask directly.
func alertMail(user db.User, heading, line, action, url string) (mail, bool) {
	if user.Email == nil || !user.EmailVerifiedAt.Valid {
		return mail{}, false
	}
	body := []string{line}
	text := line
	if action != "" {
		body = append(body,
			"If that was you, there is nothing to do. If it was not, open your profile and check what your account signs in with.")
		text += "\n\nIf that was you, there is nothing to do. If it was not, check what your\naccount signs in with: " + url
	}
	return mail{
		To: *user.Email, Subject: heading, Heading: heading, Body: body,
		Action: action, URL: url, Text: text,
	}, true
}
