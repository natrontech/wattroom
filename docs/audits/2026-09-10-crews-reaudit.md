# Audit: crews after tonight's changes — 2026-09-10

**Slice.** Crews as they stand after a day of changes: becoming one (the first-run card, the crew every account gets, naming it, the code and the door), joining (the sidebar's `+`, Home's door, the invite link, the crew page, the crew strip and switcher, the crew's rooms in the sidebar, the directory), managing (roles, kick and ban and its reach, ownership transfer, leaving, deletion, the purge's hand-over, the room cap), and the server behind each. A second pass over the 2026-09-09 crews audit's ground, looking for what moved.
**Excluded**: the room's interior (audited), rides, friends and DMs, presence internals beyond the crew strip.
**Method.** One Explore agent at `5f16eb0c`, read-only against WATTROOM.md, docs/SPEC.md, ADR-0020, ADR-0036, ADR-0038, the 2026-09-09 crews record and the rules; the two medium bugs verified by reading the cited code before filing. Nothing was run.

## Filed

By the rule _bug or high_ (no high this time), the one security gap, the newcomer's flow, one polish item, one decision.

| #     | Finding                                                                                       | Severity   | Status                                                                   |
| ----- | --------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| #1928 | "Your own crew" resolves to the oldest crew you own, so a handed-over crew steals the default | bug, drift | fixed (#1954): `crews.founded_by` |
| #1929 | Shutting a listed room from the crew page unlists it, and the Undo cannot put it back         | bug        | fixed (#1937): `listed` on the row, the undo restores both               |
| #1930 | A crew's code cannot be rotated, so a leaked invite link is permanent                         | security   | built (#1953): `POST /api/crews/{id}/code` from the crew's settings |
| #1931 | A newcomer's first crew screen leads with the invite code, not the room they came for         | design     | fixed (#1937): rooms and people first; a one-room crew lands in the room |
| #1932 | The door's headcount and the roster disagree when a stray owner row survives                  | bug        | fixed (#1937)                                                            |
| #1933 | Banning a user id that is not a user answers 500                                              | bug        | fixed (#1937)                                                            |
| #1934 | A banned person's row has no profile link and no context menu                                 | polish     | fixed (#1937)                                                            |
| #1935 | Decision: an owner can neither delete nor leave a crew with nothing left in it                | decision   | `needs-human-input`                                                      |

Cited rather than re-filed: #1255 (the roster's visibility), #1334 (a crew-wide chat), #1863 (the directory's parent row).

## The owner's first ten minutes

Sign in, **Open a room** on Home (the same sheet as the sidebar's `+`), name it, land in the room — the sheet says before the click that this makes your crew, named after you. Then **Members** or the first-run card's "Invite someone", **Copy invite link**, paste it outside. The friend opens `/c/{code}`, is bounced through sign-in and back, reads the crew's name and picture and nothing else (the headcount went with #1399), presses **Join**, and — since #1937 — lands in the room when the crew has one, with "Walk in" saying it is open to the crew. Four taps each side, every one signposted. The stumble that remains: "Name your crew" is never on that path; the owner reaches the ride without being told the crew carries their own name until they are back on Home.

## Checked and found sound

- **No crew is read across crews** — `crewByID` resolves the role for that crew and 404s on nothing or banned; every write hangs off it; a room is re-scoped to its crew before access changes.
- **One permission expression** — `visible_rooms` reads both ban levels; the two door checks are the only doors; the calendar and the mail ask it too since #1904.
- **A crew ban takes the rows, not just the sockets**, cannot touch a room's owner, and grants are crew-scoped both ways.
- **Succession** matches SPEC exactly, including "never anyone the crew banned" in the last resort; the purge deletes owned rooms before deciding; the delete-account copy names the hand-over.
- **Budgets and codes** — the door, the join and the door image throttled on the last XFF hop; codes rejection-sampled.
- **Four states and capability gating** across `/crew/{id}`, its settings and `/c/{code}`; **phone width** covered for all three; `crew-invite.spec.ts` walks gate → door → crew → room.
- **401 on the whole authenticated crew surface**; logs carry ids and slugs only.

## Not checked

The room's interior, rides, friends, presence beyond the strip; `crew_image.go`'s upload path beyond its authorisation; the desktop and TV surfaces that draw the crew code. Nothing was executed.
