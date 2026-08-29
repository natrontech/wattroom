package feedback

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

// GitHubIssuer files feedback as issues labelled `feedback`, deduplicating by
// fingerprint: a matching open issue gets a comment, not a duplicate. Token
// from WATTROOM_GITHUB_TOKEN, repo from WATTROOM_GITHUB_REPO ("owner/name");
// absent config means nil issuer and disk-only intake.
type GitHubIssuer struct {
	token string
	repo  string
	http  *http.Client
}

func GitHubFromEnv() *GitHubIssuer {
	token := os.Getenv("WATTROOM_GITHUB_TOKEN")
	repo := os.Getenv("WATTROOM_GITHUB_REPO")
	if token == "" || repo == "" {
		return nil
	}
	return &GitHubIssuer{token: token, repo: repo, http: &http.Client{Timeout: 15 * time.Second}}
}

func (g *GitHubIssuer) FileOrComment(fingerprint, title, body string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	marker := "<!-- fp:" + fingerprint + " -->"
	if url, number, ok := g.findOpen(ctx, fingerprint); ok {
		err := g.post(ctx,
			fmt.Sprintf("https://api.github.com/repos/%s/issues/%d/comments", g.repo, number),
			map[string]any{"body": marker + "\nSame fingerprint, another report:\n\n" + body}, nil)
		return url, err
	}

	var created struct {
		HTMLURL string `json:"html_url"`
	}
	err := g.post(ctx, fmt.Sprintf("https://api.github.com/repos/%s/issues", g.repo), map[string]any{
		"title": title, "body": marker + "\n" + body, "labels": []string{"feedback"},
	}, &created)
	return created.HTMLURL, err
}

// findOpen searches open feedback issues for the fingerprint marker.
func (g *GitHubIssuer) findOpen(ctx context.Context, fingerprint string) (string, int, bool) {
	q := fmt.Sprintf(`repo:%s is:issue is:open label:feedback "fp:%s"`, g.repo, fingerprint)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://api.github.com/search/issues?q="+urlQueryEscape(q), nil)
	if err != nil {
		return "", 0, false
	}
	req.Header.Set("Authorization", "Bearer "+g.token)
	res, err := g.http.Do(req)
	if err != nil {
		return "", 0, false
	}
	defer func() { _ = res.Body.Close() }()
	var out struct {
		Items []struct {
			Number  int    `json:"number"`
			HTMLURL string `json:"html_url"`
		} `json:"items"`
	}
	if json.NewDecoder(res.Body).Decode(&out) != nil || len(out.Items) == 0 {
		return "", 0, false
	}
	return out.Items[0].HTMLURL, out.Items[0].Number, true
}

func (g *GitHubIssuer) post(ctx context.Context, url string, payload any, into any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+g.token)
	req.Header.Set("Content-Type", "application/json")
	res, err := g.http.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode >= 300 {
		return fmt.Errorf("feedback: github %s: %d", url, res.StatusCode)
	}
	if into != nil {
		return json.NewDecoder(res.Body).Decode(into)
	}
	return nil
}

func urlQueryEscape(s string) string {
	out := make([]byte, 0, len(s)*2)
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9',
			c == '-', c == '_', c == '.', c == '~':
			out = append(out, c)
		default:
			out = append(out, fmt.Sprintf("%%%02X", c)...)
		}
	}
	return string(out)
}
