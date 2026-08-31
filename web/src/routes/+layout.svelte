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
	import { api } from '$lib/api';
	import { takeNext } from '$lib/auth/next';
	import { presence } from '$lib/presence.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { createProfileStore } from '$lib/profile.svelte';
	import { pullProfile } from '$lib/profile-sync.svelte';
	import DmDrawer from '$lib/dm/DmDrawer.svelte';
	import { dmHeads } from '$lib/dm/heads.svelte';
	import MobileNav from '$lib/nav/MobileNav.svelte';
	import TopNav from '$lib/nav/TopNav.svelte';
	import JukeboxDock from '$lib/room/JukeboxDock.svelte';
	import MemberCard from '$lib/room/MemberCard.svelte';
	import Toasts from '$lib/components/Toasts.svelte';
	import RoomRail from '$lib/room/RoomRail.svelte';
	import { LogOut } from '@lucide/svelte';

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
			page.url.pathname === '/legal' ||
			page.url.pathname === '/privacy' ||
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

	// The member popout (#207): a rail click fetches the room's member list
	// (member-gated server-side) and shows who that rider is.
	interface PopoutMember {
		id: string;
		displayName: string;
		avatarUrl?: string;
		avatarPreset?: string;
		totalXp?: number;
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
		const res = await api<{
			name?: string;
			members?: PopoutMember[];
			medals?: PopoutMedal[];
		}>(`/api/rooms/${slug}`);
		if (!res.ok) return;
		const member = res.data.members?.find((m) => m.displayName === name);
		if (member)
			popout = {
				member,
				roomName: res.data.name ?? slug,
				slug,
				medals: res.data.medals ?? [],
			};
	}

	const railYou = $derived({ name: account.me?.displayName ?? '' });

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
					showAv={!!account.me?.avEnabled}
					live={roomConnection.current.live.tick?.state.phase === 'running'}
					rooms={shownRooms}
					activeSlug={page.params?.slug ?? ''}
					connectedSlug={roomConnection.current.slug}
					onLeave={leaveRoom}
					onMember={(slug, name) => void openMember(slug, name)}
					micOn={av.micOn}
					camOn={av.camOn}
					voiceStatus={av.status}
					devices={{ mics: av.mics, cams: av.cams, outs: av.outs }}
					micId={av.micId}
					camId={av.camId}
					outId={av.outId}
					canPickOutput={av.canPickOutput}
					onDevice={(kind, id) =>
						kind === 'mic'
							? void av.setMic(id)
							: kind === 'cam'
								? void av.setCam(id)
								: av.setOut(id)}
					onDevicesOpen={() => void av.refreshDevices()}
					micLevel={av.micLevel}
					activeSpeaking={roster
						.filter((r) => av.speaking[r.id])
						.map((r) => r.name)}
					mixRiders={roster
						.filter((r) => r.id !== account.me?.id && av.voice[r.id] === 'live')
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
		<!-- Room chip adds a second bar on mobile — pad the content past both. -->
		<div
			class="min-w-0 flex-1 overflow-y-auto {caved
				? ''
				: roomConnection.current
					? 'pb-28 md:pb-0'
					: 'pb-16 md:pb-0'}"
		>
			{#if !caved}
				<TopNav />
			{/if}
			{@render children()}
		</div>
		<!-- The ride owns the whole screen while caved; the tab bar returns
		     with the lights. -->
		{#if !caved}
			<MobileNav />
			{#if roomConnection.current}
				<!-- The mobile "you are in this room" chip (#251): the desktop rail's
				     dot + leave button, which phones never had. Sits on the tab bar. -->
				{@const connected = roomConnection.current}
				<div
					class="border-ink/10 bg-surface fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-2 border-t px-4 py-2 md:hidden"
				>
					<a
						href="/r/{connected.slug}"
						class="flex min-w-0 flex-1 items-center gap-2 py-1"
					>
						<span class="bg-z4 h-2 w-2 shrink-0 animate-pulse rounded-full"
						></span>
						<span class="truncate text-xs font-medium"
							>in {presence.rooms.find((r) => r.slug === connected.slug)
								?.name ?? connected.slug}</span
						>
					</a>
					<button
						onclick={leaveRoom}
						class="text-muted hover:text-ink flex shrink-0 items-center gap-1.5 rounded px-3 py-2 text-xs"
						aria-label="leave the room"
					>
						<LogOut size={14} /> Leave
					</button>
				</div>
			{/if}
		{/if}
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

<!-- App-wide, framed or not — a toast must be able to land anywhere. -->
<Toasts />
