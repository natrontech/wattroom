package protocol

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"testing"
)

// The client keeps its own copy of AwayReasons — the union its menu, marks
// and timeline lines are keyed on — and the server drops any reason not in
// its list. A word added on one side only would be refused or drawn as the
// plain cup without an error anywhere, so the two are read side by side
// here, the way gamify reads the trophy catalogue (#3360).
func TestAwayReasonsMatchTheClient(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "web", "src", "lib", "away.ts"))
	if err != nil {
		t.Fatalf("client away states: %v", err)
	}
	union := regexp.MustCompile(`export type AwayReason = ([^;]+);`).FindSubmatch(src)
	if union == nil {
		t.Fatal("away.ts declares no AwayReason union")
	}
	var client []string
	for _, word := range regexp.MustCompile(`'([^']*)'`).FindAllSubmatch(union[1], -1) {
		if w := string(word[1]); w != "" { // plain away: the button's face, no reason
			client = append(client, w)
		}
	}
	if !slices.Equal(client, AwayReasons) {
		t.Errorf("the client's away reasons are %q, the server's %q", client, AwayReasons)
	}
}
