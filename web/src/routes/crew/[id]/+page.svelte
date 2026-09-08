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
			error = res.error.message;
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
	$effect(() => {
		// A role change or a rename pings the lobby (#570); re-read on it.
		presence.version;
		const loaded = untrack(() => crew);
		if (id && loaded) void load(id);
	});

	const administers = $derived(
		crew?.role === 'owner' || crew?.role === 'admin',
	);
	const owner = $derived(crew?.role === 'owner');

	// Leaving the crew (#1228, #1236): one call takes the membership and every
	// room of the crew you were in. Refused up front when you own a room here:
	// a room never leaves its crew, so neither can its owner — hand it on
	// first (#1227). Undo rejoins by the code the client still holds.
	const myRooms = $derived(
		presence.rooms.filter((r) => r.crew?.id === crew?.id && !!r.role),
	);
	const ownedHere = $derived(myRooms.filter((r) => r.role === 'owner'));
	async function leaveCrew() {
		if (!crew || ownedHere.length) return;
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
		<Banner>{error}</Banner>
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
					· {crew.people.length === 1
						? '1 person'
						: `${crew.people.length} people`}
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

		{#if !owner}
			<!-- The way out (#1228): the one thing a member can do to the crew.
			     Crew membership follows room membership, so it says exactly
			     what it does, and the danger token sits last (ux.md). -->
			<h2 class="eyebrow mt-8">leave</h2>
			<div class="panel mt-2 flex flex-wrap items-center gap-3 px-4 py-3">
				<p class="text-muted min-w-0 flex-1 text-xs">
					{#if ownedHere.length}
						You own {ownedHere.length === 1
							? ownedHere[0].name
							: `${ownedHere.length} rooms`} here, and a room never leaves its crew
						— hand {ownedHere.length === 1 ? 'it' : 'them'} to a member first, then
						leave.
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
					disabled={busy || !!ownedHere.length}
					class="btn btn-danger btn-xs shrink-0">Leave the crew</button
				>
			</div>
		{/if}
	{/if}
</main>
