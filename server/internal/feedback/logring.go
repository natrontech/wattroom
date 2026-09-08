package feedback

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

// LogRing tees slog records into a bounded in-memory ring, so a report can
// staple the server's recent log onto itself. No log stack: it dies with the
// process (ponytail: the upgrade trigger lives in ADR-0006).
type LogRing struct {
	inner slog.Handler
	mu    sync.Mutex
	lines []string
	at    int
	full  bool
}

const ringSize = 400

func NewLogRing(inner slog.Handler) *LogRing {
	return &LogRing{inner: inner, lines: make([]string, ringSize)}
}

// ringFloor is what the REPORT keeps: Info and above, whatever stdout is set
// to. Debug is for somebody watching a terminal, and 400 lines of it would
// push the lines a rider's report actually needs out of the ring.
const ringFloor = slog.LevelInfo

func (l *LogRing) capture(r slog.Record) {
	if r.Level < ringFloor {
		return
	}
	line := fmt.Sprintf("%s %s %s", r.Time.UTC().Format(time.RFC3339), r.Level, r.Message)
	r.Attrs(func(a slog.Attr) bool {
		line += " " + a.Key + "=" + a.Value.String()
		return true
	})
	l.mu.Lock()
	l.lines[l.at] = line
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

// Snapshot returns the ring oldest-first.
func (l *LogRing) Snapshot() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	var out []string
	if l.full {
		out = append(out, l.lines[l.at:]...)
	}
	out = append(out, l.lines[:l.at]...)
	// Drop empty slots from a young ring.
	trimmed := out[:0]
	for _, line := range out {
		if line != "" {
			trimmed = append(trimmed, line)
		}
	}
	return trimmed
}
