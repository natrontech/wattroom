<script lang="ts">
	/**
	 * A finished ride's own name (#4209): the route page's rename, for a ride.
	 * Empty is a name too — the one of what was ridden — so clearing the box
	 * and pressing Rename gives the ride its workout's name back.
	 */
	import { MaxWorkoutNameChars } from '$lib/protocol';
	import { riddenName, type RideRoad } from './list';
	import { renameRide } from './title';

	let {
		ride,
		onclose,
	}: {
		/** Mutated in place, as the page's share toggle mutates it. */
		ride: { id: string; workoutName: string; road?: RideRoad; title?: string };
		onclose: () => void;
	} = $props();

	// Seeded once: the page mounts this per opening, never across rides.
	// svelte-ignore state_referenced_locally
	let name = $state(ride.title ?? '');
	let saving = $state(false);
	let error = $state<string | null>(null);
	const ridden = $derived(riddenName(ride));
	const changed = $derived(name.trim() !== (ride.title ?? ''));

	async function rename() {
		if (!changed) return;
		saving = true;
		error = await renameRide(ride, name);
		saving = false;
		if (!error) onclose();
	}
</script>

<form
	class="panel mt-3 max-w-xl"
	data-testid="ride-name"
	onsubmit={(event) => {
		event.preventDefault();
		void rename();
	}}
>
	<label for="ride-name" class="eyebrow">your name for it</label>
	<div class="mt-1 flex flex-wrap gap-2">
		<input
			id="ride-name"
			bind:value={name}
			maxlength={MaxWorkoutNameChars}
			placeholder={ridden}
			aria-invalid={!!error}
			aria-describedby="ride-name-hint"
			class="input min-w-0 flex-1"
			{@attach (input) => input.focus()}
		/>
		<button disabled={!changed || saving} class="btn btn-secondary"
			>{saving ? 'Renaming…' : 'Rename'}</button
		>
		<button type="button" onclick={onclose} class="btn btn-ghost">Cancel</button
		>
	</div>
	{#if error}
		<!-- Field-level, under the field (errors.md). -->
		<p class="text-danger mt-1 text-xs" role="alert">{error}</p>
	{/if}
	<p id="ride-name-hint" class="text-muted mt-1 text-xs">
		Your rides and the friends you share it with read this name. Against your
		best still compares what you rode: {ridden}.
	</p>
</form>
