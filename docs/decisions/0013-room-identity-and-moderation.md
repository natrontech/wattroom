# ADR-0013: Room identity is an emoji; a ban is a membership role

Date: 2026-08-31 · Status: accepted (#223, amended 2026-09-05: icon and
reaction palette are lucide keys, not emoji — #447)

## Context

Rooms all look identical in the rail, the reaction set is a hard-coded
server allowlist despite WATTROOM.md promising per-room sets ("insider
memes"), and the only moderation tool — remove member — is undone by
clicking the invite link again. #223 scopes the fixes.

## Decision

**Icon — one emoji, not an image.** A room's identity mark is a single
emoji column on the room. No uploads: an image icon buys storage, resizing,
and image-moderation problems for a 24px glyph. Public like the name.

**Reaction set — owner-curated emoji, shape-checked on the wire.** Up to 8
emoji per room (space-joined text column; empty = base set) form the palette
for cheers *and* chat reactions. The hub's fixed allowlist becomes a shape
check (`protocol.IsEmoji`): the wire guarantees a reaction can't smuggle
text; *which* emoji are welcome is the owner's call, enforced as the
client-side palette. A hostile client can send an off-palette emoji — the
answer to that is the ban, not a per-room allowlist synced into the hub.

**Ban — a membership role, not a table.** `role = 'banned'` keeps the seat
occupied: every rejoin path (link, code) runs through
`ON CONFLICT DO NOTHING`, so the ban holds structurally rather than by
checks someone remembers to write. Authorize refuses it, so metrics WS and
AV tokens are gated by the same door. Banning or removing also severs live
presence: the hub closes the rider's sockets, and av calls LiveKit's
`RemoveParticipant` (hand-rolled twirp POST — stdlib-first, no server SDK).
Voice ejection is best-effort: a failure means lingering on camera until
disconnect, never re-entry.

## Consequences

- Owner sees the ban list (roster rows with role `banned`); members don't.
- Ban-in-anticipation (banning someone who never joined) doesn't exist —
  there is no membership row to flip. Acceptable: invite links are the only
  way in, and the ban lands the moment they join.
- Keycap emoji (1️⃣) fail the shape heuristic — a real segmenter is the
  upgrade path if anyone misses them.

## Amendment — icon and reaction palette switch to lucide keys (2026-09-05, #447)

Emoji render inconsistently across platforms — different vendors ship
different glyphs for the same codepoint, so a room's identity mark and a
rider's reaction looked different depending on whose OS drew them. #447
replaces both halves of the Decision above with **curated lucide keys**: a
room's icon and a room's reaction palette are drawn marks from a fixed set,
not emoji, because drawn marks render consistently across platforms where
emoji do not.

- The wire and DB columns are unchanged in shape (short text keys); what
  changed is the vocabulary they hold and how the client renders them.
- `protocol.IsIconKey` validates a lucide name; `protocol.IsIconOrEmoji`
  (`server/internal/protocol/icon.go`) still accepts the old emoji shape,
  but only so rooms and reactions saved before #447 keep rendering — no
  path writes a new emoji icon or reaction.
- docs/SPEC.md's icon and reaction sections describe the lucide vocabulary
  that ships today; the Decision section above stays as the historical
  record of why a single glyph was chosen at all.
