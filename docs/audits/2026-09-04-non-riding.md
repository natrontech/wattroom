# Audit — the non-riding half of WattRoom — 2026-09-04

Run against main @ `6aba3bd` (release 2026.09.25). Read-only: nothing was changed or verified in a
running app, and every finding is a code-reading claim with `path:line` evidence in its issue.

Produced **62 issues, [#636–#699](https://github.com/natrontech/wattroom/issues?q=is%3Aissue+636..699)**.
This is the worked example [`.claude/skills/audit`](../../.claude/skills/audit/SKILL.md) points at.

## The brief

Quoted because the shape of the request is half of why it worked — it named a boundary, an
exclusion, a budget and an output format:

> The wattroom repository had a lot of issues, PRs and also releases by now. You need to go through
> all open and recent stuff and the current code and thoroughly check everything from intention,
> documentation, rules and actual implementation in multiple sections:
>
> - audio, cam setup
> - video playback, sync, features
> - screen sharing, chat, other lounge features
> - UI & UX design and implementation, efficiency, re-usability and reliability
> - performance of the website
>
> In short pretty much the whole website, but **excluding the actual riding features** (this will be
> another pass — specialized). And then report what you found and proposed issues (do not create them
> yet!) and how you'd fix them. You should **question everything**, also the "fixed" rules and
> decisions, with the bigger goal in mind what we want to achieve. Also do not limit this task to my
> list above, only the cycling / riding stuff is excluded.
>
> Do not spawn too many subagents, due to my Plus subscription. Answer structured, and do not
> overinflate it — be concise.

Four things in there did the work: an explicit **exclusion** (the riding pass owns those files), an
explicit **licence to question locked decisions**, an explicit **budget**, and "do not create them
yet" — which kept triage a conversation instead of 62 unreviewed issues.

## How it ran

| Phase | What happened |
| --- | --- |
| Scout | Inline: issues, merged PRs, releases, tree, file sizes, then WATTROOM.md, ARCHITECTURE.md, SPEC.md and the relevant ADRs read in full |
| Fan out | 7 agents, one per area, each given the condensed baseline, the rigor rules and an output schema. 5 completed; 2 (UI/UX, performance) died on a session limit |
| Recover | The two dead areas were audited inline in the main session rather than re-spawned |
| Verify | Every high-severity finding re-checked against the code before filing |
| File | Rule: `kind is bug OR severity is high` → 23 findings became 21 issues (two duplicate pairs merged) |
| Triage | The remaining 35 worked through with the maintainer; 7 were decisions needing a human |

**Cost:** ~1.29M subagent tokens, 563 tool calls, ~11 minutes wall clock for the agent phase.

## What the process caught that a naive run would not

- **A wrong agent claim.** An agent asserted WATTROOM.md's milestone section was an established
  exception to ADR-0001's freeze. It is not. Verifying changed #656 from "update the roadmap" to
  "decide how a founding document records a divergence".
- **Two duplicate pairs.** The chat ban hole (lounge + server) and the display-name presence bug
  (lounge + hub) were each found twice, from different sides.
- **A finding that was already correct.** The friends-presence finding looked like a privacy bug;
  reading `riders.go:236-253` showed presence was already bounded exactly as intended, and the defect
  was in ADR-0012's text. #653 is a documentation fix, not a code change.
- **Seven decisions**, separated from the bugs and brought back with options rather than implemented.

## Verified good — worth not re-litigating

- **The glow rule holds across all ten palettes.** Every `--color-neon` use swept against every
  glow/shadow/blur utility: zero violations. The only hit is a zero-blur focus ring in
  `web/src/lib/brand/LandingHero.svelte:112`. ADR-0005's hardest rule to hold is held.
- **`svelte-check` is clean** — 0 errors, 0 warnings including a11y, with 116 `aria-label`s outside
  `dev/`. No unlabelled icon buttons.
- **No timer, listener or observer leaks.** The two without teardown are deliberate app-lifetime
  singletons: `web/src/lib/dm/heads.svelte.ts:69-73` (guarded by `started`) and
  `web/src/lib/palette.svelte.ts:85-87` (module-scope `prefers-color-scheme`).
- **The database is properly indexed** — 16 indexes; none missing on a column actually filtered or
  sorted.
- **The lobby ping is event-driven, not per-tick** — every call site traced; none in the 1 Hz path.
- **Presence is correctly bounded** — `riders.go:236-253`; a non-friend room-mate sees in-room
  presence only.
- **Empty states teach rather than apologize**, dev routes 404 in production, and the ADR-0020 shell
  holds on every route.

## Noted, deliberately not filed

`web/src/lib/room/live.svelte.ts:123` does `tick = msg.tick` — a whole-object `$state` replacement
every second (4× during sprints), invalidating every reader rather than only changed fields. At 2–8
riders this is the right trade. Recorded only because WATTROOM.md §9 names "LiveKit video grids past
~12" as an open scaling question, and this is the other half of that ceiling.

## The 62 issues

| Issue | Labels | Title |
| --- | --- | --- |
| [#636](https://github.com/natrontech/wattroom/issues/636) | `bug` `security`  | fix(feedback): a mid-ride flag publishes the rider's heart rate to a public GitHub issue |
| [#637](https://github.com/natrontech/wattroom/issues/637) | `bug` `security` `rooms`  | fix(rooms): a banned rider unbans themselves by "leaving" the room |
| [#638](https://github.com/natrontech/wattroom/issues/638) | `bug` `security` `rooms`  | fix(chat): the ban stops at the room socket — chat HTTP still lets a banned rider read and post |
| [#639](https://github.com/natrontech/wattroom/issues/639) | `bug` `rooms`  | fix(hub): the live-room key is the raw path slug, so case variants fork the room and never die |
| [#640](https://github.com/natrontech/wattroom/issues/640) | `bug` `rooms`  | fix(web): a mic that dies mid-ride goes silent with the icon still green |
| [#641](https://github.com/natrontech/wattroom/issues/641) | `bug` `rooms`  | fix(web): a LiveKit drop un-mutes a rider who muted themselves |
| [#642](https://github.com/natrontech/wattroom/issues/642) | `bug` `rooms`  | fix(web,server): every AV failure reaches the rider as "voice failed" and nothing else |
| [#643](https://github.com/natrontech/wattroom/issues/643) | `bug` `jukebox`  | fix(web): the people sheet swallows the playing jukebox player below xl |
| [#644](https://github.com/natrontech/wattroom/issues/644) | `bug` `jukebox`  | fix(web): returning to a backgrounded tab chases the playhead on the rider's own wall clock |
| [#645](https://github.com/natrontech/wattroom/issues/645) | `bug` `rooms`  | fix(web): a browser that blocks audio playback leaves the room silent with nothing to click |
| [#646](https://github.com/natrontech/wattroom/issues/646) | `bug` `rooms`  | fix(web): "use this tab instead" compares a browser clock against LiveKit's server clock |
| [#647](https://github.com/natrontech/wattroom/issues/647) | `bug` `jukebox`  | fix(web): seeking a paused deck moves the scrub bar but not a single player |
| [#648](https://github.com/natrontech/wattroom/issues/648) | `bug` `jukebox`  | fix(web): /dev/sound writes the cue engine's volume directly, bypassing the mixer |
| [#649](https://github.com/natrontech/wattroom/issues/649) | `bug` `rooms`  | fix(server,web): presence identity is the display name, and display names are not unique |
| [#650](https://github.com/natrontech/wattroom/issues/650) | `bug` `rooms`  | fix(web): a chat line typed during a reconnect is silently dropped once 16 are queued |
| [#651](https://github.com/natrontech/wattroom/issues/651) | `bug` `rooms`  | fix(server): no long-lived goroutine survives a panic — one takes every live room down |
| [#652](https://github.com/natrontech/wattroom/issues/652) | `docs`  | docs(launch): the launch runbook asks for a YouTube API key nothing reads and describes the pre-ADR-0019 rollback |
| [#653](https://github.com/natrontech/wattroom/issues/653) | `docs` `needs-human-input`  | docs(friends): ADR-0012 forbids the ambient presence the app deliberately ships |
| [#654](https://github.com/natrontech/wattroom/issues/654) | `docs`  | docs: the phone story diverged from ADR-0020 and WATTROOM.md on purpose — make the docs say so |
| [#655](https://github.com/natrontech/wattroom/issues/655) | `docs` `jukebox` `needs-human-input`  | docs(jukebox): an ADR for saved playlists — YouTube-only, multi-source deferred |
| [#656](https://github.com/natrontech/wattroom/issues/656) | `docs` `needs-human-input`  | docs: how a founding decision records that we diverged, and which documents may show current state |
| [#657](https://github.com/natrontech/wattroom/issues/657) | `enhancement` `rooms`  | perf(web): the LiveKit SDK loads on every route, including login |
| [#658](https://github.com/natrontech/wattroom/issues/658) | `enhancement` `rooms`  | fix(web): you can only choose a microphone after you have already joined with the wrong one |
| [#659](https://github.com/natrontech/wattroom/issues/659) | `enhancement` `jukebox`  | fix(server,web): a refused jukebox command vanishes with no word to the rider |
| [#660](https://github.com/natrontech/wattroom/issues/660) | `enhancement` `jukebox`  | feat(web): the deck's destructive verbs are one tap, irreversible and unattributed |
| [#661](https://github.com/natrontech/wattroom/issues/661) | `enhancement` `jukebox`  | fix(web): move and remove in the queue are 20-24 px targets on a bike |
| [#662](https://github.com/natrontech/wattroom/issues/662) | `enhancement` `rooms`  | fix(web): every destructive social action fires with no confirm, no undo and no feedback |
| [#663](https://github.com/natrontech/wattroom/issues/663) | `enhancement` `rooms`  | fix(web): messages, rider tiles and friend rows have no context menu, and chat actions are hover-only |
| [#664](https://github.com/natrontech/wattroom/issues/664) | `enhancement` `rooms`  | ux(room): nobody is told when someone else starts sharing a screen while the jukebox is playing |
| [#665](https://github.com/natrontech/wattroom/issues/665) | `enhancement` `security` `rooms`  | fix(server): a banned rider's LiveKit token stays valid for six hours after the ban |
| [#666](https://github.com/natrontech/wattroom/issues/666) | `enhancement` `rooms`  | feat(web): the room with a griefer is survivable only via Settings — ban is missing from every surface where you meet the griefer |
| [#667](https://github.com/natrontech/wattroom/issues/667) | `enhancement`  | test(account): the two most destructive endpoints in the server have no tests at all |
| [#668](https://github.com/natrontech/wattroom/issues/668) | `enhancement`  | fix(web): unhandled promise rejections never reach the flight recorder, so the no-analytics bet has a hole |
| [#669](https://github.com/natrontech/wattroom/issues/669) | `enhancement` `rooms`  | perf(web): every camera in the room streams at full quality into a 96px tile |
| [#670](https://github.com/natrontech/wattroom/issues/670) | `enhancement` `rooms`  | fix(hub): one stalled socket costs every rider in the room a full tick |
| [#671](https://github.com/natrontech/wattroom/issues/671) | `rooms`  | chore(web): av.svelte.ts is 1091 lines against a 300-line ceiling, and carries a dead copy of MIC_CONSTRAINTS |
| [#672](https://github.com/natrontech/wattroom/issues/672) | `rooms`  | refactor(web): the DM thread is a second, poorer copy of the room thread |
| [#673](https://github.com/natrontech/wattroom/issues/673) | `infra`  | chore(auth): expired sessions are written, never swept |
| [#674](https://github.com/natrontech/wattroom/issues/674) | `docs`  | docs: the ADR chain is no longer followable — no index, a broken amendment link, and a stale status |
| [#675](https://github.com/natrontech/wattroom/issues/675) | `jukebox`  | fix(web): cue ducking snaps while #152 records it as ramped, and the depth default is not SPEC's |
| [#676](https://github.com/natrontech/wattroom/issues/676) | `jukebox`  | fix(server): autoplay in `ordered` mode does not loop, so the room goes silent after one pass |
| [#677](https://github.com/natrontech/wattroom/issues/677) | `jukebox`  | fix(web): the ducking default is 30 %, docs/SPEC.md specs 25 % |
| [#678](https://github.com/natrontech/wattroom/issues/678) | `security` `infra`  | docs(auth): the CSRF Origin check the package promises exists on three of ~50 mutating endpoints |
| [#679](https://github.com/natrontech/wattroom/issues/679) | `docs`  | docs: ADR-0013's "room identity is an emoji" has been false since #447 |
| [#680](https://github.com/natrontech/wattroom/issues/680) | `docs`  | docs(readme): the README claims Wahoo legacy trainer support that does not exist |
| [#681](https://github.com/natrontech/wattroom/issues/681) | `docs`  | docs: "always-on voice and camera" is a Join voice button and a 60-second refresh window |
| [#682](https://github.com/natrontech/wattroom/issues/682) | `docs` `jukebox`  | question(jukebox): WATTROOM.md still promises a Data-API "not embeddable" pre-check that ADR-0026 removed |
| [#683](https://github.com/natrontech/wattroom/issues/683) | `enhancement`  | question: the phone/iOS surface was just rebuilt and has no automated coverage at any viewport |
| [#684](https://github.com/natrontech/wattroom/issues/684) | `enhancement`  | ui(web): there is no Button primitive, and 223 buttons pay for it |
| [#685](https://github.com/natrontech/wattroom/issues/685) | `enhancement`  | ui(web): the shared empty/loading/error components are used by a minority of the pages |
| [#686](https://github.com/natrontech/wattroom/issues/686) | `rooms`  | chore(web): three non-riding files are over the size ceiling |
| [#687](https://github.com/natrontech/wattroom/issues/687) | `rooms`  | perf(server): the friends list is an N+1, and every presence event makes every client re-run it |
| [#688](https://github.com/natrontech/wattroom/issues/688) | `rooms`  | chore(hub): hub.go is 1441 lines, 3.6× the ceiling, and it is where the concurrency bugs live |
| [#689](https://github.com/natrontech/wattroom/issues/689) | `enhancement`  | perf(web): the app fetches on mount, not in load functions |
| [#692](https://github.com/natrontech/wattroom/issues/692) | `enhancement`  | fix(web): remove the custom hue picker — themes are a curated set, not an open colour space |
| [#693](https://github.com/natrontech/wattroom/issues/693) | `docs`  | docs: ten themes go beyond ADR-0005's single locked identity — record the divergence |
| [#694](https://github.com/natrontech/wattroom/issues/694) | `enhancement` `security` `rooms`  | feat(rooms): a random slug suffix makes a room URL unguessable |
| [#695](https://github.com/natrontech/wattroom/issues/695) | `enhancement` `security` `rooms`  | feat(rooms): someone who joined from a link should not be able to delete the room's things |
| [#696](https://github.com/natrontech/wattroom/issues/696) | `security`  | fix(account): export-all must cover what Swiss and EU data-protection law requires |
| [#697](https://github.com/natrontech/wattroom/issues/697) | `security` `infra`  | security(auth): Strava's refresh token is the one credential stored in the clear |
| [#698](https://github.com/natrontech/wattroom/issues/698) | `rooms`  | chore(rooms): `listed` is a knob with nothing behind it — drop the dev toggle, keep the column |
| [#699](https://github.com/natrontech/wattroom/issues/699) | `docs`  | docs: say why WattRoom releases several times a day |
