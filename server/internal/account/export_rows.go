package account

import "github.com/jackc/pgx/v5/pgtype"

// The small shapes every category writes its rows in.

// imageExt names an uploaded picture's file in the archive. The four types
// httpx.ReadImageUpload accepts, spelled the way a person expects to see them
// — mime.ExtensionsByType would answer ".jfif" for a JPEG on one machine and
// something else on the next, and this is a filename in a zip somebody opens.
func imageExt(mime string) string {
	switch mime {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	}
	return ".bin"
}

// place names where a row happened (#2554): its crew and its channel —
// never a room (#2558, #2433).
func place(row map[string]any, crew, channel string) map[string]any {
	if crew != "" {
		row["crew"] = crew
	}
	if channel != "" {
		row["channel"] = channel
	}
	return row
}

// timeOrNil is a nullable timestamp as the file should read it: a time, or
// null — never Go's zero date dressed as one.
func timeOrNil(t pgtype.Timestamptz) any {
	if !t.Valid {
		return nil
	}
	return t.Time
}

// mapRows turns a query's rows into the shape the export writes: the reader's
// vocabulary, not the schema's. An empty result is an empty array rather than
// null — a rider with no playlists should read "none", not "unknown".
func mapRows[R any](rows []R, err error, one func(R) any) (any, error) {
	if err != nil {
		return nil, err
	}
	out := make([]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, one(row))
	}
	return out, nil
}
