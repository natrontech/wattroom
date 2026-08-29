package store

import (
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
)

// UUIDString renders a pgtype.UUID for JSON. Extracted when rooms became the
// second package to need it.
func UUIDString(id pgtype.UUID) string {
	v, _ := id.Value()
	str, _ := v.(string)
	return str
}

func ParseUUID(s string) (pgtype.UUID, error) {
	var id pgtype.UUID
	if err := id.Scan(s); err != nil {
		return pgtype.UUID{}, fmt.Errorf("store: bad uuid %q: %w", s, err)
	}
	return id, nil
}
