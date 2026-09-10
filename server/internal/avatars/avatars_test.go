package avatars

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

// tinyPNG is just the signature — enough for http.DetectContentType, which is
// what decides whether a provider handed over a picture or something else.
var tinyPNG = []byte("\x89PNG\r\n\x1a\nrest-of-a-picture")

// host stands in for a sign-in provider's picture CDN. The real fetch is
// unfurl.Fetcher and the guard has its own tests; these cases are about what
// this package does with what comes back, and none of them touch a network.
type host struct {
	data  []byte
	mime  string
	err   error
	asked []string
}

func (h *host) Image(_ context.Context, url string, max int64) ([]byte, string, error) {
	h.asked = append(h.asked, url)
	if h.err != nil {
		return nil, "", h.err
	}
	if int64(len(h.data)) > max {
		return nil, "", errors.New("over the cap")
	}
	return h.data, h.mime, nil
}

func setup(t *testing.T, h *host) (*Mirror, *store.Store) {
	t.Helper()
	st := storetest.Open(t)
	return New(st, h, slog.New(slog.DiscardHandler)), st
}

// rider makes an account holding the address given — nil for a fresh one,
// a provider's own URL for a row written before this package existed.
func rider(t *testing.T, st *store.Store, avatarURL *string) db.User {
	t.Helper()
	user, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
		DisplayName: "avatars-test", AvatarUrl: avatarURL, FtpWatts: 200, WeightKg: 75,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", user.ID)
	})
	return user
}

func urlOf(t *testing.T, st *store.Store, id pgtype.UUID) *string {
	t.Helper()
	var url *string
	if err := st.Pool.QueryRow(context.Background(),
		"select avatar_url from users where id = $1", id).Scan(&url); err != nil {
		t.Fatalf("read avatar_url: %v", err)
	}
	return url
}

func TestAdopt(t *testing.T) {
	const atTheProvider = "https://pictures.example.test/u/9.png"

	t.Run("stores the bytes and an address on this origin", func(t *testing.T) {
		h := &host{data: tinyPNG, mime: "image/png"}
		m, st := setup(t, h)
		user := rider(t, st, nil)

		got := m.Adopt(t.Context(), user, atTheProvider)
		if got.AvatarUrl == nil || OffOrigin(got.AvatarUrl) {
			t.Fatalf("avatar_url = %v, want a path on this origin", got.AvatarUrl)
		}
		if want := "/api/riders/" + store.UUIDString(user.ID) + "/avatar?v="; !strings.HasPrefix(*got.AvatarUrl, want) {
			t.Fatalf("avatar_url = %q, want %s…", *got.AvatarUrl, want)
		}
		if stored := urlOf(t, st, user.ID); stored == nil || *stored != *got.AvatarUrl {
			t.Fatalf("the row says %v, the returned account %q", stored, *got.AvatarUrl)
		}
		img, err := st.Queries.GetUserAvatar(t.Context(), user.ID)
		if err != nil || img.Mime != "image/png" || string(img.Image) != string(tinyPNG) {
			t.Fatalf("stored picture = %+v, %v", img, err)
		}
	})

	t.Run("a provider that offers nothing is not asked", func(t *testing.T) {
		h := &host{data: tinyPNG, mime: "image/png"}
		m, st := setup(t, h)
		user := rider(t, st, nil)

		if got := m.Adopt(t.Context(), user, ""); got.AvatarUrl != nil {
			t.Fatalf("avatar_url = %q, want none", *got.AvatarUrl)
		}
		if len(h.asked) != 0 {
			t.Fatalf("asked %v for a picture nobody offered", h.asked)
		}
	})

	t.Run("a refused picture leaves no address behind", func(t *testing.T) {
		// The cases that all come back the same way: the host is down, the
		// URL is refused by the guard, the body is over the cap, or what came
		// back is a document rather than a picture. The rider draws as an
		// initial and nothing is stored that anybody could fetch.
		for _, why := range []error{
			errors.New("dial: address is not on the public internet"),
			errors.New("picture is over the cap"),
			errors.New("not one of the picture types WattRoom renders"),
		} {
			h := &host{err: why}
			m, st := setup(t, h)
			legacy := atTheProvider
			user := rider(t, st, &legacy)

			got := m.Adopt(t.Context(), user, atTheProvider)
			if got.AvatarUrl != nil {
				t.Fatalf("%v: the account still carries %q", why, *got.AvatarUrl)
			}
			if stored := urlOf(t, st, user.ID); stored != nil {
				t.Fatalf("%v: the row still carries %q", why, *stored)
			}
			if _, err := st.Queries.GetUserAvatar(t.Context(), user.ID); !errors.Is(err, pgx.ErrNoRows) {
				t.Fatalf("%v: something was stored anyway (%v)", why, err)
			}
		}
	})

	t.Run("a picture the rider chose is never replaced", func(t *testing.T) {
		h := &host{data: tinyPNG, mime: "image/png"}
		m, st := setup(t, h)
		user := rider(t, st, nil)
		mine := []byte("\x89PNG\r\n\x1a\nthe-one-i-chose")
		setAt := time.Now()
		url := Path(user.ID, setAt)
		if _, err := st.Queries.SetUserAvatar(t.Context(), db.SetUserAvatarParams{
			ID: user.ID, Mime: "image/png", Image: mine,
			SetAt: pgtype.Timestamptz{Time: setAt, Valid: true}, AvatarUrl: &url,
		}); err != nil {
			t.Fatal(err)
		}
		user.AvatarUrl = &url

		if got := m.Adopt(t.Context(), user, atTheProvider); *got.AvatarUrl != url {
			t.Fatalf("avatar_url moved to %q", *got.AvatarUrl)
		}
		img, _ := st.Queries.GetUserAvatar(t.Context(), user.ID)
		if string(img.Image) != string(mine) {
			t.Fatal("the rider's own picture was overwritten by the provider's")
		}
		if len(h.asked) != 0 {
			t.Fatalf("asked %v for a picture the rider had already chosen", h.asked)
		}
	})
}

// The rows written before this release: each one either becomes a picture on
// this origin or stops naming a host at all, and the pass ends rather than
// spinning on rows it cannot move.
func TestBackfillLeavesNoProviderHostBehind(t *testing.T) {
	h := &host{data: tinyPNG, mime: "image/png"}
	m, st := setup(t, h)

	legacy := make([]db.User, 3)
	for i := range legacy {
		url := "https://pictures.example.test/u/" + string(rune('a'+i)) + ".png"
		legacy[i] = rider(t, st, &url)
	}
	fresh := rider(t, st, nil)
	uploadURL := Path(fresh.ID, time.Now())
	ownPicture := rider(t, st, &uploadURL)

	m.Backfill(t.Context())

	for _, user := range legacy {
		stored := urlOf(t, st, user.ID)
		if OffOrigin(stored) {
			t.Fatalf("a converted row still names a provider: %q", *stored)
		}
		if stored == nil {
			t.Fatal("a row that had a picture came out with none")
		}
	}
	if len(h.asked) != len(legacy) {
		t.Fatalf("asked for %d pictures, want %d — %v", len(h.asked), len(legacy), h.asked)
	}
	if stored := urlOf(t, st, fresh.ID); stored != nil {
		t.Fatalf("a rider with no picture was given %q", *stored)
	}
	if stored := urlOf(t, st, ownPicture.ID); stored == nil || *stored != uploadURL {
		t.Fatalf("an address on this origin was rewritten to %v", stored)
	}

	// Nothing is left to convert, so a second pass asks nobody anything —
	// this is what makes it safe to run at every boot.
	before := len(h.asked)
	m.Backfill(t.Context())
	if len(h.asked) != before {
		t.Fatalf("a second pass refetched: %v", h.asked[before:])
	}
}

// A host that will not answer must not leave the pass looping over the same
// page forever, and must not leave the address either.
func TestBackfillGivesUpOnAHostThatWillNotAnswer(t *testing.T) {
	h := &host{err: errors.New("host is not answering")}
	m, st := setup(t, h)
	url := "https://pictures.example.test/u/z.png"
	user := rider(t, st, &url)

	m.Backfill(t.Context())

	if stored := urlOf(t, st, user.ID); stored != nil {
		t.Fatalf("the row still names %q", *stored)
	}
	if len(h.asked) != 1 {
		t.Fatalf("the pass asked %d times for one picture", len(h.asked))
	}
}

func TestOffOrigin(t *testing.T) {
	ours := "/api/riders/11111111-1111-1111-1111-111111111111/avatar?v=1"
	theirs := "https://pictures.example.test/u/1.png"
	protocolRelative := "//pictures.example.test/u/1.png"
	empty := ""
	for _, tc := range []struct {
		name string
		url  *string
		want bool
	}{
		{"nothing stored", nil, false},
		{"empty", &empty, false},
		{"a path on this origin", &ours, false},
		{"a provider's absolute URL", &theirs, true},
		// Nothing writes this, and it would load from a stranger's host all
		// the same — so the test is the scheme-less form, not just https.
		{"protocol-relative", &protocolRelative, true},
	} {
		if got := OffOrigin(tc.url); got != tc.want {
			t.Errorf("%s: OffOrigin = %v, want %v", tc.name, got, tc.want)
		}
	}
}
