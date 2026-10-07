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
	import { formatClock, formatKm } from '$lib/format';
	import { createProfileStore } from '$lib/profile.svelte';
	import { createRideFlags } from '$lib/ride/flags.svelte';
	import { createFreeRide, freeRideLabel } from '$lib/ride/free-ride.svelte';
	import FreeRiding from '$lib/ride/FreeRiding.svelte';
	import { guardLeaving } from '$lib/ride/leave-guard.svelte';
	import { createGhostSplit } from '$lib/ride/ghost-split.svelte';
	import { gearsEnabled } from '$lib/ride/gears-enabled';
	import { bindShiftKeys } from '$lib/ride/keys';
	import RideFlags from '$lib/ride/RideFlags.svelte';
	import { carriesOn } from '$lib/ride/road-end';
	import { carryOnFrom, type RideableRoute } from '$lib/ride/roads';
	import { rememberRoad } from '$lib/ride/last-ride';
	import type { Trainer } from '$lib/ble/trainer';
	import { createSoloRoadRide } from '$lib/ride/solo-road.svelte';
	import { soloTrainer } from '$lib/ride/solo-trainer.svelte';
	import SensorOverview from '$lib/session/SensorOverview.svelte';
	import { heldTrainer } from '$lib/session/sensor-status';
	import TvOverlay from '$lib/session/TvOverlay.svelte';
	import { sensors } from '$lib/sensors.svelte';
	import { skylineOf } from '$lib/workout/road-workout';
	import { SIGNAL_LOST_MS } from '$lib/workout/ride-state';

	let {
		route,
		from = 0,
		trainer: handed,
	}: {
		route: RideableRoute;
		from?: number;
		/** A trainer /ride's card paired and handed over: ride at once (#3671). */
		trainer?: Trainer;
	} = $props();

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
	const ghost = createGhostSplit(() => free);
	const trainers = soloTrainer();
	const held = $derived(heldTrainer(trainers, channelConnection.current?.ride));
	// The ⚑ and what it sends afterwards (#52), as a workout ride has them.
	const flags = createRideFlags('/ride');
	let tv = $state(false);

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
			flags.recorder.tick({
				watts: s.watts,
				cadence: s.cadence,
				target: free.targetWatts,
				state: free.recording ? 'riding' : 'armed',
			});
		});
		return () => {
			clearInterval(tick);
			off();
		};
	});
	const stale = $derived(!!solo.trainer && now - lastAt > SIGNAL_LOST_MS);
	// Easier / Harder from the keys and any clicker, wherever the pair and its
	// hint are drawn (#3329, #3661).
	$effect(() =>
		free.mode === 'grade' && gearsEnabled()
			? bindShiftKeys(solo.shift)
			: undefined,
	);

	// Where the last ride of this road stopped short (#3205), beside From
	// the start; a link that says where to start (Resume at km) already did.
	let carry = $state<number | null>(null);
	untrack(() => {
		if (!from && !route.borrowed && !handed)
			void carryOnFrom(route.id, route.road.length).then((m) => (carry = m));
	});

	function start(at?: number, trainer = trainers.handOff()) {
		if (!trainer) return;
		solo.start(trainer, at);
		flags.riding(trainer.name, freeRideLabel(route));
		// The card's “your last road” (#3671); a crew's road is not yours.
		if (!route.borrowed) rememberRoad(route.id);
	}
	untrack(() => handed && start(from, handed));
	async function end() {
		ended = true;
		tv = false;
		await solo.end();
	}
	// Leaving the page is not End ride: the trainer is let go, and the crash
	// buffer offers the ride back. A stray tap on the rail asks first, as a
	// workout ride does (#3667).
	guardLeaving(() => !!solo.trainer, {
		title: 'Leave the ride?',
		body: 'It stops here, unsaved on your account. Ride offers it back to save, or to carry on from where you left the road.',
		action: 'Leave the ride',
		cancel: 'Keep riding',
	});
	onDestroy(() => {
		if (solo.trainer) void solo.trainer.disconnect();
	});

	// You, in the shape the TV renders (#1632): a roster of one.
	const tvRider = $derived({
		id: 'you',
		name: 'You',
		ftp: profile.current.ftp,
		kg: profile.current.kg,
		you: true,
		coach: false,
		cameraOn: false,
		muted: false,
		speaking: false,
		hue: 0,
		watts,
		cadence: solo.metrics?.cadence ?? 0,
		hr: solo.metrics?.heartRate ?? 0,
		stale,
		target: free.targetWatts,
		trace: [],
	});
</script>

<svelte:window
	onkeydown={(e) => e.key === 'Escape' && (tv = false)}
	onpagehide={() => flags.flush(true)}
/>

{#if solo.trainer}
	<!-- The riding surface (ADR-0046, #3669): the road free ride rides what a
	     workout on a road rides, world and all. The page's gutters are undone
	     where the world fills the frame, as RidingScreen does. -->
	<FreeRiding
		{free}
		{watts}
		cadence={solo.metrics?.cadence ?? 0}
		hr={solo.metrics?.heartRate ?? 0}
		kg={profile.current.kg}
		lthr={profile.current.lthr}
		ftp={profile.current.ftp}
		{stale}
		gear={gearsEnabled() ? solo.gear : undefined}
		shift={solo.shift}
		cassette={!profile.current.singleSpeed}
		split={ghost.split ?? undefined}
		onend={() => void end()}
		onflag={() => flags.recorder.flag()}
		ontv={() => (tv = true)}
		worldClass="-mx-4 -my-5 sm:-mx-6"
	/>
	{#if tv}
		<!-- The TV at three metres (#1632): a free ride has no block, so the
		     frame reads the road ahead, your numbers and the clock. -->
		<TvOverlay
			stats={free.live}
			skyline={free.road
				? skylineOf(
						{
							road: free.road.profile,
							along: free.road.m,
							mps: free.road.virtualMps,
							startM: 0,
						},
						[],
						profile.current.ftp,
					)
				: null}
			riders={[tvRider]}
			segments={[]}
			total={0}
			elapsed={free.seconds}
			block={null}
			placeName={freeRideLabel(route)}
			live
			onExit={() => (tv = false)}
		/>
	{/if}
{:else}
	<div class="m-auto flex w-full max-w-2xl flex-col gap-6">
		<header class="flex flex-wrap items-center gap-3">
			<p class="eyebrow">free ride</p>
			<h1 class="page-title-sm min-w-0 truncate">
				<!-- Ridden, the road opens its page (F1); a crew's road has none of yours. -->
				{#if ended && !route.borrowed}
					<a
						href="/workouts/routes/{route.id}"
						class="underline decoration-1 underline-offset-4">{route.name}</a
					>
				{:else}
					{route.name}
				{/if}
			</h1>
			<span class="font-display ml-auto text-2xl font-bold tabular-nums"
				>{formatClock(free.seconds)}</span
			>
		</header>

		{#if !ended}
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
									new SimulatedTrainer({
										baseWatts: profile.current.ftp * 0.8,
									}),
								)
						: undefined,
				}}
			/>
			{#if carry !== null}
				<div class="flex flex-wrap gap-3">
					<button
						onclick={() => start(carry ?? 0)}
						disabled={!held.paired || held.fault === 'reconnecting'}
						class="btn btn-primary btn-lg"
						>Carry on from km {formatKm(carry)}</button
					>
					<button
						onclick={() => start(0)}
						disabled={!held.paired || held.fault === 'reconnecting'}
						class="btn btn-secondary btn-lg">From the start</button
					>
				</div>
			{:else}
				<button
					onclick={() => start()}
					disabled={!held.paired || held.fault === 'reconnecting'}
					class="btn btn-primary btn-lg">Start riding</button
				>
			{/if}
			{#if route.borrowed}
				<p class="text-muted text-sm">
					The crew’s road, from where the session starts. It saves as a free
					ride.
				</p>
			{:else if from > 0}
				<p class="text-muted text-sm">
					Carrying on from km {formatKm(from)}.
				</p>
			{/if}
		{:else if free.saving}
			<p class="text-muted text-sm" role="status">Saving your ride…</p>
		{:else if free.outcome && 'saved' in free.outcome}
			<p class="text-sm" role="status">
				Saved. <a href="/history/{free.outcome.saved.id}" class="underline"
					>See it in your history</a
				> — and on Strava, if you connected it.
			</p>
			{#if free.road && carriesOn(free.road)}
				<!-- Partway up your own road, the offer is this card's (#3205,
				     TARGETS ride-road-end 2): the same road from where you stopped. -->
				<a
					href="/ride?road={route.id}&from={Math.round(free.road.m)}"
					class="btn btn-primary btn-lg self-start"
					>Carry on from km {formatKm(free.road.m)} next time</a
				>
			{/if}
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
		{#if ended}
			<!-- The flags the ride raised, sent with their notes (#52). -->
			<RideFlags {flags} />
		{/if}
	</div>
{/if}
