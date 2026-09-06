package store

import "github.com/jackc/pgx/v5/pgtype"

// Millis is a nullable timestamp as the wire carries one: server millis, or
// 0 for NULL. Every JSON surface here already spells "no time" as a zero
// `at`, so a nullable column reaches the client the same way rather than as
// a second, differently-shaped absence.
func Millis(t pgtype.Timestamptz) int64 {
	if !t.Valid {
		return 0
	}
	return t.Time.UnixMilli()
}
