package og

import (
	"image/color"
	"math"
	"testing"
)

// Every theme the app offers draws a card (#4098): in its own colours, with
// the zone ramp untouched (ADR-0023 §4), and with every word on it as
// legible as the app's own text floor (gate.ts, CONTRAST.text).
func TestEveryThemeDrawsTheCard(t *testing.T) {
	identities := map[string]int{}
	for key := range themes {
		identities[key[0]]++
	}
	if len(identities) < 5 {
		t.Fatalf("the catalogue holds %d identities, want the app's five: %v", len(identities), identities)
	}
	// The zone bar's middle row, clear of its rounded ends.
	row := zoneBarBox.Min.Y + zoneBarBox.Dy()/2
	from, to := zoneBarBox.Min.X+zoneBarBox.Dy(), zoneBarBox.Max.X-zoneBarBox.Dy()
	reference := decode(t, mustRender(t, sampleCard()))

	for identity := range identities {
		for _, family := range []string{"dark", "light"} {
			t.Run(identity+"/"+family, func(t *testing.T) {
				p, ok := ThemeFor(identity, family)
				if !ok {
					t.Fatalf("%s has no %s half", identity, family)
				}
				card := sampleCard()
				card.Theme = p
				img := decode(t, mustRender(t, card))

				if got := img.At(4, cardSize-2); !near(got, p.surface) {
					t.Errorf("the card's ground is %v, want this theme's surface %v", got, p.surface)
				}
				for x := from; x < to; x++ {
					if got, want := img.At(x, row), reference.At(x, row); got != want {
						t.Fatalf("zone bar at x=%d is %v here and %v in Outrun: zone ink moved with the theme", x, got, want)
					}
				}
				for _, text := range []struct {
					name string
					c    color.NRGBA
				}{{"ink", p.ink}, {"muted", p.muted}, {"muted-dim", p.mutedDim}} {
					for _, ground := range []struct {
						name string
						c    color.NRGBA
					}{{"surface", p.surface}, {"surface-raised", p.raised}, {"sky", p.skyTop()}} {
						if got := contrast(text.c, ground.c); got < 4.5 {
							t.Errorf("%s on %s is %.2f:1, under the 4.5:1 text floor", text.name, ground.name, got)
						}
					}
				}
			})
		}
	}
}

func TestThemeForRefusesWhatTheCatalogueLacks(t *testing.T) {
	for _, tc := range [][2]string{{"outrun", "auto"}, {"vaporwave", "dark"}, {"", ""}} {
		if _, ok := ThemeFor(tc[0], tc[1]); ok {
			t.Errorf("ThemeFor(%q, %q) found a theme", tc[0], tc[1])
		}
	}
	// A card with no theme is the one a rider who never chose one gets.
	if got := (Palette{}).orDefault(); got != defaultPalette || got.surface != hex("#0a0118") {
		t.Errorf("the default palette is %v, want Outrun's dark half", got)
	}
}

// contrast is the WCAG 2 ratio, the measure gate.ts holds every theme to.
func contrast(a, b color.NRGBA) float64 {
	la, lb := luminance(a), luminance(b)
	return (math.Max(la, lb) + 0.05) / (math.Min(la, lb) + 0.05)
}

func luminance(c color.NRGBA) float64 {
	channel := func(v uint8) float64 {
		s := float64(v) / 255
		if s <= 0.04045 {
			return s / 12.92
		}
		return math.Pow((s+0.055)/1.055, 2.4)
	}
	return 0.2126*channel(c.R) + 0.7152*channel(c.G) + 0.0722*channel(c.B)
}
