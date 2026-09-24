# ADR-0013: Room identity is an emoji; a ban is a membership role

Date: 2026-08-31 · Status: accepted (#223, amended 2026-09-05: icon and
reaction palette are lucide keys, not emoji — #447; amended 2026-09-22 by
[ADR-0058](0058-the-room-dissolves-into-the-crew.md), #2425: identity and the ban are the crew's;
amended 2026-09-24: reactions are emoji again, and a crew uploads its own — #2643)

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
disconnect, never re-entry through the shipped client — but it does not
revoke the JWT already in a rejected client's hands. What actually bounds
re-entry with a stale token is the mint lifetime on the AV token itself
(`server/internal/av/av.go`, #665): short enough that the window closes
within a fraction of a ride, not the six hours a long-lived grant would
leave open.

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

## Amendment — identity and the ban are the crew's (2026-09-22, #2425, [ADR-0058](0058-the-room-dissolves-into-the-crew.md))

The room dissolves into the crew, and both halves of this decision move up
with it.

- **Identity.** The mark and the reaction palette are the **crew's**. Channels
  are named, not marked, so a room's icon does not survive the migration; the
  lucide amendment above applies to the crew's mark and palette unchanged.
- **The ban** is a **crew** role — `crew_roles.role = 'banned'` — and it keeps
  the seat occupied exactly as the membership row did, so every way back in
  still meets it structurally. There is no room ban any more: a crew ban
  severs every channel at once, through the one gate every door asks. At the
  migration a room ban becomes a crew ban, because the narrow side is the only
  one that cannot let a banned rider back into the room that banned them.

## Amendment — reactions are emoji again, and a crew uploads its own (2026-09-24, #2643)

The lucide amendment traded a rider's whole vocabulary for consistent glyphs,
and riders asked for the vocabulary back: eight drawn marks cannot say what a
chat reaction is for, and the "insider memes" WATTROOM.md promised per crew
never had a way in. Consistency across platforms is the cost this accepts — a
🥵 looks a little different on a Pixel than on a Mac, and nobody reading a
reaction has ever been confused by that.

- **A reaction is any Unicode emoji, a drawn icon from the curated set, or one
  of the crew's own.** The chat's reaction control opens a picker: the crew's
  set first, then its uploaded emoji, the rider's recent picks, and every
  emoji by group with a search. The composer inserts from the same picker.
- **The crew's set stays** — up to eight, the first four the mid-ride buttons,
  because a sweating rider needs four big targets, not a search box — and may
  now hold emoji and the crew's own as well as icons. An emoji saved there is
  drawn as itself; the client no longer translates one into the icon it
  resembled.
- **A crew uploads its own emoji.** Any member adds one; the one who added it,
  the owner and admins take it down. A name is 2–32 characters of `a–z 0–9 _`,
  unique in the crew, and the key is `:name:` — as a reaction, and inline in a
  message, where the line draws it if the crew knows the name and the text it
  is otherwise. Pictures are crew-private and live beside `chat_images` in
  Postgres (ADR-0002). Caps are docs/SPEC.md's. A DM has no crew, so it offers
  Unicode only and shows a `:name:` as text.
- **The wire check widens, it does not open.** `protocol.IsReaction` is an icon
  key, one emoji (`IsEmoji`, now accepting the keycaps and the handful of BMP
  symbols the picker offers), or a `:name:` shape. The server still checks
  shape, not vocabulary: which emoji a crew welcomes is its own business, and
  a key naming no emoji draws as its text.
- **The crew's mark is unchanged** — one icon from the curated set. Identity is
  where consistency still earns its cost.
