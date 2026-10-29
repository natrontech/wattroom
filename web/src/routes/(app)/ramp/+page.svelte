<script lang="ts">
	import Banner from '$lib/components/Banner.svelte';
	import RecoveredRides from '$lib/ride/RecoveredRides.svelte';
	import { theRide } from '$lib/ride/the-ride.svelte';
	import TheRide from '$lib/ride/TheRide.svelte';
	import { canSimulate } from '$lib/ble/can-simulate';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import SensorOverview from '$lib/session/SensorOverview.svelte';
	import { heldTrainer } from '$lib/session/sensor-status';
	import { soloTrainer } from '$lib/ride/solo-trainer.svelte';
	import { device } from '$lib/device.svelte';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import type { Trainer } from '$lib/ble/trainer';
	import { RAMP, RAMP_TAKES } from '$lib/workout/ramp';

	let error = $state<string | null>(null);

	// Paired before the test, not by starting it (#611): the paired-devices
	// grid owns the trainer until Start hands it to the ride.
	const solo = soloTrainer();
	// A voice channel's trainer counts as paired here too, and Start rides it
	// (#2635) — the pre-ride's rule, from the same helper.
	const held = $derived(heldTrainer(solo, channelConnection.current?.ride));

	// The test is the app's ride (ADR-0093): this page draws it and never
	// owns it, so leaving mid-test leaves it running.
	const session = $derived(theRide.session);
	const riding = $derived(
		!!theRide.road || (!!session && session.state !== 'idle'),
	);

	async function begin(trainer: Trainer) {
		error = null;
		try {
			await theRide.beginRamp(trainer);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}
</script>

<svelte:head><title>Ramp test · WattRoom</title></svelte:head>

<main
	class="page flex min-h-full flex-col {theRide.live &&
	session?.state !== 'countdown'
		? 'sm:px-6'
		: ''}"
>
	<!-- A ride already under way is the screen, whatever the address asks
	     for: the device has one ride (ADR-0093). -->
	{#if riding}
		<TheRide />
	{:else}
		<h1 class="page-title">Ramp test</h1>
		<p class="text-muted mt-2 max-w-xl text-sm">
			The one workout whose point is to end. Starts at {RAMP.startWatts} W, adds
			{RAMP.stepWatts} W every minute, and stops when you can't hold the step. Your
			FTP is {Math.round(RAMP.ftpFraction * 100)} % of your best minute.
		</p>
		<div class="panel mt-8 max-w-2xl p-8 text-center">
			<p class="text-sm">
				Takes {RAMP_TAKES}, and the last two are unpleasant.
			</p>
			<p class="text-muted mx-auto mt-2 max-w-md text-xs leading-relaxed">
				Ride each minute at the number shown. When you can't hold it any more,
				stop pedalling — stopping is the measurement, not a failure.
			</p>
		</div>

		<!-- The same paired-devices grid a voice channel's Training place draws
		     (#611), outside the panel because the cards are panels themselves.
		     A ramp is the one test whose number you keep, so seeing the trainer
		     report watts before it starts matters more here than anywhere. -->
		<div class="mt-4 max-w-2xl">
			<SensorOverview
				trainer={{
					state: held.state,
					device: held.device,
					reading: held.reading,
					// The one place a trainer fault is put into words
					// (sensor-status.ts): this card retyped the 'silent' case
					// and had nothing at all for 'no-power', which is the fault
					// this whole screen most needs to name (#2158).
					hint: held.hint,
					error: held.error,
					onPair: () => void solo.pair(new FtmsTrainer()),
					onForget: held.forget,
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
		<RecoveredRides onError={(message) => (error = message)} />

		<div class="mt-6 flex gap-2">
			<!-- Never render a button that will fail (errors.md): with no
			     trainer there is no step to hold. -->
			<button
				onclick={() => {
					const trainer = solo.handOff();
					if (trainer) void begin(trainer);
				}}
				disabled={!held.paired || held.fault === 'reconnecting'}
				class="btn btn-primary btn-lg">Start ramp test</button
			>
		</div>
		{#if held.fault === 'reconnecting'}
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
		{:else if !held.paired}
			<p class="text-muted mt-3 text-xs">
				Pair your trainer above to start — the test's steps need something to
				hold them.
			</p>
		{/if}
	{/if}
</main>
