<script lang="ts">
	import Banner from '$lib/components/Banner.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { deleteRide } from './detail';

	// One of errors.md's confirm cases, not an undo toast: a ride's samples
	// are kept nowhere else, so nothing can put one back. It names the ride
	// because a list of rows all look alike — mounting IS opening (Modal).
	let {
		ride,
		onclose,
		ondeleted,
	}: {
		ride: { id: string; workoutName: string; startedAt: string };
		onclose: () => void;
		/** Called once the ride is gone — the caller decides where to go. */
		ondeleted: () => void;
	} = $props();

	let busy = $state(false);
	let error = $state<string | null>(null);

	async function remove() {
		busy = true;
		const res = await deleteRide(ride.id);
		busy = false;
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		toasts.push(`“${ride.workoutName}” is gone.`);
		ondeleted();
	}
</script>

<Modal label="Delete this ride" {onclose}>
	<h2 class="font-display text-lg leading-tight font-bold">
		Delete this ride?
	</h2>
	<p class="text-muted mt-2 text-sm">
		“{ride.workoutName}”, {new Date(ride.startedAt).toLocaleDateString()} — its power
		trace, its medals and its XP go with it. This one can't be undone.
	</p>
	{#if error}
		<div class="mt-3"><Banner tone="error">{error}</Banner></div>
	{/if}
	<div class="mt-5 flex gap-2">
		<button onclick={remove} disabled={busy} class="btn btn-danger-solid">
			{busy ? 'Deleting…' : 'Delete ride'}
		</button>
		<button onclick={onclose} disabled={busy} class="btn btn-secondary">
			Keep it
		</button>
	</div>
</Modal>
