// Package og renders social preview images and Open Graph meta for shareable
// links. The SPA ships with an empty <head> and crawlers don't run JS, so
// link previews have to come from the server (#240). One Render(title, sub)
// covers every card; new shareable routes add a lookup case, not a renderer.
package og

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"github.com/natrontech/wattroom/server/internal/budget"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"html"
	"image"
	"image/color"
	"image/png"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/font/sfnt"
	"golang.org/x/image/math/fixed"
)

//go:embed ChakraPetch-Bold.ttf
var fontTTF []byte

const (
	imgW, imgH = 1200, 630
	margin     = 80

	siteName     = "WattRoom"
	defaultTitle = "Train together, not alone."
	roomDesc     = "You're invited to ride. Join the room on WattRoom."
	roomSub      = "Ride together on WattRoom"

	// siteDesc is the card's subtitle, drawn into a 1200×630 PNG at 24–34px —
	// so it stays one line. metaDesc is the search snippet, where Google
	// renders about 155 characters and this was spending 70 of them. The
	// second sentence is WATTROOM.md's own positioning rather than new copy:
	// "Zwift alternative", "structured training" and the trainer are what a
	// rider types into a search box, and all three were sitting in canon,
	// unindexed.
	siteDesc = "Discord for indoor cycling — no virtual world, your watts are the game."
	metaDesc = siteDesc + " A Zwift alternative for structured workouts and smart-trainer rides with friends."
)

// iconPNG is the favicon a crawler can actually use. Google reads the home
// page's *served* HTML for rel="icon", and the link this SPA had was written
// by the bundle; it does not accept SVG, and ours was the only icon; and it
// drops an icon whose URL keeps moving, which a hashed asset name does every
// build. One stable path under the static build answers all three.
const iconPNG = "/favicon.png"

// Dark side of the web/src/app.css @theme light-dark() pairs — cards are
// always dark, matching the app's synthwave identity (ADR-0005).
var (
	surface = color.NRGBA{0x0a, 0x01, 0x18, 0xff}
	ink     = color.NRGBA{0xff, 0xff, 0xff, 0xff}
	muted   = color.NRGBA{0x91, 0x82, 0xb8, 0xff}
	watt    = color.NRGBA{0xff, 0x3d, 0x8b, 0xff}
	neon    = color.NRGBA{0x8b, 0x2b, 0xff, 0xff}
)

// LookupRoom resolves a slug to a room's public identity — exactly the fields
// an unauthenticated GET /api/rooms/{slug} returns. Nil when the DB is absent.
type LookupRoom func(ctx context.Context, slug string) (name, icon string, ok bool)

// cardsPerWindow is the sign-in ceiling, per address (#1739): every distinct
// slug was a fresh 1200×630 rasterisation with no session and no ration.
const (
	cardsPerWindow = 30
	cardWindow     = time.Minute
	// maxCards bounds the render cache; past it the whole map is dropped —
	// a card is cheap to make once, and this is a preview, not a store.
	maxCards = 256
)

type Service struct {
	baseURL string
	lookup  LookupRoom
	doors   *budget.Budget[string]
	mu      sync.Mutex
	cards   map[string][]byte
	// renders counts misses — what the cache test reads.
	renders atomic.Int32
	fnt     *sfnt.Font
	log     *slog.Logger
}

func New(baseURL string, lookup LookupRoom, log *slog.Logger) *Service {
	fnt, err := embeddedFace()
	if err != nil {
		panic("og: embedded font: " + err.Error()) // build-time asset, not user input
	}
	return &Service{baseURL: strings.TrimSuffix(baseURL, "/"), lookup: lookup, fnt: fnt, log: log,
		doors: budget.New[string](cardsPerWindow, cardWindow), cards: map[string][]byte{}}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /og/default.png", func(w http.ResponseWriter, _ *http.Request) {
		s.serve(w, defaultTitle, siteDesc)
	})
	mux.HandleFunc("GET /og/r/{slug}", s.handleRoom)
}

func (s *Service) handleRoom(w http.ResponseWriter, r *http.Request) {
	if s.doors != nil && !s.doors.Spend(httpx.ClientIP(r)) {
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
			"Too many previews from this address — give it a minute.")
		return
	}
	title, sub := defaultTitle, siteDesc
	slug := strings.ToLower(strings.TrimSuffix(r.PathValue("slug"), ".png"))
	if s.lookup != nil {
		if name, _, ok := s.lookup(r.Context(), slug); ok {
			title, sub = name, roomSub
		}
	}
	// Unknown slug still gets the default card: no broken previews, and no
	// oracle beyond what GET /api/rooms/{slug} already answers.
	s.serve(w, title, sub)
}

func (s *Service) serve(w http.ResponseWriter, title, sub string) {
	buf, err := s.card(title, sub)
	if err != nil {
		// errors.md's one shape, like the 429 this same handler answers with
		// (#2253): http.Error wrote plain text, so one route had two error
		// bodies and the log line carried no context keys.
		httpx.Fail(w, s.log, "og render", err, "That preview could not be drawn.")
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write(buf)
}

// card is the rendered PNG for one title and sub, rendered once (#1739): the
// same card used to be rasterised per request, and every distinct slug was
// a distinct URL, so the HTTP cache bought nothing against a loop.
func (s *Service) card(title, sub string) ([]byte, error) {
	key := title + "\x00" + sub
	s.mu.Lock()
	defer s.mu.Unlock()
	if buf, hit := s.cards[key]; hit {
		return buf, nil
	}
	buf, err := s.Render(title, sub)
	if err != nil {
		return nil, err
	}
	s.renders.Add(1)
	if len(s.cards) >= maxCards {
		s.cards = map[string][]byte{}
	}
	s.cards[key] = buf
	return buf, nil
}

// Meta builds the <title> + social meta block for a SPA route. Room paths get
// the room's public identity; everything else gets the site card.
func (s *Service) Meta(r *http.Request) []byte {
	title := siteName + " — train together, not alone"
	desc, img := metaDesc, s.baseURL+"/og/default.png"
	if rest, ok := strings.CutPrefix(r.URL.Path, "/r/"); ok && s.lookup != nil {
		slug, _, _ := strings.Cut(rest, "/")
		slug = strings.ToLower(slug)
		if name, icon, found := s.lookup(r.Context(), slug); found {
			// A room icon has been a lucide key since #459 — "flame Sunday
			// Ride" is not a title. Only the emoji a pre-#459 room still
			// stores is a glyph a crawler can render.
			if !protocol.IsEmoji(icon) {
				icon = ""
			}
			title = strings.TrimSpace(icon+" "+name) + " — " + siteName
			desc = roomDesc
			img = s.baseURL + "/og/r/" + url.PathEscape(slug) + ".png"
		}
	}
	var b bytes.Buffer
	e := html.EscapeString
	fmt.Fprintf(&b, "<title>%s</title>\n", e(title))
	fmt.Fprintf(&b, "<meta name=\"description\" content=\"%s\" />\n", e(desc))
	for _, m := range [...][2]string{
		{"og:site_name", siteName},
		{"og:type", "website"},
		{"og:title", title},
		{"og:description", desc},
		{"og:image", img},
		{"og:image:width", "1200"},
		{"og:image:height", "630"},
		{"og:url", s.baseURL + r.URL.Path},
	} {
		fmt.Fprintf(&b, "<meta property=\"%s\" content=\"%s\" />\n", m[0], e(m[1]))
	}
	b.WriteString("<meta name=\"twitter:card\" content=\"summary_large_image\" />\n")
	// The PNG is for search and for an iOS home screen; the SVG is for a
	// browser tab, where it stays crisp at any zoom. Both are declared and
	// each consumer takes the one it understands.
	fmt.Fprintf(&b, "<link rel=\"icon\" href=\"%s\" sizes=\"192x192\" type=\"image/png\" />\n", iconPNG)
	b.WriteString("<link rel=\"icon\" href=\"/favicon.svg\" type=\"image/svg+xml\" />\n")
	fmt.Fprintf(&b, "<link rel=\"apple-touch-icon\" href=\"%s\" />\n", iconPNG)
	// Every path answers 200 with this same shell, so a link that picked up
	// ?new=, ?as= or a utm tag is a separate URL to a crawler until this
	// says otherwise.
	fmt.Fprintf(&b, "<link rel=\"canonical\" href=\"%s\" />\n", e(s.baseURL+r.URL.Path))
	fmt.Fprintf(&b, "<meta name=\"theme-color\" content=\"#%02x%02x%02x\" />\n", surface.R, surface.G, surface.B)
	if r.URL.Path == "/" {
		b.Write(s.identity())
	}
	return b.Bytes()
}

// identity is the home page's WebSite node. It is what Google's site-names
// feature reads to label a result "WattRoom" rather than "wattroom.ch", and
// it only ever looks at the root — hence the caller's path check. The
// publisher is there because the word is not ours alone: an unrelated Italian
// studio shares it, and sameAs is how an entity gets pinned to a repo rather
// than to a hostname.
func (s *Service) identity() []byte {
	doc, err := json.Marshal(map[string]any{
		"@context":    "https://schema.org",
		"@type":       "WebSite",
		"name":        siteName,
		"url":         s.baseURL + "/",
		"description": metaDesc,
		"publisher": map[string]any{
			"@type":  "Organization",
			"name":   siteName,
			"url":    s.baseURL + "/",
			"logo":   s.baseURL + iconPNG,
			"sameAs": []string{"https://github.com/natrontech/wattroom"},
		},
	})
	if err != nil {
		s.log.Error("og identity", "err", err)
		return nil
	}
	// json.Marshal escapes <, > and & to \u00xx, so the payload cannot close
	// the script element it sits in.
	return fmt.Appendf(nil, "<script type=\"application/ld+json\">%s</script>\n", doc)
}

// Inject splices Meta ahead of </head> in the SPA's index.html.
func (s *Service) Inject(index []byte, r *http.Request) []byte {
	return bytes.Replace(index, []byte("</head>"), append(s.Meta(r), []byte("</head>")...), 1)
}

// Render draws the 1200×630 card: logo + wordmark, title, accent, subtitle.
func (s *Service) Render(title, sub string) ([]byte, error) {
	img := image.NewNRGBA(image.Rect(0, 0, imgW, imgH))
	draw.Draw(img, img.Bounds(), image.NewUniform(surface), image.Point{}, draw.Src)

	drawLogo(img, margin, 72, 72)
	wordFace, err := s.face(45)
	if err != nil {
		return nil, err
	}
	drawText(img, wordFace, margin+94, 123, ink, siteName)

	titleFace, fitted, err := s.fit(title, imgW-2*margin, 88, 58)
	if err != nil {
		return nil, err
	}
	drawText(img, titleFace, margin, 420, ink, fitted)

	// Structural accent stays neon and glow-free (ADR-0005) — the title is the data.
	draw.Draw(img, image.Rect(margin, 454, margin+120, 462), image.NewUniform(neon), image.Point{}, draw.Src)

	subFace, sub, err := s.fit(sub, imgW-2*margin, 34, 24)
	if err != nil {
		return nil, err
	}
	drawText(img, subFace, margin, 528, muted, sub)

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (s *Service) face(size float64) (font.Face, error) {
	return opentype.NewFace(s.fnt, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingFull})
}

// fit drops undrawable runes (emoji in room names would render as tofu),
// shrinks the face from size to floor until the text fits, then truncates
// with an ellipsis.
func (s *Service) fit(text string, maxW int, size, floor float64) (font.Face, string, error) {
	text = s.dropUnglyphed(text)
	if text == "" {
		text = siteName
	}
	for ; ; size -= 4 {
		f, err := s.face(size)
		if err != nil {
			return nil, "", err
		}
		if font.MeasureString(f, text).Ceil() <= maxW {
			return f, text, nil
		}
		if size <= floor {
			r := []rune(text)
			for len(r) > 1 && font.MeasureString(f, string(r)+"…").Ceil() > maxW {
				r = r[:len(r)-1]
			}
			return f, string(r) + "…", nil
		}
	}
}

func (s *Service) dropUnglyphed(text string) string {
	var buf sfnt.Buffer
	var b strings.Builder
	for _, r := range text {
		if i, err := s.fnt.GlyphIndex(&buf, r); err == nil && i != 0 {
			b.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func drawText(dst *image.NRGBA, f font.Face, x, y int, c color.NRGBA, text string) {
	(&font.Drawer{Dst: dst, Src: image.NewUniform(c), Face: f, Dot: fixed.P(x, y)}).DrawString(text)
}

// drawLogo rasterizes the equalizer-W (web/src/lib/brand/Logo.svelte: five
// capsule bars, per-bar watt→neon vertical gradient) at 4× and downscales for
// smooth ends.
func drawLogo(dst *image.NRGBA, ox, oy, size int) {
	const ss = 4
	sc := float64(size*ss) / 64
	tmp := image.NewNRGBA(image.Rect(0, 0, size*ss, size*ss))
	for i, h := range [5]float64{46, 20, 34, 20, 46} {
		bx, bw := (2+float64(i)*13)*sc, 8*sc
		by, bh := (58-h)*sc, h*sc
		r := bw / 2
		for py := 0; py < int(bh); py++ {
			fy := float64(py) + 0.5
			e := r
			if fy < r {
				e = math.Sqrt(math.Max(0, r*r-(r-fy)*(r-fy)))
			} else if fy > bh-r {
				e = math.Sqrt(math.Max(0, r*r-(fy-(bh-r))*(fy-(bh-r))))
			}
			c := lerp(watt, neon, fy/bh)
			for px := int(bx + r - e); px < int(bx+r+e); px++ {
				tmp.SetNRGBA(px, int(by)+py, c)
			}
		}
	}
	draw.CatmullRom.Scale(dst, image.Rect(ox, oy, ox+size, oy+size), tmp, tmp.Bounds(), draw.Over, nil)
}

func lerp(a, b color.NRGBA, t float64) color.NRGBA {
	l := func(x, y uint8) uint8 { return uint8(float64(x) + (float64(y)-float64(x))*t) }
	return color.NRGBA{l(a.R, b.R), l(a.G, b.G), l(a.B, b.B), 0xff}
}
