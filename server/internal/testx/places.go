package testx

import (
	"regexp"
	"strings"
)

// Corridor is a route and what lies along it, all invented (#3054): the names
// a boundary test feeds in and asserts none of comes out. Fixtures stay
// synthetic — a real place in a test is a real place in a prompt.
var Corridor = struct {
	Route          string
	Places, Climbs []string
}{
	Route:  "Chrüzbode Rundi",
	Places: []string{"Hinterfeldmatt", "Oberstolle"},
	Climbs: []string{"Stollestich"},
}

// A coordinate's shape: a nonzero whole part of at most three digits and four
// decimals or more — 46.9481 or -7.44744. Execution scores (0.8999…) and
// whole watts are neither.
var coordinateShaped = regexp.MustCompile(`-?\b[1-9]\d{0,2}\.\d{4,}`)

// Leak is the first place-shaped thing in text — a coordinate-shaped float
// or a name from the Corridor — or "" when there is none. What an AI context
// may never hold (AGENTS.md, ADR-0063).
func Leak(text string) string {
	if m := coordinateShaped.FindString(text); m != "" {
		return m
	}
	lower := strings.ToLower(text)
	for _, name := range append(append([]string{Corridor.Route}, Corridor.Places...), Corridor.Climbs...) {
		if strings.Contains(lower, strings.ToLower(name)) {
			return name
		}
	}
	return ""
}
