<script lang="ts">
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
	import { fetchRailRooms } from '$lib/nav/rooms';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { createProfileStore } from '$lib/profile.svelte';
	import { pullProfile } from '$lib/profile-sync.svelte';
	import DmDrawer from '$lib/dm/DmDrawer.svelte';
	import { dmHeads } from '$lib/dm/heads.svelte';
	import JukeboxDock from '$lib/room/JukeboxDock.svelte';
	import MemberCard from '$lib/room/MemberCard.svelte';
	import RoomRail from '$lib/room/RoomRail.svelte';
	import type { RailRoom } from '$lib/room/mockcompat';

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

	// ADR-0009: everything behind sign-in. /login is the only public route;
	// /dev mocks stay open in dev builds (they 404 in production anyway).
	// '/' is public since #111: signed out it is the marketing landing, the
	// page branches itself (ADR-0009, amended).
	const publicPath = $derived(
		page.url.pathname === '/login' ||
			page.url.pathname === '/' ||
			(dev && page.url.pathname.startsWith('/dev')),
	);
	const gated = $derived(account.loaded && !account.me && !publicPath);

	// ONE rail, owned here, on every page — the room included (#191): navigating
	// out of a room must not swap rail instances. Only the spectator view and
	// login are their own frame.
	const framed = $derived(
		!!account.me &&
			!publicPath &&
			!page.url.pathname.endsWith('/watch') &&
			page.url.pathname !== '/login',
	);

	let railRooms = $state<RailRoom[]>([]);
	$effect(() => {
		if (!framed) return;
		page.url.pathname; // re-fetch presence on every navigation
		const refresh = () =>
			void fetchRailRooms().then((rooms) => (railRooms = rooms));
		refresh();
		// ponytail: 10 s poll for other rooms' presence; push it over the WS
		// if the fleet ever makes polling expensive.
		const timer = setInterval(refresh, 10_000);
		return () => clearInterval(timer);
	});

	// The room you are IN is tick-fresh: names change the second someone joins,
	// not on the next poll (#191 rider report).
	const shownRooms = $derived(
		railRooms.map((room) => {
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

	// The member popout (#207): a rail click fetches the room's member list
	// (member-gated server-side) and shows who that rider is.
	interface PopoutMember {
		id: string;
		displayName: string;
		role: string;
		ftpWatts: number;
		weightKg: number;
		joinedAt: string;
	}
	interface PopoutMedal {
		kind: string;
		rider: string;
		awardedAt: string;
	}
	let popout = $state<{
		member: PopoutMember;
		roomName: string;
		slug: string;
		medals: PopoutMedal[];
	} | null>(null);
	async function openMember(slug: string, name: string) {
		const res = await fetch(`/api/rooms/${slug}`).then(
			(r) => (r.ok ? r.json() : null),
			() => null,
		);
		const member = res?.members?.find(
			(m: PopoutMember) => m.displayName === name,
		);
		if (member)
			popout = {
				member,
				roomName: res.name ?? slug,
				slug,
				medals: res.medals ?? [],
			};
	}

	const railYou = $derived({
		name: account.me?.displayName ?? '',
		ftp: account.me?.ftpWatts ?? 0,
	});

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
	     session starts, and come back up when it ends. -->
	{@const ridePhase = roomConnection.current?.live.tick?.state.phase}
	{@const caved =
		page.url.pathname.startsWith('/r/') &&
		(ridePhase === 'countdown' ||
			ridePhase === 'running' ||
			ridePhase === 'paused')}
	<div class="flex h-dvh overflow-hidden {caved ? 'cave bg-surface' : ''}">
		<div class="hidden shrink-0 md:block">
			{#if roomConnection.current}
				{@const av = roomConnection.current.av}
				{@const roster = roomConnection.current.live.tick?.roster ?? []}
				<RoomRail
					you={railYou}
					live={roomConnection.current.live.tick?.state.phase === 'running'}
					rooms={shownRooms}
					activeSlug={page.params?.slug ?? ''}
					connectedSlug={roomConnection.current.slug}
					onLeave={() => {
						roomConnection.leave();
						// Leaving while standing in the room: the page must leave
						// too, or you stare at a room you are no longer in with no
						// way back in (rider report).
						if (page.url.pathname.startsWith('/r/'))
							void goto('/home', { replaceState: true });
					}}
					onMember={(slug, name) => void openMember(slug, name)}
					micOn={av.micOn}
					camOn={av.camOn}
					micLevel={av.micLevel}
					activeSpeaking={roster
						.filter((r) => av.speaking[r.id])
						.map((r) => r.name)}
					mixRiders={roster
						.filter((r) => r.id !== account.me?.id)
						.map((r) => ({ id: r.id, name: r.name }))}
					onRiderGain={(id, gain) => av.setRiderGain(id, gain)}
					transmitting={av.transmitting}
					voiceMode={av.mode}
					gateThreshold={av.gateThreshold}
					pttHeld={av.pttHeld}
					onVoiceMode={(m) => av.setMode(m)}
					onGateThreshold={(t) => av.setGateThreshold(t)}
					onPtt={(held) => av.setPtt(held)}
					micTesting={av.micTesting}
					onMicTest={() => void av.toggleMicTest()}
					onMic={() => (av.status === 'live' ? av.toggleMic() : av.join())}
					onCam={() => (av.status === 'live' ? av.toggleCam() : av.join())}
				/>
			{:else}
				<RoomRail
					you={railYou}
					live={false}
					rooms={shownRooms}
					activeSlug={page.params?.slug ?? ''}
					onMember={(slug, name) => void openMember(slug, name)}
					showAv={false}
				/>
			{/if}
		</div>
		<div class="min-w-0 flex-1 overflow-y-auto">
			{@render children()}
		</div>
		<!-- The DM drawer (#208) and the jukebox dock (#216) live on the
		     frame: threads and music survive navigation the same way the
		     room connection does. -->
		<JukeboxDock />
		<DmDrawer />
		{#if popout}
			{@const room = shownRooms.find((r) => r.slug === popout?.slug)}
			<MemberCard
				member={popout.member}
				roomName={popout.roomName}
				medals={popout.medals}
				online={room?.riders?.includes(popout.member.displayName) ?? false}
				inVoice={room?.voice?.includes(popout.member.displayName) ?? false}
				onClose={() => (popout = null)}
			/>
		{/if}
	</div>
{:else}
	{@render children()}
{/if}
