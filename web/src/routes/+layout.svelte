<script lang="ts">
	import { untrack } from 'svelte';
	import '../app.css';
	import '@fontsource/barlow/400.css';
	import '@fontsource/barlow/600.css';
	import '@fontsource/chakra-petch/500.css';
	import '@fontsource/chakra-petch/700.css';
	import { dev } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import { account } from '$lib/account.svelte';
	import { takeNext } from '$lib/auth/next';
	import { presence } from '$lib/presence.svelte';
	// Side-effect imports: both apply their stored choice to :root the moment
	// they load, so they belong to the shell rather than to whichever screen
	// happens to render their control. The palette reached only /profile and
	// /dev/components before this (#329); the scheme was correct only because
	// RoomRail imports it and the shell renders RoomRail.
	import '$lib/palette.svelte';
	import { theme } from '$lib/theme.svelte';
	import { palette } from '$lib/palette.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { soloRide } from '$lib/workout/session.svelte';
	import { createProfileStore } from '$lib/profile.svelte';
	import { pullProfile } from '$lib/profile-sync.svelte';
	import { dmHeads } from '$lib/dm/heads.svelte';
	import Logo from '$lib/brand/Logo.svelte';
	import Sidebar from '$lib/nav/Sidebar.svelte';
	import { openMember } from '$lib/nav/open-member';
	import { Menu } from '@lucide/svelte';
	import JukeboxDock from '$lib/room/JukeboxDock.svelte';
	import ScreenShareNotice from '$lib/room/ScreenShareNotice.svelte';
	import Toasts from '$lib/components/Toasts.svelte';
	import ContextMenuHost from '$lib/components/ContextMenuHost.svelte';
	import ImageViewer from '$lib/chat/ImageViewer.svelte';

	let { children } = $props();

	void account.load();

	// DM arrivals blip and badge on every page, not just where the friends
	// panel mounts (audit #219).
	$effect(() => {
		if (account.me) dmHeads.start();
	});

	// Account → local profile cache, once me arrives (ADR-0009: server truth).
	const profile = createProfileStore();
	$effect(() => {
		if (account.me) pullProfile(profile);
	});

	// Appearance follows the account (#326): the server's choice wins over
	// this device's; a device that chose first pushes its choice up. Untracked:
	// adopting writes the stores it reads, and this effect is about `me`.
	$effect(() => {
		const me = account.me;
		if (!me) return;
		untrack(() => {
			palette.adopt(me.accentPalette);
			theme.adopt(me.colorScheme);
		});
	});

	// ADR-0009: everything behind sign-in. /login is the only public route;
	// /dev mocks stay open in dev builds (they 404 in production anyway).
	// '/' is public since #111: signed out it is the marketing landing, the
	// page branches itself (ADR-0009, amended).
	const publicPath = $derived(
		page.url.pathname === '/login' ||
			page.url.pathname === '/' ||
			page.url.pathname === '/legal' ||
			page.url.pathname === '/privacy' ||
			(dev && page.url.pathname.startsWith('/dev')),
	);
	const gated = $derived(account.loaded && !account.me && !publicPath);

	// Signing out leaves the room. The connection holds the socket, the voice
	// channel and — since #521 — the trainer, and a signed-out session must
	// hold none of them: the room's pages are gone, so nothing else would.
	$effect(() => {
		if (account.loaded && !account.me) roomConnection.leave();
	});

	// ONE rail, owned here, on every page — the room included (#191): navigating
	// out of a room must not swap rail instances. Only login is its own frame:
	// the spectator view used to be the other one, and a phone stands in the
	// framed room itself now (#412).
	const framed = $derived(
		!!account.me && !publicPath && page.url.pathname !== '/login',
	);

	// Presence is pushed, not polled (#251): the lobby socket pings, the store
	// re-fetches — this replaced the shell's 10 s poll.
	$effect(() => {
		if (!framed) return;
		presence.start();
		return () => presence.stop();
	});

	// The room you are IN is tick-fresh: names change the second someone joins,
	// not on the next poll (#191 rider report).
	const shownRooms = $derived(
		presence.rooms.map((room) => {
			const conn = roomConnection.current;
			const roster = conn?.live.tick?.roster;
			if (!conn || room.slug !== conn.slug || !roster) return room;
			return {
				...room,
				connected: roster.length,
				riders: roster.map((r) => r.name),
			};
		}),
	);

	// The room your screen is going to (#563). Named, because the notice has
	// to say where — the connection outlives the room's pages, so a rider can
	// be three screens away while their desktop is still on the stage.
	const sharingRoom = $derived.by(() => {
		const conn = roomConnection.current;
		if (!conn) return null;
		return {
			slug: conn.slug,
			name: presence.rooms.find((room) => room.slug === conn.slug)?.name,
		};
	});

	// The room whose pages you are on opens in the sidebar — only under /r/:
	// a room's thread on /messages carries the same slug param and is
	// deliberately not standing in the room (#468).
	const roomSlug = $derived(
		page.url.pathname.startsWith('/r/') ? (page.params?.slug ?? '') : '',
	);

	// A rider named in a room's people line (#540). The rail knows the name and
	// the slug; the id — and so their page — comes from the room's member list,
	// which is member-gated server-side.
	const showMember = (slug: string, name: string) =>
		void openMember(slug, name, (href) => void goto(href));

	// Below md the sidebar is a drawer (#391). It closes on navigation —
	// leaving it open over the page you just asked for is the classic
	// mobile-nav bug.
	let drawer = $state(false);
	$effect(() => {
		page.url.pathname;
		drawer = false;
	});

	// Leaving while standing in the room: the page must leave too, or you
	// stare at a room you are no longer in with no way back in (rider report).
	// Shared by the rail's button and the mobile chip (#251).
	function leaveRoom() {
		roomConnection.leave();
		if (page.url.pathname.startsWith('/r/'))
			void goto('/home', { replaceState: true });
	}

	$effect(() => {
		if (gated) {
			const next = page.url.pathname + page.url.search;
			void goto(`/login?next=${encodeURIComponent(next)}`, {
				replaceState: true,
			});
		}
	});

	// The OAuth round-trip lands on "/" — pick up the stashed deep link, and
	// with no stash, a signed-in "/" is the rooms hub (#126). One effect owns
	// both so the redirect can never race the deep link (it did, twice).
	// Exactly once per page load: goto() is async, the effect can re-run
	// before the URL changes, and a second run with the stash already consumed
	// used to fire the fallback over the in-flight deep link.
	let routed = false;
	$effect(() => {
		if (!account.me || routed) return;
		const next = takeNext();
		if (next) {
			routed = true;
			void goto(next, { replaceState: true });
		} else if (page.url.pathname === '/') {
			routed = true;
			void goto('/home', { replaceState: true });
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if !account.loaded && !publicPath}
	<!-- Hold the frame while /api/me answers — no gated flash, no login flash. -->
	<div class="grid min-h-dvh place-items-center" aria-busy="true"></div>
{:else if gated}
	<!-- redirecting -->
{:else if framed}
	<!-- The RIDE is the cave (#113, refined on rider feedback): the lounge is
	     a desk surface and follows the theme — the lights go down when the
	     session starts, and come back up when it ends. A solo ride or ramp
	     test is a ride too (ADR-0020), so the whole frame goes dark with it —
	     not a dark instrument beside a daylight sidebar. -->
	{@const ridePhase = roomConnection.current?.live.tick?.state.phase}
	{@const caved =
		(page.url.pathname.startsWith('/r/') &&
			(ridePhase === 'countdown' ||
				ridePhase === 'running' ||
				ridePhase === 'paused')) ||
		soloRide.active}
	<div class="flex h-dvh overflow-hidden {caved ? 'cave bg-surface' : ''}">
		<!-- The sidebar is the app's whole navigation (ADR-0020): destinations,
		     rooms, the places inside the room you are standing in, messages and
		     you. Owned here so navigating out of a room does not swap instances
		     (#191). Below md it slides in as a drawer — same instance, same
		     order: a small window gets the shape, not a different app (#391).
		     A PHONE is a different question and already has its answer —
		     WATTROOM.md scopes phones read-only and /r/[slug] redirects them to
		     the spectator view. -->
		{#if drawer}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div
				class="bg-paper/60 fixed inset-0 z-40 md:hidden"
				onclick={() => (drawer = false)}
			></div>
		{/if}
		<div
			class="fixed inset-y-0 left-0 z-50 shrink-0 transition-transform duration-200 md:static md:z-auto md:translate-x-0 {drawer
				? 'translate-x-0 shadow-2xl'
				: '-translate-x-full'}"
		>
			{#if roomConnection.current}
				{@const av = roomConnection.current.av}
				<Sidebar
					pathname={page.url.pathname}
					rooms={shownRooms}
					activeSlug={roomSlug}
					connectedSlug={roomConnection.current.slug}
					live={roomConnection.current.live.tick?.state.phase === 'running'}
					onLeave={leaveRoom}
					onMember={showMember}
					showAv={!!account.me?.avEnabled}
					voiceStatus={av.status}
					micOn={av.micOn}
					camOn={av.camOn}
					sharing={av.sharing}
					onJoin={() => void av.join()}
					onMic={() => av.toggleMic()}
					onCam={() => av.toggleCam()}
					onShare={() => void av.toggleShare()}
					onLeaveVoice={() => av.leave()}
					handedOff={av.handedOff}
					onTakeOver={() => av.takeOver()}
				/>
			{:else}
				<Sidebar
					pathname={page.url.pathname}
					rooms={shownRooms}
					activeSlug={roomSlug}
					onMember={showMember}
				/>
			{/if}
		</div>
		<div class="flex min-w-0 flex-1 flex-col overflow-hidden">
			{#if !caved}
				<!-- The only chrome the drawer needs. It goes with the lights: the
				     ride owns the whole screen (#113) — below md the button
				     reappears in the thumb zone instead (see the FAB below), or a
				     phone would have no navigation at all once a session starts. -->
				<div
					class="border-ink/5 flex shrink-0 items-center gap-2 border-b px-3 py-2 md:hidden"
				>
					<button
						onclick={() => (drawer = true)}
						class="text-muted hover:text-ink rounded p-1"
						aria-label="open navigation"><Menu size={20} /></button
					>
					<Logo
						size={18}
						live={roomConnection.current?.live.tick?.state.phase === 'running'}
					/>
					<span class="font-display truncate text-sm font-bold">WattRoom</span>
				</div>
			{/if}
			<!-- Persistent, above whatever page you are on and outside its
			     scroll: your screen being live is ride-critical status, and the
			     one AV state that can leak a private tab (#563, errors.md). -->
			{#if roomConnection.current}
				{@const av = roomConnection.current.av}
				<ScreenShareNotice
					sharing={av.sharing}
					room={sharingRoom}
					pathname={page.url.pathname}
					onStop={() => void av.toggleShare()}
				/>
			{/if}
			<div class="min-h-0 flex-1 overflow-y-auto">
				{@render children()}
			</div>
		</div>
		{#if caved}
			<!-- The ride took the top bar, so the way back to the drawer is where
			     a thumb already is: bottom left, mirroring the room's people
			     button bottom right. Below md only — every wider window still has
			     the sidebar standing there (#412). -->
			<button
				onclick={() => (drawer = true)}
				class="bg-surface-raised ring-ink/15 fixed bottom-4 left-4 z-40 grid
				h-12 w-12 place-items-center rounded-full shadow-lg ring-1 md:hidden"
				aria-label="open navigation"
			>
				<Menu size={20} />
			</button>
		{/if}
		<!-- The jukebox dock lives on the frame (#216) and has to: RMF forbids
		     auto-advance while the player is offscreen, so it cannot be a place.
		     Threads became places instead (ADR-0020) — /messages (#468). -->
		<JukeboxDock />
	</div>
{:else}
	{@render children()}
{/if}

<!-- App-wide, framed or not — a toast must be able to land anywhere, and a
     picture opens over whatever chat sent it: a room's, a DM's, a thread's. -->
<Toasts />
<ImageViewer />
<ContextMenuHost />
