package fitexport

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func post(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/rides/export", strings.NewReader(body))
	rec := httptest.NewRecorder()
	Handler(slog.New(slog.DiscardHandler)).ServeHTTP(rec, req)
	return rec
}

const goodRide = `{"startedAt":"2026-08-29T06:00:00Z","samples":[
	{"second":0,"watts":200,"cadence":90,"heartRate":140},
	{"second":1,"watts":205,"cadence":91,"heartRate":141}]}`

func TestHandlerReturnsAFitFile(t *testing.T) {
	rec := post(t, goodRide)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "application/vnd.ant.fit" {
		t.Errorf("content-type = %q", got)
	}
	if got := rec.Header().Get("Content-Disposition"); !strings.Contains(got, "wattroom-2026-08-29-0600.fit") {
		t.Errorf("content-disposition = %q", got)
	}
	body, _ := io.ReadAll(rec.Body)
	if len(body) == 0 {
		t.Fatal("empty body")
	}
	// It must be a real file, not just bytes with the right header.
	if _, err := MessageKinds(body); err != nil {
		t.Fatalf("response is not decodable as FIT: %v", err)
	}
}

// The body is client-recorded and therefore attacker-controlled. Each of these
// must be refused with a message a rider could act on, not a 500.
func TestHandlerRejectsBadInput(t *testing.T) {
	tests := map[string]string{
		"not json":          `{`,
		"unknown field":     `{"startedAt":"2026-08-29T06:00:00Z","samples":[],"evil":1}`,
		"no start time":     `{"samples":[{"second":0,"watts":200}]}`,
		"no samples":        `{"startedAt":"2026-08-29T06:00:00Z","samples":[]}`,
		"negative watts":    `{"startedAt":"2026-08-29T06:00:00Z","samples":[{"second":0,"watts":-5}]}`,
		"absurd watts":      `{"startedAt":"2026-08-29T06:00:00Z","samples":[{"second":0,"watts":99999}]}`,
		"absurd cadence":    `{"startedAt":"2026-08-29T06:00:00Z","samples":[{"second":0,"watts":200,"cadence":9999}]}`,
		"absurd heart rate": `{"startedAt":"2026-08-29T06:00:00Z","samples":[{"second":0,"watts":200,"heartRate":9999}]}`,
		"negative second":   `{"startedAt":"2026-08-29T06:00:00Z","samples":[{"second":-1,"watts":200}]}`,
		"out of order":      `{"startedAt":"2026-08-29T06:00:00Z","samples":[{"second":5,"watts":200},{"second":2,"watts":200}]}`,
	}

	for name, body := range tests {
		t.Run(name, func(t *testing.T) {
			rec := post(t, body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400. body = %s", rec.Code, rec.Body.String())
			}
			var payload map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
				t.Fatalf("error body is not JSON: %v", err)
			}
			if payload["error"] == "" || payload["message"] == "" {
				t.Errorf("error shape missing code or message: %v", payload)
			}
		})
	}
}

// A hostile client must not be able to make the server allocate a huge ride.
func TestHandlerRejectsOversizedRides(t *testing.T) {
	var b strings.Builder
	b.WriteString(`{"startedAt":"2026-08-29T06:00:00Z","samples":[`)
	for i := range maxSamples + 1 {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`{"second":`)
		b.WriteString(itoa(i))
		b.WriteString(`,"watts":200}`)
	}
	b.WriteString(`]}`)

	rec := post(t, b.String())
	// Either the sample cap or the body cap catches it; both are 400.
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var digits []byte
	for i > 0 {
		digits = append([]byte{byte('0' + i%10)}, digits...)
		i /= 10
	}
	return string(digits)
}
