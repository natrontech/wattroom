<script lang="ts">
	// The crew's Home (ADR-0038, ADR-0058; #1150, #1151, #2451): its name,
	// then what is live, what is next and who is around (CrewNow), then the
	// invite and the way out. The live half
	// is read from the crew's voice channels; the crew itself holds nothing
	// live.
	import { page } from '$app/state';
	import { account } from '$lib/account.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import CrewMark from '$lib/components/CrewMark.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import RecoveredNotice from '$lib/ride/RecoveredNotice.svelte';
	import CrewNow from './CrewNow.svelte';
	import YourWeek from './YourWeek.svelte';
	import { fetchCrew, type Crew } from '$lib/crew';
	import {
		leaveCrewFlow,
		MAIN_CREW_HINT,
		MAIN_CREW_LABEL,
		makeMainCrewFlow,
		shareInviteLink,
	} from '$lib/crew-flows';
	import { presence } from '$lib/presence.svelte';
	import { shareVerb } from '$lib/share';
	import Copy from '@lucide/svelte/icons/copy';
	import Settings from '@lucide/svelte/icons/settings';
	import Users from '@lucide/svelte/icons/users';
	import Star from '@lucide/svelte/icons/star';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const id = $derived(page.params.id ?? '');
	let crew = $state<Crew | null>(untrack(() => data.crew));
	let error = $state<string | null>(untrack(() => data.error));
	let errorCode = $state<string | null>(untrack(() => data.errorCode));
	let loadedId = $state<string | null>(untrack(() => data.id));
	let busy = $state(false);

	async function load(which: string) {
		const res = await fetchCrew(which);
		if (!res.ok) {
			// Only a first load fails loudly: this also runs on every lobby
			// ping, and one hiccup must not replace the page you are reading
			// with a sentence (the voice channel's shell draws the same line).
			if (!crew) {
				error = res.error.message;
				errorCode = res.error.error;
			}
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
			errorCode = data.errorCode;
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

	const administers = $derived(
		crew?.role === 'owner' || crew?.role === 'admin',
	);
	const owner = $derived(crew?.role === 'owner');
	// The crew's size, not the length of the list you may see (#1135).
	const members = $derived(crew?.members ?? crew?.people.length ?? 0);

	// Leaving the crew (#1228, #1236): one call takes the membership and the
	// private channels you were named into. A confirm, not an undo: rejoining
	// by the code brings back the membership and nothing else (crew-flows.ts).
	async function leaveCrew() {
		if (!crew || owner) return;
		busy = true;
		await leaveCrewFlow(crew);
		busy = false;
	}
</script>

<svelte:head>
	<title>{crew?.name ?? 'Crew'} · WattRoom</title>
</svelte:head>

<main class="page">
	{#if error && errorCode === 'not_found'}
		<!-- Permanent: not a crew of yours, or none at all. A Retry here
		     answered the same sentence forever (#1677). -->
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
	{:else if !crew}
		<Skeleton class="h-8 w-48" />
		<Skeleton class="mt-6 h-40" />
	{:else}
		<!-- Wraps below sm (#2175): the mark, the name and its line take the
		     row, and the actions drop to one of their own. Unwrapped, an admin
		     in two or more crews — the only case the main-crew control renders
		     in — had "Make main crew" and "Settings" leaving about thirty
		     pixels for the crew's name at 375 px, so it was an ellipsis. -->
		<header class="flex flex-wrap items-start gap-3">
			<CrewMark
				name={crew.name}
				icon={crew.icon}
				imageUrl={crew.imageUrl}
				size={48}
				class="rounded-xl"
			/>
			<div class="min-w-0 flex-1">
				<h1 class="page-title-sm truncate">
					{crew.name}
				</h1>
				<p class="text-muted text-sm">
					{members === 1 ? '1 person' : `${members} people`}
					{#if owner}
						· yours
					{:else if crew.role === 'admin'}
						· you admin it
					{/if}
				</p>
			</div>
			{#if presence.crews.length > 1 || administers}
				<!-- A row of their own below sm (#2175). Wrapping the header is not
				     enough on its own: a flex item shrinks before it wraps, so the
				     title kept giving width back to these two until it was an
				     ellipsis. `basis-full` makes them a row instead. -->
				<div class="flex basis-full items-center gap-2 sm:basis-auto">
					{#if presence.crews.length > 1}
						<!-- The main crew (#2144): the one the sidebar opens in on every
					     device. A choice only once there is one to make. -->
						{#if account.me?.homeCrewId === crew.id}
							<span
								class="text-muted flex shrink-0 items-center gap-1 text-xs"
								title={MAIN_CREW_HINT}><Star size={13} /> main crew</span
							>
						{:else}
							<button
								onclick={() => crew && makeMainCrewFlow(crew)}
								class="btn btn-secondary btn-xs shrink-0"
								title={MAIN_CREW_HINT}
								><Star size={13} /> {MAIN_CREW_LABEL}</button
							>
						{/if}
					{/if}
					{#if administers}
						<!-- Name, picture, icon, channels and reactions live on
					     Settings (#1237, #2454); this page is the roster and the
					     invite. -->
						<a
							href="/crew/{crew.id}/settings"
							class="btn btn-secondary btn-xs shrink-0"
							><Settings size={13} /> Settings</a
						>
					{/if}
				</div>
			{/if}
		</header>

		{#if owner && !crew.named}
			<!-- The migration's placeholder (#1151): said here, where the name
			     is one click away, until the owner replaces it. -->
			<p class="text-muted mt-2 text-xs">
				Named after you until you rename it — in <a
					href="/crew/{crew.id}/settings"
					class="underline">Settings</a
				>.
			</p>
		{/if}

		<!-- WattRoom opens here (#2576), so a ride to rescue is said here (#2616). -->
		<RecoveredNotice />
		<YourWeek />
		<CrewNow {crew} />
		<!-- The people, their roles, the board and the crew's sessions have one
		     home since #2453: the Members page. -->
		<a href="/crew/{crew.id}/members" class="btn btn-secondary mt-8"
			><Users size={14} /> Members{#if crew.members}&nbsp;· {crew.members}{/if}</a
		>

		<!-- After the people (#1931): a newcomer used to read a code before the
		     place they came for. Still the invite's one home. -->
		{#if crew.code}
			<h2 class="eyebrow mt-8">invite</h2>
			<!-- Stacked on a phone: the sentence between the code and the
			     button squeezed into a six-line column at 375px. -->
			<div
				class="panel mt-2 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
			>
				<span class="min-w-0">
					<span class="eyebrow">crew code</span>
					<span class="font-display block text-lg font-bold tracking-widest"
						>{crew.code}</span
					>
				</span>
				<span class="text-muted min-w-0 flex-1 text-xs">
					Anyone with it joins {crew.name} and walks into its open channels.
				</span>
				<button
					onclick={() => crew?.code && shareInviteLink(crew.code)}
					class="btn btn-secondary btn-xs shrink-0 self-start sm:self-auto"
					><Copy size={13} /> {shareVerb()} invite link</button
				>
			</div>
		{/if}

		<!-- The way out (#1228): the one thing a member can do to the crew. It
		     says exactly what it does, and the danger token sits last (ux.md).
		     The owner sees it disabled with the route out (docs/SPEC.md's
		     matrix: hand the crew on first) rather than nothing at all. -->
		<h2 class="eyebrow mt-8">leave</h2>
		<div class="panel mt-2 flex flex-wrap items-center gap-3">
			<p class="text-muted min-w-0 flex-1 text-xs">
				{#if owner}
					You own {crew.name} — hand it to someone on
					<a href="/crew/{crew.id}/members" class="underline">Members</a> first, then
					leave.
				{:else}
					Leaving takes you out of {crew.name}. The code gets you back.
				{/if}
			</p>
			<button
				onclick={leaveCrew}
				disabled={busy || owner}
				class="btn btn-danger btn-xs shrink-0">Leave the crew</button
			>
		</div>
	{/if}
</main>
