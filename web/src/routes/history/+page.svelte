<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import Logo from '$lib/brand/Logo.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { api } from '$lib/api';
	import { formatClock } from '$lib/format';
	import { createHistoryStore, type RideRecord } from '$lib/history.svelte';

	// Device-only leftovers: summaries saved while the server was unreachable
	// (or from before #110). They have no samples, so they cannot become
	// account rides — they stay listed here until cleared.
	const device = createHistoryStore();

	interface ServerRide extends RideRecord {
		xp: number;
		room?: boolean;
	}
	let rides = $state<ServerRide[] | null>(null);
	let error = $state<string | null>(null);

	// /progression's chart drilldown lands here with ?ride=<id> — ring it.
	let highlightId = $state<string | null>(null);

	async function load() {
		const res = await api<{ rides: ServerRide[] }>('/api/rides');
		if (res.ok) {
			rides = res.data.rides;
			error = null;
			const picked = page.url.searchParams.get('ride');
			if (picked && rides.some((ride) => ride.id === picked)) {
				highlightId = picked;
				await tick();
				// Instant, retried: smooth scrolling gets cancelled by the route
				// transition, and arriving from another page needs a position,
				// not an animation.
				for (const delay of [50, 400]) {
					setTimeout(() => {
						const row = document.getElementById(`ride-${picked}`);
						if (!row) return;
						const box = row.getBoundingClientRect();
						if (box.top > window.innerHeight * 0.8 || box.top < 0) {
							row.scrollIntoView({ behavior: 'instant', block: 'center' });
						}
					}, delay);
				}
			}
		} else {
			error = res.error.message;
		}
	}
	void load();
</script>

{#snippet rideRow(ride: RideRecord, badge?: string)}
	<li
		id="ride-{ride.id}"
		class="panel flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4 {highlightId ===
		ride.id
			? 'ring-z2/70 ring-1'
			: ''}"
	>
		<span class="font-display font-bold">{ride.workoutName}</span>
		{#if badge}
			<span class="eyebrow">{badge}</span>
		{/if}
		<span class="text-muted text-xs"
			>{new Date(ride.startedAt).toLocaleDateString()}</span
		>
		<span class="text-muted ml-auto font-mono text-xs tabular-nums"
			>{formatClock(ride.seconds)}</span
		>
		<span class="font-mono text-xs tabular-nums">{ride.avgWatts} W</span>
		<span class="text-muted font-mono text-xs tabular-nums">{ride.kj} kJ</span>
		<span class="font-display text-sm font-semibold tabular-nums"
			>{Math.round(ride.execution * 100)}%</span
		>
	</li>
{/snippet}

<main class="page max-w-3xl">
	<div class="flex flex-wrap items-center gap-3">
		<Logo size={30} />
		<div>
			<h1 class="font-display text-2xl leading-tight font-bold">Rides</h1>
			<p class="text-muted text-xs">
				Private by default — visible to you, and nobody else.
			</p>
		</div>
		<a
			href="/progression"
			class="text-muted hover:text-ink ml-auto text-xs underline"
			>Progression →</a
		>
	</div>

	{#if error}
		<div class="mt-8">
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button
						onclick={() => void load()}
						class="text-muted hover:text-ink text-xs underline">Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{:else if rides === null}
		<div class="mt-8 grid gap-3">
			{#each { length: 3 } as _, i (i)}
				<div class="border-muted/15 rounded-lg border px-5 py-4">
					<Skeleton class="h-4 w-48" />
					<Skeleton class="mt-2 h-3 w-28" />
				</div>
			{/each}
		</div>
	{:else if rides.length === 0 && device.all.length === 0}
		<!-- Empty states teach (.claude/rules/ux.md). -->
		<div class="mt-8">
			<EmptyState>
				<p class="text-ink text-sm">No rides yet.</p>
				<p class="mx-auto mt-2 max-w-sm text-xs leading-relaxed">
					Finish a workout and it lands here with its execution score. You can
					export any ride as a .fit for Strava or your head unit.
				</p>
				{#snippet cta()}
					<a href="/workouts" class="btn btn-primary">Pick a workout</a>
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<ul class="mt-8 grid gap-2">
			{#each rides as ride (ride.id)}
				{@render rideRow(ride, ride.room ? 'room' : undefined)}
			{/each}
		</ul>
	{/if}

	{#if device.all.length > 0}
		<h2 class="eyebrow mt-10">on this device only</h2>
		<p class="text-muted mt-1 text-xs">
			Saved while the server was unreachable — summaries only, so they can't
			move to your account.
		</p>
		<ul class="mt-3 grid gap-2">
			{#each device.all as ride (ride.id)}
				{@render rideRow(ride)}
			{/each}
		</ul>
		<button onclick={() => device.clear()} class="btn btn-danger mt-4"
			>Clear device rides</button
		>
	{/if}
</main>
