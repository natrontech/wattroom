package og

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"image/color"
)

// The rider's appearance on a card (#4098). The themes are the web's
// (web/src/lib/themes.ts), derived there and written here by `make themes`,
// so a colour has one source and this package copies no themed hex.
//
//go:embed themes.json
var themesJSON []byte

// Palette is one theme as a card paints it. The zero value is Outrun's dark
// half, the theme a rider who never chose one sees.
type Palette struct {
	surface, raised, ink, muted, mutedDim, watt, neon color.NRGBA
}

var themes = func() map[[2]string]Palette {
	var list []struct {
		Identity, Family string
		Tokens           map[string]string
	}
	if err := json.Unmarshal(themesJSON, &list); err != nil {
		panic("og: themes.json: " + err.Error()) // build-time asset, not user input
	}
	out := make(map[[2]string]Palette, len(list))
	for _, t := range list {
		out[[2]string{t.Identity, t.Family}] = Palette{
			surface: hex(t.Tokens["surface"]), raised: hex(t.Tokens["surface-raised"]),
			ink: hex(t.Tokens["ink"]), muted: hex(t.Tokens["muted"]), mutedDim: hex(t.Tokens["muted-dim"]),
			watt: hex(t.Tokens["watt"]), neon: hex(t.Tokens["neon"]),
		}
	}
	return out
}()

// defaultPalette is what the web falls back to: Outrun, dark.
var defaultPalette = themes[[2]string{"outrun", "dark"}]

// ThemeFor is the palette of an identity in a family ("dark" or "light"),
// and false when the catalogue has no such theme.
func ThemeFor(identity, family string) (Palette, bool) {
	p, ok := themes[[2]string{identity, family}]
	return p, ok
}

func (p Palette) orDefault() Palette {
	if p == (Palette{}) {
		return defaultPalette
	}
	return p
}

// iconInk is `neon` lifted towards ink: a 2-unit stroke at 30 px is a tenth
// of the paint a text glyph is, and the structural hue alone disappeared into
// the tile it sits on. Still chrome, still glow-free (ADR-0005).
func (p Palette) iconInk() color.NRGBA { return lerp(p.neon, p.ink, 0.34) }

// skyTop is the top of the card's ground: `surface` lifted towards
// `surface-raised`, so the page has a sky rather than a flat wall.
func (p Palette) skyTop() color.NRGBA { return lerp(p.surface, p.raised, 0.65) }

func hex(s string) color.NRGBA {
	var c color.NRGBA
	if _, err := fmt.Sscanf(s, "#%02x%02x%02x", &c.R, &c.G, &c.B); err != nil {
		panic(fmt.Sprintf("og: themes.json colour %q: %v", s, err))
	}
	c.A = 0xff
	return c
}
