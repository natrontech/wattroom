<script lang="ts">
	// Retired by ADR-0020: a cross-crew list of what is coming is the second
	// half of "what is happening", which is Home. Per-crew planning is the
	// crew's own Schedule (#2452).
	import { goto } from '$app/navigation';
	$effect(() => {
		void goto('/home#sessions', { replaceState: true });
	});
</script>
