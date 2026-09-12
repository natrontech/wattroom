package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/oauth2"

	"github.com/natrontech/wattroom/server/internal/avatars"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
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

// signInWith runs one provider sign-in and hands back the account it landed
// on, cleaned up after the test.
func signInWith(t *testing.T, s *Service, ident identity) db.User {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	user, _, err := s.upsert(req, provider{id: "github"}, ident, &oauth2.Token{})
	if err != nil {
		t.Fatalf("sign-in: %v", err)
	}
	t.Cleanup(func() {
		_, _ = s.store.Pool.Exec(context.Background(), "delete from users where id = $1", user.ID)
	})
	return user
}

// storedAvatarURL is what every other reader of the account sees — the roster,
// the crew strip, a DM thread, the friends list all select this column and
// hand it to an <img>. Read from the row and not from the struct on purpose:
// the struct is one caller's copy, the row is what the app renders.
func storedAvatarURL(t *testing.T, s *Service, user db.User) *string {
	t.Helper()
	var url *string
	if err := s.store.Pool.QueryRow(context.Background(),
		"select avatar_url from users where id = $1", user.ID).Scan(&url); err != nil {
		t.Fatalf("read avatar_url: %v", err)
	}
	return url
}

// The picture a provider serves is copied onto this origin, and its host never
// reaches a rider's browser (#2078).
//
// This is the privacy property, not a convenience: an <img> at
// avatars.githubusercontent.com tells GitHub which rider is in which room at
// which minute, every time a roster paints, and no rider ever asked GitHub to
// be told. It is also what the enforced img-src needs to be true before it can
// name its hosts (server/headers.go).
func TestASignInPictureIsCopiedOntoThisOrigin(t *testing.T) {
	pictures := &providerPicture{data: tinyPNG}
	s := testServiceWithPictures(t, pictures)

	const atTheProvider = "https://pictures.example.test/u/4711.png"
	user := signInWith(t, s, identity{
		ProviderUserID: "4711", DisplayName: "Kim", AvatarURL: atTheProvider,
	})

	stored := storedAvatarURL(t, s, user)
	if stored == nil {
		t.Fatal("the account carries no picture at all — the mirror dropped it")
	}
	if avatars.OffOrigin(stored) {
		t.Fatalf("the account carries a provider's own host: %q — every roster that draws it tells them where the rider is", *stored)
	}
	if want := "/api/riders/" + store.UUIDString(user.ID) + "/avatar?v="; !strings.HasPrefix(*stored, want) {
		t.Fatalf("avatar_url = %q, want %s…", *stored, want)
	}
	// The struct the sign-in handed back has to say the same thing: it is what
	// /api/me answers with before anything re-reads the row.
	if user.AvatarUrl == nil || *user.AvatarUrl != *stored {
		t.Fatalf("the returned account says %v, the row says %q", user.AvatarUrl, *stored)
	}
	// And the bytes are here, so the address resolves to a picture rather than
	// to a 404 (server/internal/riders serves them).
	img, err := s.store.Queries.GetUserAvatar(t.Context(), user.ID)
	if err != nil || img.Mime != "image/png" || !bytes.Equal(img.Image, tinyPNG) {
		t.Fatalf("stored picture = %+v, %v", img, err)
	}
	if len(pictures.asked) != 1 || pictures.asked[0] != atTheProvider {
		t.Fatalf("the provider was asked %v, want exactly [%s]", pictures.asked, atTheProvider)
	}

	// Signing in again costs the provider nothing: the bytes are the cache,
	// and they are this rider's own row.
	signInWith(t, s, identity{ProviderUserID: "4711", DisplayName: "Kim", AvatarURL: atTheProvider})
	if len(pictures.asked) != 1 {
		t.Fatalf("a returning sign-in refetched the picture: %v", pictures.asked)
	}
}

// What happens when the provider's host is down, slow, or hands over
// something that is not a picture: the rider gets the initial the app already
// draws for a rider with no picture, and no address anybody could fetch is
// left behind (.claude/rules/errors.md — a defined fallback, not a broken
// <img>).
func TestASignInPictureThatCannotBeFetchedLeavesNoAddress(t *testing.T) {
	pictures := &providerPicture{err: errors.New("host is not answering")}
	s := testServiceWithPictures(t, pictures)

	user := signInWith(t, s, identity{
		ProviderUserID: "4712", DisplayName: "Dana",
		AvatarURL: "https://pictures.example.test/u/4712.png",
	})

	if stored := storedAvatarURL(t, s, user); stored != nil {
		t.Fatalf("a picture that would not download left %q on the account", *stored)
	}
	if user.AvatarUrl != nil {
		t.Fatalf("the returned account still carries %q", *user.AvatarUrl)
	}
	// The next sign-in tries again — the provider hands the URL over every
	// time, so nothing had to be kept to make the retry possible.
	pictures.err = nil
	pictures.data = tinyPNG
	again := signInWith(t, s, identity{
		ProviderUserID: "4712", DisplayName: "Dana",
		AvatarURL: "https://pictures.example.test/u/4712.png",
	})
	if again.AvatarUrl == nil || avatars.OffOrigin(again.AvatarUrl) {
		t.Fatalf("the retry did not land the picture on this origin: %v", again.AvatarUrl)
	}
}

// A picture the rider uploaded is theirs, and a later provider sign-in does
// not put the provider's back (#1353 beside #2078).
func TestASignInDoesNotReplaceAnUploadedPicture(t *testing.T) {
	pictures := &providerPicture{data: tinyPNG}
	s := testServiceWithPictures(t, pictures)
	user := signInWith(t, s, identity{ProviderUserID: "4713", DisplayName: "Sam"})

	mine := []byte("\x89PNG\r\n\x1a\nthe-one-i-chose")
	setAt := time.Now()
	url := avatars.Path(user.ID, setAt)
	if _, err := s.store.Queries.SetUserAvatar(t.Context(), db.SetUserAvatarParams{
		ID: user.ID, Mime: "image/png", Image: mine,
		SetAt: pgtype.Timestamptz{Time: setAt, Valid: true}, AvatarUrl: &url,
	}); err != nil {
		t.Fatal(err)
	}

	signInWith(t, s, identity{
		ProviderUserID: "4713", DisplayName: "Sam",
		AvatarURL: "https://pictures.example.test/u/4713.png",
	})
	img, err := s.store.Queries.GetUserAvatar(t.Context(), user.ID)
	if err != nil || !bytes.Equal(img.Image, mine) {
		t.Fatalf("the rider's own picture was replaced: %v", err)
	}
	if len(pictures.asked) != 0 {
		t.Fatalf("the provider was asked for a picture the rider had already chosen: %v", pictures.asked)
	}
}
