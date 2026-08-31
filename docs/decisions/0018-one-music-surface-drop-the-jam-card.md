# ADR-0018: One music surface — drop the Spotify Jam card

- Status: accepted
- Date: 2026-08-31
- Supersedes: [ADR-0003](0003-spotify-via-jam-link-not-api.md) (its "never integrate Spotify playback" half stands; the Jam link-out card does not)

## Context

[ADR-0003](0003-spotify-via-jam-link-not-api.md) foreclosed Spotify API playback — that reasoning is untouched and still binding. What it also shipped was a consolation prize: a "Join the Jam" link-out card, a link and a QR code, sitting next to the YouTube jukebox.

A room with the card up has two music surfaces with incompatible rules. The jukebox is synced to the shared playhead, ducks under voice, and every member can queue into it. The Jam plays in each rider's own app, at their own position, ducking nothing — and the card had to carry a paragraph explaining that. The side panel had grown a single "paste a YouTube **or** Spotify link" field that silently routed to one of two unrelated features depending on a regex. Riders arriving mid-ride cannot tell which surface the room is actually listening to.

The jukebox rework (#286) is the moment this became untenable: the queue is becoming a real playlist — history, upvotes, reordering, visible sync state — and none of it has any meaning for a link-out. Every feature added to the jukebox widens the gap between the two cards.

## Decision

WattRoom has exactly one music surface: the synced jukebox. The Jam card, the `jam` command, and the `jamUrl` field are removed from the protocol, the hub, and the UI. Rooms that want to listen on Spotify together start a Jam in Spotify and paste the link in room chat, like any other link — WattRoom does not model it.

ADR-0003's actual decision — never integrate Spotify playback, no API, no OAuth, no sync engine — is unchanged and remains binding.

## Consequences

- One vocabulary on every screen: what plays for the room is what is in the queue. Capability gating gets simpler — there is no second, un-duckable audio path to explain.
- The `uqr` dependency goes with the QR code, and the privacy page loses a third-party paragraph.
- Rooms that used the card lose a pinned, always-visible invite; a chat line scrolls. Accepted: link-out was never the recommendation, and the queue is where the room's attention already is.
- The generalization ADR-0003 offered ("same pattern for anything with a share link") is withdrawn — a link-out card is not a room feature, it is a message.
- Revisit only if a service ships genuine third-party group playback we can drive, which is the same trigger ADR-0003 already named.
