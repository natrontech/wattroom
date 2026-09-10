<script lang="ts">
	import Instrument from '$lib/room/Instrument.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import RideHeader from '$lib/room/RideHeader.svelte';
	import SecondaryRow from '$lib/room/SecondaryRow.svelte';
	import { describeBlock } from '$lib/room/view';
	import Banner from '$lib/components/Banner.svelte';
	import RideStatus from '$lib/ride/RideStatus.svelte';
	import RampResult from './RampResult.svelte';
	import { createRideFlags } from '$lib/ride/flags.svelte';
	import RideFlags from '$lib/ride/RideFlags.svelte';
	import TvOverlay from '$lib/room/TvOverlay.svelte';
	import Flag from '@lucide/svelte/icons/flag';
	import { onDestroy } from 'svelte';
	import { guardLeaving } from '$lib/ride/leave-guard.svelte';
	import { createRideSounds, guardOfRide } from '$lib/ride/ride-sounds.svelte';
	import { canSimulate } from '$lib/ble/can-simulate';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { roomConnection } from '$lib/room/connection.svelte';
	import SensorOverview from '$lib/room/SensorOverview.svelte';
	import { soloTrainer } from '$lib/ride/solo-trainer.svelte';
	import { device } from '$lib/device.svelte';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import type { Trainer } from '$lib/ble/trainer';
	import { sensors } from '$lib/sensors.svelte';
	import { formatClock } from '$lib/format';
	import { createProfileStore } from '$lib/profile.svelte';
	import {
		createRideSession,
		SIGNAL_LOST_MS,
	} from '$lib/workout/session.svelte';
	import { openRideBuffer, type RideBuffer } from '$lib/ride/buffer';
	import { uploadRide } from '$lib/ride/save';
	import {
		buildRampTest,
		RAMP,
		RAMP_TAKES,
		rampBlown,
		rampUsable,
	} from '$lib/workout/ramp';

	const profile = createProfileStore();
	const workout = buildRampTest();

	let session = $state<ReturnType<typeof createRideSession> | null>(null);
	let done = $state(false);
	// The ⚑ and the TV, as /ride has them (#1799, ADR-0046): a ramp that goes
	// wrong is exactly what the flag exists to report.
	const flags = createRideFlags('/ramp');
	let tv = $state(false);
	let flagNotice = $state(false);
	function flag() {
		flags.recorder.flag();
		flagNotice = true;
		setTimeout(() => (flagNotice = false), 4000);
	}
	let error = $state<string | null>(null);
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
					flags.recorder.tick({
						watts: sample.watts,
						cadence: sample.cadence,
						target: session?.target ?? 0,
						state: session?.state ?? '',
					});
				},
			});
			flags.riding(trainer.name, 'starting the ramp test');
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
		// The rows above are stamped with the target NOW: while no sample lands
		// they are a frozen record under a climbing target, which read as a
		// failure and ended a test on a Bluetooth glitch (#1794). The tick still
		// re-runs this every second, so the moment samples return it looks again.
		const last = current.sample;
		const stale = !last || Date.now() - last.at > SIGNAL_LOST_MS;
		if (
			rampBlown(current.elapsed, trailing, {
				stale,
				released: current.spiralActive,
			})
		) {
			current.stop();
			done = true;
		}
	});

	// The same persistent status /ride shows (#37, errors.md): past 3 s without
	// a sample the test says so rather than freezing a number the rider is
	// about to trust for a month.
	let nowMs = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (nowMs = Date.now()), 1000);
		return () => clearInterval(id);
	});
	const signalLost = $derived(
		!!session &&
			session.state !== 'done' &&
			!!session.sample &&
			nowMs - session.sample.at > SIGNAL_LOST_MS,
	);

	// The ramp speaks like every ride (#1792): each step is a block cue, the
	// guards and a dropout say so, and the end is heard — the number a rider
	// keeps for a month should not arrive in silence.
	createRideSounds({
		fault: () => (signalLost ? 'trainer' : null),
		sprint: () => null,
		guard: () => guardOfRide(session?.state),
		spiral: () => session?.spiralActive,
		block: () =>
			session && session.state !== 'idle' && session.state !== 'done'
				? session.info.segmentIndex
				: undefined,
		ended: () => session?.state === 'done',
	});

	// "Test again" used to be a link to this page, which a same-route
	// navigation leaves exactly as it was (#1797): the page kept its finished
	// session and the button did nothing. This is the fresh page begin() starts
	// from, with the trainer back in the grid.
	function restart() {
		if (session && session.state !== 'done') session.stop();
		session = null;
		buffer = null;
		savedId = null;
		rideStatus = null;
		recorded = false;
		done = false;
		error = null;
	}

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
	<h1 class="page-title">Ramp test</h1>
	<p class="text-muted mt-2 max-w-xl text-sm">
		The one workout whose point is to end. Starts at {RAMP.startWatts} W, adds
		{RAMP.stepWatts} W every minute, and stops when you can't hold the step. Your
		FTP is {Math.round(RAMP.ftpFraction * 100)} % of your best minute.
	</p>

	{#if !session}
		<div class="panel mt-8 max-w-2xl p-8 text-center">
			<p class="text-sm">
				Takes {RAMP_TAKES}, and the last two are unpleasant.
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
				disabled={!solo.trainer || solo.fault === 'reconnecting'}
				class="btn btn-primary btn-lg">Start ramp test</button
			>
		</div>
		{#if solo.fault === 'reconnecting'}
			<p class="text-muted mt-3 text-xs">
				Waiting for the trainer to come back.
			</p>
		{/if}
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
					<div class="flex flex-wrap items-center justify-end gap-2">
						<button onclick={() => (tv = true)} class="btn btn-secondary btn-lg"
							>TV</button
						>
						<button
							onclick={() => {
								session?.stop();
								done = true;
							}}
							class="btn btn-secondary btn-lg">I'm done</button
						>
						<!-- The ⚑ (#52): one tap, no dialog, keep pedalling. -->
						<button
							onclick={flag}
							class="border-neon/40 text-neon hover:bg-neon/10 grid h-11 w-14 place-items-center rounded border"
							aria-label="Flag a problem"><Flag size={18} /></button
						>
					</div>
				{/snippet}
			</RideHeader>

			{#if flagNotice}
				<!-- Consent in plain words, at the moment of the tap, never blocking. -->
				<p class="text-muted mt-2 text-xs">
					Flagged — after the test this sends your last two minutes of ride data
					and logs to the developers. Only yours, nobody else's.
				</p>
			{/if}

			<!-- The guard states and the dropout, as /ride says them (#1799):
			     mid-ramp the resistance can vanish for ten seconds on purpose. -->
			<RideStatus
				{session}
				{signalLost}
				lost="Trainer signal lost — reconnecting. Keep pedalling; the step resumes the moment it is back, and the test will not end on the gap."
			/>

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
			<RideFlags {flags} />
			<div class="mt-6 flex gap-2">
				<button onclick={restart} class="btn btn-primary">Test again</button>
				<a href="/workouts" class="btn btn-secondary">Ride something else</a>
			</div>
		</div>
	{:else}
		<!-- The number, and what to do with it: its own component (#1799),
		     which also keeps this page under the ceiling. -->
		<RampResult {session} {stepsDone} onRestart={restart}>
			{@render rideLine()}
			<RideFlags {flags} />
		</RampResult>
	{/if}
</main>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (tv = false)} />

{#if session && !done && session.state !== 'done' && tv}
	<!-- The room's TV, on the ramp (#1799, ADR-0046): the same screen at 3 m. -->
	<TvOverlay
		riders={[
			{
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
				watts: session.sample?.watts ?? 0,
				cadence: session.sample?.cadence ?? 0,
				hr: session.sample?.heartRate ?? 0,
				stale: false,
				target: session.target,
				trace: session.trace,
			},
		]}
		segments={session.segments}
		total={session.total}
		elapsed={session.elapsed}
		{block}
		roomName={workout.name}
		workoutName={block?.label ?? ''}
		live
		onExit={() => (tv = false)}
	/>
{/if}
