// Package notify emails riders about planned sessions (#117). Resend is one
// authenticated POST, so the client is stdlib net/http — no SDK. Without
// WATTROOM_RESEND_KEY the constructor returns nil and nothing here exists:
// no dead settings UI, no dead endpoint (capability gating).
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/natrontech/wattroom/server/internal/budget"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
)

type Service struct {
	store   *store.Store
	log     *slog.Logger
	baseURL string
	from    string
	// The alarm's own sender (#1642, ADR-0030): a filter or a throttle on
	// the bulk sender must not take the alarm down with it.
	alertFrom string
	key       string
	apiURL    string
	httpc     *http.Client
	// How much session mail one crew may cause an hour (#1639): a coach
	// rescheduling in a loop mailed every member each time, unbounded.
	// ponytail: the room's number, now per crew (#2440); a crew plans more
	// than one room did, so raise it if a busy crew's mail starts to stall.
	sessions *budget.Budget[pgtype.UUID]
}

// The ceiling on handler-triggered session mail per crew. The clock's own
// reminder is not counted: it is once per session by construction.
const (
	sessionMailsPerWindow = 10
	sessionMailWindow     = time.Hour
)

func New(st *store.Store, log *slog.Logger, baseURL string) *Service {
	key := os.Getenv("WATTROOM_RESEND_KEY")
	if key == "" {
		return nil
	}
	svc := Bare(st, log, baseURL)
	svc.key = key
	return svc
}

// Bare is the service with no way to send (#1643): what the unsubscribe
// link needs — a link already in a rider's inbox has to keep working after
// the sending key is unset or rotated, and RFC 8058 obliges us to honour it.
func Bare(st *store.Store, log *slog.Logger, baseURL string) *Service {
	from := os.Getenv("WATTROOM_MAIL_FROM")
	if from == "" {
		from = "WattRoom <rides@wattroom.ch>"
	}
	alertFrom := os.Getenv("WATTROOM_ALERT_FROM")
	if alertFrom == "" {
		alertFrom = from
	}
	return &Service{
		store: st, log: log, baseURL: baseURL, from: from, alertFrom: alertFrom,
		apiURL:   "https://api.resend.com/emails",
		httpc:    &http.Client{Timeout: 15 * time.Second},
		sessions: budget.New[pgtype.UUID](sessionMailsPerWindow, sessionMailWindow),
	}
}

func (s *Service) Register(mux *http.ServeMux) {
	s.RegisterUnsubscribe(mux)
}

// RegisterUnsubscribe mounts the two unsubscribe routes; they need the store
// and nothing else, so a Bare service mounts them too.
func (s *Service) RegisterUnsubscribe(mux *http.ServeMux) {
	// GET shows a confirm button instead of flipping the setting: mail
	// scanners prefetch GET links and would unsubscribe riders silently.
	mux.HandleFunc("GET /api/notify/unsubscribe", s.handleUnsubscribeForm)
	mux.HandleFunc("POST /api/notify/unsubscribe", s.handleUnsubscribe)
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
	from := s.from
	if m.From != "" {
		from = m.From
	}
	body := map[string]any{
		"from": from, "to": []string{m.To}, "subject": m.Subject,
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
		return &sendError{status: res.Status, detail: string(detail)}
	}
	return nil
}

// sendError is the provider refusing. Its Error() is the status alone
// (#1643): the error is logged, into the ring the feedback report carries,
// and the provider's body can name an address. The body stays on Detail for
// whoever holds the error and wants it.
type sendError struct {
	status string
	detail string
}

func (e *sendError) Error() string  { return "resend: " + e.status }
func (e *sendError) Detail() string { return e.detail }
