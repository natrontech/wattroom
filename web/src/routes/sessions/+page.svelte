<script lang="ts">
	// Retired by ADR-0020: a cross-room list of what is coming is the second
	// half of "what is happening", which is Home. Per-room planning is the
	// room's own Sessions place.
	import { goto } from '$app/navigation';
	$effect(() => {
		void goto('/home#sessions', { replaceState: true });
	});
</script>
