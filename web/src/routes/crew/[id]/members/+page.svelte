<script lang="ts">
	// The crew's Members page (#2453, ADR-0058): the room's Members place and
	// the crew settings' people half, merged. What the crew adds up to, the
	// weekly board while the crew keeps one, its people with their roles and
	// medals, your own two switches, and the sessions it rode in the last 90
	// days. Owns the four states (errors.md); the people list owns its menus.
	import { page } from '$app/state';
	import Banner from '$lib/components/Banner.svelte';
	import RiderPrefs from '$lib/components/RiderPrefs.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import TogetherTiles from '$lib/components/TogetherTiles.svelte';
	import WeekBoard from '$lib/components/WeekBoard.svelte';
	import {
		fetchCrew,
		fetchCrewMembers,
		fetchCrewRecaps,
		type Crew,
		type CrewMembers,
	} from '$lib/crew';
	import { presence } from '$lib/presence.svelte';
	import type { SessionRecap } from '$lib/protocol';
	import SessionRecapCard from '$lib/session/SessionRecapCard.svelte';
	import { untrack } from 'svelte';
	import CrewPeople from './CrewPeople.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const id = $derived(page.params.id ?? '');
	let crew = $state<Crew | null>(untrack(() => data.crew));
	let members = $state<CrewMembers | null>(untrack(() => data.members));
	let recaps = $state<SessionRecap[] | null>(untrack(() => data.recaps));
	let error = $state<string | null>(untrack(() => data.error));
	let errorCode = $state<string | null>(untrack(() => data.errorCode));
	let loadedId = $state<string | null>(untrack(() => data.id));

	async function load(which: string) {
		const [c, m, r] = await Promise.all([
			fetchCrew(which),
			fetchCrewMembers(which),
			fetchCrewRecaps(which),
		]);
		const failed = !c.ok ? c : !m.ok ? m : null;
		if (failed && !failed.ok) {
			// Only a first load fails loudly: this also runs on every lobby
			// ping, and a hiccup must not replace the page with a sentence.
			if (!crew) {
				error = failed.error.message;
				errorCode = failed.error.error;
			}
			return;
		}
		error = null;
		if (c.ok) crew = c.data;
		if (m.ok) members = m.data;
		// A recap read that fails keeps what was there, or says so below.
		if (r.ok) recaps = r.data.recaps;
	}

	$effect(() => {
		const which = id;
		if (!which || loadedId === which) return;
		loadedId = which;
		crew = null;
		members = null;
		recaps = null;
		error = null;
		void load(which);
	});
	// A role, a ban or a switch elsewhere pings the lobby (#570): re-read.
	let seenVersion = untrack(() => presence.version);
	$effect(() => {
		const version = presence.version;
		if (version === seenVersion) return;
		seenVersion = version;
		if (id && untrack(() => crew)) void load(id);
	});

	// The people list reads the crew's shape; the Members read is the same
	// roster with medals on it, so it takes the crew's place there.
	const roster = $derived(
		crew && members
			? { ...crew, people: members.members, banned: members.banned }
			: null,
	);
	const administers = $derived(
		crew?.role === 'owner' || crew?.role === 'admin',
	);
	// Newest first: the most recent evening is the one a rider looks for.
	const newestFirst = $derived([...(recaps ?? [])].reverse());
</script>

<svelte:head>
	<title>Members · {crew?.name ?? 'Crew'} · WattRoom</title>
</svelte:head>

<main class="page">
	{#if error && errorCode === 'not_found'}
		<Banner tone="error">
			{error}
			{#snippet action()}
				<a href="/home" class="btn-link text-xs">Home</a>
			{/snippet}
		</Banner>
	{:else if error}
		<Banner tone="error">
			{error}
			{#snippet action()}
				<button onclick={() => void load(id)} class="btn-link text-xs"
					>Retry</button
				>
			{/snippet}
		</Banner>
	{:else if !crew || !members || !roster}
		<Skeleton class="h-8 w-48" />
		<Skeleton class="mt-6 h-24" />
		<Skeleton class="mt-6 h-40" />
	{:else}
		<header>
			<p class="eyebrow"><a href="/crew/{crew.id}">{crew.name}</a></p>
			<h1 class="page-title-sm">
				Members — {crew.members ?? members.members.length}
			</h1>
		</header>

		<div class="mt-6">
			<TogetherTiles
				together={members.together}
				streakWeeks={members.streakWeeks}
				streakLabel="this crew's streak"
			/>
		</div>

		{#if members.boardEnabled}
			{#if members.board?.length}
				<WeekBoard rows={members.board} />
			{:else}
				<p class="panel text-muted mt-3 text-xs">
					The weekly board is on. Nobody on it has ridden a session this week
					yet — it resets Monday.
				</p>
			{/if}
		{/if}

		<CrewPeople crew={roster} onchange={() => void load(id)} />

		<RiderPrefs
			path="/api/crews/{crew.id}/me"
			me={members.me}
			boardEnabled={members.boardEnabled}
		/>
		{#if !members.boardEnabled && administers}
			<p class="text-muted mt-2 text-xs">
				The board is off until you or another admin turns it on in <a
					href="/crew/{crew.id}/settings"
					class="underline">Settings</a
				>. The crew's invite link says so before anyone joins.
			</p>
		{/if}

		<h2 class="eyebrow mt-8">sessions</h2>
		{#if recaps === null}
			<Banner tone="error">
				The crew's sessions could not be loaded.
				{#snippet action()}
					<button onclick={() => void load(id)} class="btn-link text-xs"
						>Retry</button
					>
				{/snippet}
			</Banner>
		{:else if newestFirst.length === 0}
			<p class="text-muted mt-2 text-xs">
				Every session the crew rides leaves a card here for 90 days: who came,
				and for how long.
			</p>
		{:else}
			<ul class="mt-2 grid gap-2">
				{#each newestFirst as recap (recap.id)}
					<li><SessionRecapCard {recap} /></li>
				{/each}
			</ul>
		{/if}
	{/if}
</main>
