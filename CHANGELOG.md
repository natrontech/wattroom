# Changelog

All notable changes to WattRoom are recorded here.

The format is [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versions are [CalVer](https://calver.org/) `YYYY.0M.MICRO` — `2026.09.1`, then
`2026.09.2`, and MICRO back to 1 next month. The number tells you _when_ a
release is from; whether it breaks anything for you is what the headings below
are for, so read Changed and Removed rather than counting digits.

Entries are written by whoever did the work, in the PR that did it, as a file
in [`changelog.d/`](changelog.d/) — one per PR, so parallel work never collides
on this file. `make release` collates them into a dated section and deletes
them. Nothing here is generated from commit
subjects on purpose: a changelog is for the person deciding whether to upgrade,
not a second copy of `git log`.

## [Unreleased]

## [2026.09.33] - 2026-09-07

### Changed

- A soundboard is no longer capped at nine clips. Add as many as your storage allows — the board grows a row at a time and scrolls, and the empty slot at the end is always the next one to fill.
- Soundboard keys are yours to set: click the key beside a clip and press whichever one you want, or Escape to take it away. Showing the board moved from `B` to `Alt+B`, so it no longer fires while you have a button or a link focused, and a pad can no longer go off behind an open dialog.

### Fixed

- The soundboard opens from the sound row in the sidebar now, beside the mic and the mixer, instead of a floating button that sat on top of the chat composer.
- Opening a room chat or private conversation puts the cursor in the message box, ready to type without an extra click.
- Your execution score now means the same thing on screen and in the saved ride. It weighs a hard interval more than an easy one, ignores warmup and cooldown, and — the part that was a genuine question — scores you against your own ±% trim rather than the untrimmed target, so riding a dialled-down day well is a good score.

## [2026.09.32] - 2026-09-06

### Added

- Links in chat now get a preview. Until now only YouTube and Spotify showed a
  card, because those were the two sites a browser was allowed to ask; the
  server fetches the rest, so an article, a Steam page or a repo arrives with
  its title and picture instead of as a bare URL. Preview images are fetched
  through WattRoom, so opening a chat never hands your address to the sites
  other people link.
- Trim a soundboard clip: cut it down to the part you want, fade either end, and push or pull its level. Nothing is re-encoded, so the edit is undoable forever and you can change your mind later. A file longer than a minute is fine now — upload it and choose which minute.
- A soundboard of your own: upload MP3s, put them on nine pads, and fire them into the room with keys `1`–`9`. The panel floats where you drag it and folds away with `B`. It has its own volume in the mixer — turning the cues down for a quiet ride never silences it, and turning it down never costs you the countdown.

### Changed

- The room's voice and video code is no longer one 1400-line file. Device
  choice, the outgoing audio bus, the mic-gate settings and the stage now
  live in modules of their own, each under test for the first time —
  including the rules about forgetting an unplugged microphone and about the
  gate rising while music plays, which previously had no coverage at all. No
  behaviour changes.
- Icon buttons and quiet text actions now share one definition, so they disable, size and round the same way everywhere. The one visible change is that round icon buttons hold their size in a tight row instead of squashing, and greyed-out ones look greyed out.
- A soundboard pad now draws its clip's real waveform once the audio has loaded, so you recognise a sound by its shape rather than by reading the label.

### Fixed

- Device pickers keep to their own column: a long microphone name no longer
  draws over the picker beside it, and the open list stays inside the dialog,
  flipping above the picker when there is no room below. The room's Sound
  panel now picks your camera too, next to the microphone.
- "Export everything" now actually does. Alongside your profile and rides it carries the messages you wrote, your DM threads, friends, rooms, playlists, workouts, planned sessions and your XP and trophies — machine-readable JSON in one zip. It stops where other people begin: someone else's chat line stays theirs, and nobody else's account details or ride data ride along.
- Right-clicking a rider now offers the same things wherever you do it. Their
  tile and their row in the people column had drifted apart: only the row
  carried their volume, and only the tile let an owner ban them — so stopping
  someone depended on which of the two you happened to right-click. Both now
  offer everything the room can do with that person, and the menu itself sits
  its rows evenly inside its own edges.
- A busy room no longer makes every open WattRoom tab hammer the server. The
  app refreshes its sidebar whenever anything changes anywhere, and a fast
  chat exchange used to mean one refresh per message, on every signed-in
  rider's machine — including riders who are not in that room. Bursts now
  collapse into a single refresh, while the first message still updates the
  badge immediately.
- A saved ride's duration now counts seconds instead of packets. A trainer that reports in bursts, or a tab that wakes up and flushes what it buffered, could add minutes of riding that never happened — to the ride, to the month's totals and to the XP that follows them.
- Room pages no longer slow down as the ride history grows. The monthly kJ
  total and the room's streak both scanned every ride ever recorded, because
  the column they filter on was never indexed; on a 200 000-ride database they
  now take 0.4 ms and 0.2 ms instead of 29 ms and 16 ms. Deleting a ride, and
  deleting an account, get the same treatment.
- The sidebar no longer gets slower the more rooms you are in, or the busier
  your rooms are. Loading it ran five separate database queries per room, and
  every message anyone posted made every signed-in rider load it again — so a
  single chat line could cost the server hundreds of queries. It is one query
  now, whatever the room count.
- One rider on bad wifi no longer slows the room down for everyone. Each rider's screen now has its own outbound queue, so a connection that stops keeping up misses ticks by itself instead of costing every other rider up to a second of theirs — most visible during a sprint, where the room ticks four times a second.
- The app no longer re-downloads itself on every cold load. Its hashed
  JavaScript and CSS were served with no cache headers at all — not even a
  validator to ask "has this changed" with — so every fresh visit pulled the
  whole shell again. They are now cached for a year, which is safe because a
  new build writes new filenames. The reference `deploy/Caddyfile` also gains
  `encode zstd gzip`; self-hosted instances were serving everything
  uncompressed.

## [2026.09.31] - 2026-09-06

### Added

- Stepping out and coming back now make a sound, the way arriving and leaving already did — the same two cues, a fifth lower, so a room quietly emptying to one is something you hear from the bike instead of something you notice on the screen. Your own "Away" stays silent, because the same press mutes your speakers; the cue you hear is the one that tells you the room's sound is back.
- You can now choose whether your own voice ducks the room. Music and cues have
  always dipped only for other riders; the mix panel now has a switch for
  riders who want them to dip while they speak too. Off by default — nothing
  changes unless you ask for it.
- You can edit a message you sent, in a room or in a DM. Right-click it (or
  long-press on a phone) and pick Edit — the line updates for everyone who is
  there, and shows "edited" so nobody is quietly rewritten. Only the sender
  can, and only the text; an attached image stays put.
- A friend request now announces itself wherever you are in the app — a blip, a toast, and an OS notification if the tab is in the background — and so does someone accepting the request you sent. A request that gets dismissed now says so too, instead of leaving you watching a row that would never move. Both sides also see the friends list update the moment it changes, instead of on the next refresh.
- A GIF button in the composer: search GIPHY and send without leaving the room, in room chat and in direct messages. Servers set `WATTROOM_GIPHY_KEY` to enable it; without a key the button does not appear.
- A ride sent to Strava now says whether it arrived. Delivery is remembered rather than living in a background task, so an outage or a server restart no longer abandons it silently — the ride is retried on its own, and the ride's page shows where it went, links the Strava activity once it lands, and says plainly when it could not be sent.

### Changed

- Away now takes the room off your speakers as well as your mic and camera. Voices, the jukebox and the cue sounds all go quiet on the screen you stepped away from — until now the room kept playing at full volume to an empty chair, which is a problem for whoever else is in the house. Your levels are untouched: coming back restores the mix you had, not a default, and the sound panel says it is muted rather than showing every fader at zero.
- The cue level is now in your own menu — right-click yourself at the foot of the sidebar, from any screen — and letting go of the fader plays a cue at the level you set. It stays in the Sound panel too.
- Pick your microphone by right-clicking the mic, and where the voice comes out by right-clicking yourself — both lists are in the menus now, alongside the Sound panel's own.
- How far music and cues dip while someone is speaking is now in your own menu too — right-click yourself at the foot of the sidebar while you are in a room. It stays in the Sound panel.
- Right-clicking your microphone now switches between voice activation and push-to-talk, and offers the way to the gate meter — instead of three clicks into the Sound panel. The threshold itself stays there, where you can see your own level against it.
- A rider's volume is now in their right-click menu, wherever they appear — the people column, their tile on stage, the Members list — instead of a speaker icon on two rows. The music level moved into the jukebox, next to the queue and the transport.

### Fixed

- Exporting all your data no longer loads every ride's samples into memory at once. It reads them one ride at a time while streaming the zip, so the export costs the same whether you have ridden for a month or for years.
- A solo ride whose save to your account fails is no longer lost. It stays on the device with every sample, and the ride screen offers it back with a "Save to your account" button next to the .fit download — previously only a summary survived, and the recovery card never mentioned it.
- Auto-pause and the spiral guard now protect you in a group ride, not only when riding alone. Stop pedalling, or grind to a halt at low cadence, and your trainer lets go while the room's session carries on — with a line on screen saying so, and a countdown when you pick back up. A sprint moment no longer lands on a rider who has stopped.
- Removed a stale copy of the microphone settings in the room's voice client. It never took effect and disagreed with the real one, so nothing changes in how you sound — there is now one place those settings live.
- Two riders sharing a display name no longer answer for each other: the unread badge on a room stays yours while your namesake is standing in it, and a DM header no longer says your friend is riding somewhere when it is someone else with their name.
- The ramp test now ends when you stop pedalling, which is how a ramp test is meant to end. Auto-pause used to release the trainer before the test had counted the five seconds it needs, leaving you paused mid-ramp with no FTP at the end of it.
- A sprint moment now ends on time even if your connection drops during it. The sprint's hill (or, on a single-speed setup, its 2×FTP hold) used to stay on the trainer for as long as the drop lasted, because the window was measured off the last message from the room.
- Stopping now reaches the trainer straight away. A trainer that acknowledges slowly used to leave every out-of-date ERG target queued in front of the release, so the resistance held for seconds after Stop, auto-pause or the spiral guard; superseded targets are dropped instead, and targets left over from a dropped connection no longer stall the reconnect.
- The "with you" strip in the sidebar now shows real profile pictures and avatar presets, instead of falling back to a coloured initial for everyone.

### Security

- Flagging a problem mid-ride no longer puts your name or your room's address into a public issue. The report still carries everything needed to fix the bug, and the private record kept for triage is unchanged.

## [2026.09.30] - 2026-09-06

### Added

- WattRoom now emails you when a way into your account changes: a passkey added or removed, a sign-in provider connected or disconnected, and the recovery address replaced — that last one goes to the address losing the account, so a change you did not make cannot happen quietly. Deleting your account sends a receipt. These need a confirmed address and have no off switch; they are the alarm.
- Game modes now tell you what to do, not just what happened. Team Relay says out loud when the front comes to you, Floor is Lava announces the called zone changing and your own lives burning, Watt Golf counts the hole in while the meter is hidden, and the ramp modes mark each new round. Until now only being knocked out and the podium made a sound.
- A planned session now emails the room an hour before it starts, so the ride you meant to do is not the one you remember at nine. It rides the same switch as the other session emails — nothing new to turn on — and each session is reminded exactly once, however many times the server restarts in between. A session whose start slipped past while the server was down is skipped rather than announced late.
- The voice channel now says who arrived. Someone joining or leaving the call plays the room's arrival cue a fifth up — until now a rider joined silently and you found out when they spoke, or you didn't.

### Changed

- WattRoom's emails now look like WattRoom. A planned session, a session that moved and the address confirmation all arrive in the same dark shell with the equalizer mark, the workout and its start time in the live magenta, and a real button instead of a bare link. The plain-text version still goes out beside it, so a client that will not render HTML — or a rider who told it not to — loses nothing.
- A tile with the camera off now shows the rider's own avatar and level ring
  instead of the WattRoom mark, so you can tell who is in the seat at a glance.

### Fixed

- A room whose clock crashed repeatedly used to strand everyone inside it: the server stopped restarting the loop but left the sockets open, so the timer sat frozen with nothing on screen to say why. Such a room is now closed, and reconnecting puts you straight into a working one.
- A rider switching their camera off gets their mark back on their tile, instead of leaving an empty seat behind.
- Sprint moments no longer speed up disconnect penalties in Floor is Lava, Backyard Ramp or Collective Ramp.
- A brief network failure no longer signs you out and drops you from the room you are in — only the server actually saying so does. If the room does end under you, it now says so out loud, with the way back in.
- Session emails now give the time in your timezone instead of the server's. Two riders in the same room, in different countries, each get the hour their own clock shows. Nothing to set: your browser reports where you are, and it corrects itself when you move.
- Cancelling a planned session now emails the room, the way planning one and moving one already did — riders who were told to turn up at seven no longer find out by opening an empty room. It rides the same switch as the others, so nothing new to turn on, and a plan whose start time has already passed is skipped: being told a ride you already missed is off is not news.

### Security

- Two ceilings that only an abuser should ever meet: an account can now ask for at most ten address-confirmation emails an hour, and passkey sign-ins refuse to start once too many are already in flight rather than letting one flood slow down everybody else's. Both answer with a plain "try again in a moment" instead of failing quietly.

## [2026.09.29] - 2026-09-06

### Added

- The room now says out loud when something breaks. A trainer, the room connection, voice or the microphone dropping plays a falling two-note cue, and a rising one when it comes back — the banner alone only ever reached riders who were reading the screen. Error toasts, a coach pausing or resuming the session, and someone reacting to a chat line are audible for the first time too.

### Changed

- The pages a mail link opens — confirm your address, unsubscribe — now look like WattRoom: the app's colours, the wordmark and a proper button instead of an unstyled form in the browser's default serif. A link that has expired or was already used explains itself on the same page rather than showing raw JSON.

## [2026.09.28] - 2026-09-06

### Added

- The sign-in screen now marks the provider you used last time, and a sign-in that creates a brand-new account says so — so clicking the wrong button no longer leaves you quietly looking at an empty second account with none of your rides.
- Banning a disruptive rider is now available from the Members page and
  rider tiles in the Lounge, not just Settings — right where you meet them.
- You can now disconnect a sign-in provider from your account in your profile — connecting the wrong Strava account no longer means deleting everything and starting over. Disconnecting Strava also hands the authorization back to Strava, and stops ride upload. WattRoom will not let you remove your last way in.
- DMs can now react to messages, the same as room chat.
- Sign in with a passkey — your phone, your password manager, or a security key. Nothing to type: the browser shows which WattRoom account the passkey belongs to and signs you in. Add one in your profile; the sign-in providers you already use keep working beside it.
- Saved rides can now be downloaded as FIT files from ride history.
- When someone else starts sharing a screen while music is playing, the room
  now hears about it: a line lands in the timeline, the sharer's tile shows a
  screen glyph while the share is live, and the room-event cue plays. Before,
  the share only appeared as one more chip in the stage picker.
- Your account can now hold a confirmed email address, so you can get back in if you ever lose the way you sign in. Add one in your profile and follow the link we send; it is never shown to anyone and nothing else uses it.

### Changed

- Every face now says where its person is. One badge — riding, in a room, away, offline — on the avatar itself, so the people column, the friends list, the messages list, a DM and the chat log all read the same. Chat lines show the real avatar with its level ring instead of a coloured initial, the Away button moved off the Lounge header to sit with your mic and camera at the bottom of the sidebar, and a rider's tile can poke them like the people column always could.
- DMs now have the same message tools as room chat: right-click Copy, the
  "N new" unread divider, and time-based grouping. (Reactions stay room-only
  for now — there's no DM reaction backend yet.)
- Move the room, history, profile and rider profile fetches into route loads so navigation can start them before each page mounts.
- The sidebar says where you are with one wash at three strengths — the room you're in, the row you're pointing at, the row you're on — instead of a left stripe, a pulsing green dot and a rule down the room's pages. Those pages no longer run edge-to-edge when highlighted, hovering one now fills it rather than only recolouring the label, and the fill survives the pain cave, where it used to be nearly invisible.

### Fixed

- In the collective ramp, a rider who dropped out no longer makes the room's average go up: past the disconnect grace they count as stopped, the same as in the individual ramp, and a room where everyone has gone quiet ends instead of counting rounds forever.
- Collective Ramp now averages each rider's FTP fraction equally, keeping mixed-FTP groups fair.
- The microphone and speaker pickers in the Sound panel and on your profile's
  Voice & audio page now list your actual devices before you join a room, and
  fill in the moment "test my mic" is granted permission — no more joining with
  the wrong microphone just to be able to pick the right one.
- Opening a direct message from a fresh tab no longer rebuilds the thread when the other rider's name arrives, so the "new since last time" divider stays where it belongs.
- Coming back to a backgrounded tab no longer yanks the jukebox playhead by
  your machine's clock skew and then back again: the returning tab re-measures
  the room's position on server time, from the clock estimate it learned while
  on screen, instead of falling back to its own wall clock for the first second.
- Saving your profile no longer re-sends the confirmation mail or kills the link already in your inbox: the address only travels when you changed it. A confirmation that failed to send no longer pretends it went out, and the tab that asked for the link now notices when you confirm it elsewhere. Confirming an address while a profile save was in flight can no longer be overwritten by the old one.
- Arriving at Rides from a recent ride on Home or from the progression chart rings and scrolls to that ride again.
- Riders now see an actionable message when a YouTube track or playlist cannot be added to a full or invalid jukebox queue.
- Removing a passkey and disconnecting a provider at the same moment could both pass the "not your last way in" check and leave an account with nothing to sign in with. The two removals now take turns on the account row, so the second one is refused.
- Floor is Lava now gives disconnected riders the documented grace period before judging their missing power.
- Right-clicking a rider's tile in the lounge now reaches Focus, "Watch their screen" and, for the owner, "Ban from the room" — the tile's own menu had been swallowing them.
- A microphone that dies mid-ride now says so. Unplug a USB headset, let a
  Bluetooth one switch profiles or have another app grab the device and the
  room used to hear silence for the rest of the session while your mic icon
  stayed green. Now the mic closes, your tile reads muted, a persistent
  "Your microphone stopped" banner sits on the dashboard with one big
  Reconnect, and a chosen mic that disappears falls back to the default.
- A passkey named with 40 characters ending in an accented letter was refused after the browser had already stored it; names are now cut by character. Signing in with a passkey from a room link lands you in that room instead of the rooms list.
- Members no longer see Rename, Delete, "Set as active", remove-a-track or the autoplay switches on room playlists, which the server keeps for the coach and the owner; the controls are hidden or disabled with a one-line hint instead of failing on click.
- Points Race now awards points for the final sprint before publishing the race podium.
- Ramp tests now use readings from paired power and heart-rate sensors.
- A rider's page fetched itself over and over for as long as it was open. It loads once, and again only when presence changes.
- A crash inside background work (a room's game mode, jukebox, session save,
  chat pruning, a mail send, or a server-wide housekeeping job) no longer takes
  the whole server down with every live room in it. The failure is logged with a
  stack trace, the work is restarted, and every other ride carries on untouched.
- A game mode or jukebox tick that panicked left its room's lock held forever: the room stopped ticking for good, and the rooms list, friends and rider pages hung for everyone until a restart. The lock is released on the way out and the relaunched loop carries on.
- A jukebox refusal is no longer wiped by the track ending under it; your own sidebar avatar shows riding like everyone else's; a database hiccup while removing a DM reaction is reported as an error rather than "no such message".
- Two riders on exactly the same sprint w/kg were placed at random each tick, so a points race could hand the 5 and the 3 either way. Ties now resolve the same way every time.
- "Use this tab instead" now always wins. The takeover was stamped with your
  computer's clock while a tab's join was stamped with the server's, so on a
  machine whose clock ran behind the other tab could refuse to stand down and
  you heard yourself twice in the room. Both stamps now sit on the server's
  clock, the way the jukebox playhead already does.
- A voice join that fails now tells you why and what to do. A browser that is
  blocking the microphone, a missing microphone or camera, an expired sign-in
  and a room you are no longer a member of each get their own message in the
  Lounge next to "Try voice again" — no more bare "voice failed".
- Voice: a mic test or a mid-call mic switch that the browser refuses now says why instead of doing nothing. A microphone another app is holding no longer forgets your chosen mic for good. The "microphone stopped" banner no longer lingers after handing the mic to another tab or stepping away, and Reconnect there no longer opens a second mic. Leaving and rejoining voice keeps the unplugged-mic and tab-return handling alive.

### Security

- New room links now carry a short random suffix (`/r/thursday-crew-7f3a`), so
  a room's name is no longer enough to guess its URL. Existing rooms and their
  links are unaffected, and renaming a room never changes its slug.
- Joining a room from a shared link no longer lets you delete or rename its
  saved playlists, remove one of their tracks, or change autoplay — those are
  owner/coach only now. Members can still queue, vote, skip, and create and
  manage their own playlists.

## [2026.09.27] - 2026-09-05

### Added

- Step away without leaving: one button in the Lounge mutes your microphone, stops your camera and marks you away on every screen in the room. Pressing it again brings back exactly what was live before.
- DMs now have a file-picker button for images, not just paste.
- Poke one rider from their room menu when chat is too easy to miss; their own cue volume and notification settings remain in control.

### Changed

- Clarified how playlists, themes, jukebox playback and frequent releases work.
- Clarified that phones can use room lounge and chat surfaces while trainer controls stay desktop-only.

### Removed

- The free custom-hue theme picker is gone; pick from the ten curated themes
  instead. Anyone previously on a custom hue is moved to the closest preset
  automatically.

### Fixed

- Autoplay keeps the music going: when the last track of the active room
  playlist ends, the deck refills from the playlist again instead of falling
  silent until somebody rejoins. Turn autoplay off in the room's playlists to
  stop after one pass.
- A chat line typed while the room is reconnecting no longer vanishes once
  sixteen are already waiting to be sent. The text comes back into the box
  with a note to try again in a moment, instead of disappearing without a word.
- Rider tiles, chat messages and friend rows now have a right-click/long-press menu, not just hover-only buttons — reachable on a phone or from three metres away.
- The `/dev/sound` debug page now moves the cue volume through the mixer
  instead of a level nothing else could reach, so its slider matches what you
  hear and survives navigating away and back.
- Voice ducking now dips the music to the specced 25 % of its own volume while someone is talking, instead of 30 %.
- Cue sounds now glide under a talking rider over the same 150 ms attack /
  600 ms hold / 400 ms release the music already used, and to the same 25 %
  the mixer knob names — a countdown or cheer that is sounding when someone
  speaks no longer takes an audible click in either direction. One module owns
  every ducking number, so the mixer, the cue bus and the jukebox can never
  disagree about how deep or how fast.
- The friends list no longer runs two extra database queries per online
  friend — loading it now costs a small, constant number of queries no matter
  how many friends are online.
- Removing a track from the jukebox queue, or skipping a whole playlist, now
  offers an undo toast for a few seconds instead of dropping it for good.
- The LiveKit voice, camera and screenshare client now loads only when a rider joins AV, keeping login and other non-AV routes lighter.
- fixed: opening the people list on a phone or tablet no longer hides the playing jukebox video behind the panel — it now drops to its usual floating corner instead.
- Connecting a second sign-in provider now attaches it to the account you are already in, instead of quietly creating a second account with its own, separate ride history. Your profile gained a Connections section to do it from, and connecting Strava there is what turns on automatic ride upload.
- Removing a track from the queue is now a bike-sized button, the same 40 px
  the transport uses, instead of a 24 px cross you had to aim for at arm's
  length. The tiny move up/down arrows are gone from the row — they never fit
  beside a readable title on a phone — and live in the track's right-click or
  long-press menu; votes remain the one-tap way to float a track up. "Queue
  this again" in the just-played list grew to the same size.
- The README no longer claims Wahoo legacy (pre-FTMS) trainer support — that
  driver was never built and stays backlogged (#4); the Hardware & browsers
  section now says so instead of implying a Kickr v2 will pair.
- A voice drop no longer un-mutes you. When LiveKit loses the connection and
  the room rejoins on its own two seconds later, you come back the way you
  left: muted if you were muted, open if you were talking. Before, the rejoin
  always opened the microphone — silently, mid-phone-call, while you were not
  looking at the screen.
- A room link typed with different capitalisation now lands you in the same
  live room as everyone else. Before, `/rooms/MyRoom` and `/rooms/myroom`
  opened two separate rooms on the server — riders could not see each other,
  a kick or a room close only reached one of them, and the spare copy was
  never cleaned up.
- Scrubbing a paused jukebox deck now moves the video, not just the time readout — the picture used to hold the old frame until you pressed play.
- Expired sign-in sessions are now swept from the database daily instead of
  accumulating forever.
- Removing a friend, unscheduling a session or banning a rider now says so and offers Undo — a mis-tap used to fire silently with no way back. Removing a member from a room has no inverse call, so it asks first instead; the friends list also shows "Loading friends…" instead of a blank panel while it fetches.

### Security

- A ban now holds at every door. A banned rider could delete their own
  membership row by "leaving" the room and rejoin as a fresh member, and could
  still read the chat backlog, post lines and upload images over HTTP while
  banned. Leaving is refused for banned riders, the row can no longer be deleted
  through that path, and every chat endpoint now refuses banned members the
  same way the room socket, playlists and RSVPs already did.
- Every mutating API endpoint now enforces the Origin check the docs already
  promised, not just three. Cross-site requests were already blocked in
  practice by the session cookie's SameSite=Lax setting; this closes the gap
  between that and what the auth package's own comment claimed.
- A ⚑ flag report never carries your heart rate. The two-minute recording
  that goes out with a report kept watts, cadence and heart rate; heart rate
  is health data and now stays out of it on your side and is stripped again
  on the server before anything is filed. The same recording also captures
  rejected promises now, so a broken page outside a ride leaves a trace.
- A banned rider's voice and camera access now expires within 30 minutes
  instead of staying valid for up to six hours. Ejecting a rider from the
  LiveKit call removes them from that session, but it never revoked the
  access token already in their browser; the token's own lifetime is what
  actually bounded a stale token's reach, and it was six hours.

## [2026.09.26] - 2026-09-04

### Added

- A room's Members place now shows what its crew has done: each rider's badges
  beside the medals they won in that room, and the list can be ordered by
  joined, level or badges. Comparison stays inside the room — there is no
  ranking of riders anywhere else, and nobody sees progress toward a badge
  someone has not earned yet.
- A rider's page now shows the badges they have earned, so a level finally has
  its receipts: who coaches, who DJs, who turns up before seven. Room-mates and
  friends see the badges themselves — never how far along someone is on the
  ones they have not earned, and never a completion score.

### Fixed

- A rider's face in a room's people column now opens their page on a click.
  It took a right-click or a long-press before — a menu was the only way in,
  on the one surface you sit on while riding. The sidebar's video tiles still
  go back to the Lounge on a click, and offer the rider on a right-click.
- A rider's profile page now counts all the XP they have earned. It summed
  rides only, so everything the ledger pays for — lounge time, voice sessions
  and achievements — was missing there, and the profile showed a lower level
  than the sidebar, the room and your messages showed for the same person.
- The level bar has a visible track again. It sat on a card of its own colour,
  so the unfilled part vanished and a quarter-full bar did not read as a
  quarter; it now shares the ring's track, and the two agree at a glance.
- The faces in a room wear their level ring — the people column and the video
  strip, which showed a bare avatar while every other surface showed the ring.
- The workout picker is usable on a phone. Its two panes stacked side by side
  whatever the screen, which left the description and the interval graph a
  53-pixel column reading one word per line; below tablet width they now sit
  one above the other at full width.
- A room's empty chat no longer prints its "nothing said here yet" line
  underneath the floating navigation and people buttons.
- The drawer's controls are thumb-sized. Leaving a room was a 12-pixel target,
  opening one 13; those and every navigation row are now at least 44 pixels on
  a phone, unchanged on a desk.

### Security

- Fixed: a rider's trophy case handed your progress toward every unearned badge
  to anyone who could open your page — "3 of 5 rides before 07:00" and the
  like. Progress is now yours alone, on your own trophy case; the earned badges
  are what other people see.

## [2026.09.25] - 2026-09-04

### Added

- The "what's new" notice on Home now tells you what actually changed instead
  of counting entries, and a release can hang a one-tap action off it. The
  first one offers the Monokai theme — it names the half your light/dark
  setting will actually render, and one tap applies it. If several releases
  landed since you were last here, the notice announces the newest and says
  how many you missed, with the link to the rest.

## [2026.09.24] - 2026-09-04

### Added

- The jukebox panel now has saved playlists: a room can keep several,
  editable by any member, with one marked active; you can also build your own
  personal playlists and queue them into any room you're in. A room can turn
  on autoplay — ordered or shuffled, with an optional pinned "always play
  this first" track — so the active room playlist starts itself when someone
  joins an idle deck.

### Fixed

- Deleting a room now clears everything live about it. The slug a delete frees
  can be taken by the next room of the same name, and that room used to open
  carrying the deleted room's jukebox queue, chat and session — visible to
  members who were never in the old room. Deleted rooms also stop holding
  memory and a timer for the life of the server.
- Jukebox videos no longer play with closed captions burned in when your
  browser has YouTube's "always show captions" preference on. The player has
  no on-screen controls to turn them off, so WattRoom now forces captions off
  itself.
- The three-room ownership cap now reaches the browser from the server, so the
  hint under a disabled "Open room" always names the number the server will
  actually enforce. It had been written out by hand in four places, and a
  future change to the cap would have left the app saying the old one.

## [2026.09.23] - 2026-09-03

### Added

- A fifth theme: Monokai, alongside Outrun, Tron Ice, Miami Nights and Laser
  Yellow on the profile page. Editor-gray cave with cyan-violet chrome and
  magenta on the numbers at night; a warm paper desk with the same chrome and
  data colours by day.

## [2026.09.22] - 2026-09-03

### Added

- Paste a YouTube playlist into the jukebox and the whole thing queues as one
  entry, playing straight through once. Paste a link to a video that sits
  inside a playlist and the room asks which you meant, naming how many tracks
  the playlist holds. Skip and the new back button move within a playlist; a
  separate button drops the rest of it and moves the room on, and every member
  can press it. A playlist takes one slot in the queue rather than fifty, so
  one paste no longer buries everyone else's tracks or the votes on them.
  Previously a playlist link was either ignored in favour of the single video
  or refused as "not a YouTube link".
- Starting a workout on your own now shows the same paired-devices overview as
  a room's Training place. `/ride` and the ramp test draw a card each for your
  trainer, heart rate, power meter and cadence, with the device's name and its
  live reading — so you pair everything, watch the watts arrive, and only then
  press Start. Pairing has moved off the start button: it used to connect and
  start the ride in one click, which left no moment at which you could see
  whether your trainer was actually reporting anything.

### Fixed

- A sensor now belongs to one screen at a time. With your trainer paired on
  your phone, the desktop says "Trainer paired on your phone" instead of
  offering to pair a second one — and your ride record no longer counts two
  streams of watts when you had two tabs open, which quietly inflated the
  execution score. Whichever screen paired keeps it; Forget there to move it.

## [2026.09.21] - 2026-09-03

### Added

- Training now shows a Zwift-style "paired devices" overview before a session
  starts: one card each for your trainer, heart rate strap, power meter and
  cadence sensor, with an icon and live connection state, so you can see
  what's actually paired instead of guessing from a single "Pair trainer"
  button.

### Changed

- The Lounge no longer shows "Pair trainer" or session controls (Start,
  Sprint, Pause, End) — that's Training's job now. The Lounge stays the
  room's social home; get set up and run the session from Training instead.
- Your phone now gets the real room instead of the old read-only watch page:
  the same places as every other screen, reached through the same drawer, with
  the crew's live watts, the reactions and the chat one thumb away. Training
  follows a rider — tap anyone in the crew strip — since a phone has no trainer
  of its own. Pairing, ERG and session control stay off a phone, where they
  could only fail; add `?full=1` to the room's link to get them back on a
  narrow screen that can actually use them. `/r/<room>/watch` now opens the
  room.

## [2026.09.20] - 2026-09-03

### Added

- The list of who is in a room, under its name in the sidebar, is now a way in
  rather than a caption: clicking it opens that room's Members place — so the
  "+2" finally shows you the two it was hiding — and right-clicking it opens
  each rider it named straight on their own page.

### Changed

- The last emoji in the app are drawn icons now: medals on a room's members
  page, the sprint and game podiums, a Floor-is-Lava rider's remaining lives,
  the flag-a-problem button on the ride screen, and a mark of its own for each
  of the seven game modes. They keep their shape and weight on every device
  and follow your theme, instead of whatever your platform's emoji font
  decided — and a screen reader now reads the ones that used to be a bare
  glyph.

### Fixed

- The flag-a-problem button on the ride screen no longer wears the same
  magenta as your live watts, so the numbers keep the colour that makes them
  findable at arm's length.
- Refreshing the page no longer drops you out of voice. Reload while you are in
  a room's call and you come straight back into it, muted if you were muted —
  the mic is never opened for you, and the camera stays off. Only a reload does
  this: opening the room fresh, coming back after a break, or hanging up first
  all leave you out, and a rejoin never takes the mic off another tab of yours.
- Sharing your screen is now impossible to miss: a persistent red status
  strip sits above every page while your screen is live, naming the room it
  is going to and offering one big Stop, the sidebar's share button turns red
  while it is on, and the stage labels your own share "Your screen".
- Your mic no longer stops opening when a track starts. The gate still lifts
  a little while the jukebox plays, but it can never rise past the top of the
  meter, and it only lifts for riders who actually hear the music — turn your
  music down to zero and you keep the gate you set.

## [2026.09.19] - 2026-09-03

### Fixed

- The sidebar now lifts the room you are standing in as one grouped section,
  making your current room clear before its individual places.
- The sidebar now offers a **Join voice** button when you are not in voice; the mic, camera and screen-share controls appear once you are in, instead of sitting there greyed out. The people column lists everyone again — in voice, in the room, and the members who are offline — with their real faces, and the jukebox deck no longer clips its own play button when the video is on the stage.

## [2026.09.18] - 2026-09-02

### Added

- Planned sessions take an RSVP. Any member of a room can say they are in for
  one, take it back, and see who else has committed — the Sessions place lists
  them in the order they said yes. There is no maybe: you are in or you are
  not.

### Changed

- The room's right column gives its height to whatever you are actually using. The jukebox folds its picture away while the video is playing on the stage — it was a 200 px placeholder for something already on your screen — and the people list folds to a row of faces you can open, which it does by itself mid-ride where the execution bars matter. Whichever one you leave open takes the space the other gives back.
- A message now reaches you the same way wherever it comes from: a room you are standing in, a room you are not, or a DM. With the tab in front of you it arrives as a toast you can click to open the thread; behind another window it is still the browser notification. Chat in a room you have not joined used to announce nothing at all.
- Unread marks read the same everywhere — the sidebar's DM dot no longer takes the live-data accent, and a room's Chat place carries a count of what was said while you were in another place.
- Unread counts and the sidebar update the moment somebody speaks, instead of waiting up to a minute for the next refresh.
- Voice, camera, screen share, sound and leave now live in one place: the you-panel at the bottom of the sidebar, on a row of their own. The duplicate set in the people column and the lounge header's Share screen button are gone.

### Fixed

The Members place opens again in rooms where a rider has collected more than one medal in a day. It used to leave you standing in the previous place with the address bar already moved, and a shared link to it never finished loading.
- Your own rider page has a way in. Clicking yourself at the bottom of the
  sidebar opens `/u/<you>` — the level, medals and shared rides other riders
  see — the way clicking anyone else's avatar already did. The gear beside it
  still goes to settings, and your page now links to the trophy case.
- A session someone else plans now appears in the room's Sessions place and on
  everyone's Home the moment it is planned, instead of on the next reload.
  Moving or cancelling one, a role change, and a member joining or leaving
  land the same way — the room you are standing in no longer only updates for
  the person who changed it.
- The Sensors page shows your trainer. Pairing happens in a room, and the page you open to check your equipment used to list every strap and sensor except the one device the ride depends on — it now names your trainer, says when it has dropped or has gone quiet, and lets you re-pair or forget it from there. The bias buttons also say why they are dead when nothing is paired, instead of just not responding.

## [2026.09.17] - 2026-09-02

### Added

The execution meter is live during a session. Training now shows how cleanly everyone is riding their own workout, ranked and updating as you go, instead of only telling you afterwards.
- A room's chat is now a place of its own — Chat, in the sidebar under the room you are in, beside Lounge and Training. It is the same live conversation, with the whole width for reading back a session's worth of talk, room-sized reactions, and the pictures people paste; on a screen too narrow for the people column it is the chat without summoning anything.

### Changed

- The people column has handed the chat over to that place and kept what only it can do: who is here, who is in voice, the deck, and the room's reactions. Where the log used to be there is now one line — who spoke while you were elsewhere and how much you missed — that opens the chat. Three surfaces had been splitting that column's height and none of them had enough; the roster and the queue get it back.
- The room's video has one home instead of a window you had to park: it plays
  in the people column, drops into the nav rail on a window too narrow for that
  column and on every page outside the room, and rises to the stage or TV mode
  when the room is watching together — so the transport is always beside it.
  The floating pop-out is gone. In the Lounge a third layout, **Sidebar**,
  keeps the video in the people column and gives the whole room back to the
  crew; the picture in the other two is centred and no longer carries a corner
  grip — drag the divider between it and the crew instead.

### Fixed

- Opening a room on a phone showed an empty screen: the redirect that hands a phone the spectator view was also hiding the view it lands on, so the one room screen a phone is meant to get rendered nothing. It is back — and it now carries a Say something button into the room's Chat place, which a phone can stand in and type in, since talking needs none of the Bluetooth a phone browser lacks.
- Voices are back to their normal loudness, and the music dips again when somebody talks. The previous release turned off the browser's automatic gain control, which quietly took both with it.

## [2026.09.16] - 2026-09-02

### Changed

- The Strava sign-in button on the login screen is now Strava's own "Connect with Strava" button, as their brand guidelines require. Nothing about signing in changes — the button just looks the way Strava says it must, which is a precondition for raising how many riders can connect their Strava account.

### Fixed

Your ride record keeps every watt after a re-pair or a mid-session page reload — the trainer's numbers used to reach the room's tiles but vanish from the saved ride. Signing out now releases the trainer too.

## [2026.09.15] - 2026-09-02

### Added

- Add friend is now one right-click away from anyone you ride with — a tile in the lounge, a row in the people column, a name on the members page. Their page keeps its button; you no longer have to go there. The people column's menu also gained View profile, which it was missing.
- The mix and the voice gate are reachable from inside a room again: a **Sound** button beside Join voice opens the music, cue and duck faders, your gate on its meter, the riders you have turned up or down, and the mic and speaker pickers — without leaving the ride for the profile page.
- Open any past ride to see how it went — the graph with your trace, time in
  zone, the numbers and any medals — and delete one you don't want to keep.

### Fixed

- A trainer that misses one command keeps working — before, a single timeout or a Bluetooth blip could silently end ERG control for the rest of the ride, and the trainer just held its last resistance.
- Clicking a picture in a room's chat or a DM opens it big in WattRoom itself, instead of handing it to a new browser tab that took the room with it. Click it again for full size, Escape or the backdrop to come back — and the new tab is still there on right-click.
The rider tiles are legible in the light theme instead of washed out, and the small tiles in the sidebar say who is speaking, riding or muted exactly the way the big ones do.
- A right-click menu on a rider stays open. It was closing itself about a second after it opened — the room rebuilds the people it shows on every update from the server, and the menu was going away with the row it was drawn on.
Pair a trainer from Training, not just the Lounge. Riders who opened Training with nothing paired saw an instrument stuck at 0 W and had to go back a place to fix it.
Ending a session now asks first. The coach's End control ran on the first tap, and a stray thumb on a 44 px target stopped the ride for everyone in the room with no way back.
The "Open Rides" button now appears on your own profile when you haven't shared a ride yet. It was written but never rendered, so the empty state explained how to share a ride without giving you the way there.
- Zooming into a screenshare stays zoomed. The stage snapped back to 1× about
  half a second after every zoom — once per room tick — which made reading a
  chart or a settings dialog on someone else's screen impossible. The zoom now
  belongs to the picture: it returns to fit when you pick another source, or
  when the sharer stops and shares again.
- Your trainer stays paired while you browse. Opening your workouts, your
  profile or anything else outside the room quietly disconnected it, even
  though you were still standing in the room — and pairing again made the
  server treat the rest of your ride as duplicates, so the session summary and
  the execution meter stopped counting a ride you were still doing. The
  trainer now belongs to the room you are in, and is released when you leave
  it or start a solo ride.
- A paired trainer that stops delivering now says so. "Unpair trainer" used to
  be the only thing the room could show, so a trainer that dropped, that
  reconnected in a loop, or that never sent a single watt looked exactly like
  one that was working. The room now carries the same persistent banner it
  already had for a lost connection or a dropped call, with a button to pair
  again.
- Voice activation no longer cuts you off mid-sentence, and the mic meter no longer dances in a silent room. The level is now measured continuously on the audio thread instead of sampled nine times a second, the gate opens fast and closes slowly (and fades instead of cutting), and automatic gain control is off — it was raising your room's noise the moment you stopped talking.
- The room now shows who is in voice before you are. Walking into a room where three people were already talking used to read "in voice, 0", listing all of them under "in the room" instead, until you pressed Join voice yourself.

## [2026.09.14] - 2026-09-02

### Fixed

- Volume faders move smoothly. Music, cues, the duck under a voice and another
  rider's level jumped in 5 % notches — a step you cannot hear near full
  volume, and a 6 dB leap down where you set a track under someone talking.
  They now move a percent at a time, and the mixer reads out where it sits.
- Joining voice or switching your camera on and off no longer makes the room's video stutter, the floating player carries only the video instead of a face beside it, and turning your camera off hands the camera back to your machine so other apps can use it again.

## [2026.09.13] - 2026-09-02

### Fixed

- A right-click menu stays open until you use it: it no longer shuts itself about a second after opening, when the room's chat scrolled to its newest line.
- Someone whose camera is on the stage is no longer drawn a second time in the tile grid, and focusing a rider is a Stage-layout thing now — in side-by-side and the grid, everyone stays one size.

## [2026.09.12] - 2026-09-02

### Fixed

- Fixed the fault behind several odd behaviours in a room with a video playing: the player's position was fed back into the app's update cycle every frame, which could stop the room updating at all — navigating a place then changed the address without changing the page. Popping the player out also works now when the video is on the stage, where the button used to do nothing.
- On a laptop-sized window, the chat and people sheet now opens over the video on the stage instead of under it — the jukebox transport, the chat and the room's people are reachable again while something is playing.

## [2026.09.11] - 2026-09-02

### Fixed

- The jukebox panel no longer shows a blank box while the video plays on the stage: the slot the player docks into carries the track's own artwork.

## [2026.09.10] - 2026-09-02

### Fixed

- Fixed a bug from the last release: with a video on the stage, moving between a room's places changed the address but left the page where it was. The jukebox panel keeps a picture-sized box while the stage has the video — that comes back once the underlying fault is fixed — but it no longer grows with the panel and takes the chat's room.

## [2026.09.9] - 2026-09-02

### Added

Right-click now works where you would expect it: a friend in the sidebar, a member, a ride, a workout, the jukebox deck — not just a room row. Objects with nothing to offer hand the right-click back to your browser instead of swallowing it.

### Fixed

- When a browser mutes the room's music until you press play, it says so in a quiet line under the player instead of a wide magenta bar that looked like an error.
- The jukebox panel no longer keeps an empty video box when the picture is on the stage or in the popped-out window — it says where the video is and gives the room back to the chat. When the panel does hold the player, the picture keeps a sane height instead of growing with the panel.
- Messages no longer shows a second list beside the sidebar: the page is the conversation, and the sidebar you already have is the list. Right-click one of your rooms to read its chat without going in.
- The start / plan a session window uses the height of your screen again instead of stopping short above the music player.

## [2026.09.8] - 2026-09-02

### Added

- Right-click a person in the people column to message them, or a chat line to react, copy it, or queue the YouTube link in it.
- Right-click (or long-press) a room in the sidebar, a rider's tile, the stage or a track in the queue for its actions: the places of a room and leaving it, focus and message, fit / pop out / fullscreen, vote / move / remove.
- Watching together has three one-tap layouts on the Lounge — Stage, Split, Crew — so the picture or the cams get the room, remembered per device. Dragging the frame's edge still works for fine-tuning.
- Messages is a place now: every room's chat and your DMs in one list, unread
  first, and you can read and write in a room without joining it — whoever is
  in the room sees your line as if you had typed it there, and a "N new" line
  marks where you left off.
- Each rider in voice has their own volume now — from their row in the people
  column or on Members — and Join voice lives in one place, the people column.
- While you are in a room but not on its Lounge — Training, Home, a message — the sidebar shows who is with you above your own panel: cameras when they are on, who is talking, who is riding, the last to speak first.
- The sidebar names who is in each of your rooms under the room, not just how many, so you can see where your friends are before you go in.
- Every member and friend has a page now: level, energy, medals from rooms
  you share, and the rides they chose to share. Add a friend from it. Rides
  stay private until you flip one to "shared" in Rides.
- A trophy case at `/trophies`, one tap from the level tile on Home: your
  medals, ten achievements with how far along each is, where every XP came
  from, and the energy your legs have put into the trainer. XP now also
  arrives off the bike — 1 XP per five minutes in a lounge's voice channel
  (24 a day at most), 5 XP for a group session you were on the call for, and
  100–500 XP once per achievement. Riding still pays best by a wide margin.

### Changed

- A room's calendar-link reset moved under Advanced on Sessions, with a line explaining what it is for: the link carries a private key, and resetting it is for when that key leaked.
- The jukebox video plays inside the people column by default, where the deck is, instead of floating over the page; a pop-out button turns it into the draggable window when you want that, and the window has a button to put it back.
- Room icons and reactions are drawn icons now, picked from a set in Room
  settings, instead of emoji — they render the same on every device and in
  every theme. A room that already had an emoji icon or reaction keeps
  showing it as the matching drawn icon.

### Removed

- The Lounge's Leave button is gone again: the sidebar's leave icon on the room row disconnects you, and leaving a room's membership stays in its Settings.

### Fixed

- Home's "Plan a session" asks which room when you can plan in more than one, with the room you are in listed first, instead of quietly opening the first one.
- The jukebox no longer crowds the chat out of the people column: the deck is capped at under half the column, the queue shows three lines with a "+n more", and "just played" is folded until you open it.
- The start / plan a session window is wider, so the workout list and the preview stop fighting for room.
- TV mode with a video playing: the player sits in the TV's top-right corner instead of floating over the numbers.
- Joining voice, muting, turning your camera on, sharing your screen and leaving voice now sit at the top of the people column in every room, labelled — not two grey icons at the bottom of the sidebar.

## [2026.09.7] - 2026-09-02

### Added

- Your theme and light/dark choice now follow your account: pick Tron Ice on the laptop and the TV shows Tron Ice too. The light/dark/auto switch is back, on your profile next to the palette — it had gone missing with the old room rail.

### Changed

- Every page uses the full width of the window instead of a narrow column on the left: Home gets a right rail for opening rooms and what's next, workouts sit in a grid, and the ride charts sit side by side on a wide screen.
- The landing's claymation riders draw their tyres, bars and hubs in the room's own dark instead of Outrun's violet, so they sit right on Tron Ice and Miami Nights too — and a test now keeps every other colour on the theme's tokens, so a palette you pick reaches all of it.

### Fixed

- Delete and other destructive buttons are the same red in every theme instead
  of borrowing zone 6's colour, which had turned them pastel pink. Error text,
  failed-state banners and "eliminated" markers moved with them.
- Opening a direct message no longer throws an update-depth error in the console on every visit.
- The jukebox player no longer sits on top of every dialog and menu: floating, it stays under them. On the stage it now follows the stage the same frame something appears above it, and while something else is fullscreen it pauses for you instead of playing on unseen.
- You can leave a room again: a member finds "Leave room" in the room's Settings (with an undo), and the Lounge has a Leave button that disconnects you next to the TV button.
- The room you are in stays opened in the sidebar while you read a message or visit Home, so Training is one click away again instead of two.
- A theme other than Outrun no longer flashes Outrun on every page load: the last applied theme is painted before the app bundle runs.
Training zones are vivid again at the hard end. Zone 6 and 7 had faded to pale pink, so the hardest efforts were the palest thing on screen; the ramp now keeps its saturation, and every theme's zones are checked for colour-blind legibility as well as contrast.

## [2026.09.6] - 2026-09-01

### Changed

- The whole app now sits in one frame. A single sidebar holds your places, your rooms, and — for the room you are standing in — the places inside it: Lounge, Training, Sessions, Members and Settings, each with its own link. The top bar and the phone tab bar are gone, and so are five destinations: Rooms, Sessions, Progression, Ramp test and Sensors have moved into the pages they belonged to. Rides now carries the charts that were on Progression; Home carries what is planned across every room, and the forms for opening and joining one.
- Training is rebuilt around one question — am I on target. Your watts travel over a track marking the tolerance band, the interval graph runs along the bottom, and the whole crew is on screen with camera, watts, w/kg, rpm and bpm. When someone shares a screen the player takes over and your numbers move beneath it; when a sprint is armed or a game is running, that takes the screen and gives it back. The solo ride and the ramp test use the same instrument.
- Direct messages and friends are places now, not a box in the corner — a conversation shows who you are talking to, whether they are riding, and a way to join them.
- A room you are not looking at finally says so: an unread count on the rail, and the room name in bold, cleared when you open it.
- "Riding now" stops being a pink dot that read like something was broken. It is the WattRoom mark's own equalizer bars, moving.
- TV mode shows the same instrument as the training view, sized for the sofa: your watts travel over the tolerance band, so "am I on target" reads from three metres the way it reads from the saddle. One design at two distances instead of two designs.

### Fixed

- A solo ride or ramp test in light mode now darkens the whole frame, sidebar included — the ride is the cave whether or not anyone else is in it. Leaving either page mid-ride now really ends the session, so the trainer no longer keeps holding a target for a screen that is gone.
- Training: the crew strip is a row of fixed-size thumbnails again, so one other rider no longer fills the column and squeezes your instrument; sprint standings are sized for the 3 m surface.

## [2026.09.5] - 2026-09-01

### Changed

- Changelog entries are one file per pull request now, collated at release —
  so parallel work stops colliding on a single file, and an entry can no longer
  be lost in a rebase conflict.

## [2026.09.4] - 2026-09-01

### Added

- The landing page carries two live numbers: how many riders are online right
  now (it hides itself when nobody is), and the repo's real star count next to
  the GitHub link.
- `wattroom_room_riding` on `/metrics`: how many riders have sent a power
  sample in the last 10 seconds, as opposed to how many are sitting in a room.
  Anyone automating deploys can use it to avoid restarting mid-interval — a
  room between sessions no longer looks like a ride in progress.

### Fixed

- What's new no longer goes blank. Any release note that used the same code
  span twice in one line — `deploy/` did, in 2026.09.3 — took the whole page
  down with it.

## [2026.09.3] - 2026-09-01

### Added

- The room's chat now carries what the room did with its plan: a session
  planned, moved or cancelled, one starting and one finishing, and a reminder
  ten minutes before a planned session is due.

### Changed

- The room is two tabs instead of one long scroll: Room holds the shared
  screen and the rider tiles, Training holds the clock, the interval, your
  target and the graph — and a session starting takes you straight to it.
- A finished session now opens its summary over the room instead of drawing it
  below the fold, where riders watching the shared screen never saw it.
- Planning a session from the Sessions page opens the room's own picker, so
  you see the graph, the zones and the cadence bands before you commit a room
  to a workout.
- Appearance themes now recolour the whole app — surfaces, text, accents, and
  power zones — with matching dark and daylight variants instead of changing
  only two accent colours.
- The end-to-end smoke fixture is one minute of riding instead of two, which
  halves the slowest job in CI. It is a test fixture — never listed, resolvable
  by id only — so no workout anyone can pick changed length.

### Removed

- `deploy/` no longer ships an auto-updater: `wattroom-update.sh` and its
  systemd unit and timer are gone. Deploying is the operator's job — for
  wattroom.ch it lives in `janlauber/homelab` — and `deploy/` is the
  self-hosting reference and the home of the alert rules, nothing more. Pin a
  release tag in your own compose file and roll it forward however you already
  roll anything else forward.

### Fixed

- The page no longer scrolls by the height of the top nav: the room fills
  exactly what is left of the screen instead of one nav-bar too much.
- Stopping a screen share from the browser's own bar now ends it in the room.
  The button had gone on offering to stop a share that was already over, and
  the stage sat on its last frame while the room saw nothing.
- A dropped connection no longer leaves the mic button reading "on" with no
  mic behind it — which stuck permanently when the rejoin also failed.

### Security

- Corrected the 2026.09.1 note about the `/metrics` exposure: it claimed
  nothing was exposed in practice, which was wrong. wattroom.ch was already
  live, so the endpoint was public for as long as the site had been running.

## [2026.09.2] - 2026-09-01

*Reconstructed 2026-09-01: this release originally listed only the first entry
below. Six other changes shipped in it, three of them rider-visible, because
the per-PR changelog rule landed mid-flight and nothing enforced it.*

### Added

- What's new: the app shows the changelog of the version it is running, and
  says so once when a new version has landed — on the home screen, never
  during a ride.
- The room's video plays *on* the stage instead of floating over it. The
  player seats into the stage layout, and floats again — at the size and
  position you gave it — when you leave the room or scroll the stage away.

### Fixed

- Live numbers are readable on rider tiles and in TV mode. Name, watts and the
  bpm/rpm/w·kg row now sit on an edge scrim rather than on whatever the camera
  is pointing at, and TV mode no longer greys out the number while
  highlighting the unit.
- Picking a rider for the stage no longer blanks their tile. A camera track is
  deliberately mounted twice — tile and stage — and each mount was tearing the
  other one down, so both went black for as long as the pick stood.

## [2026.09.1] - 2026-09-01

*The first tagged release. WattRoom was built and deployed for months before
releases existed, so this section describes what the alpha comprises rather
than itemising the changes that got it there — those are the issue board and
the git history.*

### Added

- Solo workout player: FTMS trainer control, heart-rate/cadence/power sensor
  pairing over Web Bluetooth, a workout format with an editor and a curated
  library, interval graph with FTP scaling, a built-in ramp test, and `.fit`
  export that Strava classifies as a Virtual Ride.
- Rooms: social sign-in and profiles, persistent rooms with roles, the 1 Hz
  live dashboard, an IndexedDB crash buffer that survives a reconnect, and a
  phone spectator view behind the share link.
- Presence: LiveKit voice and camera, three room layouts plus TV mode, and a
  synced YouTube jukebox that ducks under voice — with a playlist, votes and
  play history.
- Stats and the game layer: the one-transaction ride completion pipeline, FTP
  auto-detection, a live execution meter, medals, room streaks and challenges,
  and sprint moments.
- Seven game modes with their own heroes, room-level sound packs, cheers and
  quick reactions.
- Friends and presence, direct messages, and room chat with image support.
- Personal read tokens and an MCP endpoint for your own data (ADR-0017).
- Production deploy: a single-VM compose stack behind Caddy, nightly `pg_dump`,
  tagged releases, and a systemd timer that converges the VM onto the pinned
  release and rolls itself back if the new one fails its health gate
  (ADR-0019).

### Changed

- `/api/healthz` performs a real database ping instead of always answering
  `ok`, and `/api/version` reports the release tag it was built as — both so a
  deploy can be gated on them rather than on hope.

### Security

- `/metrics` is no longer proxied to the public internet. Until this release
  wattroom.ch served rider counts and Go runtime internals to anyone who asked
  for them.

  *Corrected 2026-09-01.* This entry first claimed the exposure was caught
  before wattroom.ch was ever deployed and that nothing was exposed in
  practice. That was wrong — the site was already live, so the endpoint was
  reachable for as long as it had been running. The fix itself is unchanged;
  only the claim about impact was false.

[Unreleased]: https://github.com/natrontech/wattroom/compare/2026.09.33...HEAD
[2026.09.33]: https://github.com/natrontech/wattroom/compare/2026.09.32...2026.09.33
[2026.09.32]: https://github.com/natrontech/wattroom/compare/2026.09.31...2026.09.32
[2026.09.31]: https://github.com/natrontech/wattroom/compare/2026.09.30...2026.09.31
[2026.09.30]: https://github.com/natrontech/wattroom/compare/2026.09.29...2026.09.30
[2026.09.29]: https://github.com/natrontech/wattroom/compare/2026.09.28...2026.09.29
[2026.09.28]: https://github.com/natrontech/wattroom/compare/2026.09.27...2026.09.28
[2026.09.27]: https://github.com/natrontech/wattroom/compare/2026.09.26...2026.09.27
[2026.09.26]: https://github.com/natrontech/wattroom/compare/2026.09.25...2026.09.26
[2026.09.25]: https://github.com/natrontech/wattroom/compare/2026.09.24...2026.09.25
[2026.09.24]: https://github.com/natrontech/wattroom/compare/2026.09.23...2026.09.24
[2026.09.23]: https://github.com/natrontech/wattroom/compare/2026.09.22...2026.09.23
[2026.09.22]: https://github.com/natrontech/wattroom/compare/2026.09.21...2026.09.22
[2026.09.21]: https://github.com/natrontech/wattroom/compare/2026.09.20...2026.09.21
[2026.09.20]: https://github.com/natrontech/wattroom/compare/2026.09.19...2026.09.20
[2026.09.19]: https://github.com/natrontech/wattroom/compare/2026.09.18...2026.09.19
[2026.09.18]: https://github.com/natrontech/wattroom/compare/2026.09.17...2026.09.18
[2026.09.17]: https://github.com/natrontech/wattroom/compare/2026.09.16...2026.09.17
[2026.09.16]: https://github.com/natrontech/wattroom/compare/2026.09.15...2026.09.16
[2026.09.15]: https://github.com/natrontech/wattroom/compare/2026.09.14...2026.09.15
[2026.09.14]: https://github.com/natrontech/wattroom/compare/2026.09.13...2026.09.14
[2026.09.13]: https://github.com/natrontech/wattroom/compare/2026.09.12...2026.09.13
[2026.09.12]: https://github.com/natrontech/wattroom/compare/2026.09.11...2026.09.12
[2026.09.11]: https://github.com/natrontech/wattroom/compare/2026.09.10...2026.09.11
[2026.09.10]: https://github.com/natrontech/wattroom/compare/2026.09.9...2026.09.10
[2026.09.9]: https://github.com/natrontech/wattroom/compare/2026.09.8...2026.09.9
[2026.09.8]: https://github.com/natrontech/wattroom/compare/2026.09.7...2026.09.8
[2026.09.7]: https://github.com/natrontech/wattroom/compare/2026.09.6...2026.09.7
[2026.09.6]: https://github.com/natrontech/wattroom/compare/2026.09.5...2026.09.6
[2026.09.5]: https://github.com/natrontech/wattroom/compare/2026.09.4...2026.09.5
[2026.09.4]: https://github.com/natrontech/wattroom/compare/2026.09.3...2026.09.4
[2026.09.3]: https://github.com/natrontech/wattroom/compare/2026.09.2...2026.09.3
[2026.09.2]: https://github.com/natrontech/wattroom/compare/2026.09.1...2026.09.2
[2026.09.1]: https://github.com/natrontech/wattroom/releases/tag/2026.09.1
