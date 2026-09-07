<script lang="ts">
	// The screen a rider opens to ask "what am I paired to?" — and, since
	// #1000, to answer it: pairing a trainer here used to be disabled with a
	// note sending the rider into a room, on the one page named for pairing.
	// The machinery was already there; only this page was never wired to it.
	//
	// One card everywhere (#1000): the same `SensorOverview` /ride, /ramp and
	// the Training place draw, so the answer reads identically wherever a
	// rider happens to be standing.
	import { canSimulate } from '$lib/ble/can-simulate';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import { createProfileStore } from '$lib/profile.svelte';
	import { createSoloTrainer } from '$lib/ride/solo-trainer.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import SensorOverview from '$lib/room/SensorOverview.svelte';
	import { deviceWord } from '$lib/room/sensor-claim';
	import { pairedElsewhereAll, trainerState } from '$lib/room/sensor-status';
	import { sensors } from '$lib/sensors.svelte';

	// A room holds its BLE connection for as long as you stand in one (#521),
	// and this page could not see it (#565) — so when there IS a room, its
	// trainer is the one to show. With no room, the page pairs its own, the
	// way /ride does: `solo.pair` takes the hardware back from a room first,
	// so the two owners can never both hold it.
	const solo = createSoloTrainer();
	const profile = createProfileStore();
	const ride = $derived(roomConnection.current?.ride);
	const roomHolds = $derived(!!ride?.trainer);
	// And what the rider's OTHER screens hold (#610) — answering only for this
	// tab would be the same half-truth #565 fixed.
	const elsewhere = $derived(
		pairedElsewhereAll(roomConnection.current?.live.pairing, deviceWord()),
	);

	const roomTrainerState = $derived(
		trainerState(
			{
				trainer: ride?.trainer ?? null,
				fault: ride?.fault ?? null,
				error: ride?.error ?? null,
			},
			null,
		),
	);

	async function pairTrainer() {
		await solo.pair(new FtmsTrainer());
	}

	async function pairSimulated() {
		await solo.pair(
			new SimulatedTrainer({ baseWatts: profile.current.ftp * 0.75 }),
		);
	}

	function forgetTrainer() {
		if (roomHolds) ride?.unpair();
		else solo.forget();
	}
</script>

<main class="page">
	<div class="flex items-center gap-3">
		<div>
			<h1 class="font-display text-2xl leading-tight font-bold">Sensors</h1>
			<p class="text-muted text-xs">
				Your trainer, and whatever else you strap on. Everything below it is
				optional.
			</p>
		</div>
	</div>

	<div class="mt-8">
		<SensorOverview
			{elsewhere}
			trainer={{
				state: roomHolds ? roomTrainerState : solo.state,
				device: roomHolds ? ride?.trainer?.name : solo.trainer?.name,
				// Live-ness is the honest confirmation: paired but silent is not
				// working (#520), and this is the screen a rider checks it on.
				reading: roomHolds ? undefined : solo.reading,
				hint:
					(roomHolds ? ride?.fault : solo.fault) === 'silent'
						? 'no watts yet — turn the cranks'
						: undefined,
				error: roomHolds ? ride?.error : solo.error,
				onPair: () => void pairTrainer(),
				onForget: forgetTrainer,
				onSimulate: canSimulate() ? () => void pairSimulated() : undefined,
			}}
		/>
	</div>

	<!-- What each optional sensor actually buys the rider — capability gating
	     needs a reason, not a shrug (ux.md), and for two of these the honest
	     answer is "probably nothing, your trainer already does it". It sits
	     under the grid rather than inside the cards because this is the screen
	     a rider reads, not the one they glance at mid-ride. -->
	<dl class="text-muted mt-6 grid gap-2 text-xs sm:grid-cols-3">
		<div>
			<dt class="text-ink font-medium">Heart rate</dt>
			<dd>
				Adds bpm to your dashboard and your .fit export. If your strap is
				already paired to your trainer, it comes through without this.
			</dd>
		</div>
		<div>
			<dt class="text-ink font-medium">Power meter</dt>
			<dd>
				Pair one only if you trust it over your trainer — it takes over as the
				power your ride is scored on.
			</dd>
		</div>
		<div>
			<dt class="text-ink font-medium">Cadence</dt>
			<dd>
				Most trainers report cadence already. Worth pairing if yours drops out
				when you stop sprinting.
			</dd>
		</div>
	</dl>

	<div class="mt-8 flex flex-wrap items-center gap-3">
		<a href="/workouts" class="btn btn-primary btn-lg">Pick a workout</a>
		{#if canSimulate()}
			<!-- Same reason SimulatedTrainer exists: the dashboard has to be
			     buildable without a strap on your chest. Dev equipment (#123),
			     behind the one gate every surface now shares. -->
			<button
				onclick={() => void sensors.pair('heart-rate', true)}
				class="btn btn-secondary btn-lg">Simulate a strap</button
			>
		{/if}
	</div>
</main>
