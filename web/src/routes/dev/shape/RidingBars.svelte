<script lang="ts">
	// Moved to $lib/components — the real sidebar, roster and friends list all
	// use it now. Kept as a shim so the mock's imports stay local.
	import RidingBars from '$lib/components/RidingBars.svelte';
	let { size = 11 }: { size?: number } = $props();
</script>

<RidingBars {size} />
