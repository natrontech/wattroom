package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"

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

func getJSON(ctx context.Context, cfg *oauth2.Config, tok *oauth2.Token, url string, into any) error {
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
