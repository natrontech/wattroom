<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { api } from '$lib/api';
	import { formatClock } from '$lib/format';
	import { createHistoryStore, type RideRecord } from '$lib/history.svelte';
	import PowerCurveChart from '$lib/components/PowerCurveChart.svelte';
	import FtpTrendChart from '$lib/components/FtpTrendChart.svelte';
	import FitnessChart from '$lib/components/FitnessChart.svelte';
	import {
		fetchProgression,
		FORM_SENTENCES,
		type Progression,
	} from '$lib/progression';

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

	let progression = $state<Progression | null>(null);
	let progressionError = $state<string | null>(null);

	async function load() {
		const res = await api<{ rides: ServerRide[] }>('/api/rides');
		if (res.ok) {
			rides = res.data.rides;
			error = null;
		} else {
			error = res.error.message;
		}
	}
	async function loadProgression() {
		const res = await fetchProgression();
		if (res.ok) {
			progression = res.data;
			progressionError = null;
		} else {
			progressionError = res.error.message;
		}
	}
	void load();
	void loadProgression();

	// Chart drilldown: a click lands on the ride row it came from.
	let highlightId = $state<string | null>(null);
	function focusRide(id: string) {
		highlightId = id;
		document
			.getElementById(`ride-${id}`)
			?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}
	function focusDay(date: string) {
		// Snap to the nearest ride: most days carry no ride, and a click that
		// silently does nothing reads as broken.
		const target = new Date(date + 'T12:00:00Z').getTime();
		let best: ServerRide | null = null;
		let dist = Infinity;
		for (const ride of rides ?? []) {
			const d = Math.abs(new Date(ride.startedAt).getTime() - target);
			if (d < dist) {
				dist = d;
				best = ride;
			}
		}
		if (best) focusRide(best.id);
	}
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

<main class="page max-w-4xl">
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
		<!-- Progression (#222): trends from the same rides listed below. Charts
		     degrade quietly — a failed analysis call never hides the ride list. -->
		{#if progressionError}
			<p class="text-muted mt-8 text-xs">
				Progression could not be loaded.
				<button
					onclick={() => void loadProgression()}
					class="hover:text-ink underline">Retry</button
				>
			</p>
		{:else if progression && progression.rides.length > 0}
			<section class="mt-8">
				<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
					<h2 class="eyebrow">progression</h2>
					<span class="text-muted text-xs">
						Category
						<span class="text-ink font-display text-sm font-bold"
							>{progression.category}</span
						>
						{#if progression.wkg > 0}
							· {progression.wkg.toFixed(1)} w/kg, 90-day best 20 min
						{/if}
					</span>
				</div>
				<div class="mt-3 grid gap-3">
					<div class="panel px-6 py-5">
						<h3 class="text-ink text-sm font-semibold">
							Best power by duration
						</h3>
						<!-- Interpretation lives in the UI, not the rider's head:
						     every panel says what its numbers mean in one line. -->
						<p class="text-muted mt-0.5 mb-4 max-w-2xl text-xs">
							Your hardest average power held for each duration. The shades
							compare now with your past: a darker bar reaching its lighter
							neighbours means you're back at your best.
						</p>
						<PowerCurveChart
							d30={progression.curve.d30}
							d90={progression.curve.d90}
							all={progression.curve.all}
						/>
					</div>
					<div class="panel px-6 py-5">
						<h3 class="text-ink text-sm font-semibold">
							FTP over the last year
						</h3>
						<p class="text-muted mt-0.5 mb-4 max-w-2xl text-xs">
							The line is the FTP your rides were scored against; each dot is a
							ride's best 20 minutes. Dots climbing away above the line mean
							your FTP is due a retest.
						</p>
						<FtpTrendChart
							rides={progression.rides}
							onpick={(ride) => focusRide(ride.id)}
						/>
					</div>
					{#if progression.load && progression.load.series.length > 1}
						{@const load = progression.load}
						<div class="panel px-6 py-5">
							<div class="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
								<h3 class="text-ink text-sm font-semibold">Training load</h3>
								{#if load.building}
									<span class="text-muted text-xs italic"
										>building history — form shows after your first month</span
									>
								{:else}
									<span class="text-ink font-display text-sm font-semibold">
										form {load.formPct > 0 ? '+' : ''}{Math.round(
											load.formPct,
										)}%
									</span>
									<span class="text-muted text-xs"
										>{FORM_SENTENCES[load.zone] ?? load.zone}</span
									>
								{/if}
								<span class="text-muted ml-auto text-[11px]"
									>based on your WattRoom rides</span
								>
							</div>
							<p class="text-muted mt-0.5 mb-4 max-w-2xl text-xs">
								Every ride adds load. Fitness is the load your body is used to
								(a slow 42-day average); fatigue is the last week (fast).
								Training with fatigue a little above fitness is what builds —
								far above it is where recovery earns more than riding.
							</p>
							<FitnessChart series={load.series} onpick={focusDay} />
						</div>
					{/if}
				</div>
			</section>
		{/if}
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
