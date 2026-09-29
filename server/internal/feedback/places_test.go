package feedback

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// routeNames is a rider's routes by their names alone: all the intake reads.
type routeNames []string

func (r routeNames) ListOwnerRoutes(context.Context, pgtype.UUID) ([]db.ListOwnerRoutesRow, error) {
	rows := make([]db.ListOwnerRoutesRow, len(r))
	for i, name := range r {
		rows[i].Name = name
	}
	return rows, nil
}

// A report becomes a public issue that agents work, and a disk record they
// read (#3054, ADR-0063): neither holds the reporter's route name, a
// coordinate, or the road the route's query named.
func TestAReportCarriesNoPlace(t *testing.T) {
	t.Setenv("WATTROOM_FEEDBACK_DIR", t.TempDir())
	issuer := &captureIssuer{}
	// Two routes, one name the start of the other: the longer goes first.
	routes := routeNames{"Chrüzbode", testx.Corridor.Route}
	svc := New(fakeSessions{db.User{DisplayName: "velvet"}}, issuer, routes, NewLogRing(slog.DiscardHandler), slog.New(slog.DiscardHandler))
	mux := http.NewServeMux()
	svc.Register(mux)

	payload := `{"route":"/ride?road=3f2a9c1e-route","note":"stalled halfway up the Chrüzbode Rundi","clientBuild":"dev",
		"firstError":"Error: invalid LngLat(7.44744, 46.94812)","userAgent":"vitest","trainer":"Kickr","clientMs":1,
		"buffer":{"ticks":[{"at":1,"watts":210,"cadence":88,"target":200,"state":"riding"}],
		"events":[{"at":1,"kind":"ride","text":"starting chrüzbode rundi"}],
		"errors":[{"at":2,"text":"tile at 46.9481,7.4474 failed"}]}}`
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/feedback", strings.NewReader(payload)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}

	for name, text := range map[string]string{"issue": issuer.title + "\n" + issuer.body, "disk": readReports(t, svc.dir)} {
		if leak := testx.Leak(text); leak != "" {
			t.Errorf("the %s carries %q:\n%s", name, leak, text)
		}
		for _, leak := range []string{"road=", "3f2a9c1e", "rundi"} {
			if strings.Contains(strings.ToLower(text), leak) {
				t.Errorf("the %s carries %q:\n%s", name, leak, text)
			}
		}
		// The debug story survives: what happened, with the place taken out.
		for _, want := range []string{"stalled halfway up the a route", "starting a route", "tile at a place,a place failed", `"watts":210`} {
			if !strings.Contains(text, want) {
				t.Errorf("the %s lost %q:\n%s", name, want, text)
			}
		}
	}
	// The first error is kept on disk and in the fingerprint, not the issue.
	if disk := readReports(t, svc.dir); !strings.Contains(disk, "invalid LngLat(a place, a place)") {
		t.Errorf("the disk record lost the first error:\n%s", disk)
	}
}
