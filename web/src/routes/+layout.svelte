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
	import { createProfileStore } from '$lib/profile.svelte';
	import { pullProfile } from '$lib/profile-sync.svelte';
	import RoomRail from '$lib/room/RoomRail.svelte';
	import type { RailRoom } from '$lib/room/mockcompat';

	let { children } = $props();

	void account.load();

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

	// The rail is the app's frame on every page except the ones that ARE their
	// own frame: the room (it mounts the same rail itself, with AV wired), the
	// phone spectator, login and the dev mocks.
	const framed = $derived(
		!!account.me &&
			!publicPath &&
			!page.url.pathname.startsWith('/r/') &&
			page.url.pathname !== '/login',
	);

	let railRooms = $state<RailRoom[]>([]);
	$effect(() => {
		if (!framed) return;
		page.url.pathname; // re-fetch presence on every navigation
		void fetchRailRooms().then((rooms) => (railRooms = rooms));
	});

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

	// The OAuth round-trip lands on "/" — pick up the stashed deep link there.
	$effect(() => {
		if (account.me) {
			const next = takeNext();
			if (next) void goto(next, { replaceState: true });
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
	<div class="flex h-dvh overflow-hidden">
		<div class="hidden shrink-0 md:block">
			<RoomRail you={railYou} live={false} rooms={railRooms} showAv={false} />
		</div>
		<div class="min-w-0 flex-1 overflow-y-auto">
			{@render children()}
		</div>
	</div>
{:else}
	{@render children()}
{/if}
