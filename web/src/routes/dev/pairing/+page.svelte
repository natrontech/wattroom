<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import DeviceSlot, {
		type Slot,
		type SlotState,
	} from '$lib/components/DeviceSlot.svelte';

	// docs/SPEC.md / #11: trainer over FTMS or WCPS, plus BLE HRS, CPS and CSC sensors.
	const slots: Slot[] = [
		{
			id: 'trainer',
			label: 'Smart trainer',
			need: 'Required to ride — the trainer holds your ERG targets.',
			required: true,
			device: 'KICKR CORE 8F2A',
			protocol: 'FTMS · 0x1826',
			battery: undefined,
		},
		{
			id: 'hr',
			label: 'Heart rate',
			need: 'Adds bpm to your tile and your .fit export.',
			required: false,
			device: 'TICKR 04C1',
			protocol: 'HRS · 0x180D',
			battery: 78,
		},
		{
			id: 'cadence',
			label: 'Cadence',
			need: 'Most trainers report cadence already — pair a sensor only if yours does not.',
			required: false,
			device: 'RPM CADENCE 21B7',
			protocol: 'CSC · 0x1816',
			battery: 91,
		},
	];

	let states = $state<Record<string, SlotState>>({
		trainer: 'idle',
		hr: 'idle',
		cadence: 'idle',
	});

	// Web Bluetooth is Chrome/Edge on desktop and Android only — Safari never ships it.
	let supported = $state(true);
	let useSimulator = $state(false);

	function pair(id: string, outcome: SlotState = 'connected') {
		states[id] = 'requesting';
		setTimeout(() => (states[id] = 'connecting'), 900);
		setTimeout(() => (states[id] = outcome), 2100);
	}

	const ready = $derived(states.trainer === 'connected' || useSimulator);
</script>

<main class="mx-auto max-w-3xl px-6 py-10">
	<h1 class="font-display text-3xl font-bold tracking-tight">
		Pair your devices
	</h1>
	<p class="text-muted mt-2 max-w-xl text-sm">
		The first screen anyone meets. Bluetooth lives entirely in the browser, so
		the app's job is to explain state — never to pretend it can scan on its own.
	</p>

	<!-- Dev toggles for the states you can't reach on a machine that has Bluetooth. -->
	<div class="text-muted mt-5 flex flex-wrap items-center gap-4 text-xs">
		<label class="flex items-center gap-2">
			<input type="checkbox" bind:checked={supported} /> Web Bluetooth available
		</label>
		<button
			onclick={() => pair('trainer', 'failed')}
			class="hover:text-ink underline">simulate a failed pair</button
		>
	</div>

	{#if !supported}
		<!-- Capability gating: hide nothing, explain it, offer the way out. -->
		<div class="border-z5/40 bg-z5/10 mt-6 rounded-lg border px-5 py-4">
			<p class="text-sm font-medium">This browser can't talk to Bluetooth</p>
			<p class="text-muted mt-1 text-xs">
				Web Bluetooth is Chrome or Edge on desktop and Android. Safari and
				Firefox don't implement it and aren't planning to. On iPhone or iPad,
				join as a spectator instead — you'll see everyone's live numbers, you
				just can't ride.
			</p>
			<a href="/dev/spectator" class="mt-3 inline-block text-xs underline"
				>Open spectator view</a
			>
		</div>
	{/if}

	<div class="mt-6 grid gap-3">
		{#each slots as slot (slot.id)}
			<DeviceSlot
				{slot}
				state={states[slot.id]}
				{supported}
				onPair={() => pair(slot.id)}
				onForget={() => (states[slot.id] = 'idle')}
			/>
		{/each}
	</div>

	<!-- WATTROOM.md: the simulator is dev-flag selectable so contributors never need hardware. -->
	<label
		class="border-muted/15 bg-surface-raised mt-3 flex items-center gap-3 rounded-lg border p-5"
	>
		<input type="checkbox" bind:checked={useSimulator} />
		<div>
			<p class="text-sm font-medium">Use the simulated trainer</p>
			<p class="text-muted mt-0.5 text-xs">
				Rides a realistic power curve with no hardware. How CI and contributors
				without a trainer use the app.
			</p>
		</div>
	</label>

	<div class="mt-6 flex items-center gap-4">
		<button
			disabled={!ready}
			class="bg-ink text-paper hover:bg-ink/90 rounded px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
			>Enter the room</button
		>
		{#if !ready}
			<p class="text-muted text-xs">
				Pair a trainer, or switch on the simulator, to ride.
			</p>
		{/if}
	</div>

	{#if states.trainer === 'idle' && !useSimulator}
		<!-- Empty states teach: one line on what this is, then the CTA. -->
		<div
			class="border-muted/10 mt-10 flex items-center gap-5 rounded-lg border border-dashed p-6"
		>
			<Logo size={40} />
			<div>
				<p class="text-sm">Nothing paired yet.</p>
				<p class="text-muted mt-1 text-xs">
					WattRoom talks to your trainer straight from this browser — nothing is
					installed, and your power never leaves the room you're riding in.
				</p>
			</div>
		</div>
	{/if}
</main>
