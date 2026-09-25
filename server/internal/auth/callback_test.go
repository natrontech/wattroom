package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"golang.org/x/oauth2"
)

// A failed OAuth round trip lands in a browser tab, not in the SPA's fetch
// (#2847): the answer is a page that says what happened and links the way
// back, never a JSON body sitting in the address bar.
func TestAFailedOAuthCallbackLandsOnAPageWithAWayBack(t *testing.T) {
	for _, c := range []struct {
		name, query, cookie string
		want                int
		says, href          string
	}{
		{"cancelled at the provider", "?error=access_denied&state=s1", "s1", http.StatusOK,
			"You cancelled at GitHub", "/login"},
		{"cancelled while connecting", "?error=access_denied&state=" + linkStatePrefix + "s1", linkStatePrefix + "s1", http.StatusOK,
			"nothing was connected", "/settings/profile"},
		{"cancelled, the tab reloaded", "?error=access_denied&state=s1", "", http.StatusOK,
			"You cancelled at GitHub", "/login"},
		{"another provider error", "?error=server_error&state=s1", "s1", http.StatusBadRequest,
			"GitHub did not finish", "/login"},
		{"stale state", "?state=s1&code=x", "", http.StatusBadRequest,
			"started in this browser", "/login"},
		{"a code the provider will not trade", "?state=s1&code=x", "s1", http.StatusBadRequest,
			"GitHub did not accept", "/login"},
	} {
		t.Run(c.name, func(t *testing.T) {
			s := callbackService()
			// A token endpoint that refuses every code, so nothing leaves the test.
			refuse := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
			}))
			t.Cleanup(refuse.Close)
			s.providers["github"] = provider{id: "github", config: &oauth2.Config{
				Endpoint: oauth2.Endpoint{TokenURL: refuse.URL},
			}}
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/auth/github/callback"+c.query, nil)
			req.SetPathValue("provider", "github")
			if c.cookie != "" {
				req.AddCookie(&http.Cookie{
					Name: stateCookie, Value: c.cookie,
					Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode,
				})
			}
			w := httptest.NewRecorder()
			s.handleCallback(w, req)
			body := w.Body.String()
			if w.Code != c.want || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/html") {
				t.Fatalf("%d %s, want a %d page", w.Code, w.Header().Get("Content-Type"), c.want)
			}
			if !strings.Contains(body, c.says) || !strings.Contains(body, `href="`+c.href+`"`) {
				t.Errorf("the page does not say %q with a link to %s:\n%s", c.says, c.href, body)
			}
		})
	}
}
