<script lang="ts">
	/**
	 * The free ride's mode switch (ADR-0059, #3027): Grade or Watts, Road or
	 * Watts on a road. A free ride draws it, and so does a ride whose workout
	 * was taken off on its road (#4283). One segmented control: a frame round
	 * both halves, the pressed half filled, and no padding inside it, which
	 * the band cannot spend above the corridor.
	 */
	import type { FreeMode } from '$lib/ride/free-ride-controls';

	let {
		mode,
		road,
		onmode,
	}: {
		mode: FreeMode;
		/** On a road the slope is the road's: Grade reads Road. */
		road: boolean;
		onmode: (next: FreeMode) => void;
	} = $props();

	const modes: { id: FreeMode; label: string }[] = $derived([
		{ id: 'grade', label: road ? 'Road' : 'Grade' },
		{ id: 'watts', label: 'Watts' },
	]);
</script>

<div
	class="border-muted/20 flex rounded-lg border max-md:basis-full"
	role="group"
	aria-label="what you set"
>
	{#each modes as each (each.id)}
		<button
			onclick={() => onmode(each.id)}
			aria-pressed={mode === each.id}
			class="btn btn-ride max-md:flex-1 {mode === each.id
				? 'btn-secondary'
				: 'btn-ghost'}">{each.label}</button
		>
	{/each}
</div>
