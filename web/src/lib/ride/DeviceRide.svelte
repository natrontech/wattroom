<script lang="ts">
	// A ride only this device holds, opened from its row on Rides (#4262): its
	// summary, and the save a refusal took from it while the ride buffer still
	// has its seconds. A refused save ends the buffer's ride, so the card that
	// offers crashes back never shows it.
	import { account } from '$lib/account.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { formatClock } from '$lib/format';
	import type { RideRecord } from '$lib/history.svelte';
	import { bufferedRide } from '$lib/ride/buffer';
	import { rideTitle } from '$lib/ride/list';
	import { uploadPayload, type RecoveredRide } from '$lib/ride/recovered';
	import { toastSaved, uploadRide } from '$lib/ride/save';

	let {
		ride,
		onclose,
		onSaved,
	}: {
		ride: RideRecord;
		onclose: () => void;
		/** The ride is on the account now: the page drops its summary. */
		onSaved: () => void;
	} = $props();

	const title = $derived(rideTitle(ride));
	// Undefined while the buffer is read, null when it no longer has the ride.
	let seconds = $state<RecoveredRide | null | undefined>(undefined);
	$effect(() => {
		const owner = account.me?.id;
		if (!owner) return;
		let current = true;
		void bufferedRide(ride.id, owner).then((found) => {
			if (current) seconds = found;
		});
		return () => {
			current = false;
		};
	});
	// Only an ended ride: one never ended is the crash card's to save, above.
	const payload = $derived(seconds?.endedAt ? uploadPayload(seconds) : null);
	let saving = $state(false);
	let error = $state<string | null>(null);

	// The seconds stay in the buffer, ended, until its prune takes them: a
	// discard is the crash card's, behind its ask (irreversible.test.ts).
	async function save() {
		if (!payload) return;
		saving = true;
		error = null;
		const outcome = await uploadRide(payload);
		saving = false;
		if ('failure' in outcome) {
			error = outcome.failure.message;
			return;
		}
		toastSaved(outcome.saved);
		onSaved();
	}
</script>

<Modal label={title} {onclose}>
	<h2 class="font-display truncate text-lg font-bold" {title}>{title}</h2>
	<p class="text-muted num mt-1 text-sm">
		{new Date(ride.startedAt).toLocaleString()} · {formatClock(ride.seconds)} ·
		{ride.avgWatts} W · {ride.kj} kJ
	</p>
	{#if error}
		<div class="mt-4"><Banner tone="error">{error}</Banner></div>
	{/if}
	<div class="mt-4">
		{#if seconds === undefined}
			<Skeleton class="h-9 w-48" />
		{:else if payload}
			<p class="text-sm">
				Its seconds are still on this device, so it can go to your account.
			</p>
			<div class="mt-3 flex flex-wrap gap-2">
				<button
					onclick={() => void save()}
					disabled={saving}
					class="btn btn-primary"
					>{saving ? 'Saving…' : 'Save to your account'}</button
				>
				<button onclick={onclose} class="btn btn-secondary">Close</button>
			</div>
		{:else if seconds && !seconds.endedAt}
			<p class="text-sm">The recovered ride above saves it to your account.</p>
			<button onclick={onclose} class="btn btn-secondary mt-3">Close</button>
		{:else}
			<p class="text-muted text-sm">Only its summary is kept on this device.</p>
			<button onclick={onclose} class="btn btn-secondary mt-3">Close</button>
		{/if}
	</div>
</Modal>
