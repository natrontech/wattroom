package wardrobe

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// The catalogue's marks and motifs (#3256, ADR-0069): trademarks, protected
// symbols and look-alike motifs, read from the guard the studio shares, so the
// server's test and the studio's gate refuse the same things. The studio's
// gate judges a look as it is drawn; this test judges what the catalogue
// itself says — its words, its pattern and style names, and its fixed
// colours. Common-word marks (Record, Edge, Look, Time, Bell, Giant, Scott,
// Trek) are a checkbox in the PR template: a regex would refuse English.
type guard struct {
	BlockedWords []string          `json:"blockedWords"`
	MarkUse      map[string]string `json:"markUse"`
	Motifs       struct {
		RainbowBands []string `json:"rainbowBands"`
		LeaderWords  []string `json:"leaderWords"`
		DotPatterns  []string `json:"dotPatterns"`
		CrossWords   []string `json:"crossWords"`
		ShieldWords  []string `json:"shieldWords"`
	} `json:"motifs"`
}

// wholeWord matches word case-insensitively, as a word of its own.
func wholeWord(word string) *regexp.Regexp {
	return regexp.MustCompile(`(?i)(^|[^\pL\pN])` + regexp.QuoteMeta(word) + `($|[^\pL\pN])`)
}

func anyWord(words []string, text string) string {
	for _, w := range words {
		if wholeWord(w).MatchString(text) {
			return w
		}
	}
	return ""
}

// refusals is everything the guard finds wrong with one catalogue entry.
func (g guard) refusals(it map[string]any) []string {
	var out []string
	id := str(it, "id")
	words := strings.Join([]string{str(it, "name"), str(it, "blurb"), str(it, "spec"), str(it, "era")}, " · ")
	for _, mark := range g.BlockedWords {
		if wholeWord(mark).MatchString(words) {
			out = append(out, fmt.Sprintf("%s names %q, a registered mark — use %s", id, mark, g.MarkUse[mark]))
		}
	}
	// What an entry draws: its pattern, its decal and a decoration's style —
	// never its name or its shape, where "shield" is a kind of lens.
	drawn := []string{str(it, "pattern"), decalStyle(it)}
	if str(it, "slot") == "helmetDeco" {
		drawn = append(drawn, str(it, "style"))
	}
	tokens := strings.Join(drawn, " · ")
	if w := anyWord(g.Motifs.CrossWords, tokens); w != "" {
		out = append(out, fmt.Sprintf("%s draws a cross (%q): a red cross on white is protected, and a Swiss one is reserved to public bodies", id, w))
	}
	if w := anyWord(g.Motifs.ShieldWords, tokens); w != "" {
		out = append(out, fmt.Sprintf("%s draws a shield (%q): a coat of arms is reserved to public bodies", id, w))
	}
	if str(it, "slot") == "jersey" {
		if w := anyWord(g.Motifs.LeaderWords, words); w != "" {
			out = append(out, fmt.Sprintf("%s is named as a leader's jersey (%q): a race's leader jersey is its organiser's mark", id, w))
		}
	}
	if anyWord(g.Motifs.DotPatterns, str(it, "pattern")) != "" && light(str(it, "colour")) {
		out = append(out, fmt.Sprintf("%s puts dots on a white ground: that is a climber's jersey", id))
	}
	if bands := hueBands(hexesIn(it)); strings.Contains(bands, strings.Join(g.Motifs.RainbowBands, ",")) {
		out = append(out, fmt.Sprintf("%s runs the rainbow bands: a world champion's, the UCI's registered mark", id))
	}
	return out
}

func decalStyle(it map[string]any) string {
	decal, _ := it["decal"].(map[string]any)
	return str(decal, "style")
}

var hexColour = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// hexesIn is every colour an entry fixes, in the order it lists them.
func hexesIn(v any) []string {
	switch v := v.(type) {
	case string:
		if hexColour.MatchString(v) {
			return []string{v}
		}
	case []any:
		var out []string
		for _, e := range v {
			out = append(out, hexesIn(e)...)
		}
		return out
	case map[string]any:
		// Only the keys that hold colours, in a fixed order, so a sequence
		// is the one the entry lists.
		var out []string
		for _, k := range []string{"colour", "decal", "defaults", "front", "rear", "tint"} {
			out = append(out, hexesIn(v[k])...)
		}
		out = append(out, hexesIn(v["colours"])...)
		return out
	}
	return nil
}

// hueBands names each colour's band — black, red, yellow, green, blue or
// other — comma-joined, so a sequence reads as a substring.
func hueBands(hexes []string) string {
	names := make([]string, len(hexes))
	for i, h := range hexes {
		hue, lightness := hsl(h)
		switch {
		case lightness < 0.2:
			names[i] = "black"
		case hue >= 345 || hue < 15:
			names[i] = "red"
		case hue >= 45 && hue < 70:
			names[i] = "yellow"
		case hue >= 80 && hue < 170:
			names[i] = "green"
		case hue >= 190 && hue < 250:
			names[i] = "blue"
		default:
			names[i] = "other"
		}
	}
	return strings.Join(names, ",")
}

func light(hex string) bool {
	if !hexColour.MatchString(hex) {
		return false
	}
	_, lightness := hsl(hex)
	return lightness > 0.85
}

func hsl(hex string) (hue, lightness float64) {
	rgb, _ := strconv.ParseUint(hex[1:], 16, 32)
	r, g, b := float64(rgb>>16&0xff)/255, float64(rgb>>8&0xff)/255, float64(rgb&0xff)/255
	hi, lo := max(r, g, b), min(r, g, b)
	lightness = (hi + lo) / 2
	if hi == lo {
		return 0, lightness
	}
	d := hi - lo
	switch hi {
	case r:
		hue = (g - b) / d
		if g < b {
			hue += 6
		}
	case g:
		hue = (b-r)/d + 2
	default:
		hue = (r-g)/d + 4
	}
	return hue * 60, lightness
}

func readGuard(t *testing.T) (guard, client) {
	t.Helper()
	c := readClient(t)
	return c.Guard.guard, c
}

// Every word the guard blocks says what to write instead: the error is the
// fix (errors.md), not a bare "no".
func TestEveryBlockedWordSaysWhatToUse(t *testing.T) {
	g, _ := readGuard(t)
	for _, w := range []string{"Everesting", "PostAuto", "Zwift", "Watopia", "Climb Portal", "Ride On", "Q-Rings", "UCI", "Tour de France", "Swiss Army"} {
		if !slices.Contains(g.BlockedWords, w) {
			t.Errorf("the guard does not block %q (#3256)", w)
		}
	}
	for _, w := range g.BlockedWords {
		if g.MarkUse[w] == "" {
			t.Errorf("%q is blocked with no generic word to use instead", w)
		}
	}
}

// Nothing in the catalogue a rider reads carries a mark or a motif.
func TestTheCatalogueCarriesNoMarkAndNoMotif(t *testing.T) {
	g, c := readGuard(t)
	for _, it := range c.Items {
		for _, why := range g.refusals(it) {
			t.Error(why)
		}
	}
	for key, text := range c.UnlockText {
		if mark := anyWord(g.BlockedWords, text); mark != "" {
			t.Errorf("unlock %s names %q, a registered mark — use %s", key, mark, g.MarkUse[mark])
		}
	}
}

// Each guard refuses the one entry made to trip it (#3256's acceptance): a
// guard that never fires would let the catalogue through quietly.
func TestEachGuardRefusesItsInjectedItem(t *testing.T) {
	g, _ := readGuard(t)
	for _, c := range []struct {
		name string
		item map[string]any
		want string
	}{
		{"a mark in a name", map[string]any{"id": "shoe.x", "slot": "shoes", "name": "Velcro strap"}, "use hook-and-loop"},
		{"a mark in a spec, any case", map[string]any{"id": "x.1", "slot": "bars", "spec": "an everesting special"}, `"Everesting"`},
		{"the rainbow bands", map[string]any{"id": "jp.x", "slot": "jersey", "decal": map[string]any{"colours": []any{"#0073c0", "#e30613", "#1d1d1b", "#ffe500", "#009a44"}}}, "rainbow bands"},
		{"a leader's jersey", map[string]any{"id": "jp.x", "slot": "jersey", "name": "Leader's yellow", "colour": "#f2c230"}, "leader's jersey"},
		{"dots on white", map[string]any{"id": "jp.x", "slot": "jersey", "pattern": "dots", "colour": "#f2eff6"}, "dots on a white ground"},
		{"a red cross", map[string]any{"id": "deco.x", "slot": "helmetDeco", "style": "cross", "colour": "#d52b1e"}, "draws a cross"},
		{"a shield", map[string]any{"id": "deco.x", "slot": "helmetDeco", "decal": map[string]any{"style": "shield"}}, "draws a shield"},
	} {
		if got := strings.Join(g.refusals(c.item), "\n"); !strings.Contains(got, c.want) {
			t.Errorf("%s: the guard said %q, want it to refuse with %q", c.name, got, c.want)
		}
	}
	// And the words that only look like one pass.
	for _, ok := range []map[string]any{
		{"id": "x", "slot": "jersey", "name": "Crosswind cape"},
		{"id": "x", "slot": "socks", "name": "Uncial lettering"},
		{"id": "x", "slot": "jersey", "pattern": "gipfelpunkte", "colour": "#2b44b8"},
		{"id": "x", "slot": "glasses", "name": "Shield", "style": "shield"},
	} {
		if got := g.refusals(ok); len(got) > 0 {
			t.Errorf("%v refused: %v", ok, got)
		}
	}
}
