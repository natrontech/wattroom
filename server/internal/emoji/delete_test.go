package emoji

import (
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// Who takes an emoji down (#2643): the uploader, and the crew's owner and
// admins, who keep the crew — never another member.
func TestDeleteRights(t *testing.T) {
	w := setup(t)
	bobs := w.add(t, "bob", "bobs")
	caras := w.add(t, "cara", "caras")

	for _, tc := range []struct {
		name, who, path string
		want            int
		code            string
	}{
		{"signed out", "", w.path("/" + bobs), http.StatusUnauthorized, "unauthorized"},
		{"not in the crew", "dave", w.path("/" + bobs), http.StatusNotFound, "not_found"},
		{"another member's", "cara", w.path("/" + bobs), http.StatusForbidden, "forbidden"},
		{"unknown id", "bob", w.path("/00000000-0000-0000-0000-000000000000"), http.StatusNotFound, "not_found"},
		{"malformed id", "bob", w.path("/nope"), http.StatusNotFound, "not_found"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := w.do(t, http.MethodDelete, tc.who, tc.path, nil)
			if rec.Code != tc.want {
				t.Fatalf("%d %s, want %d", rec.Code, rec.Body.String(), tc.want)
			}
			if body := decode(t, rec); body["error"] != tc.code {
				t.Errorf("error = %v, want %s", body["error"], tc.code)
			}
		})
	}
	if got := w.names(t, "bob"); len(got) != 2 {
		t.Fatalf("a refused delete took something: %v", got)
	}

	// An id from another crew, under that crew's path, misses: dave's crew
	// does not hold bob's emoji even though dave may delete in his own.
	other := testx.Crew(t, w.st, "Other Crew", w.users.ByToken["dave"].ID)
	if rec := w.do(t, http.MethodDelete, "dave", "/api/crews/"+store.UUIDString(other)+"/emoji/"+bobs, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("an emoji deleted through another crew: %d", rec.Code)
	}

	// The owner takes anyone's down.
	if rec := w.do(t, http.MethodDelete, "alice", w.path("/"+caras), nil); rec.Code != http.StatusNoContent {
		t.Fatalf("the owner deleting cara's: %d %s", rec.Code, rec.Body.String())
	}
	// So does an admin.
	w.setRole(t, "cara", "admin")
	if rec := w.do(t, http.MethodDelete, "cara", w.path("/"+bobs), nil); rec.Code != http.StatusNoContent {
		t.Fatalf("an admin deleting bob's: %d %s", rec.Code, rec.Body.String())
	}
	if got := w.names(t, "bob"); len(got) != 0 {
		t.Fatalf("after both deletes the crew reads %v", got)
	}
	// Gone is gone: a second delete is a 404, not a silent success.
	if rec := w.do(t, http.MethodDelete, "bob", w.path("/"+bobs), nil); rec.Code != http.StatusNotFound {
		t.Errorf("deleting it twice: %d, want 404", rec.Code)
	}
}
