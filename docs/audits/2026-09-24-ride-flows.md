# Audit: the ride flows after M9 — 2026-09-24

**The flow.** Everything a rider does around a workout, two days after ADR-0058's big bang dissolved the room into the crew, its channels and its sessions: picking or building a workout, planning a session and answering it, starting one in a voice channel or from the Schedule, the count-in, riding (the session's Training place, the solo `/ride`, the ramp), the coach's controls, games, the end, the summary, and what is left afterwards (Rides, the ride page, recaps, recovery after a crash).
**Excluded**: the jukebox, voice/AV, text channels, crew admin and the board, auth, desktop packaging, BLE driver internals. Strava payloads were never read.
**Method.** Four read-only agents at `705acbd9`, one per area: solo ride + ramp, voice-channel session, planning & schedule, workouts & after-ride. Each read against WATTROOM.md, docs/SPEC.md, ADR-0020, -0034, -0036, -0042, -0046, -0047, -0048, -0058, the rules, and the earlier audits of the same ground. Every high-severity finding and the one security finding were re-read in the code before filing. The rest were spot-checked, and each issue's footer says which. Nothing was run. It was prompted by #2594: a session start never asked for the trainer, while `/ride` always had.

## Filed

The rule was _bug or high_, plus everything the maintainer asked to be filed from triage (the copy, End-ride confirm, sidebar and polish rows below). Duplicates across areas were merged: the Schedule's *Start now* landing and the voice channel's own start are one issue (#2599), and Rides' "can't move to your account" joined the recovery-surface issue (#2616).

### Voice-channel session

| #     | Finding                                                                                                     | Severity |
| ----- | ----------------------------------------------------------------------------------------------------------- | -------- |
| #2596 | After a session ends only its last coach is offered *Start a session* — the tick keeps a done session's coach | high     |
| #2597 | A game is not a session: no ride, summary, recap, radar or crash buffer, and anyone may end it             | high     |
| #2636 | No screen hands the session off; the hub and protocol do. Plus the decided automatic hand-off               | high     |
| #2598 | A crew admin has no End for someone else's session, on a desk or a phone                                    | high     |
| #2599 | Starting a session (Lounge or Schedule) leaves the coach on the Lounge through the count-in                  | medium   |
| #2600 | The end of a session strands riders on the ended session's address; `tick.recap` is drawn nowhere           | medium   |
| #2601 | TV mode shows "waiting for the coach" through the count-in and hides the summary under itself               | medium   |
| #2602 | Clicking another voice channel mid-ride hangs up and releases the trainer without asking                    | medium   |
| #2603 | The coach picking the next workout closes everyone's summary                                                | medium   |
| #2604 | *End game* ends it for everyone in one tap                                                                  | medium   |
| #2605 | Stopping the countdown says the session ended and points at a recap that was never written                 | low      |

### Planning & schedule

| #     | Finding                                                                                                                | Severity |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | -------- |
| #2606 | A voice channel says nothing about the plan due in it; a session started there never marks the plan, so *Start now* fails | high     |
| #2610 | Deleting a private voice channel opens its plans to the whole crew and the shareable crew feed (`security`)             | medium   |
| #2607 | *Start now* on a channel-less plan points at a picker "above" that moved into a modal                                  | medium   |
| #2608 | Home's *What's next* opens a crew page that does not show the plan                                                     | medium   |
| #2609 | A double tap on *Plan it* in a voice channel plans and mails twice                                                     | medium   |
| #2612 | The notifications offer sits only on Home, which WattRoom no longer opens on (#2576)                                    | medium   |
| #2611 | Session mail links to a voice channel for "anything else planned", and to Profile for the switch                       | low      |
| #2613 | A refused plan time is a toast, not a line under the field                                                             | low      |
| #2614 | SPEC's sidebar next-session line is gone from the UI; amend SPEC and drop the per-ping query                           | low      |

### Solo ride + ramp

| #     | Finding                                                                                                    | Severity |
| ----- | ---------------------------------------------------------------------------------------------------------- | -------- |
| #2615 | Cancelling the count-in orphans the trainer's GATT link; re-pairing opens a second client                  | high     |
| #2616 | A crashed or unsaved ride is offered back only at the foot of `/ride`'s setup screen; Rides says it can't move | high     |
| #2617 | A ride still being recorded (another tab, a live session) is offered as recovered; saving it keeps half     | medium   |
| #2618 | A failed save says "reload" instead of *Try again*                                                         | medium   |
| #2619 | A ⚑ flagged mid-ride is lost unless the rider finds a second button                                        | medium   |
| #2620 | At phone width the numbers row overflows once HR and execution appear (estimated, not measured)            | medium   |
| #2623 | *End ride* and the ramp's *I'm done* end the effort on one stray tap                                        | medium   |
| #2622 | A ride left auto-paused never ends — decided: ends itself after 10 min, tail trimmed                       | medium   |
| #2621 | A ramp ridden to its last step freezes on the riding panel                                                 | low      |

### Workouts & after-ride

| #     | Finding                                                                                                   | Severity |
| ----- | --------------------------------------------------------------------------------------------------------- | -------- |
| #2624 | The crew's Workouts page sends "ride together" to the solo library and cannot plan a new workout          | high     |
| #2625 | Session recap cards never say which day the session was                                                   | medium   |
| #2626 | The FTP prompt does not appear after the ride that earned it                                              | medium   |
| #2627 | A failed import save hides the preview and both Save buttons                                              | medium   |
| #2632 | The delete-ride confirm says the XP goes; ADR-0047 keeps it                                               | medium   |
| #2628 | *Ride it again* only plans, needs a voice channel, starts with no time                                    | low      |
| #2629 | *Against your best* shows 0% execution for an unscored ride                                               | low      |
| #2630 | A crew ride reads "solo" once its crew is deleted, and links to a crew the rider left                     | low      |
| #2631 | A session ride slower than ~8 s to save never gets its *See your ride* link                               | low      |

### Batches and records

| #     | What                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------ |
| #2634 | Ride-flow copy that says something false: sub-minute saves, "Ride complete", XP for a refused save, invented RPE words, pre-M9 "Lounge" wording, private-plan copy |
| #2635 | Polish (M10): TV exit size, the phone's watch link, rider counts, the unchosen FTP on PreRide, `/ride` ignoring a channel's trainer, solo execution parity, two "join the ride" doors, SPEC's two plan windows |
| #2633 | ADR-0058 amendment recording the decision below                                                         |

**Sequencing.** #2596 first (it adds `sessionOpen`, which #2598 and #2636 gate on). #2597 before #2604. #2616 before #2617 and #2618. #2606 decides whether #2614 may drop `next`. The reverse links are on each issue.

## Decisions taken with the maintainer

Put as questions during the run and answered on 2026-09-24. The answers are recorded in the issues that carry them.

- **A solo ride left on auto-pause** ends itself after **10 minutes** stopped, and the stopped tail is trimmed before save and export. It is a SPEC default, tune in alpha (#2622).
- **The session's closing card ranks riders by execution, and that stays.** The card is still inside the session. ADR-0058's privacy section gets a paragraph saying so (#2633).
- **A coach who is gone past the reconnect grace hands the session off automatically** to the rider who has been riding longest. With nobody riding, it waits for an admin's End (#2636, #2598).
- **The sidebar's next-session line is not coming back**: SPEC is amended and the query dropped (#2614).

Two findings the agents called decisions were filed as defects instead, because canon already answers them. A game being a session is SPEC's glossary (#2597). The notifications offer's surface is ADR-0042's intent ("the first time a rider sees a planned session") on a surface that moved (#2612).

## The seams M9 left

Most of the high findings are one shape. Something the room did implicitly had no owner once the room went:
- the room's Sessions place carried the due plan and its "starts at" line (#2606);
- the room's coach was a role, and the session's coach is a tick field nobody clears (#2596);
- a room ran its games without a session because nothing needed one (#2597);
- #2450 listed hand-off and admin-end, and closed with neither wired (#2636, #2598).

The next M9-style change should list what the old object did implicitly before deleting it.

## Checked and found sound

**Session.** One session per channel, and a refused start names the coach. Start waits for the pick's tick, and a refusal cancels it. `/v/{ch}/training` follows a session to its address, and `liveSessionId` ignores a done id. Ride-critical status is persistent and ranked (channel drop with a big retry, auto-pause, spiral release, trainer fault with re-pair, the paused banner). Sounds cover pause, resume, the fanfare after a real run and the shared count-in. End asks and names its cost, and Stop the countdown does not. Every client resets its recording when a session goes live (#1535 holds). There is one crash buffer per session, with the lost-session and no-crash-safety banners. An ended or unknown session id says where its recap and ride went. Start notifications reach connected riders and, through crew arrivals, everyone else but the coach. Phone gating lives inside the components.

**Planning.** The Schedule has all four states. The roles matrix matches SPEC on both sides. One total order holds across the schedule, Home and both feeds. RSVP has two words and a second tap clears it. Declines are cleared only on a real move, and the reminder skips riders who said out. Cancel asks, and mails only for a future plan. Private-channel plans are filtered everywhere they are read (the delete path is #2610). The 100-plan cap is counted under a row lock. Reminders are claimed in the same update that marks them, per rider timezone. *Start now* marks a plan only after the hub took it. `/sessions` redirects rather than dying.

**Solo ride + ramp.** One count-in, whose Cancel files no zero-sample ride. Start is gated on a paired trainer and on "reconnecting". Dropout detection counts from the clock start. RideStatus covers every state, TV included, and every state change is audible. The save path ends the buffer only on the server's acknowledgement and keeps final and retryable failures apart. The ramp's blown detector ignores stale samples and spiral release, and its result carries provenance. Mid-ride controls are 44 px. A solo sprint releases the trainer to slope. The leave guard stands down during the count-in. The wake lock and trainer release run on every end path.

**Workouts & after-ride.** `/workouts` has all four states and undo on delete. The editor guards unsaved changes and validates inline. Import says what the file could not bring and at which FTP it converted. The ride page keeps not-found separate from a retryable error. The share toggle speaks one wording and reverts on refusal. RideFeel is private and says so. Rides pages by server cursor, with its own inline error. Crew recaps and plans are filtered to channels the viewer may enter. The comparison describes rather than grades. The summary is gated at 60 samples, and its medal comes from the saved ride.

## Not checked

Nothing was executed. The phone-width finding (#2620) is estimated from Tailwind classes. Whether a single-connection trainer advertises while #2615's orphan holds it decides whether re-pair finds nothing or a second client. That wants a hardware session (docs/HARDWARE-SESSIONS.md). Not read:
- the XP, medal and stats pipeline, and whether SessionSummary's client XP matches the ride page's;
- the HUD mirror and the desktop notification-click path;
- ICS `SEQUENCE` behaviour for moved events in real calendar clients;
- the mail templates' rendering;
- the `.zwo`/`.erg` parsers beyond what the UI shows.

Also unfiled: a race where two members start a channel-less plan in two channels at the same instant (judged too rare), and a dead `room?: boolean` field on the ride list and summary types.

## Lessons for the next run

- **The compact trainer card and the full grid had drifted** in a way only CI's Chromium, with no Web Bluetooth, could show. #2595's new e2e failed there and passed locally. When a spec leans on a dev-only affordance (*Ride simulated*), run it once with `navigator.bluetooth` deleted.
- **Ask the flavour question up front.** Giving every agent the one finding that prompted the run (#2594) produced findings of the same shape — a missing step, a dead end, a silent failure — rather than code review.
