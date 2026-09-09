<script lang="ts">
	import Instrument from '$lib/room/Instrument.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import RideHeader from '$lib/room/RideHeader.svelte';
	import SecondaryRow from '$lib/room/SecondaryRow.svelte';
	import { describeBlock } from '$lib/room/view';
	import Banner from '$lib/components/Banner.svelte';
	import { onDestroy } from 'svelte';
	import { guardLeaving } from '$lib/ride/leave-guard.svelte';
	import { canSimulate } from '$lib/ble/can-simulate';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { roomConnection } from '$lib/room/connection.svelte';
	import SensorOverview from '$lib/room/SensorOverview.svelte';
	import { soloTrainer } from '$lib/ride/solo-trainer.svelte';
	import { device } from '$lib/device.svelte';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import type { Trainer } from '$lib/ble/trainer';
	import { sensors } from '$lib/sensors.svelte';
	import { ZONE_TEXT, zoneOf } from '$lib/components/zones';
	import { formatClock } from '$lib/format';
	import { pushProfile } from '$lib/profile-sync.svelte';
	import { createProfileStore, PROFILE_LIMITS } from '$lib/profile.svelte';
	import { createRideSession } from '$lib/workout/session.svelte';
	import { openRideBuffer, type RideBuffer } from '$lib/ride/buffer';
	import { uploadRide } from '$lib/ride/save';
	import {
		buildRampTest,
		ftpFromRamp,
		RAMP,
		rampBlown,
		rampUsable,
	} from '$lib/workout/ramp';

	const profile = createProfileStore();
	const workout = buildRampTest();

	let session = $state<ReturnType<typeof createRideSession> | null>(null);
	let done = $state(false);
	let error = $state<string | null>(null);
	let saved = $state(false);
	let lthrSaved = $state(false);
	// The test is a ride (#1540): buffered like one and saved like one, so
	// fifteen maximal minutes reach the history, count as load, and survive
	// a crash at minute fourteen.
	let buffer: RideBuffer | null = null;
	let savedId = $state<string | null>(null);
	let rideStatus = $state<string | null>(null);
	let recorded = false;

	// Paired before the test, not by starting it (#611): the paired-devices
	// grid owns the trainer until Start hands it to the session.
	const solo = soloTrainer();

	// FTP is irrelevant to the test itself — the steps are absolute watts — but the
	// session needs one, so it gets the current profile value.
	async function begin(trainer: Trainer) {
		error = null;
		done = false;
		saved = false;
		lthrSaved = false;
		// One trainer, one rider (#521): the room now holds its BLE connection
		// for as long as you stand in it, so a solo ride has to take it back
		// rather than open a second control channel to the same hardware. A
		// trainer paired in the grid and then left for a simulated run is the
		// same conflict on this page.
		roomConnection.current?.ride.unpair();
		if (solo.trainer && solo.trainer !== trainer) solo.forget();
		try {
			const startedAt = Date.now();
			recorded = false;
			savedId = null;
			rideStatus = null;
			buffer = await openRideBuffer({
				rideId: String(startedAt),
				startedAt,
				workoutName: workout.name,
				workoutJson: JSON.stringify(workout),
			});
			const next = createRideSession({
				trainer,
				workout,
				ftp: profile.current.ftp,
				startedAt,
				readings: () => sensors.readings,
				onRecord: (sample) => {
					buffer?.append({ ...sample, seq: sample.second + 1, at: Date.now() });
				},
			});
			await next.start();
			session = next;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	// The rider at the end of a ramp will not press a button; the test notices for them.
	// Against the PRESCRIBED target, not the actuator's: stopping is how a ramp ends,
	// and auto-pause releases the target to zero three seconds before the five the
	// test needs — so `current.target` had the rider sitting in a pause that never
	// resolved into a result (#792).
	$effect(() => {
		const current = session;
		if (!current || done) return;
		const trailing = current.recording.slice(-RAMP.failSeconds).map((s) => ({
			watts: s.watts,
			target: current.info.targetWatts ?? 0,
		}));
		if (rampBlown(current.elapsed, trailing)) {
			current.stop();
			done = true;
		}
	});

	const result = $derived(
		session
			? ftpFromRamp(session.recording.map((s) => s.watts))
			: { best: 0, ftp: 0 },
	);
	const wkg = $derived((result.ftp / profile.current.kg).toFixed(2));
	const usable = $derived(rampUsable(session?.elapsed ?? 0));
	const stepsDone = $derived(
		Math.max(
			0,
			Math.floor(
				((session?.elapsed ?? 0) - RAMP.warmupSeconds) / RAMP.stepSeconds,
			),
		),
	);
	// The same header every other ride gets (ADR-0046). The ramp counts its own
	// steps, because the warm-up is segment one and "step 1" must not name it;
	// everything else in the block — the next step's ABSOLUTE watts above all —
	// falls out of the shared view model.
	const block = $derived(
		session && session.segments.length > 0
			? describeBlock(
					session.info,
					session.segments,
					workout,
					profile.current.ftp,
				)
			: null,
	);
	const stepEyebrow = $derived(
		(session?.elapsed ?? 0) < RAMP.warmupSeconds
			? 'warm-up'
			: `step ${stepsDone + 1} of ${RAMP.steps}`,
	);
	/** The test's own top, in FTP fractions — the graph's scale, as #1565 gave
	 *  the gauge one. */
	const rampCeiling = $derived(
		(RAMP.startWatts + RAMP.steps * RAMP.stepWatts) / profile.current.ftp,
	);

	// LTHR suggestion (ADR-0014): a maximal ramp ends near HRmax, and the
	// SPEC's field estimate is 90 % of that. Suggested, never auto-applied —
	// the same posture as FTP suggestions.
	const maxHr = $derived(
		(session?.recording ?? []).reduce(
			(peak, sample) => Math.max(peak, sample.heartRate ?? 0),
			0,
		),
	);
	const suggestedLthr = $derived.by(() => {
		const estimate = Math.round(0.9 * maxHr);
		return estimate >= PROFILE_LIMITS.minLthr &&
			estimate <= PROFILE_LIMITS.maxLthr
			? estimate
			: 0;
	});
	// The account first, like the FTP below (#1571): the anchor used to live
	// in this browser alone, and the desktop app read "—" the same evening.
	async function saveLthr() {
		const message =
			(await pushProfile({ lthr: suggestedLthr })) ??
			profile.update({ lthr: suggestedLthr });
		if (message) error = message;
		else lthrSaved = true;
	}

	// The account first, this browser second (#1543): the other order
	// reported "Saved" on a push that never landed, and the next boot pulled
	// the old number back over the new one.
	async function saveFtp() {
		const message =
			(await pushProfile({ ftpWatts: result.ftp })) ??
			profile.update({ ftp: result.ftp, ftpMeasuredAt: Date.now() });
		if (message) error = message;
		else saved = true;
	}

	// The ride half of the test, once — from the effect below and from
	// onDestroy, the same two doors /ride has.
	$effect(() => {
		if (session?.state === 'done') saveRide(session);
	});
	function saveRide(current: ReturnType<typeof createRideSession>) {
		if (recorded) return;
		recorded = true;
		if (current.recording.length === 0) {
			buffer?.end();
			return;
		}
		const ended = buffer;
		void uploadRide({
			workoutName: workout.name,
			workoutJson: JSON.stringify(workout),
			startedAt: current.startedAt.toISOString(),
			samples: current.recording.map((sample) => ({
				watts: sample.watts,
				cadence: sample.cadence,
				hr: sample.heartRate,
			})),
		}).then((outcome) => {
			if ('saved' in outcome) {
				ended?.end();
				savedId = outcome.saved.id || null;
				return;
			}
			// Under a minute is refused for good; anything else stays in the
			// buffer and is offered back on /ride with a Save (#794).
			if (outcome.failure.final) ended?.end();
			rideStatus = outcome.failure.final
				? outcome.failure.message
				: `${outcome.failure.message} The riding is kept on this device — /ride offers it back with a Save.`;
		});
	}
	// One mis-tap on the rail at minute 14 must not lose the number: the same
	// confirm /ride has, only while the test is alive.
	guardLeaving(
		() =>
			!!session &&
			!done &&
			session.state !== 'done' &&
			session.state !== 'idle',
		{
			title: 'Stop the ramp test and leave?',
			body: 'The test cannot be resumed — its number is lost. The riding so far is saved to your history.',
			action: 'Stop the test',
			cancel: 'Keep going',
		},
	);
	// This page is the session's only owner: leaving mid-test ends it, or the
	// trainer holds a step with nobody watching and the frame stays caved.
	onDestroy(() => {
		if (!session) return;
		session.stop();
		saveRide(session);
	});
</script>

{#snippet rideLine()}
	{#if savedId}
		<p class="text-muted mt-3 text-xs">
			The riding is on your history too — <a
				href="/history/{savedId}"
				class="underline">see the ride</a
			>.
		</p>
	{:else if rideStatus}
		<div class="mt-3"><Banner tone="warn">{rideStatus}</Banner></div>
	{/if}
{/snippet}

<svelte:head><title>Ramp test · WattRoom</title></svelte:head>

<main class="page">
	<h1 class="font-display text-3xl font-bold tracking-tight">Ramp test</h1>
	<p class="text-muted mt-2 max-w-xl text-sm">
		The one workout whose point is to end. Starts at {RAMP.startWatts} W, adds
		{RAMP.stepWatts} W every minute, and stops when you can't hold the step. Your
		FTP is {Math.round(RAMP.ftpFraction * 100)} % of your best minute.
	</p>

	{#if !session}
		<div class="panel mt-8 max-w-2xl p-8 text-center">
			<p class="text-sm">
				About 12–18 minutes, and the last two are unpleasant.
			</p>
			<p class="text-muted mx-auto mt-2 max-w-md text-xs leading-relaxed">
				Ride each minute at the number shown. When you can't hold it any more,
				stop pedalling — stopping is the measurement, not a failure.
			</p>
		</div>

		<!-- The same paired-devices grid the room's Training place draws
		     (#611), outside the panel because the cards are panels themselves.
		     A ramp is the one test whose number you keep, so seeing the trainer
		     report watts before it starts matters more here than anywhere. -->
		<div class="mt-4 max-w-2xl">
			<SensorOverview
				trainer={{
					state: solo.state,
					device: solo.trainer?.name,
					reading: solo.reading,
					hint:
						solo.fault === 'silent'
							? 'no watts yet — turn the cranks'
							: undefined,
					error: solo.error,
					onPair: () => void solo.pair(new FtmsTrainer()),
					onForget: () => solo.forget(),
					// Simulated watts pair like any other trainer rather than
					// starting the test outright: the card is where a rider sees
					// a trainer reporting before Start.
					onSimulate: canSimulate()
						? () => void solo.pair(new SimulatedTrainer({ baseWatts: 150 }))
						: undefined,
				}}
			/>
		</div>

		{#if error}
			<div class="mt-4"><Banner tone="error">{error}</Banner></div>
		{/if}

		<div class="mt-6 flex gap-2">
			<!-- Never render a button that will fail (errors.md): with no
				     trainer there is no step to hold. -->
			<button
				onclick={() => {
					const trainer = solo.handOff();
					if (trainer) void begin(trainer);
				}}
				disabled={!solo.trainer}
				class="btn btn-primary btn-lg">Start ramp test</button
			>
		</div>
		{#if device.spectator}
			<!-- The grid above is hidden on a spectator device, so the disabled
			     button needs its own reason (errors.md). -->
			<p class="text-muted mt-3 text-xs">
				This device can't reach a trainer — its browser has no Web Bluetooth.
				Test from a desktop, or Chrome on Android.
			</p>
		{:else if !solo.trainer}
			<p class="text-muted mt-3 text-xs">
				Pair your trainer above to start — the test's steps need something to
				hold them.
			</p>
		{/if}
	{:else if !done}
		<!-- One riding surface (ADR-0046): the header, the instrument, your own
		     numbers and the horizon, in the order the room and the solo ride use
		     them. The ramp's real differences are two words — it prescribes a
		     STEP, and it counts steps rather than blocks. -->
		<div class="panel mt-8 flex flex-col gap-5 p-8">
			<RideHeader
				{block}
				elapsed={session.elapsed}
				total={session.total}
				cadence={session.sample?.cadence ?? 0}
				hr={session.sample?.heartRate ?? 0}
				title={workout.name}
				unit="step"
				eyebrow={stepEyebrow}
			>
				{#snippet controls()}
					<button
						onclick={() => {
							session?.stop();
							done = true;
						}}
						class="btn btn-secondary btn-lg shrink-0">I'm done</button
					>
				{/snippet}
			</RideHeader>

			<!-- Scaled to the test's own top, not the FTP it exists to correct
			     (#1565): at FTP 180 the bar used to pin at 270 W on step 10. -->
			<Instrument
				watts={session.sample?.watts ?? 0}
				target={session.target}
				ftp={profile.current.ftp}
				targetLabel="step"
				fullScale={RAMP.startWatts + RAMP.steps * RAMP.stepWatts}
			/>

			<!-- The test records heart rate for its whole length and reads the
			     peak to suggest an LTHR, and never showed the rider a bpm
			     (#1531). -->
			<SecondaryRow
				cadence={session.sample?.cadence ?? 0}
				hr={session.sample?.heartRate ?? 0}
				watts={session.sample?.watts ?? 0}
				kg={profile.current.kg}
				lthr={profile.current.lthr}
			/>

			<!-- The staircase, and how far up it you are. -->
			<div class="h-28">
				<IntervalGraph
					segments={session.segments}
					total={session.total}
					elapsed={session.elapsed}
					ftp={profile.current.ftp}
					ceiling={rampCeiling}
					trace={session.trace}
				/>
			</div>
		</div>
	{:else if !usable}
		<div class="panel mt-8 p-8">
			<h2 class="font-display text-2xl font-bold">Not enough to measure</h2>
			<p class="text-muted mt-3 max-w-md text-sm leading-relaxed">
				You stopped after {formatClock(session.elapsed)}. The test needs the
				{formatClock(RAMP.warmupSeconds)} warm-up plus at least {RAMP.minSteps}
				steps before the number means anything.
			</p>
			{@render rideLine()}
			<div class="mt-6 flex gap-2">
				<a href="/ramp" class="btn btn-primary">Test again</a>
				<a href="/workouts" class="btn btn-secondary">Ride something else</a>
			</div>
		</div>
	{:else}
		<div class="panel mt-8 p-8">
			<p class="eyebrow">your new FTP</p>
			<div class="mt-2 flex items-baseline gap-2">
				<span
					class="text-watt glow-text-strong font-display text-7xl leading-none font-bold tabular-nums"
					>{result.ftp}</span
				>
				<span class="text-muted text-xl">W</span>
			</div>
			<p class="text-muted mt-4 text-xs leading-relaxed">
				Best minute was {result.best} W, and FTP is {Math.round(
					RAMP.ftpFraction * 100,
				)} % of that. You lasted {formatClock(session.elapsed)} — {stepsDone}
				steps. Every workout you ride from here scales to this number —
				<a href="/workouts" class="underline">the library</a>
				and <a href="/home" class="underline">what your rooms have planned</a> already
				do.
			</p>
			<p class="mt-3 text-sm">
				That's <span class={ZONE_TEXT[zoneOf(result.ftp, result.ftp)]}
					>{wkg} w/kg</span
				>
				at {profile.current.kg} kg.
			</p>
			{@render rideLine()}

			{#if error}
				<div class="mt-4"><Banner tone="error">{error}</Banner></div>
			{/if}

			{#if saved}
				<p
					class="border-z4/40 bg-z4/10 mt-6 rounded-lg border px-4 py-3 text-sm"
				>
					Saved. Every workout now scales to {result.ftp} W.
				</p>
				<a href="/workouts" class="btn btn-secondary mt-3">Pick a workout</a>
			{:else}
				<div class="mt-6 flex gap-2">
					<button
						onclick={saveFtp}
						disabled={result.ftp === 0}
						class="btn btn-primary">Save {result.ftp} W</button
					>
					<a href="/ramp" class="btn btn-secondary">Test again</a>
					<!-- Never silently change FTP: it moves every workout's difficulty. -->
					<a
						href="/settings/profile"
						class="text-muted hover:text-ink self-center py-2 text-xs underline"
						>Keep my current {profile.current.ftp} W</a
					>
				</div>
			{/if}

			{#if suggestedLthr > 0}
				<div class="border-ink/5 mt-6 border-t pt-4">
					{#if lthrSaved}
						<p class="text-z4 text-xs">
							LTHR set to {suggestedLthr} bpm — your heart-rate zones now follow it.
						</p>
					{:else}
						<p class="text-muted text-xs">
							Your heart rate peaked at {maxHr} bpm — that puts your LTHR around
							{suggestedLthr} bpm{profile.current.lthr
								? ` (currently ${profile.current.lthr})`
								: ''}.
						</p>
						<button onclick={saveLthr} class="btn btn-secondary btn-xs mt-2"
							>Set LTHR to {suggestedLthr}</button
						>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</main>
