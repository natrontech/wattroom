package og

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
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
	lookup := func(_ context.Context, code string) (string, []byte, bool) {
		if code == "TUESDAY" {
			return `Tuesday <Crew> & "friends"`, nil, true
		}
		return "", nil, false
	}
	return New("https://wattroom.ch/", lookup, slog.New(slog.DiscardHandler))
}

// solidPNG is a crew picture: one flat colour, wide, so a squashed draw and
// a cropped one land differently.
func solidPNG(t *testing.T, c color.NRGBA) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 400, 200))
	for y := range 200 {
		for x := range 400 {
			img.SetNRGBA(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestRender(t *testing.T) {
	s := testService()
	cases := []struct{ name, title, sub string }{
		{"default", defaultTitle, siteDesc},
		{"room", "Tuesday Crew", crewSub},
		{"emoji-only title falls back", "🚴🔥", crewSub},
		{"long title truncates", strings.Repeat("Zurich Winter Base Camp ", 6), crewSub},
		{"widest glyphs", strings.Repeat("W", 40), crewSub},
		{"unbroken word", strings.Repeat("Hammerzeit", 12), crewSub},
		{"long subtitle", "Tuesday Crew", strings.Repeat("ride together ", 12)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			buf, err := s.Render(tc.title, tc.sub, nil)
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

// A crew's picture lands in its square, top right, rounded, and a picture
// that does not decode costs the card nothing (#2445).
func TestRenderCrewPicture(t *testing.T) {
	s := testService()
	buf, err := s.Render("Tuesday Crew", crewSub, solidPNG(t, watt))
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(buf))
	if err != nil {
		t.Fatal(err)
	}
	mid := image.Pt(imgW-margin-picSize/2, 72+picSize/2)
	if r, g, b, _ := img.At(mid.X, mid.Y).RGBA(); r>>8 != uint32(watt.R) || g>>8 != uint32(watt.G) || b>>8 != uint32(watt.B) {
		t.Fatalf("picture centre = %v, want the picture's colour", img.At(mid.X, mid.Y))
	}
	// The corner is rounded away, so the surface shows through.
	wr, wg, wb, _ := surface.RGBA()
	if r, g, b, _ := img.At(imgW-margin-picSize+1, 73).RGBA(); r != wr || g != wg || b != wb {
		t.Errorf("picture corner = %v, want it rounded off", img.At(imgW-margin-picSize+1, 73))
	}
	if _, err := s.Render("Tuesday Crew", crewSub, []byte("not an image")); err != nil {
		t.Fatalf("an undecodable picture failed the card: %v", err)
	}
}

// A picture that declares a canvas past the ceiling is refused on its header,
// before a pixel is allocated: the upload caps the bytes, not the canvas.
func TestDecodePictureRefusesAHugeCanvas(t *testing.T) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewGray(image.Rect(0, 0, 5000, 5000))); err != nil {
		t.Fatal(err)
	}
	if _, ok := decodePicture(buf.Bytes()); ok {
		t.Fatalf("a %d-byte picture declaring 5000×5000 was decoded", buf.Len())
	}
	if _, ok := decodePicture(solidPNG(t, watt)); !ok {
		t.Fatal("an ordinary picture was refused")
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
	t.Run("crew door names the crew, escaped", func(t *testing.T) {
		meta := string(s.Meta(httptest.NewRequestWithContext(t.Context(), "GET", "/c/TUESDAY", nil)))
		for _, want := range []string{
			"<title>Tuesday &lt;Crew&gt; &amp; &#34;friends&#34; — WattRoom</title>",
			`content="https://wattroom.ch/og/c/TUESDAY.png"`,
			"invited to ride. Join the crew on WattRoom.",
			"summary_large_image",
		} {
			if !strings.Contains(meta, want) {
				t.Fatalf("meta missing %q:\n%s", want, meta)
			}
		}
		if strings.Contains(meta, "<Crew>") {
			t.Fatal("unescaped crew name in meta")
		}
	})
	// A room link is not a door any more: it gets the site's card.
	for _, path := range []string{"/", "/rooms", "/c/UNKNOWN", "/r/tuesday-crew"} {
		t.Run("default card for "+path, func(t *testing.T) {
			meta := string(s.Meta(httptest.NewRequestWithContext(t.Context(), "GET", path, nil)))
			if !strings.Contains(meta, "og/default.png") || !strings.Contains(meta, siteDesc) {
				t.Fatalf("no default card for %s:\n%s", path, meta)
			}
		})
	}
}

// What a crawler that never runs the bundle has to find in the served head
// (#2136). Each of these was absent in production while the client-side
// equivalent looked perfectly correct in a browser, which is the whole
// failure mode: nothing errors, the mark just never shows.
func TestCrawlerHead(t *testing.T) {
	s := testService()
	head := func(path string) string {
		return string(s.Meta(httptest.NewRequestWithContext(t.Context(), "GET", path, nil)))
	}
	t.Run("icons and canonical, on every path", func(t *testing.T) {
		for _, path := range []string{"/", "/rooms", "/c/TUESDAY"} {
			for _, want := range []string{
				// A format Google accepts (not SVG) at a URL that survives a
				// deploy (not a hashed asset name).
				`<link rel="icon" href="/favicon.png" sizes="192x192" type="image/png" />`,
				`<link rel="apple-touch-icon" href="/favicon.png" />`,
				`<link rel="canonical" href="https://wattroom.ch` + path + `" />`,
				`<meta name="theme-color" content="#0a0118" />`,
			} {
				if !strings.Contains(head(path), want) {
					t.Errorf("%s: head missing %s", path, want)
				}
			}
		}
	})
	t.Run("the site's identity belongs to the home page alone", func(t *testing.T) {
		home := head("/")
		for _, want := range []string{`"@type":"WebSite"`, `"name":"WattRoom"`, `"url":"https://wattroom.ch/"`} {
			if !strings.Contains(home, want) {
				t.Fatalf("home page missing %s:\n%s", want, home)
			}
		}
		// Google's site-names feature reads the root and nowhere else, so
		// anywhere else is noise a room page pays to send.
		if strings.Contains(head("/rooms"), "ld+json") {
			t.Error("structured data served off the home page")
		}
	})
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
	for _, path := range []string{"/og/default.png", "/og/c/TUESDAY.png", "/og/c/UNKNOWN.png"} {
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

// A card is rendered once per title and sub, and an address gets the
// sign-in ceiling of crew cards a minute (#1739).
func TestCrewCardsAreCachedAndBudgeted(t *testing.T) {
	svc := testService()
	mux := http.NewServeMux()
	svc.Register(mux)
	for range 2 {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), "GET", "/og/c/TUESDAY.png", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("known code: %d", rec.Code)
		}
	}
	if n := svc.renders.Load(); n != 1 {
		t.Fatalf("the same card was rendered %d times, want 1", n)
	}
	for i := 2; i < cardsPerWindow; i++ {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), "GET", fmt.Sprintf("/og/c/CODE%d.png", i), nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("card %d: %d", i, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), "GET", "/og/c/ONEMORE.png", nil))
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("past the ceiling: %d, want 429", rec.Code)
	}
}
