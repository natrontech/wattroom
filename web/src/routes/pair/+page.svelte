<script lang="ts">
	// Sensors are the Equipment section of Settings now. Kept as a redirect for one release so bookmarks and older links
	// still land (#1330, expand/contract), then it goes.
	import { goto } from '$app/navigation';
	$effect(() => {
		void goto('/settings/equipment', { replaceState: true });
	});
</script>
