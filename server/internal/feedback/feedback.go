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
	// The last ~2 minutes: samples, transitions, errors — opaque JSON,
	// size-bounded at the boundary.
	Buffer json.RawMessage `json:"buffer"`
}

type Sessions interface {
	User(r *http.Request) (db.User, bool)
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
	user, ok := s.sessions.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Sign in to send feedback.")
		return
	}
	// One report per rider per 10 s: a stuck retry loop must not flood.
	s.mu.Lock()
	last := s.lastSeen[user.DisplayName]
	now := time.Now()
	if now.Sub(last) < 10*time.Second {
		s.mu.Unlock()
		httpx.WriteError(w, http.StatusTooManyRequests, "invalid_request",
			"That flag just went through — give it a few seconds.")
		return
	}
	s.lastSeen[user.DisplayName] = now
	s.mu.Unlock()

	r.Body = http.MaxBytesReader(w, r.Body, 512<<10)
	var report Report
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&report); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That report could not be read.")
		return
	}
	if len(report.Route) > 200 || len(report.Note) > 2000 || len(report.FirstError) > 2000 {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "That report is out of shape.")
		return
	}

	stored := map[string]any{
		"at":        now.UTC(),
		"reporter":  user.DisplayName,
		"serverSHA": s.buildSHA,
		"report":    report,
		"serverLog": s.ring.Snapshot(),
	}
	// Disk first — the invariant.
	if err := s.append(stored); err != nil {
		s.log.Error("feedback disk write failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"The report could not be saved. Try once more.")
		return
	}

	issueURL := ""
	if s.issuer != nil {
		fp := Fingerprint(s.buildSHA, report.FirstError, report.Route)
		title := fmt.Sprintf("feedback: %s", firstLine(report.Note, report.FirstError, report.Route))
		body := issueBody(user.DisplayName, s.buildSHA, report)
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

func issueBody(reporter, sha string, report Report) string {
	buffer, _ := json.Marshal(report.Buffer)
	return fmt.Sprintf(
		"Reporter: %s\nRoute: `%s`\nServer: `%s` · Client: `%s`\nUA: %s\nTrainer: %s\n\n%s\n\n<details><summary>last two minutes</summary>\n\n```json\n%s\n```\n</details>\n",
		reporter, report.Route, sha, report.ClientBuild, report.UserAgent,
		report.Trainer, report.Note, string(buffer),
	)
}
