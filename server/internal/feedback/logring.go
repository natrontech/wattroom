package feedback

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
)

// LogRing tees slog records into a bounded in-memory ring, so a report can
// staple the server's recent log onto itself. No log stack: it dies with the
// process (ponytail: the upgrade trigger lives in ADR-0006).
type LogRing struct {
	inner slog.Handler
	mu    sync.Mutex
	lines []entry
	at    int
	full  bool
}

// entry keeps a record's attributes apart from its head, so Snapshot can tell
// whose line it is. Values are formatted at capture, as the line always was.
type entry struct {
	head   string
	fields []field
}

type field struct{ key, val string }

const ringSize = 400

func NewLogRing(inner slog.Handler) *LogRing {
	return &LogRing{inner: inner, lines: make([]entry, ringSize)}
}

// ringFloor is what the REPORT keeps: Info and above, whatever stdout is set
// to. Debug is for somebody watching a terminal, and 400 lines of it would
// push the lines a rider's report actually needs out of the ring.
const ringFloor = slog.LevelInfo

func (l *LogRing) capture(r slog.Record) {
	if r.Level < ringFloor {
		return
	}
	e := entry{head: fmt.Sprintf("%s %s %s", r.Time.UTC().Format(time.RFC3339), r.Level, r.Message)}
	r.Attrs(func(a slog.Attr) bool {
		e.fields = append(e.fields, field{a.Key, a.Value.String()})
		return true
	})
	l.mu.Lock()
	l.lines[l.at] = e
	l.at = (l.at + 1) % ringSize
	if l.at == 0 {
		l.full = true
	}
	l.mu.Unlock()
}

func (l *LogRing) Handle(ctx context.Context, r slog.Record) error {
	l.capture(r)
	if !l.inner.Enabled(ctx, r.Level) {
		return nil
	}
	return l.inner.Handle(ctx, r)
}

// Enabled is the ring's own floor OR the inner handler's — never the ring's
// alone. Being the OUTER handler, slog asks this first, so pinning it at Info
// dropped every Debug record before stdout was ever consulted and made every
// `log.Debug` call in the server dead code (#1098). The cue lines #152 wrote
// "for headless diagnosis" have never once been printed.
//
// The comment this replaces said the ring "must capture even what stdout
// filters", which is true and is served by capture() running ahead of the
// inner handler in Handle — not by refusing records here.
func (l *LogRing) Enabled(ctx context.Context, level slog.Level) bool {
	return level >= ringFloor || l.inner.Enabled(ctx, level)
}
func (l *LogRing) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &ringChild{ring: l, inner: l.inner.WithAttrs(attrs)}
}
func (l *LogRing) WithGroup(name string) slog.Handler {
	return &ringChild{ring: l, inner: l.inner.WithGroup(name)}
}

// ringChild keeps derived handlers writing into the same ring.
type ringChild struct {
	ring  *LogRing
	inner slog.Handler
}

func (c *ringChild) Handle(ctx context.Context, r slog.Record) error {
	c.ring.capture(r)
	if !c.inner.Enabled(ctx, r.Level) {
		return nil
	}
	return c.inner.Handle(ctx, r)
}
func (c *ringChild) Enabled(ctx context.Context, level slog.Level) bool {
	return level >= ringFloor || c.inner.Enabled(ctx, level)
}
func (c *ringChild) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &ringChild{ring: c.ring, inner: c.inner.WithAttrs(attrs)}
}
func (c *ringChild) WithGroup(name string) slog.Handler {
	return &ringChild{ring: c.ring, inner: c.inner.WithGroup(name)}
}

// Snapshot returns, oldest first, the lines that name the reporter as their
// rider or user: "the session's own log lines", never the room's (ADR-0006,
// #2822). The ring is process-wide, so everything else in it is somebody
// else's — a co-rider's join, another account's deletion, a panic from
// another request — and is left out. On a kept line, any other id outside the
// rider's own context (their channel, crew, session, ride) is blanked, since
// a line about the reporter can still name who they acted on.
func (l *LogRing) Snapshot(reporter string) []string {
	l.mu.Lock()
	var entries []entry
	if l.full {
		entries = append(entries, l.lines[l.at:]...)
	}
	entries = append(entries, l.lines[:l.at]...)
	l.mu.Unlock()
	var out []string
	for _, e := range entries {
		if reporter != "" && e.names(reporter) {
			out = append(out, e.line(reporter))
		}
	}
	return out
}

// personKeys are the attributes a log line names its rider by.
var personKeys = map[string]bool{"rider": true, "user": true}

// contextKeys hold ids of the reporter's own surroundings, kept on their lines.
var contextKeys = map[string]bool{"channel": true, "crew": true, "session": true, "ride": true}

func (e entry) names(reporter string) bool {
	for _, f := range e.fields {
		if personKeys[f.key] && f.val == reporter {
			return true
		}
	}
	return false
}

func (e entry) line(reporter string) string {
	line := e.head
	for _, f := range e.fields {
		val := f.val
		if val != reporter && !contextKeys[f.key] && uuid.Validate(val) == nil {
			val = "(someone else)"
		}
		line += " " + f.key + "=" + val
	}
	return line
}
