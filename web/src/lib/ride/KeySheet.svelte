<script lang="ts">
	import Modal from '$lib/components/Modal.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const KEYS: [string, string][] = [
		['. + = Num+  PgUp', 'Harder'],
		[', -  Num−  PgDn', 'Easier'],
		['← →', 'Computer page'],
		['1 2 3 4', 'Camera: Chase, Heli, Side, Steady'],
		['H', 'Clean view'],
		['M', 'Computer MAP page'],
		['O', 'Snap'],
		['S', 'Say the ride'],
		['Space', 'Push to talk'],
		['?', 'This sheet'],
	];
</script>

<Modal label="Ride keys" {onclose} class="max-w-sm">
	<h2 class="ride-label">Ride keys</h2>
	<dl
		data-testid="key-sheet"
		class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2"
	>
		{#each KEYS as [keys, does] (keys)}
			<dt>
				<kbd class="border-ink/30 rounded border px-2 py-1 text-2xl">{keys}</kbd
				>
			</dt>
			<dd class="text-2xl">{does}</dd>
		{/each}
	</dl>
	<button class="btn btn-secondary btn-ride mt-4 w-full" onclick={onclose}
		>Close</button
	>
</Modal>
