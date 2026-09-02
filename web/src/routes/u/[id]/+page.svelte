<script lang="ts">
	// A rider's page (ADR-0024): what rooms already see — level, energy,
	// medals from rooms you share, where they are — plus, for friends, the
	// rides they chose to share. Built from the /dev/profile mock (#457).
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
	import {
		Award,
		Check,
		Eye,
		Lock,
		MessageSquare,
		Pencil,
		Radio,
		Trophy,
		UserPlus,
		Users,
	} from '@lucide/svelte';

	const id = $derived(page.params.id ?? '');
	let rider = $state<Rider | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);

	async function load(who: string) {
		const res = await fetchRider(who);
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		rider = res.data;
	}

	$effect(() => {
		const who = id;
		rider = null;
		error = null;
		if (who) void load(who);
	});
	$effect(() => {
		// Presence pings (#251) re-fetch: they walked into a room, or out.
		presence.version;
		if (id && rider) void load(id);
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
			{
				label: 'medals',
				value: String(medalTotal(rider.medals)),
				hint:
					rider.roomsInCommon.length > 0
						? 'in rooms you share'
						: 'in rooms you share — none yet',
			},
		];
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
	><title>{rider ? rider.displayName : 'Rider'} · WattRoom</title></svelte:head
>

{#snippet openRides()}
	<a href="/history" class="btn btn-secondary btn-xs">Open Rides</a>
{/snippet}

<main class="page">
	{#if error}
		<Banner tone="error">
			{error}
			{#snippet action()}
				<button
					onclick={() => void load(id)}
					class="text-muted hover:text-ink text-xs underline">Retry</button
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
				preset={rider.avatarPreset}
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
						>{toNext.toLocaleString()} XP to {level + 1}</span
					>
				</div>
			</div>
			<div class="flex shrink-0 flex-col gap-2">
				{#if rider.friend === 'self'}
					<!-- Your own page is where you look for your trophies (#575);
					     Home's level tile was the only way in. -->
					<a href="/trophies" class="btn btn-secondary"
						><Trophy size={15} /> Trophy case</a
					>
					<a href="/profile" class="btn btn-secondary"
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
				{#if rider.presence.room}
					<a href="/r/{rider.presence.room.slug}" class="btn btn-accent"
						><Radio size={15} /> Join them</a
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
							<h2
								class="text-muted text-xs font-semibold tracking-widest uppercase"
							>
								Activity
							</h2>
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
			</div>

			<aside class="min-w-0 space-y-8">
				{#if medalKinds.length > 0}
					<section>
						<h2
							class="text-muted text-xs font-semibold tracking-widest uppercase"
						>
							Medals
						</h2>
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
					<h2
						class="text-muted text-xs font-semibold tracking-widest uppercase"
					>
						Rooms in common
					</h2>
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
