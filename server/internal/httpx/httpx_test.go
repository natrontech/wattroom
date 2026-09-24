package httpx

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// imageBytes builds a body that http.DetectContentType recognises as the given
// type: the magic prefix, padded to size so the boundary cases can pick the
// exact length.
func imageBytes(magic string, size int) []byte {
	b := make([]byte, size)
	copy(b, magic)
	return b
}

const (
	pngMagic  = "\x89PNG\r\n\x1a\n"
	jpegMagic = "\xFF\xD8\xFF"
	gifMagic  = "GIF89a"
	webpMagic = "RIFF\x00\x00\x00\x00WEBPVP8 "
)

// readUpload runs ReadImageUpload over one body with the declared Content-Type
// and returns what it decided plus the recorded response.
func readUpload(t *testing.T, declared string, body []byte) (data []byte, mime string, ok bool, rec *httptest.ResponseRecorder) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/channels/x/chat/images", bytes.NewReader(body))
	if declared != "" {
		req.Header.Set("Content-Type", declared)
	}
	rec = httptest.NewRecorder()
	data, mime, ok = ReadImageUpload(rec, req)
	return data, mime, ok, rec
}

func decodeError(t *testing.T, rec *httptest.ResponseRecorder) ErrorResponse {
	t.Helper()
	var e ErrorResponse
	if err := json.NewDecoder(rec.Body).Decode(&e); err != nil {
		t.Fatalf("error body is not the ErrorResponse shape: %v (%q)", err, rec.Body.String())
	}
	return e
}

// A cross-site form posts text/plain, urlencoded or multipart without a
// preflight, and a JSON decoder reads the object at the front of such a body
// (#1823). Bare JSON with no Content-Type at all still decodes.
func TestDecodeStrictRefusesFormEncodings(t *testing.T) {
	for _, contentType := range []string{"text/plain", "text/plain; charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"} {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(`{"a":1}=x`))
		req.Header.Set("Content-Type", contentType)
		var into struct{ A int }
		if err := DecodeStrict(req, &into); err == nil {
			t.Fatalf("%s decoded", contentType)
		}
	}
	for _, contentType := range []string{"", "application/json", "application/json; charset=utf-8"} {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(`{"a":1}`))
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		var into struct{ A int }
		if err := DecodeStrict(req, &into); err != nil || into.A != 1 {
			t.Fatalf("%q did not decode: %v", contentType, err)
		}
	}
}

// Behind a declared proxy the LAST hop is the only one the caller did not
// write (#1824); a fresh first hop per request used to be a fresh sign-in
// budget per request.
func TestClientIPTakesTheProxysHop(t *testing.T) {
	trustProxyForTest(t, true)
	cases := []struct{ xff, remote, want string }{
		{"", "10.0.0.7:4242", "10.0.0.7"},
		{"203.0.113.9", "10.0.0.1:1", "203.0.113.9"},
		{"1.2.3.4, 203.0.113.9", "10.0.0.1:1", "203.0.113.9"},
		{"spoofed, more spoof, 203.0.113.9", "10.0.0.1:1", "203.0.113.9"},
		{"203.0.113.9, ", "10.0.0.1:1", "203.0.113.9"},
		{" , ", "10.0.0.7:4242", "10.0.0.7"},
	}
	for _, c := range cases {
		if got := ClientIP(clientIPRequest(t, c.xff, c.remote)); got != c.want {
			t.Errorf("xff %q remote %q: got %q, want %q", c.xff, c.remote, got, c.want)
		}
	}
}

// With no proxy declared — the bare binary, and the default — the header is
// caller-written and reading it hands out a budget per header value (#2258).
// Same table, and every answer is the socket's peer.
func TestClientIPIgnoresTheHeaderWithNoProxyDeclared(t *testing.T) {
	trustProxyForTest(t, false)
	for _, c := range []struct{ xff, remote, want string }{
		{"", "10.0.0.7:4242", "10.0.0.7"},
		{"203.0.113.9", "10.0.0.1:1", "10.0.0.1"},
		{"1.2.3.4, 203.0.113.9", "10.0.0.1:1", "10.0.0.1"},
		// A budget is spent per returned key: two callers writing different
		// headers from one host must come back as one key, not two.
		{"9.9.9.9", "10.0.0.1:2", "10.0.0.1"},
	} {
		if got := ClientIP(clientIPRequest(t, c.xff, c.remote)); got != c.want {
			t.Errorf("xff %q remote %q: got %q, want %q", c.xff, c.remote, got, c.want)
		}
	}
}

func trustProxyForTest(t *testing.T, trust bool) {
	t.Helper()
	was := trustProxy.Load()
	TrustProxyHeader(trust)
	t.Cleanup(func() { TrustProxyHeader(was) })
}

func clientIPRequest(t *testing.T, xff, remote string) *http.Request {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	req.RemoteAddr = remote
	if xff != "" {
		req.Header.Set("X-Forwarded-For", xff)
	}
	return req
}

func TestReadImageUploadAcceptsTheFourRenderedTypes(t *testing.T) {
	cases := []struct {
		name  string
		magic string
		mime  string
	}{
		{"png", pngMagic, "image/png"},
		{"jpeg", jpegMagic, "image/jpeg"},
		{"gif", gifMagic, "image/gif"},
		{"webp", webpMagic, "image/webp"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body := imageBytes(tc.magic, 64)
			// The declared type is deliberately wrong: the bytes decide.
			data, mime, ok, rec := readUpload(t, "application/octet-stream", body)
			if !ok {
				t.Fatalf("refused a %s: %d %s", tc.name, rec.Code, rec.Body.String())
			}
			if mime != tc.mime {
				t.Errorf("mime = %q, want %q", mime, tc.mime)
			}
			if !bytes.Equal(data, body) {
				t.Errorf("returned bytes differ from the upload")
			}
			if rec.Code != http.StatusOK || rec.Body.Len() != 0 {
				t.Errorf("an accepted upload must not write a response, got %d %q", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestReadImageUploadSniffsInsteadOfBelievingTheHeader(t *testing.T) {
	cases := []struct {
		name     string
		declared string
		body     []byte
	}{
		{"svg claiming png", "image/png", []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)},
		{"html claiming png", "image/png", []byte(`<!doctype html><html><body><script>alert(1)</script></body></html>`)},
		{"plain text claiming jpeg", "image/jpeg", []byte("not an image at all")},
		{"pdf", "application/pdf", []byte("%PDF-1.7 ...")},
		{"empty body", "image/png", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data, mime, ok, rec := readUpload(t, tc.declared, tc.body)
			if ok || data != nil || mime != "" {
				t.Fatalf("accepted %s as %q", tc.name, mime)
			}
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", rec.Code)
			}
			e := decodeError(t, rec)
			if e.Error != "validation_error" {
				t.Errorf("error code = %q, want validation_error", e.Error)
			}
			if !strings.Contains(e.Message, "PNG, JPEG, WebP, or GIF") {
				t.Errorf("message does not name the accepted types: %q", e.Message)
			}
		})
	}
}

func TestReadImageUploadCapsAtMaxImageBytes(t *testing.T) {
	t.Run("exactly the cap is accepted", func(t *testing.T) {
		data, _, ok, rec := readUpload(t, "image/png", imageBytes(pngMagic, MaxImageBytes))
		if !ok {
			t.Fatalf("refused a body of exactly MaxImageBytes: %d %s", rec.Code, rec.Body.String())
		}
		if len(data) != MaxImageBytes {
			t.Errorf("len(data) = %d, want %d", len(data), MaxImageBytes)
		}
	})
	t.Run("one byte over is refused", func(t *testing.T) {
		data, _, ok, rec := readUpload(t, "image/png", imageBytes(pngMagic, MaxImageBytes+1))
		if ok || data != nil {
			t.Fatalf("accepted a body over the cap")
		}
		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", rec.Code)
		}
		e := decodeError(t, rec)
		if e.Error != "validation_error" || !strings.Contains(e.Message, "capped") {
			t.Errorf("unexpected error %+v", e)
		}
	})
}

// A caller's own cap (#2643) is the one refused at, in the caller's words.
func TestReadImageUploadUpToCapsAtTheCallersLimit(t *testing.T) {
	read := func(size int) (bool, *httptest.ResponseRecorder) {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/crews/x/emoji", bytes.NewReader(imageBytes(pngMagic, size)))
		rec := httptest.NewRecorder()
		_, _, ok := ReadImageUploadUpTo(rec, req, 1024, "Emoji are capped at 1 KB.")
		return ok, rec
	}
	if ok, rec := read(1024); !ok {
		t.Fatalf("refused exactly the cap: %d %s", rec.Code, rec.Body.String())
	}
	ok, rec := read(1025)
	if ok || rec.Code != http.StatusBadRequest {
		t.Fatalf("one byte over: ok=%v %d", ok, rec.Code)
	}
	if e := decodeError(t, rec); e.Error != "validation_error" || e.Message != "Emoji are capped at 1 KB." {
		t.Errorf("unexpected error %+v", e)
	}
}

// A rider who navigates away cancels the request's context, and every read in
// flight fails with context.Canceled. Nothing broke: logging it as an error
// buried real failures among a walk's worth of navigations (#2538).
func TestFailTreatsAnAbandonedRequestAsNoError(t *testing.T) {
	for _, tc := range []struct {
		name      string
		err       error
		wantError bool
	}{
		{"client hung up", fmt.Errorf("list rides: %w", context.Canceled), false},
		{"deadline passed", fmt.Errorf("list rides: %w", context.DeadlineExceeded), true},
		{"real failure", errors.New("connection refused"), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var logs bytes.Buffer
			log := slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
			rec := httptest.NewRecorder()
			Fail(rec, log, "list rides failed", tc.err, "Could not load your rides.")

			if got := strings.Contains(logs.String(), `"level":"ERROR"`); got != tc.wantError {
				t.Errorf("logged an ERROR = %v, want %v: %s", got, tc.wantError, logs.String())
			}
			if tc.wantError {
				if rec.Code != http.StatusInternalServerError || decodeError(t, rec).Error != "internal_error" {
					t.Errorf("got %d %q, want 500 internal_error", rec.Code, rec.Body.String())
				}
			} else if rec.Body.Len() != 0 {
				t.Errorf("wrote %q to a client that already left", rec.Body.String())
			}
		})
	}
}
