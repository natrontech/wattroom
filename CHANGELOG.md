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

## [2026.09.79] - 2026-09-09

### Fixed

- The room on a phone: when the browser is waiting for a tap before it plays the room's audio, or has refused the microphone, the fix is now on the page itself instead of behind the hamburger; the Lounge no longer scrolls sideways when something is on stage and its last row clears the floating buttons; a spectator is no longer offered "Join the ride"; the rider you follow is named during a sprint or a game and can be un-followed by tapping their tile again; a `?full=1` cockpit now survives moving between places; Escape closes the drawer without also dropping the rider you follow; and the reconnect banner's button gets its own row at phone width.
- On a phone, a long-press opens the menu even when your thumb drifts a few pixels, and the hover-only edit/copy/react buttons on messages no longer sit invisible but tappable on touch — the long-press menu is the touch path.

## [2026.09.78] - 2026-09-09

### Changed

- The end-of-ride summary shows how it went — your power second by second against your FTP line — and, after a group session, who rode with you and how each held target. The power curve only lists the windows the ride was long enough for and says which need a longer ride, instead of showing dashes.

### Fixed

- From tonight's first rides: the ramp test's gauge is scaled to the test's own top instead of your current FTP × 1.5, so the bar keeps moving through the hard steps rather than pinning early; the "Single-speed setup (Zwift Cog)" checkbox now says what it does — "Sprints stay in ERG — don't make me shift" — with a hint, and hides the sprint grade it makes irrelevant; the execution bars in the room's roster carry their name; and the FTP trend chart explains what it needs before it can draw a line worth reading.

### Security

- Sign-in follow-ups: passkey sign-in and the monitor's token are limited per address so one stranger cannot lock everyone out or guess forever; removing a passkey or disconnecting a provider signs the account out everywhere else, and Settings › Profile has a "Sign out everywhere else" button for the day an alarm mail arrives; and the address confirmation's "Send again" counts down the two-minute window instead of appearing to send and doing nothing.
- Sign-in hardening: the developer login only opens on a local address and never answers a cross-site request, an unknown API path answers a proper 404 instead of the app shell, every response tells browsers the app may not be framed and that a link's full address is not passed on to other sites, the confirm-address page is never cached or leaked through a referrer, and checking whether an address is already taken now costs the same budget as sending a mail.

## [2026.09.77] - 2026-09-09

### Fixed

- The desktop app can pair a trainer again. It was cancelling every attempt
  before the scan had heard anything — the first one because Bluetooth is still
  waking up, all the later ones because the list starts out empty — and telling
  you that you had cancelled it. It now waits for your trainer to answer, and
  says to wake the sensor when nothing does.
- In an elimination game, a rider whose connection drops and comes back with their buffered pedalling is no longer knocked out for the silence — the reconnect proves they kept riding, as the rules promised. A rider who leaves the room leaves the game too: Team Relay hands the front to someone still here, and neither a game podium nor a sprint podium is topped by someone who closed their tab.
- A sprint and a game are visible wherever they are audible: the Lounge shows the sprint countdown and the game panel while they run, and TV mode carries the game beside its sprint layer. A rider knocked out of an elimination game is told so in their own panel, their tile says "out", and the reconnect banner counts down the game's 30-second disconnect grace so a Wi-Fi blip is not a mystery.
- A finished game is announced on the room's timeline ("Ada won Watt Golf"), counted for its winner like a won sprint, and its podium stays up for half a minute before the room lets the game go — it used to sit on every tick until the coach pressed End. Sprint Roulette's battles now run at the sprint's fast tick, and its window's start rides the tick so the 3-2-1 can follow.
- Game podiums are fair on a tie: two riders on the same strokes, points, w/kg or lives used to get a winner picked at random by the server; now the earlier id wins, the same rule the sprint podium already used. Every game mode advances once a second even while a sprint's fast ticks run, so Team Relay's distance no longer quadruples when the coach arms a sprint mid-game; a game keeps its riders' names and FTPs across a session start; and the coach hears which of two things went wrong when a game cannot start.
- The session picker is a proper dialog for keyboard and screen-reader use: named, modal, and focus stays inside it until it closes.
- Game modes work on screen again: a game started without a workout session now shows its panel on the Training place instead of "Nothing is running yet", and the coach's controls carry an End game button so a game can always be stopped. Sprint Roulette sounds its klaxon. Game clocks and Watt Golf's count-in follow the server's clock, not the laptop's. On a phone, the sprint overlay shows the rider you follow, not your own zero. The Lounge's sprint, pause and end buttons are thumb-sized, the disabled sprint button says why, and starting a game gets a full-size button.
- Your LTHR follows your account like FTP and weight: set it after a ramp test in one browser and the desktop app and every other device show it too, with heart-rate zones coloured everywhere. An LTHR you had set before this stays and is carried up to the account on the next visit.

## [2026.09.76] - 2026-09-09

### Fixed

- "Export everything" now carries your medals, every field the ride page shows (normalised power, whether execution was scored, the room, the sharing flag), and a manifest written last that lists what went in — so an archive that was cut short is recognisable as one.
- "Keep my current FTP" is remembered: declining a suggested FTP no longer brings the card back on every visit, and the suggestion now appears on the Rides page above the FTP trend, where you are looking at the curve. The training-load chart names the right day west of Greenwich. A rider page that does not exist, or is not visible to you, says so with a way on instead of a Retry that could never work, and the ride page says when your 30- and 90-day bests could not be loaded.
- Rides beyond the first hundred are reachable again: the Rides page loads older rides on request instead of stopping quietly at two hundred, an exported .fit is named by its day and workout instead of an id, and the Strava sign-in failure now points at Settings › Profile, where the Strava connection actually lives.
- Room rides are dated when the session started. With riders in the room the saved ride was usually stamped at the session's end — the moment a rider's own numbers crossed the finish line, the clock the save read had gone back to zero — and the same slip hid the group-session voice XP. A session that ends with nobody in the room now leaves its "ended" line at the time it ended, not when the next person walks in.
- A ramp test is a ride: it is buffered against a crash like any workout and saved to your history when it ends, so its fifteen hard minutes count as training load and can be opened, exported and compared. Saving a ramp's FTP now reports success only once your account has it. And a room ride you left by closing the tab no longer comes back as an "unfinished ride" to recover on the solo screen — the room's buffer opens with the session and closes with it, named after the workout.
- In a room, the end-of-session summary is yours and this session's: riders who were not the coach used to see the warm-up's numbers folded into the main set's summary, and a rider who joined ten minutes in never got the "See your ride" link. The Sessions place now says when past sessions are still loading, could not be loaded (with Retry), or do not exist yet, instead of showing nothing. And when a session ends, the Training place says where its recap went.
- The solo ride's finish is tidier: "Ride complete" (a session is a group ride), the summary says "Saving…" while the ride goes to your account instead of reshuffling its buttons, a ride you ended by leaving the page reports its save as a toast instead of in silence, a ride with nothing recorded says so instead of showing zeros, execution shows a dash when the workout had nothing to score, and normalised power under 20 minutes is the plain average — the same number the ride page shows. A ride saved from the recovery card no longer stays as a second copy on the device, and a finished ride lets go of the trainer so the next pairing starts clean.

## [2026.09.75] - 2026-09-09

### Added

- The navigation sidebar's width is yours to set: drag its right edge, the
  way the room's people-and-chat panel already resizes from its left edge, and
  it stays where you put it on this device.

### Fixed

- Screen readers hear more of the app: banners and toasts announce themselves when they appear (errors interrupt, the rest waits), dropdowns say which value they hold and which row the arrows are on, the sidebar names the room you are in, every message thread is a log, and unlabelled inputs (room name, crew code, the chat composer, passkey and token names, the flag note) have names. The first Tab on any page offers "Skip to the page" past the sidebar. Cheers, the recording dot and the paused-session pulse hold still when the system asks for reduced motion, and the small edit/copy/react and reaction buttons grew to the 24 px floor.
- The two resizable seams — the room's panel and the navigation sidebar — can be moved from the keyboard: Tab to the divider, then the arrow keys move it a step at a time.
- Keyboard use in a room works as it should: with push-to-talk on, Space still clicks a button you tabbed to (a mouse-focused button leaves Space to the mic as before); the phone's closed navigation drawer no longer catches Tab or scrolls the page, opens with focus on its first row, and closes on Escape; the email gate, TV mode and the people sheet keep focus inside them and hand it back; a confirm dialog focuses Cancel first instead of the irreversible action; and Escape closes one layer at a time instead of every open one.
- When the room connection stays down past the 15 seconds the app spends retrying, the banner now says so and grows one big Reconnect button that dials at once — for the rider whose Wi-Fi just came back on another network. It no longer reloads the page, which would have dropped the trainer mid-ride. The automatic retry keeps running underneath either way.

## [2026.09.74] - 2026-09-09

### Fixed

- An uploaded track on the deck now shows its length and a working seek bar from the first second, for every rider in the room — one still loading the file, muted or sitting out included. The waveform seat draws a plain line until the track's own shape has been read, instead of a placeholder that looked like one (#1509).
- Two riders with the same display name no longer break TV mode or the execution meter mid-ride.
- The app loads faster on a slow link: the server compresses its own scripts, styles and pages instead of leaving that to a proxy, and the shell and the changelog are revalidated with a tag instead of re-downloaded on every visit.

## [2026.09.73] - 2026-09-09

### Fixed

- Home's *Around right now* no longer lists you as someone to join — a room where you stand alone reads as quiet, and the headline stops inviting you to join yourself.
- A Strava upload that timed out no longer retries every five minutes forever with nothing shown on the ride: each attempt is counted and its reason kept. A deploy that lands the moment a session ends now waits for the room's rides to save instead of losing them. Session reminders are sent with a budget per session, so one slow mail provider cannot leave the rest of a busy hour unreminded, and a stuck XP or voice-clock write can no longer stop XP for good.
- A finished session's recap card is retried like the ride save instead of being lost on a database blip, and a session leaves exactly one. Ride mail only ever goes to a confirmed address. Abandoned chat images are swept on the clock, the daily sweeps run in bounded batches with a budget each, and a server that cannot reach its database at boot fails within a minute instead of hanging silently — while the token backfill no longer holds up the listener.

## [2026.09.72] - 2026-09-09

### Fixed

- Controls you reach from the bike are 44 px tall now: mute, camera, share and leave voice, Join voice and Away in the sidebar, the room's cheer buttons, a game's End game, and the stage's source picker and zoom cluster. Your own heart rate wears its zone colour in a room as it does solo, a game's line and the front rider's name no longer glow like live data, and two rider-tile states that could never appear — including a hard-coded "synced to 24:07" chip — are gone.
- In a room, the session's controls and the way into a running ride are on the Lounge in every phase, not only before it starts. Every place now hears a block change, the spiral release, a game's cues (your turn on front, a life burning, the podium) and the session ending; the spiral release, a refused command and a voice connection that failed are persistent status on screen with the one button back, and the Training place says the session has ended instead of asking you to pair a trainer.
- Mid-ride on the Training place: a game shows your own watts beside its panel (Watt Golf still hides them on purpose), a block's cadence or heart-rate band shows in the header coloured by your live value, the sprint podium hands the instrument back eight seconds after the window instead of thirty, TV mode carries the room's status banners and the sprint over its numbers, cheers no longer drift across the video player, and the session summary waits for a minute of riding before it opens.

## [2026.09.71] - 2026-09-09

### Fixed

- The live execution meter shows a dash until something scorable has been ridden, instead of a 100 % the saved ride then contradicts; Lanterne Rouge's "but completed the session" now means the ride reached the workout's final segment.
- The "name your crew" set-up step now retires when the crew is actually renamed, not when its owner changes their own display name, and a crew deliberately named after its owner stops nagging. The sign-in page says up front that a new account confirms an email address, and the address gate tells an invited rider their crew door is waiting right behind it.
- A failed load no longer pretends: Home says when your rooms or rides could not be read instead of showing "open your first room" to a rider with ten rooms, a room's settings show a loading state instead of nothing, the app opens on its mark instead of a blank screen, a workout of yours that fails to load is said rather than swapped for Sweet Spot 2×20, your own page's Retry works again, "Banned" and "Calendar link reset" wait for the server's answer, the data export fails inside the app instead of replacing it with an error page, and a failed "Show more" in the directory keeps the rooms already listed.
- Failures are said where you are looking: a refused profile save is a red banner naming the field instead of a grey line that reads like "Saved.", a failed account purge or export says the server's reason beside its button, a room, its settings, its autoplay panel, the workout editor and What's new offer Retry instead of a sentence about reloading, the ride summary keeps "your ride is only on this device" even if an export fails, and a refused crew code sits above the code field rather than the room form.

## [2026.09.70] - 2026-09-09

### Added

- A library track in the queue shows its bpm, and while a session runs the
  tracks whose tempo fits the block's cadence — or double it — say "fits the
  block". Smart autoplay already weighed this; now you can see it.

### Fixed

- A crew ban now takes the person off every room roster in the crew, as the crew rules always said, and lifting it restores crew membership alone. A crew admin can no longer add someone to the crew by user id — joining by the code is the one way in. The crew door and a room's door tell a removed rider so instead of offering a Join that fails, the crew page says how many are in the crew rather than how many you can see, and promoting someone no longer resets the day they joined or their place in the succession line.
- Leaving a crew now asks first and names what goes — the rooms of it you are in, and that a private room needs a fresh invitation — instead of offering an undo that only rejoined the crew. A rider the crew removed is told so at the crew's door and at its rooms' doors, with no Join that would fail. The crew page shows how many are in the crew, the owner sees why Leave is disabled, "Open a room here" on a crew with no rooms yet opens it there, opening a crew's page puts the sidebar in that crew, and the crew settings page can retry a failed load and says when a name is missing.
- A crew whose last room was deleted no longer vanishes from the sidebar: its code, its people, its settings and the way to leave it stay reachable, and its owner's next room opens in it.
- The first hour reads better: Workouts stays lit under a ride or a ramp test and the crew row lights on the crew's own pages; a member in a room's Training place is no longer told to start a session they cannot start; Join voice says the room's audio is never recorded and the mic opens when you speak; Home's biggest button before the first room is Open a room, its empty-state copy knows when you already joined a crew, and the calendar subscription waits for a room to plan in; the sidebar's red "Leave the room" is now "Disconnect", which is what it does; the pre-ride FTP field accepts the same range as the profile; the day-one crew-name toast is gone, since Home's set-up card already carries it.
- "Just played" survives a restart. The room's last five used to live only
  in the server's memory and vanished with every deploy; now every play —
  YouTube videos too, not only your own tracks — is written down, and a room
  coming back up shows what it last heard until it plays something new.

## [2026.09.69] - 2026-09-09

### Added

- Pick several tracks in your library at once: a checkbox on every row, then
  queue them all in the room you are in or save them all to a playlist in
  one go.
- Your playlists are on the Music page now, beside your tracks: make one,
  open it to see and reorder what is in it, add to it by searching your
  library or pasting a link, and queue it when a room is open. Until now they
  were only reachable inside a room's jukebox.
- Anything in the queue, in "just played" or in your library can be saved
  to a playlist from its right-click menu — "Save to «Threshold Tuesdays»",
  one line per room playlist and per playlist of your own. Under up next,
  "Save as a playlist" keeps what the room is hearing tonight, the deck and
  everything behind it, as a new room playlist named for today.

### Fixed

- A room session whose last rider closed the tab before the timeline ran out is saved when it ends, dated when it ran — it used to wait for the next visitor and take their date, or never save at all. A reconnect's replay is refused from a screen that no longer holds the trainer, carries up to an hour instead of ten minutes, and a long replay or a large workout pick no longer closes the socket.
- A solo ride whose save timed out and was then saved from the recovery card no longer lands on your history twice. Leaving the ride page mid-ride saves what you rode instead of leaving it for the recovery card. The room ride buffer keeps one row a second however fast the trainer reports, so a replayed drop and a recovered .fit no longer count double, and joining rooms no longer pushes an unsaved solo ride out of the crash buffer.
- After a Wi-Fi drop in a room, the reconnect replays every sample from the last one the server confirmed — the seconds the browser thought it had sent while the connection was already dead used to be missing from the saved ride.
- A solo ride records one sample per second however often the trainer reports, so its duration, kJ, power curve and XP no longer scale with the trainer's notification rate. A friend's shared ride and the rides trend say "not scored" instead of "0 % on target" for a session whose workout prescribed nothing.
- The score a ride is saved with excludes the same stopped seconds the live meter does (under 5 rpm and under 20 W), so the number you watched all session is the number you keep. Medals need two riders who actually rode: one working power meter beside two dead ones could take Diesel, Hammer and Lanterne Rouge at once. A sprint podium ranks only riders with five seconds in the window, never a two-second burst. Streak weeks are counted in one timezone on both sides, so riding last week counts as last week wherever the server sits. Saving the same ride twice — a retry after a lost answer, on your own or in a room — no longer makes two rides, two helpings of XP or two medals.

## [2026.09.68] - 2026-09-09

### Added

- Right-click (or long-press) a track in your library for its menu: queue it
  in the room you are in, edit it, or delete it. The buttons are still there;
  the menu is the shortcut, like everywhere else in the app.
- A saved playlist can be reordered: right-click (or long-press) a track in
  it for Move up and Move down, the way the queue's rows already have them.
- A saved playlist can hold your own music now, beside YouTube links. The add
  field on a room or personal playlist is the same one the jukebox has —
  search your library or paste a link — and a library track in a playlist
  shows its title and artist as the Music page has them. Queue the playlist
  and its tracks play in the order you saved them; delete a track from your
  library and it leaves every playlist it was in.
- The jukebox's add box searches your library. Type a title or an artist and
  the matches appear under the field, each with a queue button; Enter queues
  the top one. A pasted YouTube link works exactly as before. Until now your
  own music could only be queued from the Music page, a screen away from the
  room that wanted the song.
- Settings › Notifications has a "Send a test notification" button, so you can
  see what one looks like — and let macOS ask its permission while you are
  watching — instead of waiting for a friend to message you.

### Changed

- Autoplay is set up on the room's Settings page now — on or off, ordered,
  shuffled or smart, and which playlist it walks — instead of inside the
  jukebox column. The jukebox still says what autoplay is set to, and a room
  playlist's menu still makes it the active one. The "fixed start" option,
  one pinned video played before the playlist, is gone: the first track of
  the active playlist is the start.
- Autoplay's Smart order follows the room's active playlist: it draws from
  that playlist's library tracks, weighted by what the room plays and skips,
  instead of ignoring the playlist and picking from every library in the
  room. With no active playlist it draws from the whole library as before.
  Ordered and Shuffled already play a playlist's library tracks alongside
  its videos.
- A track from your library on the deck shows its waveform in the jukebox
  and on the rail, the part already played lit, instead of a music icon in a
  box built for a video.
- The jukebox column is tidier: what is up next sits right under the add box,
  the saved playlists come after it, playlist rows are rows rather than boxes,
  and "Skip for me" and "Stop for me" are bike-sized buttons instead of two
  lines of small text.
- Your uploaded music is called your **library** everywhere now. The Music
  page and the jukebox used to call the same thing the pool, the shelf and the
  record shelf, and the glossary had no word for it at all.
- The sprint's klaxon, gun and fanfare now sound wherever you are in the room, not only on Training; auto-pause and the resume countdown say so out loud, the way a shared pause does. Re-pairing a dropped trainer from the mid-session strip is a full-size button. A medal card shows its big number only when it is the medal's own metric (Metronome's execution score), and the sprint button wears the structural accent, keeping the live hue for live watts.
- The workout editor is easier on a phone and at the desk: your steps come first, then the step you are editing, then the library; cadence and heart-rate bands fold away unless a step carries one; a problem with a step is said under that step (with "Show the step" from the banner when it is elsewhere); Undo and Redo have buttons; deleting a step keeps you on its neighbour; a refused save says so with a way to try again; saving confirms with a toast that rides the workout. Edit and Delete on your workouts, and the session picker's Close, are proper buttons.

### Fixed

- An account holds at most ten passkeys, like ten tokens; the desktop sign-in hand-off refuses when its queue is full instead of growing without bound; and one account can keep at most sixteen live connections to the server open at once, which is plenty for every device and tab and stops a single account from loading the room service.
- The three-room cap, the 2 GB track quota and the 100 MB clip quota now hold even when requests arrive at once: each is counted with your account locked, in the same transaction that writes, so a burst of parallel creates or uploads can no longer slip past it.
- Direct messages in the sidebar, the thread list and the DM header now show whether a friend is online, offline, in a room or riding — the same badge the friends panel shows. A friend with the app open used to show no badge at all unless they stood in a room you could see.
- A conversation left open behind another window no longer swallows its
  messages. A room chat or DM thread that is open while WattRoom sits behind
  another app now blips and notifies like any other, instead of being treated
  as read in front of you.

## [2026.09.67] - 2026-09-09

### Added

- Saved rides now explain how to try importing their FIT file into Garmin Connect,
  including recorded heart rate, retry guidance and the current validation limits.

### Fixed

- A Strava upload that fails now tells you which of three things happened — reconnect Strava, the file was refused, or Strava could not be reached — instead of the provider's raw error text. Removing or re-roling someone who is not in the room answers "not in this room" instead of pretending it worked; a banned rider is unbanned, not removed. A database hiccup while sending a message, leaving a crew, handing a room over or letting someone in is reported as a hiccup with a retry, never as "they are banned" or "you own a room here", and it can no longer wave the three-room cap through. Your display name is counted in characters, not bytes, and trimmed, so a Cyrillic or Japanese name of normal length is accepted and a name of spaces is not. The feedback flag's cool-down follows your account rather than your display name, and what you type in a flag can no longer format itself on the public issue tracker.
- In a room: the sprint podium is scored on the best five seconds, not the best five trainer packets, so riders on fast-notifying trainers no longer win on a shorter window; a coach's Start pressed while a session is already running no longer erases the running ride's record; the live execution meter leaves out stopped seconds the way auto-pause defines them (under 5 rpm and under 20 W), so it agrees with the saved ride; a workout picked for the room is held to the same rules as one saved in the editor, with the refusal naming the step; a track title or device label with non-Latin characters no longer ends in a broken character.
- Openers' three raises are 15-second sprints, the sprint moment the app defines, instead of a minute all-out each — an opener is meant to wake the legs, not spend them.
- The session summary counts a ride once per second however often the trainer reports, so the kJ on a medal card no longer doubles on a fast-notifying trainer, and the card shows the ride's real XP instead of "0 XP". Your medal is matched to you by id and to this session by the server's clock, so a session ending after midnight finds it. "Lost the room" no longer flashes on the way into a room; it appears only while reconnecting. The sprint countdown on screen runs on the server's clock, the same one the trainer's slope flip uses. A coach on a narrow window keeps the game controls beside the session's. The live leaderboard no longer drops a rider who coasts for a moment.

## [2026.09.66] - 2026-09-09

### Added

- Your own calendar link is on Home, under What's next: one subscription that carries every session planned in every room you are in, and follows you when you join or leave a room. It was built as the calendar the app offers first and then never offered — the Sessions place only had the room's link, so a rider in four rooms subscribed four times. The room's link stays for what it is, a club schedule to hand to people outside the room, and says so.

### Changed

- The Friends page says what a friend actually sees: that you are online, in a room, or riding — never what you are pushing.
- Handing a room over and banning someone from it no longer hide behind a right-click: an owner's Members row has a ⋯ button that opens the same menu. On the crew's page, every room row shows its owner and admins an "Open to the crew" / "Make private" button — the row an admin came to act on used to look disabled with its only action in the menu.
- Small things on the pages outside a room: the Friends page's dismiss, cancel and remove are proper buttons, the ramp test's "I'm done" is sized for a hand on the bars, and its errors read like everywhere else's.

### Removed

- The old addresses `/profile`, `/pair` and `/trophies` are gone: they have redirected to `/settings/profile`, `/settings/equipment` and `/u/me` since 2026.09.63, every link the app and its emails send has pointed at the new ones since 2026.09.64, and a bookmark from before that now lands on "no such page" rather than a silent hop.

### Fixed

- The ramp test no longer ends itself during the warm-up: five seconds of spinning up, or soft-pedalling under the warm-up's target, used to count as blowing up and land on "you stopped after 0:05". Leaving a running ramp test asks first, the way leaving a ride does. The Friends page, the ride comparison, the sign-in gate and a crew's invite link all say when something could not be loaded and offer a retry, instead of "loading…" forever, "could not be loaded" while still loading, "no sign-in providers are configured" for a server that could not be reached, or a dead invite for a network blip. Clearing the rides kept only on this device asks first. The public rooms directory shows more than its first fifty rooms.
- A workout saved through the API is held to the same rules as one built in the editor — step lengths, targets, watts, cadence and heart-rate bands, repeat counts — so nothing can be stored that your shelf then refuses to show; the refusal names the step. The editor, in turn, now says when a workout would run longer than a day (the server's limit) instead of letting Save be refused. If older saved workouts cannot be read by this version, the Workouts page says how many rather than hiding them.
- Workouts: the server now refuses a workout that would expand past the engine's limits (more than 50 repeats, nested deeper than four, more than 200 blocks) instead of trying to build it — the editor already enforced those numbers, the API did not. Your shelf says when it could not be loaded, with a retry, on the Workouts page and in a room's session picker, instead of claiming you have no workouts. Opening a saved workout that could not be found no longer lets Save overwrite it with a blank sheet, and loading a library copy saves beside the workout you opened, never over it. Undoing a delete says so if it fails; starting a planned session whose workout can no longer be read says so instead of doing nothing; a database hiccup while saving is a "try again", not "that workout does not exist".

## [2026.09.65] - 2026-09-09

### Added

- A planned session has a right-click menu (long-press on touch), like a rider's tile or a track: say you're in or out, copy the link to the room's Sessions place, and — for a coach — start it now, move it or cancel it, with the greyed entries saying why ("not due yet", "a session is running"). The buttons stay where they were; the menu is the shortcut.

### Changed

- Your profile picture is yours to change: Settings › Profile now takes an upload (PNG, JPEG, WebP or GIF, shrunk before it leaves your browser). The row of preset icons is gone — a rider who had picked one shows their sign-in photo again, or their initial.
- The Sessions place tells a member what sessions are and who plans them instead of asking them to plan one; there is one "Plan" button, not two; a long list of riders who are in ends in "+N more"; past sessions sit flush with the panels above them. A room's Members row removes with a proper button. A room's settings page confirms a delete through the same dialog as everything else and toasts a refused save where the control is, then re-reads the room so the form does not keep values the server declined. A crew with no rooms says what a room is and who opens one; the leave button knows you own a room here before the room list has landed; "Make admin" reads the same in the row and its menu; the settings page says what actually happens to a crew when its owner goes.
- Session times say "Today 19:30" and "Tomorrow 19:30" the way the planner's picker does, wherever a planned session is named — the Sessions place, the Lounge card, the sidebar, the chat line and the toasts; beyond that, the weekday as before. Home's "What's next" now carries the date too, so next week's session no longer reads like tomorrow's, and its row opens the room's Sessions place.

### Fixed

- Demoting a crew admin to member, or lifting a crew ban, no longer drops them out of the crew: membership is kept, as the crew page and its rooms expect. Inside a room, a refused action — a hand-over over the cap, a plan the server declined, an RSVP on a session that is gone — now says why in a toast instead of doing nothing. Planning, moving and RSVPing confirm with a toast; cancelling a planned session asks first (its RSVPs go with it and the old undo quietly created a new session and mailed everyone again) and is called "cancel" everywhere. "Start now" is offered only while nothing is running, so it can no longer wipe your own recording mid-ride, and a phone never sees the planning controls. A moved session is reminded again for its new time. A failed load of the planned sessions is an error, not an empty "plan the first session". The crew page keeps what it shows if a background refresh fails and offers a retry when the first load does; picking a crew icon keeps the name you were typing.
- The Members place counts a rider's medals for real: every medal the room ever awarded them, by rider. It used to match display names over the 24 most recent awards, so the number shrank as the room rode on and two riders with one name shared a count.

## [2026.09.64] - 2026-09-09

### Changed

- The "direct messages" heading in the sidebar now folds the list away and
  back, and remembers it on this device. A folded list still shows a dot when
  someone wrote. (#1359)
- Your own rider page says each number once: the level and its lifetime XP sit in the header, achievements sit beside your rides, and the medals list no longer repeats the shelf below it. A new account sees one empty state with the way to fill it, and a trophy case that failed to load says so with a retry. The row with your name in the sidebar opens your page and lights up while you are on it. The settings sections share one panel, and Equipment's buttons are sized for browsing, not for the bike.

### Fixed

- A room row in the sidebar that says "12 min in" now lands on Training, where the ride is, instead of the Lounge — unless you are already standing in that room.
- Connecting Strava, GitHub or Google from Settings shows its outcome again — connected, already taken, already linked, or failed — which the move to /settings had silently dropped. The room's Sound panel's link to Voice & audio now closes the panel and lands on the gate. Notifications say when a browser cannot show them or has blocked them instead of a blank section or a button that does nothing; a failed load of your coach tokens says so with a retry instead of reading as "no tokens"; your own rider page no longer draws the achievements twice, and a failed look-up of who you are shows an error instead of loading forever. Emails and alerts from the server point at the new settings address.

## [2026.09.63] - 2026-09-09

### Added

- Every end links forward: a finished ride's summary offers "See your ride" — the ride's own page — as soon as it is saved, in a room and solo; the room's summary shows after any session, not only long ones; the ramp result points at the workouts and plans its new FTP rescaled; Home's recent rides open the ride itself; the room's Sessions place lists past sessions; and a room's door you cannot open has a way back.
- Home shows one notice at a time — your new account, the desktop app, then what's new — and dismissing one reveals the next, instead of stacking up to four above your numbers. A rider who owns a crew gets a short getting-set-up card (pair your trainer, name your crew, invite someone) that crosses each step off as it is done and leaves when the last one is. "Open a room" opens the form instead of scrolling to it, and the empty Friends heading is gone.

### Changed

- The crew is now the first row of the sidebar, drawn as the header it is,
  and the WattRoom logo left the column: the tab and the title bar carry it,
  and your avatar already shows when you ride. Room names are set in the same
  type as the rest of the navigation, with the room you are in a step bolder,
  and "direct messages" shows that it goes somewhere. (#1327)
- The Lounge holds the room's action: a coach starts the session there with the same controls Training has, a rider joins a running one from there, and "Join the ride" from Home or a rider's page lands on Training, where the numbers are. Planning a session has one home, Sessions; the Lounge links there.
- Settings have an address: /settings, with a section per page — Profile, Equipment (your sensors and the ramp test), Voice & audio, Appearance, Notifications, Your data — so every part can be linked to, and the sidebar's gear says Settings and lights while you are in any of them. The trophy case moved onto your own rider page, /u/me. /profile, /pair and /trophies forward there for one release.
- A room's unread count is now the way to read its chat without walking in;
  the right-click entry that used to be the only door is gone. (#1328)

## [2026.09.62] - 2026-09-09

### Changed

- Your voice goes out clean: no noise suppression, Opus at full bandwidth, and no comfort noise between sentences. The gate still keeps the fan out of the room while you are not talking, and echo cancellation stays on for riders on speakers.

### Fixed

- A clip fired from the soundboard can be stopped: press the glowing pad, or its key, again and everyone in the room hears it end. Before, the only way out of a wrong pad was to wait it out.
- Every voice in the room is heard once again. From your first click after joining, each rider's voice was also playing a second time a few milliseconds behind itself — the phaser sound, and the doubling when hopping between rooms — and the per-rider fader only caught one of the two.

## [2026.09.61] - 2026-09-09

### Fixed

- The message box of a conversation that is not open yet says where things stand — you asked and they have not answered, they asked and it is your move, or you are not friends yet — instead of "add them" in every case.
- Every page names its browser tab now — "Home · WattRoom", the room's name for any of its places, the workout or ride you are looking at, the friend you are messaging — instead of the bare address on most of them.
- A ride the server refuses for good — under a minute — no longer comes back on the recovery card after every reload, and the words stop promising a save that would be refused again; Rides' "on this device only" now says both reasons a summary can end up there.

## [2026.09.60] - 2026-09-09

### Fixed

- Pasting a friend's eight-character code into "Join a crew with a code" now says it looks like a friend code and that friends are added on the Friends page, instead of "no crew has that code".
- A conversation with someone who is not your friend yet says so under the message box, with the box disabled, instead of refusing the line after you typed it.
- A conversation opened from a notification, a pasted link or a reload no longer says "Message them…" with a "T" for a face until the first line arrives: the page looks the rider up and shows their name and picture straight away.
- The download page, opened from a desktop app that updates itself, no longer reads as if you had to download the newer build by hand: it says the app is fetching it and that the restart is on Home.
- Pasting a crew's six-character invite code into the friend-code box now says it looks like a crew's code and that a crew is joined from Home, instead of "no rider has that code — double-check it with them".
- Home's "Join a crew with a code" no longer trims a pasted friend code to six characters and sends it: it says the eight characters look like a friend code and points at Friends.
- The Lounge's "Invite" button copies the crew's invite link in one click instead of sending you to the Members place to find it there.
- The room's calendar link on the Sessions place is a proper row now — one line saying every planned session lands in your calendar app, and a "Copy calendar link" button — instead of an eleven-pixel link floating under the list.

## [2026.09.59] - 2026-09-09

### Added

- The desktop app updates itself: the next release downloads in the background and installs when you restart, with a _Restart to update_ note on home once it is ready. Never during a ride. The 2026.09.4 build is the last one you install by hand.

## [2026.09.58] - 2026-09-09

### Added

- Opening a crew's invite link while signed out now shows whose crew you are joining on the sign-in screen — its name, picture and how many ride there — instead of a bare sign-in page; signing in still lands you on the crew's door.

### Fixed

- What's new and the release notice render **bold** lead-ins as bold instead of showing the asterisks; release notes and chat now share one inline-markup renderer.

## [2026.09.57] - 2026-09-09

### Changed

- The crew's invite has one home, the crew page, where every member sees it. Crew settings hold only what the crew is called and looks like, and the invite panel no longer squeezes its sentence into a thin column on a phone.

### Fixed

- Home's "nobody's around" line no longer tells a rider with rooms to open one: it says the rooms are quiet, and keeps the open-a-room nudge for someone who has none yet.
- Leaving a room no longer promises that "the room's code gets you back in" — rooms have had no codes since the invite became the crew's. It now says what is true: an open room you can walk back into, a private one the owner lets you back into.
- A room's settings header said "you joined 2026-09-08"; it now reads "you joined Sept 2026", the way a crew's people and a room's members already say "since".

## [2026.09.56] - 2026-09-09

### Added

- A room's Members place says how to get someone new in — invite them to the crew — with the crew's invite link one click away, where the room's own code used to be. (#1236)

### Fixed

- A chat line no longer appears twice, or keeps its old words after the author fixed it, for a rider who opened the room in the second the line was sent: the join-time backlog and the live tick each carried a copy and only one of them knew the line's id (#1231).

## [2026.09.55] - 2026-09-09

### Changed

- A room's settings page no longer carries a second copy of the member list. Coaches, bans and handing the room on live on the Members place, on each person's menu, and the settings page points there. (#1265)

### Fixed

- Following your own crew's invite link no longer offers you a "Join" that does nothing: the door says you are in and opens the crew. (#1236)
- Right-clicking a crew room you have not walked into yet offers "Walk in" instead of places and a chat you could not read. (#1236)

## [2026.09.54] - 2026-09-09

### Added

- Right-click the crew at the top of the sidebar for its page, its settings, a copy of its invite link, and leaving it — the same things its page offers, one click closer. (#1257)

### Changed

- Home tells a rider without a crew that their first room makes one, named after them, before they open it — and the note that follows links straight to the crew's settings, where the rename lives. The "no code?" line says that joining a listed room joins its crew. (#1151, #1236)

## [2026.09.53] - 2026-09-08

### Added

- A crew has a settings page: its name, a picture you upload (shown in the sidebar, on the crew's page and at its door), the fallback icon, and the invite code and link in one place. The crew's page keeps the roster and points admins at the settings. (#1237)

### Fixed

- Editing a chat line right after sending it now reaches everyone in the room. If the fix arrived before the other riders' copies of the line had been saved, it was dropped and they kept reading the old words until a reload. (#1231)
- The last places that still talked about a room's own code follow the crew: the TV's idle screen shows the crew's code, the settings page and the Members place say what actually lets someone in, and undoing "leave room" walks you back in through the crew instead of failing. (#1236)

## [2026.09.52] - 2026-09-08

### Changed

- Inviting people happens at the crew now, not per room. A crew has a six-character code and a share link; whoever joins with it can walk into the crew's open rooms, and a room the owner made private still admits only its members and whoever was let in. Room codes and room links are gone from the app — settings and the Members place point at the crew's invite instead — and "Join with a code" on Home takes a crew code. Rooms listed in the directory stay a public door; joining one joins its crew. (#1236)

## [2026.09.51] - 2026-09-08

### Added

- A crew's owner and admins can open any of the crew's rooms to the crew, or make it private again, from the crew page — including rooms they have never entered. The room's contents stay its members'; only who may walk in changes. (#1226)
- A crew can have an icon: its owner or an admin clicks the crew's mark on the crew page and picks one from the same set rooms use. The sidebar switcher and the crew strip draw it. (#1209)
- The desktop app is now offered where you will see it: once on the home page with the installer for your computer, as a quiet row at the bottom of the sidebar, and under the landing page's sign-in. Not on a phone, and never inside the app itself.
- The desktop app floats your watts, target and time left in a small window over whatever else is on screen while a ride runs and WattRoom is not in front — and room events now reach you as system notifications there, once you flip the notification switch.
- A crew's page has a "Leave the crew" button for members: it leaves every room of the crew you are in, in one move, with an undo. It says up front when you own a room there and have to hand it on first. (#1228)
- Notifications finally reach you: a message, someone arriving, a session starting or a poke, whenever the window is hidden or behind another app. The desktop app has them on from the start; in a browser, turn them on from your profile. A click lands in the conversation, and on a Mac the desktop app lets you reply right from the notification.
- The owner of a private room can let one crew-mate in without opening the room to the whole crew: the Members place lists crew-mates outside the room with a "Let in" button, and who has been let in but not walked in yet. They see the room in their sidebar and join themselves — being let in is not joining. (#1224)
- A room's owner can hand it to one of its members — right-click them on the Members place. You stay on as a coach. Until now a room could never change hands, and it vanished for everyone the day its owner deleted their account. (#1227)

### Changed

- The crew switcher at the top of the sidebar is a plain row like Home and Friends below it, and opening it lists your crews in place instead of dropping a card. With one crew the row simply opens the crew's page. (#1238)

### Fixed

- Joining voice can no longer sit at "joining voice…" for the rest of a ride. If the connection neither opens nor fails within twenty seconds, voice reports that it did not connect in time and offers "Try voice again". (#1203)

## [2026.09.50] - 2026-09-08

### Added

- A crew's owner can hand it to someone in it — right-click a person on the crew page. You stay on as an admin. Until now the only ways a crew changed hands were deleting your account or leaving every one of its rooms. (#1208)
- A room's owner now chooses who can find it in one place: its members only, the whole crew, or everyone on WattRoom. Rooms from before crews arrived were private and stayed that way with no way to open them; the settings page's "Who can find this room" now has the crew as its middle step, and a room made for the crew can be shut again. (#1204)
- A crew's owner and admins can open rooms in it — not only the person who made it. The sidebar's + opens the room in the crew you are looking at when you may, the crew page has "Open a room here", and a rider who runs more than one crew picks which. Members still open rooms in their own crew. (#1201)

### Changed

- Opening a room your crew left open no longer greets you with "You have been invited to ride here" — it says the room is open to everyone in the crew, you included, and the button reads "Walk in". The invitation wording stays for share links. (#1216)

### Fixed

- A room you made private no longer hands its link to crew-mates who are not in it. The sidebar and the crew page showed "private — you are not in this room" but still carried the room's address underneath, and the address is the door: anyone who found it could walk in. Locked rooms now travel without it. (#1205)
- Someone who owns a room in a crew can no longer be banned from that crew: a room never leaves its crew, and banning its owner left a room nobody could moderate and an owner locked out of their own room. Any crew whose owner carried a stale ban is repaired on upgrade. (#1212)

## [2026.09.49] - 2026-09-08

### Fixed

- **The + beside your rooms does something now.** It opens "Open a room" and "Or join with a code" right there, in the crew you are looking at, instead of pointing at a spot on Home the page could not scroll to. Home's own "Open a room" button and the old /rooms link land on the forms too.
- fixed: the speaking ring and voice ducking now react to a teammate's voice — they never actually worked for any remote rider before this

## [2026.09.48] - 2026-09-08

### Changed

- The desktop app draws its own title bar in the app's colours — no more white strip over a dark room — and opens on a first screen made for a desk: the live-room scene beside one sign-in button.

### Fixed

- The desktop app signs you in through your browser: one button opens wattroom.ch there, you use your passkey, GitHub or Strava as usual, and the app picks the session up on its own. Signing in inside the app's own window never worked — passkeys hung and GitHub or Strava stranded you in the browser.

## [2026.09.47] - 2026-09-08

### Added

- Autoplay's Smart mode now leans toward what your room actually enjoys: finish a track and its artist — or, more loosely, its genre — comes round more often. Skipping builds nothing, and the track you just heard does not come straight back. Each room learns only from its own rides.
- Smart autoplay now matches the music to the work: while a session is running it favours tracks whose tempo fits the cadence the current block is asking for, at that cadence or at double it. Tracks with no BPM are never buried for it, and a room with nothing running picks exactly as before.
- **Your crew has a door now.** Every room is made inside your crew and open to it; your room list says what you may do in each of the crew's rooms — open, private and you are in it, private and you are not, or yours to administer without reading; a crew can be renamed; a crew admin can ban from the whole crew, which severs every room at once, and lifting a crew ban never lifts a room ban or the other way round. Deleting your account now hands your crew on instead of failing.
- **Your crew has a page.** From the crew header in the sidebar: its rooms with what you may do in each, its people with their crew roles, and — for the owner and admins — make or unmake an admin, ban from the crew, and lift a crew ban with a line saying it restores nothing a room's owner decided. The room's own Unban says the same in the other direction.
- **The day the crew arrives, it says so once.** A brief notice names your crew — named after you until you rename it — and points at its page, where the name is the heading and a click edits it.
- **The crews you are not looking at still report in.** When another crew has something on — riders on watts, people in voice, lines you have not read — one line under the crew header says so, and tapping it switches. A quiet crew says nothing at all.
- **The sidebar shows one crew at a time.** A header above your rooms names the crew you are looking at and switches to another; the room you are connected to stays in the sidebar under "you are in", whichever crew is on screen. The crew you own carries a small shield.
- **A room row says what you may do there before you open it.** Private rooms you are in carry an eye, private rooms you are not in a lock, and rooms you administer without being in them a sliders mark — and the last two are not links that fail.
- Groundwork for crews, the layer above rooms: a group can be in one place
  while doing different things, each in its own room. Nothing changes for
  riders yet — this release only lays the tables down, and every existing
  room keeps exactly the visibility it had.
- A desktop app is on its way. wattroom.ch/download picks the installer for the computer you are on once one is published, and the app itself says so on the home page when a newer version is out — never mid-ride.
- Rooms can list themselves. An owner can now make a room findable by name in a new directory at **Find a room**, linked from the join card — and every room stays invite-only until its owner says otherwise. Being findable is not being readable: people who have not joined see a room's name and icon, and nothing about who rides there or what they did.
- You now have your own settings for each room, on its settings page: whether planned sessions there reach you by email, and whether you appear on that room's weekly board. They are yours — nobody else sees them and the owner cannot change them. Both start on, so nothing changes until you say so, and leaving a room forgets them.
- In the desktop app, sharing your screen now shares what your computer is playing too, so the room hears the same thing you do. It arrives on its own fader and ducks under voices like the jukebox does, and the sharing notice says when the room can hear you as well as see you. Requires macOS 14.2 or Windows; a screen shared from the browser is silent as before.
- Autoplay has a third mode, **Smart**: instead of looping a playlist it picks from your music library, quietest on the tracks the room just played or keeps skipping. Each room learns on its own — what one room skips changes nothing anywhere else.
- Tag anything in the music pool with whatever words suit it — genre, mood, the part of a ride it belongs to. A track arrives wearing whatever genre its file claimed, the tags stay editable like every other field, and the Music page grows a row of shelves you can click to narrow the library down to one of them.

### Changed

- "Are you sure?" questions — ending a session, leaving a live ride, removing a member, disconnecting Strava, deleting a track from the pool — now open WattRoom's own dialog instead of the browser's plain grey prompt, with the action named on the button.
- Who can see your profile, trophies and shared rides is now decided in one
  place rather than by four separate queries that each had to remember the
  rules. Nothing changes about who that is today; a ban — of either kind —
  now reliably ends it everywhere at once.
- Room settings is worth opening when you don't own the room. It used to say only that you cannot change anything; now it shows the room's join code and invite link with copy buttons, who owns it, how many ride there, and what the room is set to — sound pack, weekly board, reactions. Leaving is still there, still last.

### Fixed

- **Away works.** Pressing it used to flip your status and then quietly undo itself a moment later — your mic stayed live, the room kept hearing you, and your speakers came back on. It now sticks: the mic and camera close and stay closed, a screen you were sharing stops, and coming back restores the mic and camera you had. A share is not resumed for you; the button is there when you want it.
- Self-hosters can turn the server's log up: `WATTROOM_LOG_LEVEL=debug` now actually prints debug lines, which it never did — an internal filter dropped every one of them before they reached the log. Unset still means info, and a rider's feedback report keeps the same lines it always did.
- A ride the workout gave nothing to score no longer reports a perfect
  execution. It used to read 100 %, pay the full execution XP bonus, and take
  the Metronome medal — and a rider whose power meter dropped out took
  Diesel and Lanterne Rouge with it, off people who had actually ridden.
  Those medals now go to riders who reported power, and history shows a dash
  where there was nothing to score.
- Two things WattRoom promised to delete now actually get deleted. Session
  recaps past their 90 days were only swept when a session ended, so a room
  that went quiet kept them indefinitely; expired sign-in sessions were never
  removed at all. Neither could be read by anyone, but both were kept longer
  than intended.
- Deleting a pool track while a room is playing it no longer freezes the room's
  jukebox on it. The deck now reports the dead track as over and moves on to the
  next thing in the queue, with a toast saying which track could not be played,
  exactly as it already does for a YouTube video that refuses to play.
- A track from the pool now shows its length and a moving seek bar in the
  jukebox, and no longer draws an empty black tile on the stage — a pool track
  is heard, not seen, so the stage stays with the riders.
- "Just played" can put a pool track on again. The replay arrow used to send
  the row as a YouTube video with no id, which the jukebox refused with "that
  video link is not playable here".
- **A Strava outage no longer loses your ride's upload.** It used to give up about fifty minutes after the first failure, and answer Strava asking us to slow down by asking ~45 more times a second later. Uploads now back off over hours, a rate limit pauses every delivery instead of costing an attempt, and a ride that still could not be sent has a **Try sending it again** button — the old message blamed a disconnection that had usually not happened.

### Security

- A ban now reaches everywhere it should. A rider banned from a room could
  still stream the tracks its members had uploaded, have their own music
  drawn into the room's autoplay, and receive its planned-session emails —
  the last with no way to stop it from outside the room. All three now stop
  at the ban, and the room's own members are unaffected.
- **A ban now reaches the trophy case.** Being banned from a room kept the seat occupied, which is deliberate — rejoining by link or code lands you back on the ban. But the trophy-case check read that seat as a shared room, so a banned rider could still open the case of everyone left in the room, and be opened by them. The rider page above it already said no. Both now agree. Friendship is a separate door and still opens: a banned ex-room-mate who is also an accepted friend keeps the access friendship gave them.
- Groundwork for crews: a ban can now be set for a whole crew, and every door
  that already refused a room ban refuses it too — joining by link or by code,
  the room itself, the live socket, the jukebox and a rider's own room
  settings. Nothing changes for existing rooms, which have no crew ban to
  honour.
- **A crew ban now empties the sidebar too.** Being banned from a crew closed every door into its rooms — joining, opening, settings — except one: the room list your own sidebar reads still handed you the room. Nothing behind it would open, but it should not have been listed, and now it is not.
- **Your music reaches the crew — and stops at a crew ban.** A track plays for anyone who may enter a room its uploader may enter, so a room open to your crew shares its members' music with everyone in the crew; browsing a shelf stays the uploader's alone. A rider banned from the crew could still fetch a crew-mate's audio through a membership row the ban leaves in place; they cannot now, and their shelf leaves the room's autoplay with them.
- **The music library is yours, not the whole server's.** Until now every signed-in person on an instance could browse, play and queue every track anyone had ever uploaded — fine when one instance meant one crew, wrong once it does not. Your shelf is now your own, and a room's autoplay reaches only what its own members brought. Nothing was deleted: a song two people uploaded is two entries over one stored file, and a track you uploaded is still yours.
- Disconnecting Strava now revokes the grant through Strava's `oauth/revoke` endpoint, which carries your token in the request body rather than in the URL. A token in a URL is a token in somebody's proxy log; it never should have been there. A revoke that Strava refuses is now reported instead of passed over in silence.

## [2026.09.46] - 2026-09-08

### Added

- Every track in the music library now has a button that drops it straight into the jukebox of the room you are in, without leaving the shelf. With no room open the button is not there, and the page says to open one.

### Fixed

- A correction someone made while your connection dropped now reaches you. Edits are announced once and never repeated, so if your socket flapped at that moment you kept reading the old words — and reconnecting could not fix it, only a full page reload could.

## [2026.09.45] - 2026-09-08

### Added

- Music is a place now: browse the crew's shared library, search it by title, artist or album, and drop MP3s straight onto the page to add them. Tags come out of the files and every field stays editable, so a badly-tagged track gets fixed rather than re-uploaded.
- A track from the music pool can go in the room's queue beside YouTube links and plays for everyone in sync, like anything else on the deck. It shows as a card rather than a video — there is nothing to watch — and the queue interleaves the two sources in one list.

## [2026.09.44] - 2026-09-08

### Fixed

- Cameras no longer stream at full quality into thumbnail-sized tiles, and your own upload stops sending picture sizes nobody asked for. On a home connection with several riders in the room, that was the difference between a room that holds and one that stutters — and it cost your own upload too. Video also stops flowing into a tab you have switched away from.

## [2026.09.43] - 2026-09-08

### Added

- The music pool has its server side: upload MP3s to a library the whole instance shares, with 2 GB per rider. Titles, artists and albums come from the file's own tags and stay editable, uploading a song the crew already has takes no extra space, and only whoever uploaded a track can change or remove it.
- A room can now turn on a weekly board: everyone's kJ for the current week, listed under the crew's tiles with each rider's category beside it. It is off until the room's owner switches it on, it resets every Monday, and nothing carries over between weeks — being in a room does not put you on a board.

### Fixed

- A browser that blocks audio no longer leaves you silently cut off from the room. It used to be unrecoverable: once the voices run through WattRoom's own mixer, a blocked tab hears nobody and no click anywhere brought it back. Now the first click anywhere in the app restores it, and if that has not happened yet the sidebar says "You cannot hear the room" with a button that fixes it.
- Taking back a skipped track or playlist now says so in the room's chat — "Kim put Sandstorm back". The undo worked, but the log recorded only the skip, which left it saying the opposite of what happened.
- A planned session now says so in the room's chat as it comes due — "Sweet Spot 3×12 starts at Tue 19:00", ten minutes ahead. The line was built when planning first reached the timeline and never actually appeared.

## [2026.09.42] - 2026-09-08

### Added

- A room's lounge now says what the crew did together: hours ridden as a crew, sessions this month against last month, and a strip of the last twelve sessions showing which ones you were in. Every figure is either the whole room's or your own — no rider's numbers are shown to anyone else.

## [2026.09.41] - 2026-09-08

### Added

- A finished session now leaves a card in the room's chat: who was here, when each rider arrived and how long they stayed, with a filled dot for everyone who rode. It is the first thing in a room's timeline that is still there after a reload. Presence and time only — no watts, no kJ, no heart rate — and recaps are kept for 90 days.

### Fixed

- Switching from push-to-talk back to the noise gate while still holding the key now stops transmitting immediately, instead of staying open until your mic next reported a level.

### Security

- The Strava refresh token is no longer stored in the clear. With `WATTROOM_TOKEN_KEY` set (32 random bytes, base64), it is sealed with AES-256-GCM and existing rows are sealed once at startup — so a database dump that leaves the host without the app's environment no longer carries a usable credential. Servers without the key keep working exactly as before and say so at boot; a key that is set but unusable stops the server rather than quietly storing in the clear.
- **Upgrading with a key set is one-way for Strava.** Sealing a token clears the readable copy, which is the point — so rolling back to an image older than this release leaves Strava auto-upload needing a reconnect for any rider whose token was sealed in the meantime. Rolling back to this release or newer is unaffected. See [ADR-0035](docs/decisions/0035-stored-credentials-are-sealed-with-a-key-from-the-environment.md).

## [2026.09.40] - 2026-09-08

### Added

- Shape a workout on its graph instead of in the side panel: drag a block's top edge to set its target (a ramp's two ends move separately), its right edge to set its duration, or the block itself to reorder it. The number follows your hand, arrow keys do the same thing without a mouse, and one drag is one ⌘Z. The graph stays read-only everywhere you are riding rather than building.

### Fixed

- **Friends** is a row in the sidebar with an icon, beside Home, Workouts and Rides, and the count of people waiting on your answer sits on it. It used to be a small word tucked into the corner of the messages heading. The two lists of faces below it now say what they are: **direct messages** holds your threads, and **with you** names the room you are standing in.
- Pages outside a room fit a phone. The charts on Rides and your profile were drawn at a fixed 600px and pushed the whole page sideways on a 375px screen, dragging the header off with them; every page also spent 32px a side on margin at every width. Charts now fit their column and narrow screens get their space back.
- Your friends see you as **riding** only while you are actually pedalling. Pairing a trainer and walking away used to leave you marked as riding for as long as the tab stayed open, and the same rider could read as riding on the friends list and online in the room they were standing in.

## [2026.09.39] - 2026-09-07

### Added

- The workout editor has undo and redo: ⌘Z / Ctrl+Z steps back through every edit — added and deleted steps, drags, duplicates, typed numbers, a workout loaded from the library — and ⇧⌘Z goes forward again. Undoing a delete brings the step back selected, and a run of typing in one field is a single step back rather than forty.
- A finished ride now shows itself against your own best ride of the same workout — average watts, execution and energy, with the difference beside each. The first time you ride something it says so instead of comparing the ride to itself. Underneath, your best 20-minute power names the window it belongs to, and says when the 90-day best is one you set recently.
- Your trophy case and your own profile now show what you have actually done here: hours in voice, sessions you were in voice for, sessions you coached, sprint wins, and tracks the room played to the end. The server had been counting all of it to award badges and then throwing the numbers away. Your level also says where it came from — riding, in voice, sessions, trophies. These are yours alone for now: four of them are the same numbers your unearned badges are measured by, which stay private.
- Sit out the room's music without stopping it for anyone else: **Skip for me** drops you out until the next track starts, **Stop for me** until you press Rejoin. Your player unloads, so nothing streams while you are out, and rejoining lands you back on the room's playhead. Stepping away now does the same.

### Changed

- Steps inside a repeat are now as editable as any other: drag them to reorder, add a ramp or a sprint or another repeat inside the set, and click a repeat's block on the graph to select that exact step instead of the whole block. Every step also gained a right-click menu and a Duplicate — building `4 × (3 min hard / 1 min ramp / 2 min easy)` no longer means writing every rep out by hand.

### Fixed

- A waiting friend request now shows as a count beside "friends" in the sidebar, the way an unread room or DM does. It used to announce itself once and then leave no trace, so if you were riding or the tab was closed you found out the next time you happened to open the page.
- The friends page puts requests waiting on you at the top, in their own section, and the ones you are waiting on quietly at the bottom. They were one list, mixed together, below your friends.
- Long-pressing an item that sits inside another item with its own right-click menu now opens the item you pressed, not its container.
- The Sensors page can pair your trainer. It used to send you into a room to do it — on the one screen named for setting up equipment. Pairing now looks and reads the same everywhere: the Sensors page, the solo ride and ramp screens, and the room all draw one card, which says what is connected, what it is reporting, and what to do when it isn't.

## [2026.09.38] - 2026-09-07

### Added

- The room's timeline now says who came and went — joined, left, went away, is back — the way ADR-0022 always described. Thirty seconds after someone slips out, "wait, is Marco still here?" has an answer other than counting avatars.
- A phone whose connection flaps produces no line at all: a rider has to be gone for fifteen seconds before the room is told, and coming back inside that says nothing in either direction. Several people arriving at once are one line that grows, not six lines pushing the conversation off the screen.

### Fixed

- The music comes back after someone stops talking. It could get stuck at a quarter volume until the next time somebody spoke, because anything else changing on screen during the pause cancelled the ramp bringing it back up.
- Music and cue sounds now dip and return at the same moment. They ran on two separate clocks with the same numbers, so one moved a little after the other.
- The workout editor and the workout list now draw every preview against your own FTP. They were both scaled to a fixed 265 W, so the watts and zone colours you shaped a workout by belonged to somebody else.
- A rider who leaves or mutes mid-sentence stops being shown as speaking. Their tile stayed ringed and their name bold until the room ended, and in a room people come and go from, the highlights piled up.
- The speaking ring now follows the voice rather than the server's opinion of it. It is measured from the audio already playing in your browser, so it lights up as someone starts talking instead of a beat later.

## [2026.09.37] - 2026-09-07

### Added

- Pads answer a right-click. Preview, trim, change the key, rename, take it off the board or delete it — the one thing you actually touch mid-ride was the only object in the soundboard with no menu.
- Clips can be renamed. A name was the uploaded file's stem, set once, and a bad one could only be fixed by uploading the file again.
- Dragging a pad onto an occupied one swaps the two clips, and so does the pad picker in your clips. Moving a clip used to knock whatever was there off the board, silently.

### Changed

- The soundboard is one panel with three faces instead of a stack of popups. Your clips and the trim editor now open in the board itself, so opening them no longer dims the board you opened them from.
- You can hear a clip without firing it at the room. There is a play button on every clip in your library and on the trim editor, alt-click does the same on a pad, and all of them play to you alone — nobody else in the room hears a thing.
- The trim editor previews the edit as you make it, looping, with a playhead on the waveform and the fades and gain you are setting applied live.

## [2026.09.36] - 2026-09-07

### Fixed

- The jukebox video no longer stays parked over the sidebar after the surface holding it has scrolled or slid off screen — it drops back to its corner instead of floating over the member list.
- Soundboard pads now fire with the board hidden. Hiding the panel — which is what you do once you have learnt the keys and want the screen back for the ride — used to switch every pad key off.
- `Alt`+`B` shows and hides the soundboard on a Mac. It never did: macOS turns `Option`+`B` into `∫`, and WattRoom was listening for the letter, so the one shortcut the clips window told you about did nothing on every Mac.
- The soundboard chord can be changed, from a row in your clips window. `Esc` cancels, Reset puts `Alt`+`B` back, and a chord the browser keeps for itself is refused with a line saying which one takes it and where — `Ctrl`+`1` switches tabs on Windows and Linux, so it says so.

## [2026.09.35] - 2026-09-07

### Changed

- The soundboard now opens from a labelled Soundboard button under the room's reactions instead of a speaker icon in the voice strip, so `Join voice` gets its width back and the two audio icons no longer look alike. It is there whether or not voice is running; `B` still toggles the board.

### Fixed

- Sharing a room link posts the room's name again. Rooms made since icons
  stopped being emoji were pasting the icon's internal name into the preview,
  so an invite to Sunday Sufferfest arrived in the chat as "flame Sunday
  Sufferfest".
- The what's-new notice on home no longer runs its Changed/Fixed labels into the text beside them — the label column now sizes itself to the longest label, so every line starts in the same place.

## [2026.09.34] - 2026-09-07

### Fixed

- Returning to WattRoom now gets you the current version. The page that names the app's files carried no caching instructions at all, so a browser was free to keep an old copy — and once those files started being cached for a year, that old copy stuck, hiding every new release until a hard reload.

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

[Unreleased]: https://github.com/natrontech/wattroom/compare/2026.09.79...HEAD
[2026.09.79]: https://github.com/natrontech/wattroom/compare/2026.09.78...2026.09.79
[2026.09.78]: https://github.com/natrontech/wattroom/compare/2026.09.77...2026.09.78
[2026.09.77]: https://github.com/natrontech/wattroom/compare/2026.09.76...2026.09.77
[2026.09.76]: https://github.com/natrontech/wattroom/compare/2026.09.75...2026.09.76
[2026.09.75]: https://github.com/natrontech/wattroom/compare/2026.09.74...2026.09.75
[2026.09.74]: https://github.com/natrontech/wattroom/compare/2026.09.73...2026.09.74
[2026.09.73]: https://github.com/natrontech/wattroom/compare/2026.09.72...2026.09.73
[2026.09.72]: https://github.com/natrontech/wattroom/compare/2026.09.71...2026.09.72
[2026.09.71]: https://github.com/natrontech/wattroom/compare/2026.09.70...2026.09.71
[2026.09.70]: https://github.com/natrontech/wattroom/compare/2026.09.69...2026.09.70
[2026.09.69]: https://github.com/natrontech/wattroom/compare/2026.09.68...2026.09.69
[2026.09.68]: https://github.com/natrontech/wattroom/compare/2026.09.67...2026.09.68
[2026.09.67]: https://github.com/natrontech/wattroom/compare/2026.09.66...2026.09.67
[2026.09.66]: https://github.com/natrontech/wattroom/compare/2026.09.65...2026.09.66
[2026.09.65]: https://github.com/natrontech/wattroom/compare/2026.09.64...2026.09.65
[2026.09.64]: https://github.com/natrontech/wattroom/compare/2026.09.63...2026.09.64
[2026.09.63]: https://github.com/natrontech/wattroom/compare/2026.09.62...2026.09.63
[2026.09.62]: https://github.com/natrontech/wattroom/compare/2026.09.61...2026.09.62
[2026.09.61]: https://github.com/natrontech/wattroom/compare/2026.09.60...2026.09.61
[2026.09.60]: https://github.com/natrontech/wattroom/compare/2026.09.59...2026.09.60
[2026.09.59]: https://github.com/natrontech/wattroom/compare/2026.09.58...2026.09.59
[2026.09.58]: https://github.com/natrontech/wattroom/compare/2026.09.57...2026.09.58
[2026.09.57]: https://github.com/natrontech/wattroom/compare/2026.09.56...2026.09.57
[2026.09.56]: https://github.com/natrontech/wattroom/compare/2026.09.55...2026.09.56
[2026.09.55]: https://github.com/natrontech/wattroom/compare/2026.09.54...2026.09.55
[2026.09.54]: https://github.com/natrontech/wattroom/compare/2026.09.53...2026.09.54
[2026.09.53]: https://github.com/natrontech/wattroom/compare/2026.09.52...2026.09.53
[2026.09.52]: https://github.com/natrontech/wattroom/compare/2026.09.51...2026.09.52
[2026.09.51]: https://github.com/natrontech/wattroom/compare/desktop-v2026.09.4...2026.09.51
[2026.09.50]: https://github.com/natrontech/wattroom/compare/2026.09.49...2026.09.50
[2026.09.49]: https://github.com/natrontech/wattroom/compare/2026.09.48...2026.09.49
[2026.09.48]: https://github.com/natrontech/wattroom/compare/desktop-v2026.09.3...2026.09.48
[2026.09.47]: https://github.com/natrontech/wattroom/compare/desktop-v2026.09.2...2026.09.47
[2026.09.46]: https://github.com/natrontech/wattroom/compare/2026.09.45...2026.09.46
[2026.09.45]: https://github.com/natrontech/wattroom/compare/2026.09.44...2026.09.45
[2026.09.44]: https://github.com/natrontech/wattroom/compare/2026.09.43...2026.09.44
[2026.09.43]: https://github.com/natrontech/wattroom/compare/2026.09.42...2026.09.43
[2026.09.42]: https://github.com/natrontech/wattroom/compare/2026.09.41...2026.09.42
[2026.09.41]: https://github.com/natrontech/wattroom/compare/2026.09.40...2026.09.41
[2026.09.40]: https://github.com/natrontech/wattroom/compare/2026.09.39...2026.09.40
[2026.09.39]: https://github.com/natrontech/wattroom/compare/2026.09.38...2026.09.39
[2026.09.38]: https://github.com/natrontech/wattroom/compare/2026.09.37...2026.09.38
[2026.09.37]: https://github.com/natrontech/wattroom/compare/2026.09.36...2026.09.37
[2026.09.36]: https://github.com/natrontech/wattroom/compare/2026.09.35...2026.09.36
[2026.09.35]: https://github.com/natrontech/wattroom/compare/2026.09.34...2026.09.35
[2026.09.34]: https://github.com/natrontech/wattroom/compare/2026.09.33...2026.09.34
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
