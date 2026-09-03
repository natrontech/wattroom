<script lang="ts">
	import { dev } from '$app/environment';
	import DeviceSlot, { type Slot } from '$lib/components/DeviceSlot.svelte';
	import type { SensorKind } from '$lib/ble/sensor';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { roomConnection } from '$lib/room/connection.svelte';
	import {
		type Pairing,
		sensorReading,
		sensorState,
		trainerState,
	} from '$lib/room/sensor-status';
	import { sensors } from '$lib/sensors.svelte';

	// The trainer is paired in a ROOM (#521) and this page could not see it, so
	// the one screen a rider opens to check their equipment was silent about the
	// only device the ride depends on (#565).
	const ride = $derived(roomConnection.current?.ride);

	// What each sensor buys the rider. Capability gating needs a reason, not a shrug
	// (.claude/rules/ux.md) — and for two of these the honest answer is "probably
	// nothing, your trainer already does it".
	const slots: Record<SensorKind, Slot> = {
		'heart-rate': {
			id: 'heart-rate',
			label: 'Heart rate',
			need: 'Adds bpm to your dashboard and your .fit export. If your strap is already paired to your trainer, it comes through without this.',
			required: false,
			protocol: 'HRS · 0x180D',
		},
		'power-meter': {
			id: 'power-meter',
			label: 'Power meter',
			need: 'Pair one only if you trust it over your trainer — it takes over as the power your ride is scored on.',
			required: false,
			protocol: 'CPS · 0x1818',
		},
		cadence: {
			id: 'cadence',
			label: 'Cadence',
			need: 'Most trainers report cadence already. Worth pairing if yours drops out when you stop sprinting.',
			required: false,
			protocol: 'CSC · 0x1816',
		},
	};

	const trainerSlot: Slot = {
		id: 'trainer',
		label: 'Trainer',
		need: 'Pairing lives in the room — open one and pair from the Lounge or the Training place.',
		required: true,
		protocol: 'FTMS · 0x1826',
	};

	const kinds = Object.keys(slots) as SensorKind[];
	const supported = typeof navigator !== 'undefined' && !!navigator.bluetooth;

	let pairing = $state<Pairing>(null);

	/** #520's fault states, said in words a rider can act on. */
	const trainerSlotState = $derived(
		trainerState(
			{
				trainer: ride?.trainer ?? null,
				fault: ride?.fault ?? null,
				error: ride?.error ?? null,
			},
			pairing,
		),
	);

	async function pairTrainer() {
		if (!ride) return;
		pairing = 'trainer';
		await ride.ride(new FtmsTrainer());
		pairing = null;
	}

	async function pair(kind: SensorKind, simulated = false) {
		pairing = kind;
		await sensors.pair(kind, simulated);
		pairing = null;
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

	{#if !supported}
		<p
			class="border-muted/20 bg-surface-raised text-muted mt-8 rounded-lg border px-5 py-4 text-sm"
		>
			This browser has no Web Bluetooth, so nothing here can pair. Chrome or
			Edge on desktop or Android will work; Safari has said it never will.
		</p>
	{/if}

	<div class="mt-8 grid gap-3">
		<DeviceSlot
			slot={{
				...trainerSlot,
				device: ride?.trainer?.name,
				// Paired but silent is not working (#520) — say so where the rider
				// is looking, rather than reading as a healthy trainer.
				protocol:
					ride?.fault === 'silent'
						? 'FTMS · 0x1826 · no watts yet — turn the cranks'
						: trainerSlot.protocol,
			}}
			state={trainerSlotState}
			supported={supported && !!ride}
			onPair={() => void pairTrainer()}
			onForget={() => ride?.unpair()}
		/>
		{#if ride?.error && pairing !== 'trainer'}
			<p class="text-muted -mt-1 px-5 text-xs">{ride.error}</p>
		{/if}

		{#each kinds as kind (kind)}
			{@const slot = sensors.slot(kind)}
			<DeviceSlot
				slot={{
					...slots[kind],
					device: slot.name,
					// Once it is live, the number matters more than the protocol.
					protocol: sensorReading(kind) ?? slots[kind].protocol,
				}}
				state={sensorState(kind, pairing)}
				{supported}
				onPair={() => pair(kind)}
				onForget={() => sensors.forget(kind)}
			/>
			{#if slot.error && pairing !== kind}
				<p class="text-muted -mt-1 px-5 text-xs">{slot.error}</p>
			{/if}
		{/each}
	</div>

	<div class="mt-8 flex flex-wrap items-center gap-3">
		<a href="/workouts" class="btn btn-primary btn-lg">Pick a workout</a>
		{#if dev}
			<!-- Same reason SimulatedTrainer exists: the dashboard has to be
			     buildable without a strap on your chest. Dev-only (#123). -->
			<button
				onclick={() => pair('heart-rate', true)}
				class="btn btn-secondary btn-lg">Simulate a strap</button
			>
		{/if}
	</div>
</main>
