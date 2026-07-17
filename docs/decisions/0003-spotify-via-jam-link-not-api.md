# 0003 — Spotify listening via Jam link-out, never via API integration

- Status: accepted
- Date: 2026-07-16

## Context

Most of the target riders have Spotify, so "listen together on Spotify" is the natural ask. Two integration paths exist and both are foreclosed by Spotify's developer policy: the Web Playback SDK requires Premium per user AND the policy prohibits Spotify content from "segue, mix, re-mix, or overlap with any other audio content" — WattRoom's audio ducking (music under live voice) is exactly that overlap — and separately prohibits synchronizing recordings with visual media. A built-in Spotify player is a TOS violation by construction, independent of implementation effort. History agrees: third-party listen-together apps built on the API have repeatedly died to policy enforcement.

Meanwhile Spotify ships its own listen-together: **Jam** — Premium host, join by link/QR, shared queue, synced playback on each member's own device/account (remote join needs Premium; free users join in-person). Actively developed as of 2026.

## Decision

WattRoom never integrates Spotify playback. The built-in synced jukebox remains YouTube-only (works for everyone, no subscription, duckable, legal). Spotify becomes a **Jam link-out media mode**: the host pastes a Jam invite link, the room shows a "Join the Jam" card (link + QR) to all members and spectators, audio plays per-rider through their own Spotify. No Spotify API calls, no OAuth, no sync engine.

## Consequences

- Zero TOS exposure; zero maintenance surface; ~an afternoon of UI (scoped into the jukebox issue).
- Honest limitation, surfaced in the UI: Jam audio plays outside the browser, so WattRoom cannot duck it under voice — riders manage their own music volume. The YouTube jukebox remains the recommendation for rooms that want ducking.
- Same pattern generalizes to anything else with a share link (Apple Music SharePlay, etc.) if ever asked for — link-out card, never API playback.
- Revisit only if Spotify ships an official partner API for third-party group playback.
