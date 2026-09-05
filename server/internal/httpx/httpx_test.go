package httpx

import (
	"bytes"
	"encoding/json"
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
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/rooms/x/images", bytes.NewReader(body))
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
