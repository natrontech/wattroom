<script module lang="ts">
	import type { PairState } from '$lib/room/sensor-status';

	/**
	 * The trainer card's view-model, injected by whoever owns the trainer.
	 *
	 * Two owners, and they are not alike (#611): a room holds its connection
	 * for as long as you stand in it (`RoomSensorOverview`), while a solo
	 * pre-ride screen pairs one it has not started riding yet
	 * (`lib/ride/solo-trainer.svelte.ts`). The three read-only sensors below
	 * the trainer are the same singleton on every screen, so they stay wired
	 * inside this component.
	 */
	export interface TrainerSlot {
		state: PairState;
		device?: string;
		/** Live watts and cadence — the honest confirmation, not just a name. */
		reading?: string;
		/** One line under the reading when it is paired but not well (#520). */
		hint?: string;
		/** Why the last pair attempt failed; shown under the grid. */
		error?: string | null;
		onPair: () => void;
		onForget: () => void;
		/** A simulated trainer, when the caller is allowed to offer one (#123). */
		onSimulate?: () => void;
	}
</script>

<script lang="ts">
	// The "get set up" grid — one card per sensor, Zwift's "Paired Devices"
	// shape, so a rider sees what is and isn't connected before they ever look
	// for a "Pair trainer" button (#606). It is the Training place's idle
	// state and both solo pre-ride screens (#611); the compact header
	// TrainerButton shown once a session is running is unchanged.
	import { device } from '$lib/device.svelte';
	import type { SensorKind } from '$lib/ble/sensor';
	import {
		type Pairing,
		sensorReading,
		sensorState,
	} from '$lib/room/sensor-status';
	import { sensors } from '$lib/sensors.svelte';
	import { Bike, HeartPulse, RotateCw, Zap } from '@lucide/svelte';

	let {
		trainer,
		elsewhere = {},
	}: {
		trainer: TrainerSlot;
		/**
		 * Kinds one of the rider's OTHER screens holds, as the phrase naming
		 * it — "on your phone" (#610). A card with one shows that instead of
		 * a pair button: the hub grants one screen per sensor and would
		 * refuse a second. Empty on the solo pre-ride screens, which hold no
		 * room socket and so have nothing to arbitrate.
		 */
		elsewhere?: Record<string, string>;
	} = $props();

	const supported = typeof navigator !== 'undefined' && !!navigator.bluetooth;

	let pairing = $state<Pairing>(null);

	async function pairSensor(kind: SensorKind) {
		pairing = kind;
		await sensors.pair(kind);
		pairing = null;
	}

	const SENSORS: { kind: SensorKind; label: string; icon: typeof Zap }[] = [
		{ kind: 'heart-rate', label: 'Heart rate', icon: HeartPulse },
		{ kind: 'power-meter', label: 'Power meter', icon: Zap },
		{ kind: 'cadence', label: 'Cadence', icon: RotateCw },
	];
</script>

{#snippet card(args: {
	label: string;
	icon: typeof Zap;
	required: boolean;
	state: PairState;
	device?: string;
	reading?: string;
	hint?: string;
	/** Held by another of the rider's screens: the phrase naming it (#610). */
	elsewhere?: string;
	onPair: () => void;
	onForget: () => void;
})}
	{@const taken = !!args.elsewhere && args.state !== 'connected'}
	<div
		class="panel flex min-w-0 flex-col items-center gap-2 px-4 py-5 text-center"
	>
		<args.icon
			size={28}
			class={args.state === 'connected' ? 'text-z4' : 'text-muted'}
			opacity={taken ? 0.5 : 1}
		/>
		<div class="min-w-0">
			<p class="font-display text-sm font-bold">
				{args.label}
				{#if !args.required}<span class="eyebrow ml-1">optional</span>{/if}
			</p>
			{#if args.state === 'connected'}
				<p class="mt-0.5 truncate text-xs">{args.device}</p>
				{#if args.reading}
					<p class="font-display text-watt text-sm font-bold tabular-nums">
						{args.reading}
					</p>
				{/if}
				{#if args.hint}
					<p class="text-danger mt-0.5 text-[11px]">{args.hint}</p>
				{/if}
			{:else if taken}
				<!-- The rider's own kit, on the rider's own other screen: not an
				     empty slot and not an error. -->
				<p class="text-muted mt-0.5 text-xs">Paired {args.elsewhere}</p>
			{:else if args.state === 'connecting'}
				<p class="text-muted mt-0.5 text-xs">Connecting…</p>
			{:else if args.state === 'failed'}
				<p class="text-danger mt-0.5 text-xs">Couldn't connect</p>
			{:else}
				<p class="text-muted mt-0.5 text-xs">Not connected</p>
			{/if}
		</div>
		{#if args.state === 'connected'}
			<button
				onclick={args.onForget}
				class="border-muted/25 hover:border-muted/60 rounded border px-3 py-1.5 text-xs"
				>Forget</button
			>
		{:else if taken}
			<!-- Nothing to press: the sensor is held, and not by this screen.
			     Forgetting it there is what frees it (ux.md: say why, never a
			     button that fails). -->
			<p class="text-muted text-[11px]">Forget it there to move it</p>
		{:else}
			<!-- Never render a button that will fail: no Web Bluetooth, no live control. -->
			<button
				onclick={args.onPair}
				disabled={!supported || args.state === 'connecting'}
				class="btn {args.state === 'failed'
					? 'btn-secondary'
					: 'btn-primary'} btn-xs"
				>{args.state === 'connecting'
					? 'Pairing…'
					: args.state === 'failed'
						? 'Try again'
						: 'Pair'}</button
			>
		{/if}
	</div>
{/snippet}

<!-- Phones are spectators (WATTROOM.md, locked) — there is no trainer to
     pair and no reason to draw the question (#412). -->
{#if !device.spectator}
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		{@render card({
			label: 'Trainer',
			icon: Bike,
			required: true,
			state: trainer.state,
			device: trainer.device,
			reading: trainer.state === 'connected' ? trainer.reading : undefined,
			hint: trainer.hint,
			elsewhere: elsewhere.trainer,
			onPair: trainer.onPair,
			onForget: trainer.onForget,
		})}
		{#each SENSORS as sensor (sensor.kind)}
			{@const slot = sensors.slot(sensor.kind)}
			{@render card({
				label: sensor.label,
				icon: sensor.icon,
				required: false,
				state: sensorState(sensor.kind, pairing),
				device: slot.name,
				reading: sensorReading(sensor.kind),
				elsewhere: elsewhere[sensor.kind],
				onPair: () => void pairSensor(sensor.kind),
				onForget: () => void sensors.forget(sensor.kind),
			})}
		{/each}
	</div>
	{#if !supported}
		<p class="text-muted mt-2 text-xs">
			This browser has no Web Bluetooth, so nothing here can pair. Chrome or
			Edge on desktop or Android will work.
		</p>
	{:else if trainer.error && trainer.state !== 'connecting'}
		<p class="text-muted mt-2 text-xs">{trainer.error}</p>
	{/if}
	{#if trainer.onSimulate && !elsewhere.trainer}
		<!-- Dev-only (#123): simulated watts in a live room would count for
		     medals, XP and streaks — the fairness layer takes no fakes. Gone
		     while another screen holds the trainer: the hub would take no
		     samples from this one anyway (#610). -->
		<button onclick={trainer.onSimulate} class="btn btn-ghost btn-xs mt-2"
			>Ride simulated</button
		>
	{/if}
{/if}
