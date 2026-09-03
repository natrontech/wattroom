<script lang="ts">
	// The Training place's own "get set up" screen (#606) — one card per
	// sensor, Zwift's "Paired Devices" shape, so a rider sees what is and
	// isn't connected before they ever look for a "Pair trainer" button.
	// Replaces the bare TrainerButton in Training's idle state; the compact
	// header TrainerButton shown once a session is running is unchanged.
	//
	// Reads the room's connection directly rather than through RoomContext
	// (like /pair does, #565): the context's `trainer` is typed `unknown` and
	// carries none of #520's fault detail ("paired but silent"), which is
	// exactly the state a rider getting set up most needs to see.
	import { dev } from '$app/environment';
	import { account } from '$lib/account.svelte';
	import { device } from '$lib/device.svelte';
	import type { SensorKind } from '$lib/ble/sensor';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { useRoom } from '$lib/room/context';
	import {
		type Pairing,
		type PairState,
		sensorReading,
		sensorState,
		trainerState,
	} from '$lib/room/sensor-status';
	import { sensors } from '$lib/sensors.svelte';
	import { Bike, HeartPulse, RotateCw, Zap } from '@lucide/svelte';

	const room = useRoom();
	const ride = $derived(roomConnection.current?.ride);
	const supported = typeof navigator !== 'undefined' && !!navigator.bluetooth;
	// Same gate as #123's SimulatedTrainer everywhere else: real watts only,
	// unless this is a dev server or a dev-provider sign-in.
	const canSimulate = dev || account.providers.includes('dev');

	let pairing = $state<Pairing>(null);

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

	async function pairSimulatedTrainer() {
		if (!ride) return;
		pairing = 'trainer';
		const baseWatts =
			(roomConnection.current?.profile.current.ftp ?? 200) * 0.75;
		await ride.ride(new SimulatedTrainer({ baseWatts }));
		pairing = null;
	}

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
	onPair: () => void;
	onForget: () => void;
})}
	<div
		class="panel flex min-w-0 flex-col items-center gap-2 px-4 py-5 text-center"
	>
		<args.icon
			size={28}
			class={args.state === 'connected' ? 'text-z4' : 'text-muted'}
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
			state: trainerSlotState,
			device: ride?.trainer?.name,
			reading:
				trainerSlotState === 'connected'
					? `${room.you.watts} W · ${room.you.cadence} rpm`
					: undefined,
			hint:
				ride?.fault === 'silent' ? 'no watts yet — turn the cranks' : undefined,
			onPair: () => void pairTrainer(),
			onForget: () => ride?.unpair(),
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
	{:else if ride?.error && pairing !== 'trainer'}
		<p class="text-muted mt-2 text-xs">{ride.error}</p>
	{/if}
	{#if canSimulate}
		<!-- Dev-only (#123): simulated watts in a live room would count for
		     medals, XP and streaks — the fairness layer takes no fakes. -->
		<button
			onclick={() => void pairSimulatedTrainer()}
			class="btn btn-ghost btn-xs mt-2">Ride simulated</button
		>
	{/if}
{/if}
