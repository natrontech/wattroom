package main

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestVersionHandler(t *testing.T) {
	rec := httptest.NewRecorder()
	versionHandler()(rec, httptest.NewRequestWithContext(t.Context(), "GET", "/api/version", nil))

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if got["commit"] == "" {
		t.Fatal("commit is empty — want a revision or the dev fallback")
	}
}
