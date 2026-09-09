<script lang="ts">
	// The crew's own page (ADR-0038; #1150, #1151): its name, its rooms with
	// what you may do in each, its people with their crew roles, and — for
	// the owner and admins — the people it banned. The rooms and the people
	// are components of their own (#1234); this page is the header, the
	// invite and the way out. Nothing live: the crew carries no voice, deck,
	// session or metrics.
	import { page } from '$app/state';
	import { account } from '$lib/account.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import CrewMark from '$lib/components/CrewMark.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import CrewPeople from './CrewPeople.svelte';
	import CrewRooms from './CrewRooms.svelte';
	import { fetchCrew, type Crew } from '$lib/crew';
	import { copyInviteLink, leaveCrewFlow } from '$lib/crew-flows';
	import { chosenCrew } from '$lib/nav/chosen-crew.svelte';
	import { presence } from '$lib/presence.svelte';
	import Copy from '@lucide/svelte/icons/copy';
	import Settings from '@lucide/svelte/icons/settings';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const id = $derived(page.params.id ?? '');
	let crew = $state<Crew | null>(untrack(() => data.crew));
	let error = $state<string | null>(untrack(() => data.error));
	let loadedId = $state<string | null>(untrack(() => data.id));
	let busy = $state(false);

	async function load(which: string) {
		const res = await fetchCrew(which);
		if (!res.ok) {
			// Only a first load fails loudly: this also runs on every lobby
			// ping, and one hiccup must not replace the page you are reading
			// with a sentence (the room layout draws the same line).
			if (!crew) error = res.error.message;
			return;
		}
		error = null;
		crew = res.data;
	}

	$effect(() => {
		const which = id;
		if (!which || loadedId === which) return;
		if (data.id === which) {
			crew = data.crew;
			error = data.error;
			loadedId = which;
			return;
		}
		loadedId = which;
		crew = null;
		error = null;
		void load(which);
	});
	// A role change or a rename pings the lobby (#570); re-read on it — on
	// the ping, not on mount, where the loader's read is seconds old.
	let seenVersion = untrack(() => presence.version);
	$effect(() => {
		const version = presence.version;
		if (version === seenVersion) return;
		seenVersion = version;
		const loaded = untrack(() => crew);
		if (id && loaded) void load(id);
	});

	// The sidebar is in this crew while you are on its page (ADR-0020
	// amended, rule 1): the header names where you are, not the crew you
	// last picked.
	$effect(() => {
		if (crew) chosenCrew.set(crew.id);
	});

	const administers = $derived(
		crew?.role === 'owner' || crew?.role === 'admin',
	);
	const owner = $derived(crew?.role === 'owner');
	// The crew's size, not the length of the list you may see (#1135).
	const members = $derived(crew?.members ?? crew?.people.length ?? 0);

	// Leaving the crew (#1228, #1236): one call takes the membership and every
	// room of the crew you were in. Refused up front when you own a room here:
	// a room never leaves its crew, so neither can its owner — hand it on
	// first (#1227). Undo rejoins by the code the client still holds.
	const myRooms = $derived(
		presence.rooms.filter((r) => r.crew?.id === crew?.id && !!r.role),
	);
	const ownedHere = $derived(myRooms.filter((r) => r.role === 'owner'));
	// The crew's own roster already says whether you own a room here, so the
	// button is right before presence lands rather than a 409 on click.
	const ownsRoomHere = $derived(
		ownedHere.length > 0 ||
			!!crew?.people.find((p) => p.id === account.me?.id)?.ownsRoom,
	);
	async function leaveCrew() {
		if (!crew || owner || ownsRoomHere) return;
		busy = true;
		await leaveCrewFlow(crew);
		busy = false;
	}
</script>

<svelte:head>
	<title>{crew?.name ?? 'Crew'} · WattRoom</title>
</svelte:head>

<main class="page">
	{#if error}
		<Banner tone="error">
			{error}
			{#snippet action()}
				<button onclick={() => void load(id)} class="btn-link text-xs"
					>Retry</button
				>
			{/snippet}
		</Banner>
	{:else if !crew}
		<Skeleton class="h-8 w-48" />
		<Skeleton class="mt-6 h-40" />
	{:else}
		<header class="flex items-start gap-3">
			<CrewMark
				name={crew.name}
				icon={crew.icon}
				imageUrl={crew.imageUrl}
				size={48}
				class="rounded-xl"
			/>
			<div class="min-w-0 flex-1">
				<h1 class="font-display truncate text-2xl font-bold tracking-tight">
					{crew.name}
				</h1>
				<p class="text-muted text-sm">
					{crew.rooms.length === 1 ? '1 room' : `${crew.rooms.length} rooms`}
					· {members === 1 ? '1 person' : `${members} people`}
					{#if owner}
						· yours
					{:else if crew.role === 'admin'}
						· you admin it
					{/if}
				</p>
			</div>
			{#if administers}
				<!-- Name, picture, icon and the invite live in one place (#1237),
				     the way a room's do; this page is the roster. -->
				<a
					href="/crew/{crew.id}/settings"
					class="btn btn-secondary btn-xs shrink-0"
					><Settings size={13} /> Settings</a
				>
			{/if}
		</header>

		{#if owner && crew.name === account.me?.displayName}
			<!-- The migration's placeholder (#1151): said here, where the name
			     is one click away, until the owner replaces it. -->
			<p class="text-muted mt-2 text-xs">
				Named after you until you rename it — in <a
					href="/crew/{crew.id}/settings"
					class="underline">Settings</a
				>.
			</p>
		{/if}

		{#if crew.code}
			<h2 class="eyebrow mt-8">invite</h2>
			<!-- Stacked on a phone: the sentence between the code and the
			     button squeezed into a six-line column at 375px. -->
			<div
				class="panel mt-2 flex flex-col gap-3 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center"
			>
				<span class="min-w-0">
					<span class="eyebrow">crew code</span>
					<span class="font-display block text-lg font-bold tracking-widest"
						>{crew.code}</span
					>
				</span>
				<span class="text-muted min-w-0 flex-1 text-xs">
					Anyone with it joins {crew.name} and walks into its open rooms. Rooms have
					no codes of their own.
				</span>
				<button
					onclick={() => crew?.code && copyInviteLink(crew.code)}
					class="btn btn-secondary btn-xs shrink-0 self-start sm:self-auto"
					><Copy size={13} /> Copy invite link</button
				>
			</div>
		{/if}

		<CrewRooms {crew} {administers} onchange={() => void load(id)} />
		<CrewPeople {crew} onchange={() => void load(id)} />

		<!-- The way out (#1228): the one thing a member can do to the crew. It
		     says exactly what it does, and the danger token sits last (ux.md).
		     The owner sees it disabled with the route out (docs/SPEC.md's
		     matrix: hand the crew on first) rather than nothing at all. -->
		<h2 class="eyebrow mt-8">leave</h2>
		<div class="panel mt-2 flex flex-wrap items-center gap-3 px-4 py-3">
			<p class="text-muted min-w-0 flex-1 text-xs">
				{#if owner}
					You own {crew.name} — hand it to someone in the people list first, then
					leave.
				{:else if ownsRoomHere}
					You own {ownedHere.length === 1
						? ownedHere[0].name
						: ownedHere.length
							? `${ownedHere.length} rooms`
							: 'a room'} here, and a room never leaves its crew — hand {ownedHere.length ===
					1
						? 'it'
						: 'them'} to a member first, then leave.
				{:else if myRooms.length}
					Leaving takes you out of {crew.name} and the {myRooms.length === 1
						? 'room'
						: `${myRooms.length} rooms`} of it you are in. The code gets you back.
				{:else}
					Leaving takes you out of {crew.name}. The code gets you back.
				{/if}
			</p>
			<button
				onclick={leaveCrew}
				disabled={busy || owner || ownsRoomHere}
				class="btn btn-danger btn-xs shrink-0">Leave the crew</button
			>
		</div>
	{/if}
</main>
