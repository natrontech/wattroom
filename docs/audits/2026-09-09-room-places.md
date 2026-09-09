# Audit: the room's places other than riding (2026-09-09)

**Slice.** Chat, Members, Sessions and Settings as a rider and a coach use them, the session picker, the coach's controls, and the server handlers they call.

**Excluded.** The riding screen and the tick, the Lounge, the jukebox UI, DMs, voice, the crew page, the after-ride path, mail; what the 2026-09-04 non-riding and the 2026-09-09 presence audits already found.

**Method.** One read-only Explore agent at `5d6beed8`+ against WATTROOM.md, SPEC's roles matrix and lifecycle, ADR-0013/0020/0022/0034/0036/0038/0046 and the rules. The high, security and quick-fix findings verified by reading the cited code before filing.

## Findings and where they went

| # | Finding | Kind | Disposition |
|---|---|---|---|
| 1 | A chat line refused by the one-a-second limit vanished with no word | bug, high | #1762 → **#1768** (the hub answers; the composer throttles itself and keeps the draft) |
| 2 | A failed image upload discarded the picture while the words came back | bug, high | #1762 → **#1768** |
| 3 | The Chat place had no loading and no error state inside the room | bug | #1764 → **#1768** |
| 4 | A refused pick was overwritten by the start behind it | bug | #1764 → **#1768** (start follows the tick) |
| 5 | A member's active-playlist picker was live and 403'd on use | bug | #1764 → **#1768** (`Select` gained `disabled`) |
| 6 | A message's menu had no route to the person or to moderation | drift | #1765 |
| 7 | Sending while scrolled back left your own line off screen | bug | #1765 |
| 8 | End was the one coach control under 44 px | bug | #1764 → **#1768** |
| 9 | The moderator and owner gates never asked `isBanned` | security | #1763 → **#1768** (tested with a stale role row) |
| 10 | The phone sweep never rendered the rows it called widest | tests | #1766 |
| 11 | `copyIcsUrl` claimed success without checking the clipboard | bug | #1764 → **#1768** |
| 12 | A refused plan closed the picker and lost the pick | polish | #1766 |
| 13 | A mention is detected but never completed | not-built | #1766 |
| 14 | A reaction pill sat under the 24 px tap floor | polish | #1766 |
| 15 | "Nothing matches" was shown for a shelf that was empty, not filtered | polish | #1766 |
| 16 | Delete-room's confirm did not name the chat, the plans or the recaps | polish | #1766 |

## Checked and found sound

- **RSVP privacy** (members only, banned riders drop off the card), **the ban list** (owner only, crew-ban warning before the click), **the roles matrix** enforced server-side and tested on every verb, **undo and confirm the right way round** nearly everywhere with the reasoning stated, **leaving is not a way out of a ban**, **transfer** is transactional under a row lock.
- **Sessions' four states**, the picker's timezone handling, past dates bounded on both sides, a same-time move mailing nobody, a passed session's cancel mailing nobody.
- **Room events stay ephemeral** (ADR-0022); chat images are room-scoped both ways, bounded and swept; edits are author-only, text-only and marked.
- **The composer takes focus on navigation only**; refused socket commands are persistent status, not toasts; the hover strip hides on coarse pointers with the context menu as the touch equivalent.
- **The reach ladder** is one honest question (#1671); ICS rotation is owner-only and its leak consequence is spelled out; a member's room prefs are theirs alone.

## Decisions surfaced

#1767: whether the phone's spectator gate reaches moderation; a chat edit window; overlapping planned sessions; whether the room's calendar feed names planners.
