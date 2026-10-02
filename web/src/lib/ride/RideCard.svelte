<script lang="ts" module>
	export type RideKind = 'free' | 'workout';
</script>

<script lang="ts">
	/**
	 * /ride's Ride card (#3671, v3-modes' “/ride, alone”): which ride — a free
	 * ride or a workout (ADR-0062's modes) — and the road any of them can
	 * carry, then where on it to start. It owns the choosing; the page owns
	 * what the choice starts, so it binds the three answers back.
	 */
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { formatClock, formatKm } from '$lib/format';
	import { gradeAt } from '$lib/road/at-metre';
	import { feltGrade } from '$lib/ride/ride-grade';
	import RoadPick from '$lib/ride/RoadPick.svelte';
	import {
		carryOnFrom,
		loadRoad,
		roadsEnabled,
		type RideableRoute,
	} from '$lib/ride/roads';
	import SoloGames from '$lib/ride/SoloGames.svelte';
	import { durationSeconds, flatten } from '$lib/workout/engine';
	import type { Workout } from '$lib/workout/types';
	import { untrack } from 'svelte';

	let {
		kind = $bindable(),
		road = $bindable(),
		from = $bindable(),
		pending = $bindable(false),
		roadId,
		remembered,
		workout,
		summary,
		lastWorkout,
		ftp,
	}: {
		kind: RideKind;
		road: RideableRoute | null;
		from: number;
		/** The road to open on is still loading: nothing may start yet. */
		pending?: boolean;
		/** The road to open on: the link's, or the one remembered. */
		roadId?: string;
		/** The road last ridden on this device, said as “your last road”. */
		remembered?: string;
		workout: Workout;
		summary: string;
		/** The workout last ridden on this device, when it is the one below. */
		lastWorkout?: string;
		ftp: number;
	} = $props();

	const roads = roadsEnabled();
	let roadError = $state<string | null>(null);
	let picking = $state(false);
	let carry = $state<number | null>(null);

	untrack(() => {
		if (!roads || !roadId) return;
		const id = roadId;
		pending = true;
		void loadRoad(id).then((result) => {
			pending = false;
			if (result.ok) onto(result.route, from);
			// A remembered road that is gone is no road; one a link asked for
			// says why it is not here.
			else if (id !== remembered) roadError = result.error;
		});
	});

	function onto(next: RideableRoute, at = 0) {
		road = next;
		from = at;
		picking = false;
		roadError = null;
		carry = null;
		if (!next.borrowed)
			void carryOnFrom(next.id, next.road.length).then((m) => {
				if (road?.id === next.id) carry = m;
			});
	}

	// The ways to start it that exist (ADR-0062): the whole road, and where
	// your last ride of it stopped short (#3205) or a link said to start.
	const starts = $derived([
		...new Set([0, carry, from].filter((m) => m !== null)),
	] as number[]);
	const felt = $derived.by(() => {
		if (!road) return null;
		const pct = gradeAt(road.road, from);
		return { road: pct, you: feltGrade(pct) };
	});

	const KINDS: { id: RideKind; name: string }[] = [
		{ id: 'free', name: 'Free ride' },
		{ id: 'workout', name: 'Workout' },
	];
	const pct = (v: number) => `${v.toFixed(1)} %`;
	const tile =
		'flex min-h-11 flex-col items-start rounded-lg border p-4 text-left';
</script>

<section class="panel panel-lg" aria-label="the ride">
	{#if roads}
		<div
			class="grid gap-3 sm:grid-cols-2"
			role="group"
			aria-label="how you ride"
		>
			{#each KINDS as k (k.id)}
				<button
					onclick={() => (kind = k.id)}
					aria-pressed={kind === k.id}
					class="{tile} {kind === k.id
						? 'border-neon'
						: 'border-frame hover:border-muted'}"
				>
					<span class="font-display text-2xl font-bold">{k.name}</span>
					<span class="text-muted mt-1 text-sm">
						{#if k.id === 'free'}
							You drive the trainer. Hold a grade, or hold your watts.
						{:else}
							The plan drives it.{lastWorkout ? ` Last: ${lastWorkout}.` : ''}
						{/if}
					</span>
				</button>
			{/each}
		</div>

		<div class="border-frame mt-4 rounded-lg border p-4">
			<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
				<span class="eyebrow">road</span>
				{#if pending}
					<Skeleton class="h-5 w-48" />
				{:else if road}
					<span class="min-w-0 truncate font-semibold">{road.name}</span>
					{#if road.id === remembered}
						<span class="text-muted text-sm">your last road</span>
					{/if}
				{:else}
					<span class="text-muted">No road</span>
				{/if}
			</div>
			<div class="mt-3 flex flex-wrap gap-2">
				<button
					onclick={() => (picking = !picking)}
					aria-expanded={picking}
					class="btn btn-secondary btn-lg"
					>{picking ? 'Close' : 'Change'}</button
				>
				{#if road}
					<button
						onclick={() => {
							road = null;
							from = 0;
						}}
						class="btn btn-secondary btn-lg">No road</button
					>
				{/if}
			</div>
			{#if roadError}
				<p class="text-danger mt-2 text-sm">{roadError}</p>
			{/if}
			{#if picking}
				<div class="mt-3"><RoadPick onpick={(next) => onto(next)} /></div>
			{/if}
			{#if road}
				<div
					class="mt-3 flex flex-wrap gap-2"
					role="group"
					aria-label="where to start"
				>
					{#each starts as m (m)}
						<button
							onclick={() => (from = m)}
							aria-pressed={from === m}
							class="btn btn-lg rounded-full border {from === m
								? 'border-neon text-ink'
								: 'border-muted/30 hover:border-muted/60'}"
							>{m === 0 ? 'Whole road' : `From km ${formatKm(m)}`}</button
						>
					{/each}
				</div>
				{#if kind === 'free' && felt}
					<p class="text-muted num mt-3 text-sm">
						Feel: road {pct(felt.road)}, you feel {pct(felt.you)}
					</p>
				{/if}
			{/if}
		</div>
	{/if}

	{#if kind === 'workout'}
		<div class={roads ? 'mt-4' : ''}>
			<h2 class="page-title-sm">{workout.name}</h2>
			<p class="text-muted num mt-1 text-sm">
				{formatClock(durationSeconds(workout))} · targets scale to your FTP
			</p>
			<p class="text-muted mt-2 text-sm">{summary}</p>
			<!-- What the session looks like — the one thing to see before Start. -->
			<div class="panel panel-flush mt-3 overflow-hidden">
				<IntervalGraph
					segments={flatten(workout)}
					total={durationSeconds(workout)}
					elapsed={0}
					{ftp}
					trace={[]}
				/>
			</div>
			<a href="/workouts" class="btn btn-secondary btn-lg mt-3"
				>Choose a different workout</a
			>
		</div>
	{/if}

	<!-- One line, whichever ride is chosen (ride-preride 9). -->
	<div class="border-frame mt-4 border-t pt-3"><SoloGames /></div>
</section>
