// Managing the passkeys you already have (ADR-0029): list, rename, delete —
// plain JSON handlers with no ceremony behind them. Split from passkey.go,
// which keeps the WebAuthn ceremonies and the challenge store.
package auth

import (
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func (s *Service) handleListPasskeys(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListUserPasskeys(r.Context(), user.ID)
	if err != nil {
		httpx.Fail(w, s.log, "passkey list failed", err, "Your passkeys could not be loaded. Try again.")
		return
	}
	out := make([]passkeyResponse, 0, len(rows))
	for _, row := range rows {
		out = append(out, toPasskey(row))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"passkeys": out})
}

func (s *Service) handleRenamePasskey(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	id, ok := passkeyID(w, r)
	if !ok {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That rename could not be read.")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || utf8.RuneCountInString(name) > maxNameLen {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A passkey name has to be 1-40 characters.", "name")
		return
	}
	row, err := s.store.Queries.RenamePasskey(r.Context(), db.RenamePasskeyParams{
		CredentialID: id, UserID: user.ID, Name: name,
	})
	switch {
	case err == nil:
		httpx.WriteJSON(w, http.StatusOK, toPasskey(row))
	case errors.Is(err, pgx.ErrNoRows):
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That passkey is not on this account.")
	default:
		httpx.Fail(w, s.log, "passkey rename failed", err, "That passkey could not be renamed. Try again.")
	}
}

func (s *Service) handleDeletePasskey(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	id, ok := passkeyID(w, r)
	if !ok {
		return
	}

	// ADR-0029's invariant, shared with the provider disconnect so the two
	// cannot drift (credentials.go).
	rows, last, err := s.removeCredential(r.Context(), user.ID, func(q *db.Queries) (int64, error) {
		return q.DeletePasskey(r.Context(), db.DeletePasskeyParams{CredentialID: id, UserID: user.ID})
	})
	switch {
	case err != nil:
		httpx.Fail(w, s.log, "passkey delete failed", err, "That passkey could not be removed. Try again.")
	case last:
		httpx.WriteError(w, http.StatusConflict, "conflict", lastCredentialMessage)
	case rows == 0:
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That passkey is not on this account.")
	default:
		// Unnamed on purpose: the id is all the delete path carries, and
		// reading the row back to name it in the alarm is a query spent on
		// wording. The alarm says something changed; the profile says what
		// is left.
		s.alert(user, "A passkey was removed from your account",
			"A passkey that could sign in to your WattRoom account was removed, and no longer can.")
		// Whoever added it may still hold a session (#1607).
		s.endOtherSessions(r.Context(), user.ID, r)
		w.WriteHeader(http.StatusNoContent)
	}
}

func passkeyID(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(r.PathValue("id"))
	if err != nil || len(raw) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a passkey id.")
		return nil, false
	}
	return raw, true
}

func passkeyName(raw string) string {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "Passkey"
	}
	// Characters, not bytes: the form counts 40 characters, and a byte cut
	// lands mid-rune, which Postgres refuses — after the authenticator has
	// already minted the credential (#824).
	if runes := []rune(name); len(runes) > maxNameLen {
		return string(runes[:maxNameLen])
	}
	return name
}

type passkeyResponse struct {
	// Base64url, the same encoding WebAuthn uses on the wire, so the client
	// can hand it straight back in a path.
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	CreatedAt  string  `json:"createdAt"`
	LastUsedAt *string `json:"lastUsedAt,omitempty"`
}

func toPasskey(row db.Passkey) passkeyResponse {
	out := passkeyResponse{
		ID:        encodeCredentialID(row.CredentialID),
		Name:      row.Name,
		CreatedAt: row.CreatedAt.Time.UTC().Format(time.RFC3339),
	}
	if row.LastUsedAt.Valid {
		last := row.LastUsedAt.Time.UTC().Format(time.RFC3339)
		out.LastUsedAt = &last
	}
	return out
}
