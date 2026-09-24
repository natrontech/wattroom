// Package textx holds the string helpers more than one package needs.
package textx

import "unicode/utf8"

// Clip keeps at most n runes of s. Runes, not bytes: a byte cut mid-rune is
// invalid UTF-8, which Postgres refuses outright and json.Marshal rewrites to
// U+FFFD (#2681, audit 2026-09-09).
func Clip(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
