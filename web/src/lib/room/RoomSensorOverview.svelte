<script lang="ts">
	// The room's trainer, said in the shape every paired-devices card speaks.
	//
	// Reads the room's connection directly rather than through RoomContext
	// (like /pair does, #565): the context's `trainer` is typed `unknown` and
	// carries none of #520's fault detail ("paired but silent"), which is
	// exactly the state a rider getting set up most needs to see.
	//
	// Split out of SensorOverview when the solo pre-ride screens grew the same
	// grid (#611): the sensors are one singleton everywhere, the trainer is
	// not — a room owns its connection for as long as you stand in it, a solo
	// screen pairs one it has not started riding yet.
	import { dev } from '$app/environment';
	import { account } from '$lib/account.svelte';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { useRoom } from '$lib/room/context';
	import SensorOverview from '$lib/room/SensorOverview.svelte';
	import { type Pairing, trainerState } from '$lib/room/sensor-status';

	const room = useRoom();
	const ride = $derived(roomConnection.current?.ride);
	// Same gate as #123's SimulatedTrainer everywhere else: real watts only,
	// unless this is a dev server or a dev-provider sign-in.
	const canSimulate = dev || account.providers.includes('dev');

	let pairing = $state<Pairing>(null);

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
</script>

<SensorOverview
	trainer={{
		state: trainerState(
			{
				trainer: ride?.trainer ?? null,
				fault: ride?.fault ?? null,
				error: ride?.error ?? null,
			},
			pairing,
		),
		device: ride?.trainer?.name,
		reading: `${room.you.watts} W · ${room.you.cadence} rpm`,
		hint:
			ride?.fault === 'silent' ? 'no watts yet — turn the cranks' : undefined,
		error: ride?.error,
		onPair: () => void pairTrainer(),
		onForget: () => ride?.unpair(),
		onSimulate: canSimulate ? () => void pairSimulatedTrainer() : undefined,
	}}
/>
