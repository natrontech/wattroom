<script lang="ts">
	// A rider's page (ADR-0024): what rooms already see — level, energy,
	// medals from rooms you share, where they are — plus, for friends, the
	// rides they chose to share. Built from the /dev/profile mock (#457).
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import Avatar from '$lib/components/Avatar.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { dm } from '$lib/dm/dm.svelte';
	import { levelFromXp, levelProgress, xpForLevel } from '$lib/level';
	import { medalName } from '$lib/medals';
	import { presence } from '$lib/presence.svelte';
	import {
		fetchRider,
		medalTotal,
		monthLine,
		ridePlace,
		rideLine,
		type Rider,
	} from '$lib/rider';
	import { toasts } from '$lib/toast.svelte';
	import BadgeGrid from '$lib/trophies/BadgeGrid.svelte';
	import TrophyCase from '$lib/trophies/TrophyCase.svelte';
	import { fetchTrophies, type Trophies } from '$lib/trophies/trophies';
	import Award from '@lucide/svelte/icons/award';
	import Check from '@lucide/svelte/icons/check';
	import Eye from '@lucide/svelte/icons/eye';
	import Lock from '@lucide/svelte/icons/lock';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Radio from '@lucide/svelte/icons/radio';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Users from '@lucide/svelte/icons/users';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The resolved id: the loader turns /u/me into yours (#1330).
	const id = $derived(
		page.params.id === 'me' ? (data.id ?? '') : (page.params.id ?? ''),
	);
	let rider = $state<Rider | null>(untrack(() => data.rider));
	// The badges behind the level (#701, ADR-0027). Same audience as the
	// page — the endpoint's own gate is SharesRoomOrFriends — so a failure
	// here is a rider with nothing to show, never a reason to fail the page.
	let trophies = $state<Trophies | null>(untrack(() => data.trophies));
	// Except on your own page, where the case IS the page below the header:
	// a failed read there is a banner with a retry, not a page with a hole.
	let trophiesError = $state<string | null>(untrack(() => data.trophiesError));
	let error = $state<string | null>(untrack(() => data.riderError));
	// A rider who is not there, or not visible to you, is an empty state
	// with a way on — not an error whose Retry 404s forever (#1555).
	let missing = $state(untrack(() => data.riderMissing));
	let busy = $state(false);
	let loadedId = $state<string | null>(untrack(() => data.id));

	async function load(who: string) {
		if (!who) {
			// /u/me that never resolved (#1330): ask the loader again rather
			// than fetch an empty id, which the SPA answers with index.html
			// and left the page on its skeleton for good (audit 2026-09-09).
			error = null;
			await invalidateAll();
			rider = data.rider;
			error = data.riderError;
			missing = data.riderMissing;
			trophies = data.trophies;
			trophiesError = data.trophiesError;
			return;
		}
		const res = await fetchRider(who);
		if (!res.ok) {
			error = res.error.message;
			missing = res.error.error === 'not_found';
			return;
		}
		error = null;
		missing = false;
		rider = res.data;
		const shelf = await fetchTrophies(who);
		trophies = shelf.ok ? shelf.data : null;
		trophiesError = shelf.ok ? null : shelf.error.message;
	}

	$effect(() => {
		const who = id;
		if (!who || loadedId === who) return;
		if (data.id === who) {
			rider = data.rider;
			trophies = data.trophies;
			trophiesError = data.trophiesError;
			error = data.riderError;
			missing = data.riderMissing;
			loadedId = who;
			return;
		}
		loadedId = who;
		rider = null;
		trophies = null;
		trophiesError = null;
		error = null;
		void load(who);
	});
	$effect(() => {
		// Presence pings (#251) re-fetch: they walked into a room, or out.
		// `rider` is read untracked: load() writes it, and tracking it made
		// every response schedule the next fetch — a loop at network speed
		// (#824).
		presence.version;
		const loaded = untrack(() => rider);
		if (id && loaded) void load(id);
	});

	// Add, accept: one call each, then the page re-reads itself. A refused
	// request is a toast — the page is not a form.
	async function friendAction(path: string, json?: unknown) {
		busy = true;
		const res = await api(path, { method: 'POST', json });
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		await load(id);
	}

	const level = $derived(rider ? levelFromXp(rider.totalXp) : 0);
	const toNext = $derived(rider ? xpForLevel(level + 1) - rider.totalXp : 0);
	const medalKinds = $derived(
		rider ? Object.entries(rider.medals).sort(([, a], [, b]) => b - a) : [],
	);
	const since = $derived(
		rider
			? new Date(rider.since).toLocaleDateString(undefined, {
					month: 'long',
					year: 'numeric',
				})
			: '',
	);
	const stats = $derived.by(() => {
		if (!rider) return [];
		const out = [
			{
				label: 'rides',
				value: rider.rides.toLocaleString(),
				hint: `since ${since}`,
			},
			{
				label: 'energy',
				value: rider.totalKj.toLocaleString(),
				unit: 'kJ',
				hint: 'generated, all rides',
			},
		];
		// Medals "in rooms you share" is a sentence about someone else; yours
		// are the shelf below, by name, and the fourth tile is the badges.
		if (rider.friend === 'self') {
			if (trophies) {
				out.push({
					label: 'achievements',
					value: String(trophies.achievements.filter((a) => a.earnedAt).length),
					unit: `of ${trophies.achievements.length}`,
					hint: `${trophies.xp.achievements.toLocaleString()} XP from them`,
				});
			}
		} else {
			out.push({
				label: 'medals',
				value: String(medalTotal(rider.medals)),
				hint:
					rider.roomsInCommon.length > 0
						? 'in rooms you share'
						: 'in rooms you share — none yet',
			});
		}
		if (rider.month) {
			out.splice(1, 0, {
				label: 'this month',
				value: rider.month.rides.toLocaleString(),
				hint: rider.month.rides > 0 ? monthLine(rider.month) : 'no ride yet',
			});
		}
		return out;
	});
</script>

<svelte:head
	><title
		>{rider ? (rider.friend === 'self' ? 'You' : rider.displayName) : 'Rider'} · WattRoom</title
	></svelte:head
>

{#snippet openRides()}
	<a href="/history" class="btn btn-secondary btn-xs">Open Rides</a>
{/snippet}

<main class="page">
	{#if missing}
		<EmptyState variant="page">
			<p class="text-ink text-sm">This rider isn't here.</p>
			<p class="mx-auto mt-2 max-w-sm text-xs leading-relaxed">
				The link is old, or it is a rider you don't share a room or a friendship
				with yet.
			</p>
			{#snippet cta()}
				<a href="/friends" class="btn btn-secondary">Open Friends</a>
			{/snippet}
		</EmptyState>
	{:else if error}
		<Banner tone="error">
			{error}
			{#snippet action()}
				<button onclick={() => void load(id)} class="btn-link text-xs"
					>Retry</button
				>
			{/snippet}
		</Banner>
	{:else if !rider}
		<div class="panel flex items-center gap-5 p-6">
			<Skeleton class="h-[72px] w-[72px] rounded-full" />
			<div class="flex-1">
				<Skeleton class="h-6 w-56" />
				<Skeleton class="mt-2 h-3 w-40" />
				<Skeleton class="mt-4 h-4 w-72" />
			</div>
		</div>
		<div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
			<Skeleton class="h-20" rows={4} />
		</div>
	{:else}
		<header class="panel flex flex-wrap items-center gap-5 p-6">
			<Avatar
				name={rider.displayName}
				avatarUrl={rider.avatarUrl}
				xp={rider.totalXp}
				size={72}
			/>
			<div class="min-w-0 flex-1">
				<h1 class="font-display text-2xl font-bold">{rider.displayName}</h1>
				<p class="text-muted mt-0.5 flex flex-wrap items-center gap-2 text-sm">
					{#if rider.presence.room}
						{#if rider.presence.riding}
							<RidingBars size={11} /> riding in {rider.presence.room.name}
						{:else}
							in {rider.presence.room.name}
						{/if}
						<span class="text-muted/50">·</span>
					{:else if rider.presence.inRoom}
						in a room <span class="text-muted/50">·</span>
					{:else if rider.presence.online}
						online <span class="text-muted/50">·</span>
					{/if}
					riding here since {since}
				</p>
				<div class="mt-3 flex flex-wrap items-center gap-3">
					<span class="font-display text-lg font-bold tabular-nums"
						>level {level}</span
					>
					<div class="w-40">
						<ProgressBar pct={levelProgress(rider.totalXp) * 100} />
					</div>
					<span class="text-muted text-[11px] tabular-nums"
						>{toNext.toLocaleString()} XP to {level + 1} · {rider.totalXp.toLocaleString()}
						lifetime</span
					>
				</div>
			</div>
			<div class="flex shrink-0 flex-col gap-2">
				{#if rider.friend === 'self'}
					<!-- Your own page is where you look for your trophies (#575);
					     Home's level tile was the only way in. -->
					<a href="/settings/profile" class="btn btn-secondary"
						><Pencil size={15} /> Edit profile</a
					>
				{:else if rider.friend === 'accepted'}
					<a
						href="/messages/dm/{rider.id}"
						onclick={() => dm.show(rider!.id, rider!.displayName)}
						class="btn btn-secondary"><MessageSquare size={15} /> Message</a
					>
				{:else if rider.friend === 'pending_in'}
					<button
						onclick={() => friendAction(`/api/friends/${rider!.id}/accept`)}
						disabled={busy}
						class="btn btn-primary"><Check size={15} /> Accept friend</button
					>
				{:else if rider.friend === 'pending_out'}
					<button class="btn btn-secondary" disabled
						><UserPlus size={15} /> Asked — waiting on them</button
					>
				{:else if rider.canAdd}
					<button
						onclick={() => friendAction('/api/friends', { userId: rider!.id })}
						disabled={busy}
						class="btn btn-primary"><UserPlus size={15} /> Add friend</button
					>
				{/if}
				{#if rider.presence.room && rider.friend !== 'self'}
					<!-- Your own page reached the app in #575; "Join them" on it
					     offered to join the room you are already standing in. -->
					<!-- Riding: the ride is joined on Training (#1332). -->
					<a
						href="/r/{rider.presence.room.slug}{rider.presence.riding
							? '/training'
							: ''}"
						class="btn btn-accent"><Radio size={15} /> Join them</a
					>
				{/if}
			</div>
		</header>

		<div class="mt-6 grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
			<div class="min-w-0 space-y-8">
				<section class="grid grid-cols-2 gap-3 sm:grid-cols-4">
					{#each stats as s (s.label)}
						<div class="panel px-4 py-3">
							<p class="eyebrow">{s.label}</p>
							<p class="font-display text-2xl font-bold tabular-nums">
								{s.value}{#if s.unit}<span class="text-muted ml-1 text-sm"
										>{s.unit}</span
									>{/if}
							</p>
							<p class="text-muted text-[11px]">{s.hint}</p>
						</div>
					{/each}
				</section>

				{#if rider.sharedRides}
					<section>
						<div class="flex items-baseline gap-3">
							<h2 class="eyebrow">Activity</h2>
							<span class="text-muted/70 flex items-center gap-1 text-[11px]"
								><Eye size={11} />
								{rider.friend === 'self'
									? 'rides you chose to share'
									: `rides ${rider.displayName} chose to share`}</span
							>
						</div>
						{#if rider.sharedRides.length === 0}
							<div class="mt-3">
								<!-- The cta snippet is EmptyState's PROP, so it has to be a direct
								     child of the component — declared inside the {#if} it was just a
								     local in the children scope and the button never rendered. -->
								<EmptyState
									cta={rider.friend === 'self' ? openRides : undefined}
								>
									{#if rider.friend === 'self'}
										<p class="text-ink text-sm">Nothing shared yet.</p>
										<p class="mx-auto mt-2 max-w-sm text-xs leading-relaxed">
											Rides are private by default. Flip one to "shared" in
											Rides and your friends see it here.
										</p>
									{:else}
										<p class="text-ink text-sm">
											{rider.displayName} hasn't shared a ride yet.
										</p>
										<p class="mx-auto mt-2 max-w-sm text-xs leading-relaxed">
											Rides are private by default; a rider shares them one at a
											time.
										</p>
									{/if}
								</EmptyState>
							</div>
						{:else}
							<ul class="mt-3 space-y-2">
								{#each rider.sharedRides as ride (ride.id)}
									<li class="panel px-5 py-4">
										<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
											<span class="font-display font-bold"
												>{ride.workoutName}</span
											>
											<span class="text-muted text-xs"
												>{ridePlace(ride)} · {new Date(
													ride.startedAt,
												).toLocaleDateString()}</span
											>
											{#if ride.medals?.length}
												<span
													class="text-z5 ml-auto flex items-center gap-1 text-[11px]"
													><Award size={12} />
													{ride.medals.map(medalName).join(', ')}</span
												>
											{/if}
										</div>
										<p class="text-muted mt-1 text-xs">{rideLine(ride)}</p>
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				{/if}

				<!-- The receipts behind the level (#701), on your own page only
				     (#1330): the counts, the shelf and where the XP came from. For
				     the four social badges the counts ARE the progress ADR-0027
				     keeps private — the same integers — so the server sends zeroes
				     for anyone else's case and none of this renders there (#1025).
				     Where the level came from (#993) is the case's table; the
				     header no longer repeats it. -->
				{#if rider.friend === 'self'}
					{#if trophies}
						<TrophyCase {trophies} />
					{:else if trophiesError}
						<Banner tone="error">
							{trophiesError}
							{#snippet action()}
								<button onclick={() => void load(id)} class="btn-link text-xs"
									>Retry</button
								>
							{/snippet}
						</Banner>
					{/if}
				{/if}

				{#if trophies && rider.friend !== 'self'}
					<!-- Yours is inside the trophy case above, with its progress
					     (ADR-0027); a second copy here drew the catalogue twice. -->
					<BadgeGrid achievements={trophies.achievements} mine={false} />
				{/if}
			</div>

			<aside class="min-w-0 space-y-8">
				<!-- Theirs from the rooms you share (ADR-0024); yours are on the
				     shelf, by name, so the same list twice is one too many. -->
				{#if medalKinds.length > 0 && rider.friend !== 'self'}
					<section>
						<h2 class="eyebrow">Medals</h2>
						<ul class="mt-3 grid grid-cols-2 gap-2">
							{#each medalKinds as [kind, count] (kind)}
								<li class="panel flex items-center gap-2.5 px-3 py-2.5">
									<Award size={18} class="text-neon shrink-0" />
									<span class="min-w-0">
										<span class="block truncate text-xs font-medium"
											>{medalName(kind)}</span
										>
										<span class="text-muted block text-[10px] tabular-nums"
											>× {count}</span
										>
									</span>
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				<section>
					<h2 class="eyebrow">Rooms in common</h2>
					{#if rider.roomsInCommon.length === 0}
						<p class="text-muted mt-3 text-xs">
							{rider.friend === 'self'
								? 'Every room you are in.'
								: 'None — you know each other as friends.'}
						</p>
					{:else}
						<ul class="mt-3 space-y-1.5">
							{#each rider.roomsInCommon as room (room.slug)}
								<li>
									<a
										href="/r/{room.slug}"
										class="panel hover:border-muted/40 flex items-center gap-2 px-3 py-2 text-sm transition-colors"
									>
										<Users size={14} class="text-muted" />
										{room.name}
									</a>
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<!-- The rules, on the page they govern (ADR-0024). -->
				<section class="border-muted/15 rounded-lg border p-4">
					<h2 class="flex items-center gap-1.5 text-xs font-semibold">
						<Lock size={12} /> What a profile shows
					</h2>
					<ul class="text-muted mt-2 space-y-1 text-[11px] leading-relaxed">
						<li>
							<strong class="text-ink">Room-mates and friends:</strong> name, level,
							energy, medals from rooms you share, which of those rooms they are in.
						</li>
						<li>
							<strong class="text-ink">Friends:</strong> the rides they chose to share,
							the month's totals, whether they are online.
						</li>
						<li>
							<strong class="text-ink">Never:</strong> live watts, heart rate, weight,
							FTP — room-scoped, as always.
						</li>
					</ul>
				</section>
			</aside>
		</div>
	{/if}
</main>
