package auth

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
)

// tinyPNG is just the signature — enough for http.DetectContentType.
var tinyPNG = []byte("\x89PNG\r\n\x1a\nrest-of-a-picture")

func postAvatar(t *testing.T, s *Service, cookie *http.Cookie, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/me/avatar", bytes.NewReader(body))
	if cookie != nil {
		req.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	s.handleSetAvatar(w, req)
	return w
}

// The rider's own picture (#1353): the upload lands, avatar_url points at it
// with a version, and a second upload moves the version so every cached
// <img> refetches.
func TestSetAvatar(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)

	if w := postAvatar(t, s, nil, tinyPNG); w.Code != http.StatusUnauthorized {
		t.Fatalf("signed out: expected 401, got %d", w.Code)
	}
	if w := postAvatar(t, s, cookie, []byte("not a picture at all")); w.Code != http.StatusBadRequest {
		t.Fatalf("text body: expected 400, got %d: %s", w.Code, w.Body.String())
	}

	w := postAvatar(t, s, cookie, tinyPNG)
	if w.Code != http.StatusOK {
		t.Fatalf("upload: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var me meResponse
	if err := json.NewDecoder(w.Body).Decode(&me); err != nil {
		t.Fatal(err)
	}
	prefix := "/api/riders/" + store.UUIDString(user.ID) + "/avatar?v="
	if me.AvatarURL == nil || !strings.HasPrefix(*me.AvatarURL, prefix) {
		t.Fatalf("avatarUrl = %v, want %s…", me.AvatarURL, prefix)
	}
	first := *me.AvatarURL
	img, err := s.store.Queries.GetUserAvatar(t.Context(), user.ID)
	if err != nil || img.Mime != "image/png" || !bytes.Equal(img.Image, tinyPNG) {
		t.Fatalf("stored avatar = %+v, %v", img, err)
	}

	w = postAvatar(t, s, cookie, tinyPNG)
	if w.Code != http.StatusOK {
		t.Fatalf("second upload: %d: %s", w.Code, w.Body.String())
	}
	_ = json.NewDecoder(w.Body).Decode(&me)
	if me.AvatarURL == nil || *me.AvatarURL == first {
		t.Fatalf("a replaced picture kept its address %q — caches would show the old one", first)
	}
}
