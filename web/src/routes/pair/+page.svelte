<script lang="ts">
	import { dev } from '$app/environment';
	import DeviceSlot, { type Slot } from '$lib/components/DeviceSlot.svelte';
	import type { SensorKind } from '$lib/ble/sensor';
	import { sensors } from '$lib/sensors.svelte';

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

	const kinds = Object.keys(slots) as SensorKind[];
	const supported = typeof navigator !== 'undefined' && !!navigator.bluetooth;

	let pairing = $state<SensorKind | null>(null);

	async function pair(kind: SensorKind, simulated = false) {
		pairing = kind;
		await sensors.pair(kind, simulated);
		pairing = null;
	}

	function slotState(kind: SensorKind) {
		if (pairing === kind) return 'connecting' as const;
		const slot = sensors.slot(kind);
		if (slot.status === 'connected') return 'connected' as const;
		if (slot.error) return 'failed' as const;
		return 'idle' as const;
	}

	/** Live-ness is the honest confirmation: paired but silent is not working. */
	function reading(kind: SensorKind): string | undefined {
		const latest = sensors.slot(kind).latest;
		if (!latest) return undefined;
		if (latest.heartRate !== undefined) return `${latest.heartRate} bpm`;
		if (latest.watts !== undefined)
			return `${latest.watts} W · ${latest.cadence ?? 0} rpm`;
		if (latest.cadence !== undefined) return `${latest.cadence} rpm`;
		return undefined;
	}
</script>

<main class="page">
	<div class="flex items-center gap-3">
		<div>
			<h1 class="font-display text-2xl leading-tight font-bold">Sensors</h1>
			<p class="text-muted text-xs">
				All optional. Your trainer is paired when you start a ride.
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
		{#each kinds as kind (kind)}
			{@const slot = sensors.slot(kind)}
			<DeviceSlot
				slot={{
					...slots[kind],
					device: slot.name,
					// Once it is live, the number matters more than the protocol.
					protocol: reading(kind) ?? slots[kind].protocol,
				}}
				state={slotState(kind)}
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
