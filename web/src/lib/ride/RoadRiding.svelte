<script lang="ts">
	/**
	 * A free ride alone on one of your own roads (#3027): the channel's free
	 * ride surface, lifted to /ride for parity (ADR-0046). Pair, ride from the
	 * first stroke, End ride saves against the route. No count-in, no
	 * workout: the road sets the grade, or the watts in watts mode.
	 */
	import { onDestroy, untrack } from 'svelte';
	import Banner from '$lib/components/Banner.svelte';
	import { canSimulate } from '$lib/ble/can-simulate';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { formatClock } from '$lib/format';
	import { createProfileStore } from '$lib/profile.svelte';
	import { createFreeRide, type FreeMode } from '$lib/ride/free-ride.svelte';
	import GearShift from '$lib/ride/GearShift.svelte';
	import { gearsEnabled } from '$lib/ride/gears-enabled';
	import { modeLine } from '$lib/ride/mode-copy';
	import RoadPick from '$lib/ride/RoadPick.svelte';
	import type { RideableRoute } from '$lib/ride/roads';
	import { createSoloRoadRide } from '$lib/ride/solo-road.svelte';
	import { soloTrainer } from '$lib/ride/solo-trainer.svelte';
	import Instrument from '$lib/session/Instrument.svelte';
	import SensorOverview from '$lib/session/SensorOverview.svelte';
	import { heldTrainer } from '$lib/session/sensor-status';
	import { sensors } from '$lib/sensors.svelte';
	import { SIGNAL_LOST_MS } from '$lib/workout/ride-state';

	let { route, from = 0 }: { route: RideableRoute; from?: number } = $props();

	const profile = createProfileStore();
	const free = createFreeRide({
		ftp: () => profile.current.ftp,
		singleSpeed: () => profile.current.singleSpeed,
		kg: () => profile.current.kg,
	});
	// One ride rides one road: the one this page opened on.
	const solo = createSoloRoadRide({
		free,
		route: untrack(() => route),
		from: untrack(() => from),
		readings: () => sensors.readings,
	});
	const trainers = soloTrainer();
	const held = $derived(heldTrainer(trainers, channelConnection.current?.ride));

	let watts = $state(0);
	let ended = $state(false);
	// The instrument says when its numbers are not live (#2851): a trainer
	// silent past the rides' one number, SIGNAL_LOST_MS.
	let lastAt = $state(0);
	let now = $state(Date.now());
	$effect(() => {
		const trainer = solo.trainer;
		if (!trainer) return;
		lastAt = Date.now();
		const tick = setInterval(() => (now = Date.now()), 1000);
		const off = trainer.onSample((s) => {
			watts = s.watts;
			lastAt = Date.now();
		});
		return () => {
			clearInterval(tick);
			off();
		};
	});
	const stale = $derived(!!solo.trainer && now - lastAt > SIGNAL_LOST_MS);

	function start() {
		const trainer = trainers.handOff();
		if (trainer) solo.start(trainer);
	}
	async function end() {
		ended = true;
		await solo.end();
	}
	// Leaving the page is not End ride: the trainer is let go, and the crash
	// buffer offers the ride back.
	onDestroy(() => {
		if (solo.trainer) void solo.trainer.disconnect();
	});

	const modes: { id: FreeMode; label: string }[] = [
		{ id: 'grade', label: 'Road' },
		{ id: 'watts', label: 'Watts' },
	];
	const value = $derived(
		free.mode === 'watts'
			? `${free.targetWatts} W`
			: `${(free.road?.roadPct ?? 0).toFixed(1)} %`,
	);
</script>

<div class="m-auto flex w-full max-w-2xl flex-col gap-6">
	<header class="flex flex-wrap items-center gap-3">
		<p class="eyebrow">free ride</p>
		<h1 class="page-title-sm min-w-0 truncate">
			{route.name}
		</h1>
		<span class="font-display ml-auto text-2xl font-bold tabular-nums"
			>{formatClock(free.seconds)}</span
		>
	</header>

	{#if !solo.trainer && !ended}
		<SensorOverview
			trainer={{
				state: held.state,
				device: held.device,
				reading: held.reading,
				hint: held.hint,
				error: held.error,
				onPair: () => void trainers.pair(new FtmsTrainer()),
				onForget: held.forget,
				onSimulate: canSimulate()
					? () =>
							void trainers.pair(
								new SimulatedTrainer({ baseWatts: profile.current.ftp * 0.8 }),
							)
					: undefined,
			}}
		/>
		<button
			onclick={start}
			disabled={!held.paired || held.fault === 'reconnecting'}
			class="btn btn-primary btn-lg">Start riding</button
		>
		{#if from > 0}
			<p class="text-muted text-sm">
				Carrying on from km {(from / 1000).toFixed(1)}.
			</p>
		{/if}
	{:else if solo.trainer}
		<Instrument
			{watts}
			{stale}
			idle={!solo.trainer}
			target={free.mode === 'watts' ? free.targetWatts : 0}
			ftp={profile.current.ftp}
		/>
		<div class="flex flex-wrap items-center justify-center gap-4">
			<div
				class="border-muted/20 flex rounded-lg border p-1"
				role="group"
				aria-label="what you set"
			>
				{#each modes as mode (mode.id)}
					<button
						onclick={() => free.setMode(mode.id)}
						aria-pressed={free.mode === mode.id}
						class="btn btn-lg {free.mode === mode.id
							? 'btn-secondary'
							: 'btn-ghost'}">{mode.label}</button
					>
				{/each}
			</div>
			<span
				class="font-display w-28 text-center text-3xl font-bold tabular-nums"
				aria-live="polite">{value}</span
			>
		</div>
		<p class="text-muted -mt-3 text-center text-sm">
			{modeLine(free.mode, profile.current.singleSpeed, true)}
		</p>
		<RoadPick {free} />
		{#if free.mode === 'grade' && gearsEnabled()}
			<GearShift
				shift={solo.shift}
				gear={solo.gear}
				off={null}
				resetAt={0}
				cassette={!profile.current.singleSpeed}
			/>
		{/if}
		<button onclick={() => void end()} class="btn btn-primary btn-lg"
			>End ride</button
		>
	{:else if free.saving}
		<p class="text-muted text-sm" role="status">Saving your ride…</p>
	{:else if free.outcome && 'saved' in free.outcome}
		<p class="text-sm" role="status">
			Saved. <a href="/history/{free.outcome.saved.id}" class="underline"
				>See it in your history</a
			> — and on Strava, if you connected it.
		</p>
	{:else if free.outcome && 'failure' in free.outcome}
		<Banner tone="error">
			It did not save — {free.outcome.failure.message} It is kept on this device,
			and Ride offers it again.
		</Banner>
	{:else}
		<p class="text-muted text-sm" role="status">
			Under a minute — nothing to save.
		</p>
	{/if}
</div>
