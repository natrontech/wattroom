<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
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

	async function load() {
		const res = await api<{ rides: ServerRide[] }>('/api/rides');
		if (res.ok) {
			rides = res.data.rides;
			error = null;
		} else {
			error = res.error.message;
		}
	}
	void load();
</script>

{#snippet rideRow(ride: RideRecord, badge?: string)}
	<li class="panel flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4">
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
	<div class="flex items-center gap-3">
		<Logo size={30} />
		<div>
			<h1 class="font-display text-2xl leading-tight font-bold">Rides</h1>
			<p class="text-muted text-xs">
				Private by default — visible to you, and nobody else.
			</p>
		</div>
	</div>

	{#if error}
		<div class="border-z6/40 bg-z6/10 mt-8 rounded-lg border px-5 py-4 text-sm">
			{error}
			<button onclick={() => void load()} class="ml-2 underline">Retry</button>
		</div>
	{:else if rides === null}
		<p class="text-muted mt-8 text-sm">Loading…</p>
	{:else if rides.length === 0 && device.all.length === 0}
		<!-- Empty states teach (.claude/rules/ux.md). -->
		<div
			class="border-muted/15 mt-8 rounded-lg border border-dashed px-6 py-8 text-center"
		>
			<p class="text-sm">No rides yet.</p>
			<p class="text-muted mx-auto mt-2 max-w-sm text-xs leading-relaxed">
				Finish a workout and it lands here with its execution score. You can
				export any ride as a .fit for Strava or your head unit.
			</p>
			<a href="/workouts" class="btn btn-primary mt-5">Pick a workout</a>
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
