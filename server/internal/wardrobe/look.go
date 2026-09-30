package wardrobe

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"regexp"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// A rider's look on the roster (#3155): the voice channel's roster names an
// outfit by the hash of its content, and every client fetches the outfit
// once by that hash — so the outfit never rides the tick, and one hash names
// one loadout for ever. Nothing here reaches the hub: the channel's door
// reads the hash straight from the store, and a test holds the hub's imports
// clear of this package (cosmetics never move anybody's speed).

const (
	// A hash is the first 16 hex digits of a SHA-256: 64 bits, enough that
	// two outfits of one crew never share one.
	lookHashLen = 16
	// The most a loadout may weigh once other riders' clients draw it. The
	// largest honest one — 39 slots, every free choice set — is about 3 KiB;
	// this is headroom over it, not a product number.
	maxLookBytes = 8 << 10
	// A free choice's own values are short words or numbers.
	maxLookValue = 64
)

var lookHashShape = regexp.MustCompile(`^[0-9a-f]{16}$`)

// canonicalLook is a loadout in the one spelling its hash is taken over:
// keys sorted at every depth, no whitespace — so the outfit a rider saved and
// the same outfit read back out of Postgres go by the same hash.
func canonicalLook(loadout []byte) ([]byte, error) {
	var v any
	if err := json.Unmarshal(loadout, &v); err != nil {
		return nil, err
	}
	return json.Marshal(v)
}

func lookHash(canonical []byte) string {
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:])[:lookHashLen]
}

// wear records the loadout as a look and returns the hash it goes by.
func wear(ctx context.Context, q *db.Queries, loadout []byte) (string, error) {
	canonical, err := canonicalLook(loadout)
	if err != nil {
		return "", err
	}
	hash := lookHash(canonical)
	return hash, q.PutLook(ctx, db.PutLookParams{Hash: hash, Loadout: string(canonical)})
}

// rewear gives an outfit changed in place — an undo's take-off — the hash of
// what it is now.
func rewear(ctx context.Context, q *db.Queries, user pgtype.UUID) error {
	outfit, err := q.GetUserOutfit(ctx, user)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	hash, err := wear(ctx, q, outfit.Loadout)
	if err != nil {
		return err
	}
	return q.SetOutfitLook(ctx, db.SetOutfitLookParams{UserID: user, LookHash: &hash})
}

// checkLooks bounds the free choices, now that other riders' clients draw
// them (#3155; outfit.go's looks): each is a word, or a flat object of words
// and finite numbers, and the whole loadout stays small. What a value means
// — a palette id, a height in range — is the drawing client's to clamp.
func checkLooks(loadout map[string]json.RawMessage, size int) string {
	if size > maxLookBytes {
		return fmt.Sprintf("An outfit is at most %d KiB.", maxLookBytes>>10)
	}
	for _, key := range looks {
		raw, ok := loadout[key]
		if !ok {
			continue
		}
		var word string
		if json.Unmarshal(raw, &word) == nil {
			if len(word) > maxLookValue {
				return fmt.Sprintf("The %s choice is too long.", key)
			}
			continue
		}
		var fields map[string]any
		if json.Unmarshal(raw, &fields) != nil {
			return fmt.Sprintf("The %s choice is a word or a set of them.", key)
		}
		for name, v := range fields {
			switch v := v.(type) {
			case string:
				if len(v) > maxLookValue || len(name) > maxLookValue {
					return fmt.Sprintf("The %s choice %q is too long.", key, name)
				}
			case float64:
				if math.IsInf(v, 0) || math.IsNaN(v) {
					return fmt.Sprintf("The %s choice %q is not a number.", key, name)
				}
			default:
				return fmt.Sprintf("The %s choice %q is a word or a number.", key, name)
			}
		}
	}
	return ""
}

// handleLook answers a look by its hash: immutable, so a client keeps it for
// good. Signed-in only — the hash reaches nobody outside a crew's roster.
func (s *Service) handleLook(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.users.RequireUser(w, r, "Sign in to see a rider's look."); !ok {
		return
	}
	hash := r.PathValue("hash")
	if !lookHashShape.MatchString(hash) {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "That is not a look.")
		return
	}
	loadout, err := s.store.Queries.GetLook(r.Context(), hash)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "There is no such look.")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "look read failed", err, "That look could not be loaded.")
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// The stored bytes, not a re-encoding: a look's body hashes to its name.
	if _, err := w.Write([]byte(loadout)); err != nil { //nolint:gosec // G705: canonical JSON this server wrote, served as JSON with nosniff
		s.log.Warn("look write failed", "err", err)
	}
}
