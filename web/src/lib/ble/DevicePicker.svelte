<script lang="ts">
	// What a rider sees when the desktop shell is scanning (#1716) — the app's
	// own modal where a native message box used to be.
	//
	// Riding sizes on every control (ux.md): pairing is a pre-ride job, but it
	// is done leaning over the bars with the machine at arm's length, and the
	// list is the one place a wrong tap pairs someone else's trainer.
	import Modal from '$lib/components/Modal.svelte';
	import type { BleDevice } from '$lib/ble/device-picker.svelte';
	import Bluetooth from '@lucide/svelte/icons/bluetooth';

	// Presentational: the shell wiring lives in `device-picker.svelte.ts` and
	// the dev harness at /dev/pairing drives this same component with a list
	// it makes up, so the states you cannot stage on real hardware — an empty
	// scan, six sensors in a gym — are one click away and cannot drift.
	let {
		devices,
		onpick,
	}: {
		/** The scan's devices, `[]` while listening, null when nothing is open. */
		devices: BleDevice[] | null;
		/** The rider's answer; null cancels. */
		onpick: (deviceId: string | null) => void;
	} = $props();
</script>

{#if devices}
	<Modal label="Pair a device" onclose={() => onpick(null)}>
		<h2 class="font-display flex items-center gap-2 text-lg font-bold">
			<!-- The radio is still listening for as long as this is open, and an
			     empty modal that never moves reads as hung. Chrome pulses its
			     own for the same reason. -->
			<Bluetooth
				size={18}
				class="text-neon {devices.length === 0
					? 'motion-safe:animate-pulse'
					: ''}"
			/>
			Pair a device
		</h2>
		{#if devices.length === 0}
			<!-- Empty states teach (ux.md). A sensor that has not been woken is
			     the overwhelmingly common reason for an empty scan, and it is
			     something the rider can act on from the bike. -->
			<p class="text-muted mt-2 text-sm">
				Listening… wake your trainer or strap — turn the cranks, or press its
				button.
			</p>
		{:else}
			<p class="text-muted mt-2 text-sm">
				Still listening, so anything else nearby will appear here.
			</p>
			<!-- A gym is a long list; the modal scrolls its own rather than
			     growing past the window (ux.md: the page never does). -->
			<ul class="mt-4 grid max-h-[50vh] gap-2 overflow-y-auto">
				{#each devices as device (device.id)}
					<li>
						<button
							onclick={() => onpick(device.id)}
							class="btn btn-secondary btn-lg w-full justify-start truncate"
							>{device.name}</button
						>
					</li>
				{/each}
			</ul>
		{/if}
		<div class="mt-5 flex justify-end">
			<button onclick={() => onpick(null)} class="btn btn-ghost btn-lg"
				>Cancel</button
			>
		</div>
	</Modal>
{/if}
