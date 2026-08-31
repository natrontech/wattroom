package og

import (
	"bytes"
	"context"
	"image/png"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testService() *Service {
	lookup := func(_ context.Context, slug string) (string, string, bool) {
		if slug == "tuesday-crew" {
			return `Tuesday <Crew> & "friends"`, "🚴", true
		}
		return "", "", false
	}
	return New("https://wattroom.ch/", lookup, slog.New(slog.DiscardHandler))
}

func TestRender(t *testing.T) {
	s := testService()
	cases := []struct{ name, title, sub string }{
		{"default", defaultTitle, siteDesc},
		{"room", "Tuesday Crew", roomSub},
		{"emoji-only title falls back", "🚴🔥", roomSub},
		{"long title truncates", strings.Repeat("Zurich Winter Base Camp ", 6), roomSub},
		{"widest glyphs", strings.Repeat("W", 40), roomSub},
		{"unbroken word", strings.Repeat("Hammerzeit", 12), roomSub},
		{"long subtitle", "Tuesday Crew", strings.Repeat("ride together ", 12)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			buf, err := s.Render(tc.title, tc.sub)
			if err != nil {
				t.Fatal(err)
			}
			img, err := png.Decode(bytes.NewReader(buf))
			if err != nil {
				t.Fatal(err)
			}
			if b := img.Bounds(); b.Dx() != 1200 || b.Dy() != 630 {
				t.Fatalf("got %dx%d, want 1200x630", b.Dx(), b.Dy())
			}
			r, g, bb, _ := img.At(1199, 0).RGBA()
			wr, wg, wb, _ := surface.RGBA()
			if r != wr || g != wg || bb != wb {
				t.Fatalf("corner not surface color: got %v", img.At(1199, 0))
			}
			// The logo region must contain non-background pixels.
			found := false
			for x := margin; x < margin+72 && !found; x++ {
				pr, pg, pb, _ := img.At(x, 110).RGBA()
				found = pr != wr || pg != wg || pb != wb
			}
			if !found {
				t.Fatal("no logo pixels drawn")
			}
			// Nothing may bleed into the side margins (4px slack for glyph
			// side bearings) — text is measured, but measuring bugs show here.
			for y := 0; y < 630; y++ {
				for _, x := range []int{2, 1198, margin - 8, 1200 - margin + 8} {
					pr, pg, pb, _ := img.At(x, y).RGBA()
					if pr != wr || pg != wg || pb != wb {
						t.Fatalf("pixel outside content area at (%d,%d): %v", x, y, img.At(x, y))
					}
				}
			}
			if dir := os.Getenv("OG_DUMP"); dir != "" { // eyeball cards while tuning layout
				_ = os.WriteFile(filepath.Join(dir, strings.Fields(tc.name)[0]+".png"), buf, 0o600) //nolint:gosec // dev-only dump, path comes from the developer's own env
			}
		})
	}
}

func TestDropUnglyphed(t *testing.T) {
	s := testService()
	if got := s.dropUnglyphed("🚴 Tuesday Crew 🔥"); got != "Tuesday Crew" {
		t.Fatalf("got %q", got)
	}
	if got := s.dropUnglyphed("…"); got != "…" {
		t.Fatalf("font lacks ellipsis glyph, got %q", got)
	}
}

func TestMeta(t *testing.T) {
	s := testService()
	t.Run("room path uses public identity, escaped", func(t *testing.T) {
		meta := string(s.Meta(httptest.NewRequestWithContext(t.Context(), "GET", "/r/Tuesday-Crew", nil)))
		for _, want := range []string{
			"🚴 Tuesday &lt;Crew&gt; &amp; &#34;friends&#34; — WattRoom",
			`content="https://wattroom.ch/og/r/tuesday-crew.png"`,
			"invited to ride. Join the room on WattRoom.",
			"summary_large_image",
		} {
			if !strings.Contains(meta, want) {
				t.Fatalf("meta missing %q:\n%s", want, meta)
			}
		}
		if strings.Contains(meta, "<Crew>") {
			t.Fatal("unescaped room name in meta")
		}
	})
	t.Run("room subpath still resolves", func(t *testing.T) {
		meta := string(s.Meta(httptest.NewRequestWithContext(t.Context(), "GET", "/r/tuesday-crew/watch", nil)))
		if !strings.Contains(meta, "tuesday-crew.png") {
			t.Fatalf("subpath got default card:\n%s", meta)
		}
	})
	for _, path := range []string{"/", "/rooms", "/r/unknown-room"} {
		t.Run("default card for "+path, func(t *testing.T) {
			meta := string(s.Meta(httptest.NewRequestWithContext(t.Context(), "GET", path, nil)))
			if !strings.Contains(meta, "og/default.png") || !strings.Contains(meta, siteDesc) {
				t.Fatalf("no default card for %s:\n%s", path, meta)
			}
		})
	}
}

func TestInject(t *testing.T) {
	s := testService()
	index := []byte(`<html><head><meta charset="utf-8" /></head><body></body></html>`)
	out := string(s.Inject(index, httptest.NewRequestWithContext(t.Context(), "GET", "/rooms", nil)))
	title := strings.Index(out, "<title>")
	head := strings.Index(out, "</head>")
	if title == -1 || head == -1 || title > head {
		t.Fatalf("meta not spliced into head:\n%s", out)
	}
}

func TestHandlers(t *testing.T) {
	mux := http.NewServeMux()
	testService().Register(mux)
	for _, path := range []string{"/og/default.png", "/og/r/tuesday-crew.png", "/og/r/unknown.png"} {
		t.Run(path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), "GET", path, nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("got %d", rec.Code)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
				t.Fatalf("got content-type %q", ct)
			}
		})
	}
}
