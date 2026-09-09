package strava

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

// The rider's ride page serves last_error verbatim, so it carries a class's
// sentence — never the provider's body, the key env var or pgx text (audit
// 2026-09-09).
func TestExportFailureNeverServesTheProvider(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		// The door it names is where ProviderConnections lives (#1548):
		// Settings › Profile, not Your data.
		{"an expired sign-in", fmt.Errorf("%w: %w", errToken, errors.New("stored refresh token cannot be read — is WATTROOM_SECRET_KEY the key")), "reconnect Strava in Settings › Profile"},
		{"a 401 from the provider", &uploadRefused{status: 401, snippet: `{"message":"Authorization Error"}`}, "reconnect Strava in Settings › Profile"},
		{"a rejected file", &uploadRefused{status: 400, snippet: "<html>malformed</html>"}, "did not accept the file"},
		{"an outage", &uploadRefused{status: 502, snippet: "<html>bad gateway</html>"}, "could not be reached"},
		{"a database failure", fmt.Errorf("persist refreshed token: %w", errors.New("ERROR: relation identities")), "could not be reached"},
	}
	for _, c := range cases {
		got := exportFailure(c.err)
		if !strings.Contains(got, c.want) {
			t.Errorf("%s: %q does not say %q", c.name, got, c.want)
		}
		for _, leak := range []string{"html", "WATTROOM_", "ERROR:", "Authorization Error", "relation"} {
			if strings.Contains(got, leak) {
				t.Errorf("%s: %q leaks %q", c.name, got, leak)
			}
		}
	}
}
