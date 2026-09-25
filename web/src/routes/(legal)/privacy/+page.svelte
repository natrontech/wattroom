<svelte:head>
	<title>Privacy policy · WattRoom</title>
</svelte:head>

<h1 class="page-title">Privacy policy</h1>
<p class="text-muted mt-1 text-sm">
	Datenschutzerklärung · last updated 25 September 2026
</p>

<p class="text-muted mt-6 text-sm leading-relaxed">
	Privacy on WattRoom is architecture, not a settings page: live metrics stay
	inside the session you ride in, audio and video are never recorded, and rides
	are private by default. This page spells out what that means in GDPR and Swiss
	revDSG terms. WattRoom is open source, so every claim here can be checked
	against the
	<a
		href="https://github.com/natrontech/wattroom"
		class="hover:text-ink underline">code</a
	>.
</p>

<section>
	<h2
		class="font-display text-ink mt-8 text-sm font-semibold tracking-wide uppercase"
	>
		Who is responsible
	</h2>
	<p class="text-muted mt-2 text-sm leading-relaxed">
		Natron Tech AG, Weissenbühlweg 40a, 3007 Bern, Switzerland (<a
			href="mailto:info@natron.io"
			class="hover:text-ink underline">info@natron.io</a
		>) operates wattroom.ch and is the controller for the processing described
		here.
	</p>
</section>

<section>
	<h2
		class="font-display text-ink mt-8 text-sm font-semibold tracking-wide uppercase"
	>
		What we store about you
	</h2>
	<ul class="text-muted mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed">
		<li>
			<strong class="text-ink font-medium">Account.</strong> You sign in with Google,
			GitHub or Strava, or with a passkey. From a provider we receive and keep your
			provider user ID, display name and avatar; a passkey leaves us only its public
			half. WattRoom has no passwords, ever — we never see or store one.
		</li>
		<li>
			<strong class="text-ink font-medium">Email (optional).</strong> Only if you
			type an address into your profile. It is used for three things: to confirm the
			address itself, for reminders about planned sessions (off unless you switch
			them on), and for account alerts — a passkey or sign-in provider added or removed,
			the address replaced — which cannot be switched off, because the person who
			should hear that a way into your account changed is you. Remove the address
			and all of it stops.
		</li>
		<li>
			<strong class="text-ink font-medium">Rides.</strong> Power, cadence, speed and
			heart rate at one sample per second, plus per-ride summaries, stored with your
			account. Rides are private by default; sharing is a per-ride opt-in.
		</li>
		<li>
			<strong class="text-ink font-medium">Heart rate is health data</strong>
			and is treated accordingly: it is visible live, only inside the session you
			ride in, only while it runs. It never appears in shared ride artifacts and is
			never scored. You consent by pairing a heart-rate monitor. A trainer can also
			relay one that is bonded to it, with nothing paired here — so your riding screen
			says whenever your heart rate is being shared, from either, and
			<strong class="text-ink font-medium">Stop sharing</strong> there ends it at
			once. Unpairing ends it too.
		</li>
		<li>
			<strong class="text-ink font-medium">Chat.</strong> A crew's chat channels and
			direct messages are rolling logs: only the most recent 500 messages per chat
			channel or conversation are kept, older ones are deleted automatically.
		</li>
		<li>
			<strong class="text-ink font-medium">Music you upload.</strong> If you add MP3s
			to your library we store the file on our own disk and a row about it: the title,
			artist, album, tags and BPM you typed or its tag carried, plus what the file
			itself measures. Only you browse your library; a voice channel hears what someone
			in it puts on. Delete a track and both go, and deleting your account takes every
			file nobody else has uploaded too.
		</li>
		<li>
			<strong class="text-ink font-medium">Soundboard clips.</strong> If you add short
			sounds to your soundboard we store each file and a row about it: the name you
			typed, the pad and key you put it on, and the trim you set. Only you see your
			clips; a voice channel hears what someone in it fires. Delete a clip and both
			go, and deleting your account takes them all.
		</li>
		<li>
			<strong class="text-ink font-medium">Crews and channels.</strong> A crew is
			a row: its name, icon and picture, its join code, whether it is listed in the
			directory, whether it keeps a weekly board, its own emoji and its calendar link.
			Its channels carry their names, whether they are private, and a voice channel's
			sounds and jukebox settings. A crew you are in keeps your standing in it — member,
			admin or banned — and when that was set, and a private channel that names you
			records that it does. Your own choices per crew (whether it may mail you, whether
			you stand on its board) are yours and nobody else's.
		</li>
		<li>
			<strong class="text-ink font-medium">Coach access.</strong> If you mint a read-only
			token for a coach or a tool, we keep its name, when you made it and when it
			was last used — never the token itself, only a hash of it. You see the token
			once, at creation. Revoke it and the row goes.
		</li>
		<li>
			<strong class="text-ink font-medium">Voice, camera, screenshare.</strong>
			Real-time audio and video run through our own self-hosted LiveKit server. It
			is transit-only: nothing is ever recorded or stored, by design.
		</li>
	</ul>
</section>

<section>
	<h2
		class="font-display text-ink mt-8 text-sm font-semibold tracking-wide uppercase"
	>
		What we deliberately don't do
	</h2>
	<p class="text-muted mt-2 text-sm leading-relaxed">
		No analytics, no tracking pixels, no error-tracking services, no ads, no
		selling or sharing of data, no public leaderboards. Your live metrics are
		session-scoped: visible only to the riders in your session and whoever is in
		its voice channel, only while it runs.
	</p>
</section>

<section>
	<h2
		class="font-display text-ink mt-8 text-sm font-semibold tracking-wide uppercase"
	>
		What other people see
	</h2>
	<ul class="text-muted mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed">
		<li>
			<strong class="text-ink font-medium">Friends</strong> — people whose request
			you accepted — see on their home page whether you are online, in voice or riding,
			and which voice channel you are in when it is one they may enter themselves,
			before they join anything. Unfriend them and that stops.
		</li>
		<li>
			<strong class="text-ink font-medium">Your crew</strong> sees your display
			name, avatar and level, and which of its voice channels you are in.
			<strong class="text-ink font-medium">People in your session</strong> — riding
			it with you, or in its voice channel — see your live power and cadence while
			you ride, and your heart rate — from a monitor you paired, or relayed by your
			trainer — unless you stopped sharing it, only inside the session and only while
			it runs.
		</li>
		<li>
			<strong class="text-ink font-medium">Your rider page</strong> is visible to
			friends and to people who share a channel with you (one you may both enter):
			level, energy ridden, badges earned in crews you share, and where you are right
			now. Rides appear there only if you shared them, one by one, and only to friends.
		</li>
	</ul>
</section>

<section>
	<h2
		class="font-display text-ink mt-8 text-sm font-semibold tracking-wide uppercase"
	>
		Cookies
	</h2>
	<p class="text-muted mt-2 text-sm leading-relaxed">
		Three, all strictly necessary: <code class="text-ink">wattroom_session</code
		>
		keeps you signed in (a server-side session we can revoke),
		<code class="text-ink">wattroom_oauth_state</code> protects the sign-in flow
		for a few minutes, and <code class="text-ink">wattroom_passkey</code> carries
		a passkey sign-in between its two steps for ten minutes. There are no tracking
		or third-party cookies — which is why there is no cookie banner.
	</p>
</section>

<section>
	<h2
		class="font-display text-ink mt-8 text-sm font-semibold tracking-wide uppercase"
	>
		Third parties
	</h2>
	<ul class="text-muted mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed">
		<li>
			<strong class="text-ink font-medium">Sign-in providers.</strong> Google, GitHub
			or Strava process your sign-in under their own privacy policies; we receive
			only the profile basics listed above.
		</li>
		<li>
			<strong class="text-ink font-medium">Strava upload.</strong> If your
			account is connected to Strava, finished rides are uploaded to
			<em>your own</em> Strava account — on by default, and you can switch it off
			in your profile. We keep a small record of each delivery, so the ride page can
			tell you whether it arrived: the state, how many times we tried, the error if
			it failed, and the activity number Strava gave it. Nobody but you ever sees
			it.
		</li>
		<li>
			<strong class="text-ink font-medium">YouTube.</strong> A voice channel's jukebox
			plays music through YouTube's embedded player in privacy-enhanced mode (youtube-nocookie.com).
			The player is created when you enter a voice channel; the player script and
			the lookups that name a pasted link come from www.youtube.com, and a track's
			artwork from i.ytimg.com. Google may process your IP address under its own privacy
			policy.
		</li>
		<li>
			<strong class="text-ink font-medium">Resend, Inc. (USA).</strong> Delivers every
			email above — the confirmation, reminders, account alerts — so they see your
			address, but only if you saved one.
		</li>
		<li>
			<strong class="text-ink font-medium">Infrastructure.</strong> The service runs
			in Switzerland, on infrastructure Natron Tech AG operates itself — the controller
			named above and the operator are the same company, so your ride data reaches
			no third-party host. DNS is provided by Cloudflare. IP addresses appear in technical
			server logs, which we keep briefly for operations and security — never for profiling.
		</li>
	</ul>
</section>

<section>
	<h2
		class="font-display text-ink mt-8 text-sm font-semibold tracking-wide uppercase"
	>
		Legal bases
	</h2>
	<p class="text-muted mt-2 text-sm leading-relaxed">
		Running your account, crews and rides: performance of contract (Art. 6
		(1)(b) GDPR). Heart rate: your explicit consent (Art. 9 (2)(a) GDPR), given
		by pairing a monitor and withdrawable at any time with Stop sharing on your
		riding screen — which also covers heart rate your trainer relays — or by
		unpairing. Security logging: legitimate interest (Art. 6 (1)(f) GDPR). The
		Swiss revDSG applies alongside.
	</p>
</section>

<section>
	<h2
		class="font-display text-ink mt-8 text-sm font-semibold tracking-wide uppercase"
	>
		Your rights
	</h2>
	<p class="text-muted mt-2 text-sm leading-relaxed">
		The two big ones are built in: your profile has
		<strong class="text-ink font-medium">export everything</strong> — a zip of
		your profile, every ride with its per-second samples, the messages you
		wrote, your DM threads and the reactions you left, friends, your crews —
		your standing and your choices in each, and the ones you own with their
		settings — the pins you wrote on their boards, the private channels that
		name you, playlists, workouts, sessions you said yes to
		<em>and</em>
		sessions you put on a calendar, the library tracks you uploaded, your soundboard
		clips, your coach-access tokens, where each ride was delivered, and your XP and
		trophies, all as machine-readable JSON. It stops where other people begin: someone
		else's chat line is theirs, not yours, and the only thing it says about anyone
		else is the display name you already see in the app. The one thing left out is
		the audio: a track's or a clip's row is in the zip and names the file it belongs
		to, the file itself is not — you have what you uploaded, and we do not hand out
		audio. The zip also carries live links — your calendar feed, a crew's join code
		and its calendar link — so treat it the way you would treat those: it is yours,
		not something to forward. There is also
		<strong class="text-ink font-medium">delete account</strong> (a full purge,
		not a soft delete). Beyond that you have the usual GDPR rights — access,
		rectification, erasure, restriction, portability, objection, withdrawal of
		consent — via
		<a href="mailto:info@natron.io" class="hover:text-ink underline"
			>info@natron.io</a
		>, and the right to complain to the Swiss FDPIC or your local EU supervisory
		authority.
	</p>
</section>

<section>
	<h2
		class="font-display text-ink mt-8 text-sm font-semibold tracking-wide uppercase"
	>
		Changes
	</h2>
	<p class="text-muted mt-2 text-sm leading-relaxed">
		If something material changes, this page and the date at the top change with
		it.
	</p>
</section>
