<script lang="ts">
	import { goto } from '$app/navigation';
	import Logo from '$lib/brand/Logo.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import PowerCurveChart from '$lib/components/PowerCurveChart.svelte';
	import FtpTrendChart from '$lib/components/FtpTrendChart.svelte';
	import FitnessChart from '$lib/components/FitnessChart.svelte';
	import {
		fetchProgression,
		FORM_SENTENCES,
		type Progression,
	} from '$lib/progression';

	let progression = $state<Progression | null>(null);
	let error = $state<string | null>(null);

	async function load() {
		const res = await fetchProgression();
		if (res.ok) {
			progression = res.data;
			error = null;
		} else {
			error = res.error.message;
		}
	}
	void load();

	// Chart drilldown lands on the ride log, which rings the ride. noScroll:
	// the ride page scrolls to the ring itself — the default scroll-to-top
	// would race it and win.
	const openRide = (id: string) =>
		goto(`/history?ride=${id}`, { noScroll: true });
	function openDay(date: string) {
		// Snap to the nearest ride — most days carry none, and a click that
		// silently does nothing reads as broken.
		const target = new Date(date + 'T12:00:00Z').getTime();
		let best: string | null = null;
		let dist = Infinity;
		for (const ride of progression?.rides ?? []) {
			const d = Math.abs(new Date(ride.date).getTime() - target);
			if (d < dist) {
				dist = d;
				best = ride.id;
			}
		}
		if (best) void openRide(best);
	}
</script>

<main class="page max-w-4xl">
	<div class="flex items-center gap-3">
		<Logo size={30} />
		<div>
			<h1 class="font-display text-2xl leading-tight font-bold">Progression</h1>
			<p class="text-muted text-xs">
				How your riding is trending — from your WattRoom rides, visible only to
				you.
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
	{:else if progression === null}
		<div class="mt-8 grid gap-3">
			{#each { length: 3 } as _, i (i)}
				<div class="border-muted/15 rounded-lg border p-6">
					<Skeleton class="h-4 w-48" />
					<Skeleton class="mt-4 h-40" />
				</div>
			{/each}
		</div>
	{:else if progression.rides.length === 0}
		<!-- Empty states teach (.claude/rules/ux.md). -->
		<div class="mt-8">
			<EmptyState>
				<p class="text-ink text-sm">Nothing to chart yet.</p>
				<p class="mx-auto mt-2 max-w-sm text-xs leading-relaxed">
					Every ride feeds this page: your power curve, your FTP's story, and
					how fitness and fatigue balance out. It builds itself — you just ride.
				</p>
				{#snippet cta()}
					<a href="/workouts" class="btn btn-primary">Pick a workout</a>
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<div class="mt-8 flex flex-wrap items-baseline gap-x-4 gap-y-1">
			<span class="text-muted text-xs">
				Category
				<span class="text-ink font-display text-sm font-bold"
					>{progression.category}</span
				>
				{#if progression.wkg > 0}
					· {progression.wkg.toFixed(1)} w/kg, 90-day best 20 min
				{/if}
			</span>
			<a
				href="/history"
				class="text-muted hover:text-ink ml-auto text-xs underline">all rides</a
			>
		</div>

		<div class="mt-3 grid gap-3">
			<div class="panel px-6 py-5">
				<h3 class="text-ink text-sm font-semibold">Best power by duration</h3>
				<!-- Interpretation lives in the UI, not the rider's head: every
				     panel says what its numbers mean in one line. -->
				<p class="text-muted mt-0.5 mb-4 max-w-2xl text-xs">
					Your hardest average power held for each duration. The shades compare
					now with your past: a darker bar reaching its lighter neighbours means
					you're back at your best.
				</p>
				<PowerCurveChart
					d30={progression.curve.d30}
					d90={progression.curve.d90}
					all={progression.curve.all}
				/>
			</div>
			<div class="panel px-6 py-5">
				<h3 class="text-ink text-sm font-semibold">FTP over the last year</h3>
				<p class="text-muted mt-0.5 mb-4 max-w-2xl text-xs">
					The line is the FTP your rides were scored against; each dot is a
					ride's best 20 minutes. Dots climbing away above the line mean your
					FTP is due a retest.
				</p>
				<FtpTrendChart
					rides={progression.rides}
					onpick={(ride) => void openRide(ride.id)}
				/>
			</div>
			{#if progression.load && progression.load.series.length > 1}
				{@const load = progression.load}
				<div class="panel px-6 py-5">
					<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<h3 class="text-ink text-sm font-semibold">Training load</h3>
						{#if load.building}
							<span class="text-muted text-xs italic"
								>building history — form shows after your first month</span
							>
						{:else}
							<span class="text-ink font-display text-sm font-semibold">
								form {load.formPct > 0 ? '+' : ''}{Math.round(load.formPct)}%
							</span>
							<span class="text-muted text-xs"
								>{FORM_SENTENCES[load.zone] ?? load.zone}</span
							>
						{/if}
					</div>
					<p class="text-muted mt-0.5 mb-4 max-w-2xl text-xs">
						Every ride adds load. Fitness is the load your body is used to (a
						slow 42-day average); fatigue is the last week (fast). Training with
						fatigue a little above fitness is what builds — far above it is
						where recovery earns more than riding.
					</p>
					<FitnessChart series={load.series} onpick={openDay} />
				</div>
			{/if}
		</div>
	{/if}
</main>
