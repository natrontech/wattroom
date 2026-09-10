<script lang="ts">
	// The room's trainer, said in the shape every paired-devices card speaks.
	//
	// Reads the room's connection directly rather than through RoomContext
	// (like /settings/equipment does, #565): the context's `trainer` is typed `unknown` and
	// carries none of #520's fault detail ("paired but silent"), which is
	// exactly the state a rider getting set up most needs to see.
	//
	// Split out of SensorOverview when the solo pre-ride screens grew the same
	// grid (#611). Both trainers are held above the router now (#521, #1716),
	// but they are still two: a room's belongs to standing in the room, the
	// solo one to a rider who has paired and not yet started.
	import { canSimulate } from '$lib/ble/can-simulate';
	import { trainerForRoom } from '$lib/ride/solo-trainer.svelte';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { useRoom } from '$lib/room/context';
	import SensorOverview from '$lib/room/SensorOverview.svelte';
	import { deviceWord } from '$lib/room/sensor-claim';
	import { pairedElsewhereAll, trainerState } from '$lib/room/sensor-status';
	import { trainerHint } from '$lib/room/sensor-status';

	// The trainer alone as one row, for a running session's header (#1000) —
	// what `TrainerButton` used to draw with its own vocabulary.
	let { compact = false }: { compact?: boolean } = $props();

	const room = useRoom();
	const ride = $derived(roomConnection.current?.ride);
	// What the rider's OTHER screens hold (#610). Only a room knows this — the
	// socket is what arbitrates — which is why it enters here rather than in
	// the grid the solo pre-ride screens share.
	const elsewhere = $derived(pairedElsewhereAll(room.pairing, deviceWord()));

	// "Connecting…" is the ride store's answer, not this component's (#1716):
	// the room's shell can unmount while the chooser is open.
	function pairSimulatedTrainer() {
		const baseWatts =
			(roomConnection.current?.profile.current.ftp ?? 200) * 0.75;
		return ride?.ride(new SimulatedTrainer({ baseWatts }));
	}
</script>

<SensorOverview
	{compact}
	{elsewhere}
	trainer={{
		state: trainerState({
			trainer: ride?.trainer ?? null,
			fault: ride?.fault ?? null,
			error: ride?.error ?? null,
			pairing: ride?.pairing ?? false,
		}),
		device: ride?.trainer?.name,
		reading: `${room.you.watts} W · ${room.you.cadence} rpm`,
		hint: trainerHint(ride?.fault),
		error: ride?.error,
		onPair: () => void ride?.ride(trainerForRoom()),
		onForget: () => ride?.unpair(),
		onSimulate: canSimulate() ? () => void pairSimulatedTrainer() : undefined,
	}}
/>
