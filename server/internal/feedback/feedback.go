// Package feedback is the alpha loop's intake (#53, ADR-0006): a rider's
// mid-ride flag becomes a durable report on disk first, then a deduplicated
// GitHub issue. Disk first is the invariant — a GitHub outage cannot lose a
// report.
package feedback

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Report is what the client submits. Validated at the boundary; the payload
// carries only the reporter's own telemetry (WATTROOM.md privacy rule) and
// the server never asks for more.
type Report struct {
	// Where it happened: "/ride", "/r/<slug>".
	Route string `json:"route"`
	// The rider's optional one-liner.
	Note string `json:"note"`
	// First console error at the marker, if any — the dedup key's core.
	FirstError string `json:"firstError"`
	// Client-side context: build, browser, trainer.
	ClientBuild string `json:"clientBuild"`
	UserAgent   string `json:"userAgent"`
	Trainer     string `json:"trainer"`
	// Marker clocks, both sides, so drift is visible.
	ClientMs int64 `json:"clientMs"`
	// The last ~2 minutes: samples, transitions, errors — typed, so only the
	// allowlisted fields reach disk or a public issue.
	Buffer Buffer `json:"buffer"`
}

// Buffer is the flight recorder's ring as the server is willing to keep it.
// Heart rate is health data (WATTROOM.md, ADR-0008: "never in a shared
// artifact") and has no field here; whatever a client adds beyond these
// fields is dropped, never stored, never filed.
type Buffer struct {
	Ticks  []Tick        `json:"ticks"`
	Events []BufferEvent `json:"events"`
	Errors []BufferError `json:"errors"`
}

// Tick is one recorded second: the rider's own power and cadence against the
// target, and the ride state at that moment.
type Tick struct {
	At      int64   `json:"at"`
	Watts   float64 `json:"watts"`
	Cadence float64 `json:"cadence"`
	Target  float64 `json:"target"`
	State   string  `json:"state"`
}

type BufferEvent struct {
	At   int64  `json:"at"`
	Kind string `json:"kind"`
	Text string `json:"text"`
}

type BufferError struct {
	At   int64  `json:"at"`
	Text string `json:"text"`
}

// UnmarshalJSON decodes leniently on purpose: the surrounding Report decoder
// rejects unknown fields, but an older client still shipping heart rate must
// have its flag land — stripped, not refused.
func (b *Buffer) UnmarshalJSON(data []byte) error {
	type plain Buffer
	var p plain
	if err := json.Unmarshal(data, &p); err != nil {
		return err
	}
	*b = Buffer(p)
	return nil
}

type Sessions interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// Issuer files the report upstream; nil means disk-only (dev without a token).
type Issuer interface {
	// FileOrComment creates an issue, or comments on the open issue matching
	// fingerprint. Returns the issue URL.
	FileOrComment(fingerprint, title, body string) (string, error)
}

type Service struct {
	sessions Sessions
	issuer   Issuer
	log      *slog.Logger
	ring     *LogRing
	dir      string
	buildSHA string

	mu       sync.Mutex
	lastSeen map[string]time.Time
}

func New(sessions Sessions, issuer Issuer, ring *LogRing, log *slog.Logger) *Service {
	dir := os.Getenv("WATTROOM_FEEDBACK_DIR")
	if dir == "" {
		dir = "feedback"
	}
	return &Service{
		sessions: sessions, issuer: issuer, ring: ring, log: log,
		dir:      dir,
		buildSHA: os.Getenv("WATTROOM_BUILD_SHA"),
		lastSeen: map[string]time.Time{},
	}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/feedback", s.handleSubmit)
}

func (s *Service) handleSubmit(w http.ResponseWriter, r *http.Request) {
	user, ok := s.sessions.RequireUser(w, r, "Sign in to send feedback.")
	if !ok {
		return
	}
	// One report per rider per 10 s: a stuck retry loop must not flood.
	// Keyed on the id (audit 2026-09-09): a display name is the rider's to
	// change, which reset their own bucket, and the map is swept so it does
	// not remember every rider ever seen.
	key := store.UUIDString(user.ID)
	s.mu.Lock()
	now := time.Now()
	for k, at := range s.lastSeen {
		if now.Sub(at) >= floodWindow {
			delete(s.lastSeen, k)
		}
	}
	if now.Sub(s.lastSeen[key]) < floodWindow {
		s.mu.Unlock()
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
			"That flag just went through — give it a few seconds.")
		return
	}
	s.lastSeen[key] = now
	s.mu.Unlock()

	r.Body = http.MaxBytesReader(w, r.Body, 512<<10)
	var report Report
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&report); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That report could not be read.")
		return
	}
	if len(report.Route) > 200 || len(report.Note) > 2000 || len(report.FirstError) > 2000 ||
		len(report.ClientBuild) > 200 || len(report.UserAgent) > 500 || len(report.Trainer) > 200 {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "That report is out of shape.")
		return
	}
	// The buffer is rider-controlled too (#2238), and the checks above covered
	// only the six scalars: its strings reach a public issue and its length
	// decides whether the issue can be filed at all (GitHub refuses a body
	// past 65 536 characters, and the only trace was a warning). Two minutes
	// at 1 Hz is what the recorder holds, so these are ceilings, not limits a
	// real client meets.
	if !boundedBuffer(report.Buffer) {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "That report is out of shape.")
		return
	}

	stored := map[string]any{
		"at":         now.UTC(),
		"reporter":   user.DisplayName,
		"reporterId": store.UUIDString(user.ID),
		"serverSHA":  s.buildSHA,
		"report":     report,
		"serverLog":  s.ring.Snapshot(store.UUIDString(user.ID)),
	}
	// Disk first — the invariant.
	if err := s.append(stored); err != nil {
		httpx.Fail(w, s.log, "feedback disk write failed", err, "The report could not be saved. Try once more.")
		return
	}

	issueURL := ""
	if s.issuer != nil {
		fp := Fingerprint(s.buildSHA, report.FirstError, report.Route)
		title := fmt.Sprintf("feedback: %s", firstLine(report.Note, report.FirstError, publicRoute(report.Route)))
		body := issueBody(s.buildSHA, report)
		url, err := s.issuer.FileOrComment(fp, title, body)
		if err != nil {
			// The report is on disk; GitHub can be retried from there.
			s.log.Warn("feedback issue failed, report kept on disk", "err", err)
		} else {
			issueURL = url
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"issue": issueURL})
}

func (s *Service) append(v any) error {
	if err := os.MkdirAll(s.dir, 0o750); err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(s.dir, "reports.jsonl"),
		os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	return json.NewEncoder(f).Encode(v)
}

// Fingerprint keys deduplication (#53's one piece of real logic): the same
// error on the same build on the same screen is one issue — a bad interval in
// a group ride produces one issue, not eight.
func Fingerprint(buildSHA, firstError, route string) string {
	// The error's first line only: stack depths differ per browser.
	errLine := firstError
	if i := strings.IndexByte(errLine, '\n'); i >= 0 {
		errLine = errLine[:i]
	}
	sum := sha256.Sum256([]byte(buildSHA + "\x00" + errLine + "\x00" + route))
	return hex.EncodeToString(sum[:8])
}

func firstLine(candidates ...string) string {
	for _, c := range candidates {
		c = strings.TrimSpace(c)
		if c != "" {
			if i := strings.IndexByte(c, '\n'); i >= 0 {
				c = c[:i]
			}
			if len(c) > 80 {
				c = c[:80]
			}
			return c
		}
	}
	return "mid-ride flag"
}

// issueBody is what a stranger reads. The reporter's name is not in it: the
// disk record keeps it for triage, the issue URL goes back to the rider who
// filed the report, and this repository's issues are public (#737). The route
// arrives redacted for the same reason — a display name plus the room someone
// was in is the same disclosure in two halves.
func issueBody(sha string, report Report) string {
	buffer, _ := json.Marshal(report.Buffer)
	// Every rider-supplied field is fenced (audit 2026-09-09): this lands in
	// a public issue, and prose there is Markdown — a note could carry an
	// image or a link. Backticks inside a value would end the fence early.
	//
	// The buffer included (#2238). Its `kind`, `text` and `state` are
	// rider-controlled and JSON does not escape backticks — though a fence
	// inside one cannot close this block today, because json.Marshal escapes
	// newlines so the block is a single line and a Markdown fence closes only
	// at the start of one. The block's integrity should not rest on how we
	// happen to serialise it, and the replacement costs nothing.
	return fmt.Sprintf(
		"Route: %s\nServer: `%s` · Client: %s\nUA: %s\nTrainer: %s\n\n```text\n%s\n```\n\n<details><summary>last two minutes</summary>\n\n```json\n%s\n```\n</details>\n",
		fenced(publicRoute(report.Route)), sha, fenced(report.ClientBuild), fenced(report.UserAgent),
		fenced(report.Trainer), strings.ReplaceAll(report.Note, "```", "'''"),
		strings.ReplaceAll(string(buffer), "```", "'''"),
	)
}

// What the flight recorder can honestly have seen in its two minutes (#2238),
// with room to spare: the ring is 1 Hz and its events are rider actions.
const (
	maxBufferTicks  = 600
	maxBufferEvents = 300
	maxBufferErrors = 200
	maxBufferText   = 500
)

// boundedBuffer reports whether the recorder's ring is within those ceilings.
func boundedBuffer(b Buffer) bool {
	if len(b.Ticks) > maxBufferTicks || len(b.Events) > maxBufferEvents ||
		len(b.Errors) > maxBufferErrors {
		return false
	}
	for _, t := range b.Ticks {
		if len(t.State) > maxBufferText {
			return false
		}
	}
	for _, e := range b.Events {
		if len(e.Kind) > maxBufferText || len(e.Text) > maxBufferText {
			return false
		}
	}
	for _, e := range b.Errors {
		if len(e.Text) > maxBufferText {
			return false
		}
	}
	return true
}

// floodWindow is the one-report-per-rider spacing the limiter keeps.
const floodWindow = 10 * time.Second

// fenced puts a rider's string in inline code with nothing that could close it.
func fenced(s string) string {
	return "`" + strings.NewReplacer("`", "'", "\n", " ", "\r", " ").Replace(s) + "`"
}

// routeSegments is every path segment the route tree (web/src/routes) spells
// out literally, and paramUnder is every place in that tree where a parameter
// stands — keyed by the path above it. Between them they are the whole
// vocabulary a public issue may quote: everything else a route can hold is a
// parameter, and every parameter this app has names somebody — a room slug, a
// rider id, a crew id, a ride id, and `/c/{code}`, a crew invite code where
// knowing it IS the permission to join.
//
// An allowlist rather than the list of name-carrying prefixes this used to be
// (#2240): that list held two of the eight route shapes that carry a name,
// and the next shape added would not have been on it either. Inverted, the
// route nobody has taught these lists about reads as `/…` — the failure that
// discloses nothing. paramUnder is what keeps a room actually called "chat"
// from reading as a screen; routeSegments is what catches the screen nobody
// has declared. The table tests below walk the route tree, so an omission
// from either is loud rather than silent.
var (
	routeSegments = fieldSet(`
		account appearance board brand c card channel chat components crew crews data dev directory
		dm download edit editor enter equipment friends hardware history home
		hud import legal licenses login medal members messages modes music
		notifications pairing panel pins privacy profile progression r ramp
		recover ride rooms schedule sessions settings sitemap.xml sound spectator
		styleguide summary terms theme-editor themes training trophies u
		s v voice watch whats-new workouts
		de ftp-test game-modes group-workouts self-host smart-trainer-app vs zwift-alternative
	`)
	// Keyed by the prefix as already redacted, so a parameter under another
	// one has a name: /crew/[id]/c/[channel] is `/crew/…/c` (#2448), and a
	// voice channel's /crew/[id]/v/[channel] is `/crew/…/v` (#2449), and a
	// session's /crew/[id]/s/[session] is `/crew/…/s` (#2450).
	paramUnder = fieldSet(`
		/c /crew /crew/…/c /crew/…/s /crew/…/v /dm /history /messages/dm /messages/r /r /u /vs
	`)
)

func fieldSet(list string) map[string]bool {
	m := make(map[string]bool)
	for _, f := range strings.Fields(list) {
		m[f] = true
	}
	return m
}

// publicRoute is the route as a stranger may read it: the screen, never who
// was on it (#737, ADR-0006 — "the public issue names nobody"). A segment
// standing in a parameter's place, and any segment the route tree does not
// spell out, become an ellipsis; a query or fragment is dropped whole, the
// field being rider-supplied and so one more place a name could be posted.
// Fingerprint keeps the full route, so per-room deduplication is unaffected.
func publicRoute(route string) string {
	if i := strings.IndexAny(route, "?#"); i >= 0 {
		route = route[:i]
	}
	segs := strings.Split(route, "/")
	out := make([]string, len(segs))
	copy(out, segs)
	for i, seg := range segs {
		if seg == "" {
			continue
		}
		if paramUnder[strings.Join(out[:i], "/")] || !routeSegments[seg] {
			out[i] = "…"
		}
	}
	return strings.Join(out, "/")
}
