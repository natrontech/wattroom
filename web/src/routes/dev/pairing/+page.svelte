<script lang="ts">
	// The trainer card in every state, including the ones you cannot reach on a
	// machine that has Bluetooth and a trainer attached.
	//
	// It used to mock the pairing screen with its own components (#1000): a
	// second drawing of a screen that now exists for real at /settings/equipment, which is
	// exactly how the three UIs happened. This drives the REAL card instead —
	// the slot is injected, so every state is one click away and none of them
	// can drift from what a rider sees.
	import Logo from '$lib/brand/Logo.svelte';
	import SensorOverview from '$lib/room/SensorOverview.svelte';
	import DevicePicker from '$lib/ble/DevicePicker.svelte';
	import type { BleDevice } from '$lib/ble/device-picker.svelte';
	import type { PairState } from '$lib/room/sensor-status';

	type Case = {
		name: string;
		state: PairState;
		device?: string;
		reading?: string;
		hint?: string;
		error?: string;
		elsewhere?: string;
	};

	const CASES: Case[] = [
		{ name: 'idle', state: 'idle' },
		{ name: 'connecting', state: 'connecting' },
		{
			name: 'connected',
			state: 'connected',
			device: 'KICKR CORE 8F2A',
			reading: '214 W · 88 rpm',
		},
		{
			name: 'reconnecting (#1716)',
			state: 'reconnecting',
			device: 'KICKR CORE 8F2A',
		},
		{
			name: 'silent (#520)',
			state: 'connected',
			device: 'KICKR CORE 8F2A',
			hint: 'no watts yet — turn the cranks',
		},
		{
			name: 'failed',
			state: 'failed',
			error:
				'The trainer stopped responding after pairing. Wake it up — spin the cranks — then try again.',
		},
		{
			name: 'on another screen (#610)',
			state: 'idle',
			elsewhere: 'on your phone',
		},
	];

	let picked = $state(0);
	const now = $derived(CASES[picked]);

	// The desktop shell's device picker (#1716). Only the shell ever feeds it,
	// so these are the states nobody can see in a browser — and the empty scan
	// is the one a rider hits most.
	const SCANS: { name: string; devices: BleDevice[] }[] = [
		{ name: 'listening, nothing yet', devices: [] },
		{ name: 'one trainer', devices: [{ id: 'a', name: 'KICKR CORE 8F2A' }] },
		{
			name: 'a gym full of sensors',
			devices: [
				{ id: 'a', name: 'KICKR CORE 8F2A' },
				{ id: 'b', name: 'Polar H10 6B31C42D' },
				{ id: 'c', name: 'TACX NEO 2T 04512' },
				{ id: 'd', name: 'Wahoo TICKR 3F9E' },
			],
		},
		{
			name: 'a device with no name',
			devices: [{ id: 'e', name: '4C:65:A8:D1:22:9F' }],
		},
	];
	let scan = $state.raw<BleDevice[] | null>(null);
	let answered = $state<string | null>(null);
</script>

<main class="mx-auto max-w-3xl px-6 py-10">
	<h1 class="page-title">The sensor card</h1>
	<p class="text-muted mt-2 max-w-xl text-sm">
		One card answers "is my trainer connected?" on /settings/equipment, /ride,
		/ramp and in the Training place. The real one is below — pick a state.
	</p>

	<div class="mt-5 flex flex-wrap gap-2">
		{#each CASES as item, i (item.name)}
			<button
				onclick={() => (picked = i)}
				class="btn btn-xs {picked === i ? 'btn-primary' : 'btn-ghost'}"
				>{item.name}</button
			>
		{/each}
	</div>

	<p class="eyebrow mt-8">the grid — getting set up</p>
	<div class="mt-2">
		<SensorOverview
			elsewhere={now.elsewhere ? { trainer: now.elsewhere } : {}}
			trainer={{
				state: now.state,
				device: now.device,
				reading: now.reading,
				hint: now.hint,
				error: now.error,
				onPair: () => {},
				onForget: () => {},
				onSimulate: () => {},
			}}
		/>
	</div>

	<p class="eyebrow mt-8">compact — a running session's header</p>
	<div class="border-muted/15 mt-2 rounded-lg border p-4">
		<SensorOverview
			compact
			elsewhere={now.elsewhere ? { trainer: now.elsewhere } : {}}
			trainer={{
				state: now.state,
				device: now.device,
				reading: now.reading,
				hint: now.hint,
				error: now.error,
				onPair: () => {},
				onForget: () => {},
				onSimulate: () => {},
			}}
		/>
	</div>

	<p class="eyebrow mt-10">the desktop shell's device picker</p>
	<p class="text-muted mt-1 max-w-xl text-xs">
		Electron ships no Bluetooth chooser, so the app draws one and the shell
		feeds it the scan as it finds things. In a browser Chrome draws its own and
		this never opens — which is why it lives here.
	</p>
	<div class="mt-3 flex flex-wrap items-center gap-2">
		{#each SCANS as item (item.name)}
			<button
				onclick={() => {
					answered = null;
					scan = item.devices;
				}}
				class="btn btn-xs btn-secondary">{item.name}</button
			>
		{/each}
		{#if answered}
			<span class="text-muted text-xs">answered: {answered}</span>
		{/if}
	</div>
	<DevicePicker
		devices={scan}
		onpick={(id) => {
			answered = id ?? 'cancelled';
			scan = null;
		}}
	/>

	<div
		class="border-muted/10 mt-10 flex items-center gap-5 rounded-lg border border-dashed p-6"
	>
		<Logo size={40} />
		<div>
			<p class="text-sm">
				The real screen is <a href="/settings/equipment" class="underline"
					>/settings/equipment</a
				>.
			</p>
			<p class="text-muted mt-1 text-xs">
				WattRoom talks to your trainer straight from this browser — nothing is
				installed, and your power never leaves the room you're riding in.
			</p>
		</div>
	</div>
</main>
