package tracks

import (
	"strings"
	"unicode"
)

// searchQuery turns what a rider typed into a tsquery that matches as they
// type (#1421): every word is a prefix, all words must match. "sun pa" finds
// "Sunrise Pace"; websearch_to_tsquery wanted the whole word and so found
// nothing until the rider had typed all of "sunrise". Letters and digits
// only — tsquery syntax characters in a title search are never meant as
// operators, and to_tsquery would refuse them. Empty means "no query".
func searchQuery(raw string) string {
	var terms []string
	for _, word := range strings.Fields(raw) {
		var b strings.Builder
		for _, r := range word {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				b.WriteRune(unicode.ToLower(r))
			}
		}
		if b.Len() > 0 {
			terms = append(terms, b.String()+":*")
		}
	}
	return strings.Join(terms, " & ")
}
