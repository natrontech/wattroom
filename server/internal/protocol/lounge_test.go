package protocol

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"testing"
)

// The client keeps its own copy of LoungeWeathers to draw the window and step
// through it. A weather added on one side only would be dropped by the hub or
// drawn as rain without an error anywhere, so the two are read side by side.
func TestLoungeWeathersMatchTheClient(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "web", "src", "lib", "lounge", "state.ts"))
	if err != nil {
		t.Fatalf("client lounge state: %v", err)
	}
	list := regexp.MustCompile(`export const WEATHERS = \[([^\]]+)\]`).FindSubmatch(src)
	if list == nil {
		t.Fatal("state.ts declares no WEATHERS")
	}
	var client []string
	for _, word := range regexp.MustCompile(`'([^']*)'`).FindAllSubmatch(list[1], -1) {
		client = append(client, string(word[1]))
	}
	if !slices.Equal(client, LoungeWeathers) {
		t.Errorf("client weathers %v, server %v", client, LoungeWeathers)
	}
}
