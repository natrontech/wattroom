package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/endpoints"
)

// identity is what a provider tells us about the person — the only thing we
// keep from Google/GitHub. Tokens are kept for Strava alone, whose grant
// doubles as the M6 ride-upload integration.
type identity struct {
	ProviderUserID string
	DisplayName    string
	AvatarURL      string
}

type provider struct {
	id     string
	config *oauth2.Config
	// fetch turns a completed exchange into an identity.
	fetch func(ctx context.Context, cfg *oauth2.Config, tok *oauth2.Token) (identity, error)
	// keepTokens: store the grant (Strava only — do not store what nothing reads).
	keepTokens bool
}

// providersFromEnv wires every provider whose credentials are configured, and
// silently skips the rest — the web hides sign-in buttons for absent providers
// rather than rendering one that 500s (capability gating, .claude/rules/ux.md).
func providersFromEnv(baseURL string) map[string]provider {
	out := map[string]provider{}
	add := func(id string, endpoint oauth2.Endpoint, scopes []string,
		fetch func(context.Context, *oauth2.Config, *oauth2.Token) (identity, error), keep bool) {
		clientID := os.Getenv("WATTROOM_OAUTH_" + envKey(id) + "_ID")
		secret := os.Getenv("WATTROOM_OAUTH_" + envKey(id) + "_SECRET")
		if clientID == "" || secret == "" {
			return
		}
		out[id] = provider{
			id: id,
			config: &oauth2.Config{
				ClientID:     clientID,
				ClientSecret: secret,
				Endpoint:     endpoint,
				RedirectURL:  baseURL + "/api/auth/" + id + "/callback",
				Scopes:       scopes,
			},
			fetch:      fetch,
			keepTokens: keep,
		}
	}

	// Not OAuth: a local-only session for machines with no registered apps.
	// Never set WATTROOM_DEV_LOGIN in production — it is an unauthenticated
	// door, and it opens on a local origin only (#1603); DevLoginMisconfigured
	// is what refuses to boot when it is asked for anywhere else.
	if os.Getenv("WATTROOM_DEV_LOGIN") == "1" && localOrigin(baseURL) {
		out["dev"] = provider{id: "dev"}
	}

	// The production ride monitor (#153): not OAuth, but a real provider row so
	// it shares the identity + session path. Absent token, absent route.
	if os.Getenv("WATTROOM_SYNTHETIC_TOKEN") != "" {
		out["synthetic"] = provider{id: "synthetic"}
	}

	add("google", endpoints.Google, []string{"openid", "profile"}, fetchGoogle, false)
	add("github", endpoints.GitHub, []string{"read:user"}, fetchGitHub, false)
	// activity:write is the M6 upload scope; asking now means no re-consent later.
	add("strava", endpoints.Strava, []string{"read,activity:write"}, fetchStrava, true)
	return out
}

func envKey(id string) string {
	switch id {
	case "google":
		return "GOOGLE"
	case "github":
		return "GITHUB"
	default:
		return "STRAVA"
	}
}

func fetchGoogle(ctx context.Context, cfg *oauth2.Config, tok *oauth2.Token) (identity, error) {
	var v struct {
		Sub     string `json:"sub"`
		Name    string `json:"name"`
		Picture string `json:"picture"`
	}
	if err := getJSON(ctx, cfg, tok, "https://openidconnect.googleapis.com/v1/userinfo", &v); err != nil {
		return identity{}, err
	}
	return identity{ProviderUserID: v.Sub, DisplayName: v.Name, AvatarURL: v.Picture}, nil
}

func fetchGitHub(ctx context.Context, cfg *oauth2.Config, tok *oauth2.Token) (identity, error) {
	var v struct {
		ID        int64  `json:"id"`
		Login     string `json:"login"`
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url"`
	}
	if err := getJSON(ctx, cfg, tok, "https://api.github.com/user", &v); err != nil {
		return identity{}, err
	}
	name := v.Name
	if name == "" {
		name = v.Login
	}
	return identity{ProviderUserID: fmt.Sprint(v.ID), DisplayName: name, AvatarURL: v.AvatarURL}, nil
}

// Strava ships the athlete inside the token response — no second request.
func fetchStrava(_ context.Context, _ *oauth2.Config, tok *oauth2.Token) (identity, error) {
	raw, ok := tok.Extra("athlete").(map[string]any)
	if !ok {
		return identity{}, fmt.Errorf("auth: strava token response carried no athlete")
	}
	id, ok := raw["id"].(float64)
	if !ok {
		return identity{}, fmt.Errorf("auth: strava athlete has no id")
	}
	name, _ := raw["firstname"].(string)
	if last, _ := raw["lastname"].(string); last != "" {
		name += " " + last
	}
	avatar, _ := raw["profile"].(string)
	return identity{ProviderUserID: fmt.Sprint(int64(id)), DisplayName: name, AvatarURL: avatar}, nil
}

// oauthTimeout bounds every outbound call the sign-in makes, the way the
// sibling strava package bounds its own client (strava.go). oauth2 falls back
// to http.DefaultClient, which has no timeout at all, so a provider host that
// accepts the connection and then says nothing pinned a goroutine for as long
// as the caller held on (#2255). A var so a test can shrink it.
var oauthTimeout = 30 * time.Second

// oauthCtx hands the oauth2 package the bounded client. Exchange, Client and
// everything built from them read it off the context, so the decoration
// travels with ctx rather than being threaded through each call.
func oauthCtx(ctx context.Context) context.Context {
	return context.WithValue(ctx, oauth2.HTTPClient, &http.Client{Timeout: oauthTimeout})
}

func getJSON(ctx context.Context, cfg *oauth2.Config, tok *oauth2.Token, url string, into any) error {
	ctx = oauthCtx(ctx)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("auth: build request: %w", err)
	}
	res, err := cfg.Client(ctx, tok).Do(req)
	if err != nil {
		return fmt.Errorf("auth: fetch identity: %w", err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("auth: identity endpoint returned %d", res.StatusCode)
	}
	if err := json.NewDecoder(res.Body).Decode(into); err != nil {
		return fmt.Errorf("auth: decode identity: %w", err)
	}
	return nil
}

// localOrigin is where the dev login may open: localhost and its aliases, and
// the private ranges a phone on the same Wi-Fi reaches a dev box on
// (docs/HARDWARE-SESSIONS.md). A public host never qualifies.
func localOrigin(baseURL string) bool {
	u, err := url.Parse(baseURL)
	if err != nil {
		return false
	}
	host := u.Hostname()
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast())
}

// minSyntheticToken is the shortest string that can be a secret rather than a
// typo. WATTROOM_SYNTHETIC_TOKEN mounts an unauthenticated-by-default door on
// a production server and its ONLY protection is the value's secrecy (#153),
// and nothing checked its shape (#2258) — while both neighbouring credential
// variables are checked loudly: WATTROOM_TOKEN_KEY must decode to 32 bytes or
// the server refuses to start (ADR-0035), and the dev login refuses a public
// base URL (#1603). Deliberately low: any real token clears it, and the bar
// is "this cannot be guessed", not a password policy.
const minSyntheticToken = 16

// SyntheticTokenTooWeak is the boot check for that door: set and unguessable,
// or unset and absent. Refused rather than warned about, for #1603's reason —
// "a warning in a log nobody reads is how an unauthenticated door reaches
// production".
func SyntheticTokenTooWeak() error {
	token := os.Getenv("WATTROOM_SYNTHETIC_TOKEN")
	if token == "" || len(token) >= minSyntheticToken {
		return nil
	}
	return fmt.Errorf(
		"WATTROOM_SYNTHETIC_TOKEN is %d characters: the synthetic sign-in is an unauthenticated door whose only protection is this value, so it needs at least %d. Lengthen it, or unset it to close the door",
		len(token), minSyntheticToken)
}

// DevLoginMisconfigured is the boot check (#1603, ADR-0035's posture): asking
// for the dev login on a public origin is refused loudly rather than
// warned about and honoured — a warning in a log nobody reads is how an
// unauthenticated door reaches production.
func DevLoginMisconfigured(baseURL string) error {
	if os.Getenv("WATTROOM_DEV_LOGIN") != "1" || localOrigin(baseURL) {
		return nil
	}
	return fmt.Errorf("WATTROOM_DEV_LOGIN=1 with a public base URL %q: the dev login is an unauthenticated door and opens on localhost or a private address only", baseURL)
}
