package rides

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
)

// jpeg is a body http.DetectContentType reads as a JPEG: its first three
// bytes are the marker, which is all the sniff looks at.
func jpeg(tag string) string { return "\xff\xd8\xff\xe0" + tag }

func photoPath(id string, n int, view string) string {
	return fmt.Sprintf("/api/rides/%s/photos/%d/%s", id, n, view)
}

func (h *harness) photos(t *testing.T, user, id string) []any {
	t.Helper()
	status, body := call(t, h.mux, user, http.MethodGet, "/api/rides/"+id+"/photos", "")
	if status != http.StatusOK {
		t.Fatalf("list photos: %d %v", status, body)
	}
	list, _ := body["photos"].([]any)
	return list
}

func TestRidePhotosRoundTrip(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)

	if got := h.photos(t, "alice", id); len(got) != 0 {
		t.Fatalf("a ride with no photos lists none: %v", got)
	}
	for _, view := range []string{"world", "overhead"} {
		if status, body := call(t, h.mux, "alice", http.MethodPut, photoPath(id, 1, view), jpeg(view)); status != http.StatusNoContent {
			t.Fatalf("put %s: %d %v", view, status, body)
		}
	}
	// A retry of the same view replaces it: the photo is still one photo.
	if status, _ := call(t, h.mux, "alice", http.MethodPut, photoPath(id, 1, "world"), jpeg("world again")); status != http.StatusNoContent {
		t.Fatalf("retry: %d", status)
	}
	if status, _ := call(t, h.mux, "alice", http.MethodPut, photoPath(id, 2, "world"), jpeg("second")); status != http.StatusNoContent {
		t.Fatalf("second photo: %d", status)
	}

	list := h.photos(t, "alice", id)
	if len(list) != 2 {
		t.Fatalf("two photos, one entry each: %v", list)
	}
	first, _ := list[0].(map[string]any)
	if first["n"] != float64(1) || fmt.Sprint(first["views"]) != "[overhead world]" {
		t.Fatalf("photo 1 has both views: %v", first)
	}
	if second, _ := list[1].(map[string]any); fmt.Sprint(second["views"]) != "[world]" {
		t.Fatalf("photo 2 has the one view it was given: %v", second)
	}

	code, body := rawGet(t, h, photoPath(id, 1, "world"), false)
	if code != http.StatusOK || body != jpeg("world again") {
		t.Fatalf("get: %d %q", code, body)
	}

	if status, _ := call(t, h.mux, "alice", http.MethodDelete, "/api/rides/"+id+"/photos/1", ""); status != http.StatusNoContent {
		t.Fatalf("delete: %d", status)
	}
	list = h.photos(t, "alice", id)
	if left, _ := list[0].(map[string]any); len(list) != 1 || left["n"] != float64(2) {
		t.Fatalf("delete takes both views of photo 1 only: %v", list)
	}
	if status, _ := call(t, h.mux, "alice", http.MethodDelete, "/api/rides/"+id+"/photos/1", ""); status != http.StatusNotFound {
		t.Fatalf("a second delete: %d, want 404", status)
	}
}

// The cap is the photo's number: past MaxRidePhotos there is no slot, and a
// ride's photo is the JPEG the world draws and nothing else.
func TestRidePhotoRefusals(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)

	for _, tc := range []struct {
		name, path, body string
		want             int
	}{
		{"past the cap", photoPath(id, protocol.MaxRidePhotos+1, "world"), jpeg("x"), http.StatusBadRequest},
		{"photo zero", photoPath(id, 0, "world"), jpeg("x"), http.StatusBadRequest},
		{"not a number", "/api/rides/" + id + "/photos/one/world", jpeg("x"), http.StatusBadRequest},
		{"no such view", photoPath(id, 1, "side"), jpeg("x"), http.StatusBadRequest},
		{"a png", photoPath(id, 1, "world"), "\x89PNG\r\n\x1a\n0000", http.StatusBadRequest},
		{"not an image", photoPath(id, 1, "world"), "hello", http.StatusBadRequest},
		{"the last slot", photoPath(id, protocol.MaxRidePhotos, "world"), jpeg("x"), http.StatusNoContent},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, body := call(t, h.mux, "alice", http.MethodPut, tc.path, tc.body)
			if status != tc.want {
				t.Fatalf("%d %v, want %d", status, body, tc.want)
			}
			if tc.want == http.StatusBadRequest && body["error"] != "validation_error" {
				t.Fatalf("a refusal says what to do: %v", body)
			}
		})
	}
}

// A photo follows its ride (WATTROOM.md: rides are private by default):
// another rider finds nothing at any of its addresses, a ride shared with
// friends shares none, and a personal token reads none.
func TestRidePhotosAreTheOwnersAlone(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)
	if status, _ := call(t, h.mux, "alice", http.MethodPut, photoPath(id, 1, "world"), jpeg("mine")); status != http.StatusNoContent {
		t.Fatalf("put: %d", status)
	}
	if status, _ := call(t, h.mux, "alice", http.MethodPatch, "/api/rides/"+id, `{"sharedWithFriends":true}`); status != http.StatusOK {
		t.Fatalf("share: %d", status)
	}

	for _, tc := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/rides/" + id + "/photos", ""},
		{http.MethodGet, photoPath(id, 1, "world"), ""},
		{http.MethodPut, photoPath(id, 2, "world"), jpeg("theirs")},
		{http.MethodDelete, "/api/rides/" + id + "/photos/1", ""},
	} {
		if status, _ := call(t, h.mux, "bob", tc.method, tc.path, tc.body); status != http.StatusNotFound {
			t.Fatalf("bob %s %s: %d, want 404", tc.method, tc.path, status)
		}
	}
	if list := h.photos(t, "alice", id); len(list) != 1 {
		t.Fatalf("bob changed alice's photos: %v", list)
	}
	for _, path := range []string{"/api/rides/" + id + "/photos", photoPath(id, 1, "world")} {
		if code, _ := rawGet(t, h, path, true); code != http.StatusForbidden {
			t.Fatalf("%s with a bearer: %d, want 403", path, code)
		}
	}
}

// The rider's ceiling is on what will be kept: a photo that would pass it is
// refused as a conflict that says what to do, and replacing a view already
// held never counts that view twice.
func TestRiderPhotoCeiling(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)
	rideID, err := store.ParseUUID(id)
	if err != nil {
		t.Fatal(err)
	}
	// One stored view that claims nearly the whole ceiling: the sum reads the
	// size column, so a test need not hold 100 MB.
	if _, err := h.store.Pool.Exec(t.Context(), `
		insert into ride_photos (ride_id, user_id, n, view, bytes, size_bytes)
		values ($1, $2, 1, 'world', $3, $4)`,
		rideID, h.users.ByToken["alice"].ID, []byte(jpeg("big")), protocol.MaxRiderPhotoBytes-4); err != nil {
		t.Fatalf("seed: %v", err)
	}

	status, body := call(t, h.mux, "alice", http.MethodPut, photoPath(id, 2, "world"), jpeg("one too many"))
	if status != http.StatusConflict || body["error"] != "conflict" ||
		!strings.Contains(fmt.Sprint(body["message"]), "Delete some") {
		t.Fatalf("past the ceiling: %d %v", status, body)
	}
	if status, body := call(t, h.mux, "alice", http.MethodPut, photoPath(id, 1, "world"), jpeg("replaced")); status != http.StatusNoContent {
		t.Fatalf("replacing the big view: %d %v", status, body)
	}
	// Another rider's photos are theirs to count, not alice's.
	bobs := h.save(t, "bob", 120, 200)
	if status, _ := call(t, h.mux, "bob", http.MethodPut, photoPath(bobs, 1, "world"), jpeg("bob")); status != http.StatusNoContent {
		t.Fatalf("bob: %d", status)
	}
}

// A photo goes with its ride.
func TestRidePhotosGoWithTheRide(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)
	if status, _ := call(t, h.mux, "alice", http.MethodPut, photoPath(id, 1, "world"), jpeg("x")); status != http.StatusNoContent {
		t.Fatalf("put: %d", status)
	}
	if status, _ := call(t, h.mux, "alice", http.MethodDelete, "/api/rides/"+id, ""); status != http.StatusNoContent {
		t.Fatalf("delete ride: %d", status)
	}
	var left int
	if err := h.store.Pool.QueryRow(t.Context(),
		"select count(*) from ride_photos where ride_id = $1::uuid", id).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Fatalf("%d photos outlived their ride", left)
	}
	if code, _ := rawGet(t, h, photoPath(id, 1, "world"), false); code != http.StatusNotFound {
		t.Fatalf("a deleted ride's photo: %d", code)
	}
}

// The served bytes are never re-read as anything but the JPEG they are.
func TestRidePhotoIsServedAsAJpeg(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)
	if status, _ := call(t, h.mux, "alice", http.MethodPut, photoPath(id, 1, "overhead"), jpeg("x")); status != http.StatusNoContent {
		t.Fatalf("put: %d", status)
	}
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, photoPath(id, 1, "overhead"), nil)
	req.Header.Set("X-Test-User", "alice")
	rec := httptest.NewRecorder()
	h.mux.ServeHTTP(rec, req)
	if rec.Header().Get("Content-Type") != "image/jpeg" || rec.Header().Get("X-Content-Type-Options") != "nosniff" ||
		!strings.HasPrefix(rec.Header().Get("Cache-Control"), "private") {
		t.Fatalf("headers: %v", rec.Header())
	}
}
