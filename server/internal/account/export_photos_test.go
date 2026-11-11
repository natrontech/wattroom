package account

import (
	"fmt"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// A rider's ride photos travel with their export (WATTROOM.md: a rider's own
// uploads do), each view a JPEG byte for byte, listed in ride-photos.json and
// counted in the manifest — and another rider's are in none of it.
func TestExportCarriesTheRidersOwnRidePhotos(t *testing.T) {
	h := setup(t)
	place := h.createCrew(t, "alice", "bob")

	files := map[string]string{}
	for _, name := range []string{"alice", "bob"} {
		ride := h.createRide(t, name, place, name+"'s Openers", gzipped(t, `[]`))
		for _, view := range []string{"world", "overhead"} {
			body := name + "-photo-" + view
			if _, err := h.store.Queries.PutRidePhoto(t.Context(), db.PutRidePhotoParams{
				N: 1, View: view, Bytes: []byte(body), SizeBytes: int32(len(body)), //nolint:gosec // a dozen bytes
				RideID: ride, UserID: h.id(name),
			}); err != nil {
				t.Fatalf("photo %s %s: %v", name, view, err)
			}
		}
		files[name] = store.UUIDString(ride)[:8]
	}

	got := h.exportFiles(t, "alice")
	for _, view := range []string{"world", "overhead"} {
		var found bool
		for name, body := range got {
			if strings.HasPrefix(name, "uploads/ride-photos/") &&
				strings.HasSuffix(name, fmt.Sprintf("-%s-1-%s.jpg", files["alice"], view)) {
				found = true
				if body != "alice-photo-"+view {
					t.Errorf("%s holds %q, not the photo", name, body)
				}
			}
		}
		if !found {
			t.Errorf("the export has no %s view of alice's photo", view)
		}
	}
	if !strings.Contains(got["ride-photos.json"], `"view": "overhead"`) {
		t.Errorf("ride-photos.json lists no photo:\n%s", got["ride-photos.json"])
	}
	if !strings.Contains(got["manifest.json"], `"ridePhotos"`) || !strings.Contains(got["manifest.json"], `"complete": true`) {
		t.Errorf("the manifest does not count the photos:\n%s", got["manifest.json"])
	}
	for name, body := range got {
		if strings.Contains(body, "bob-photo") || strings.Contains(name, files["bob"]) {
			t.Errorf("%s carries another rider's photo", name)
		}
	}
}
