<script lang="ts">
	import Modal from '$lib/components/Modal.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const KEYS: [string, string][] = [
		['+  PgUp', 'Harder'],
		['−  PgDn', 'Easier'],
		['← →', 'Computer page'],
		['1 2 3 4', 'Camera'],
		['H', 'Clean view'],
		['M', 'Map page'],
		['O', 'Snapshot'],
		['S', 'Say the ride'],
		['?', 'This sheet'],
	];
</script>

<Modal label="Ride keys" {onclose} class="w-fit! max-w-full">
	<h2 class="ride-label">Ride keys</h2>
	<dl
		data-testid="key-sheet"
		class="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2"
	>
		{#each KEYS as [keys, does] (keys)}
			<dt>
				<kbd
					class="border-ink/30 rounded border px-2 py-1 text-2xl whitespace-nowrap"
					>{keys}</kbd
				>
			</dt>
			<dd class="text-2xl">{does}</dd>
		{/each}
	</dl>
	<button class="btn btn-secondary btn-ride mt-4" onclick={onclose}
		>Close</button
	>
</Modal>
