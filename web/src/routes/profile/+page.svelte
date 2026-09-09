<script lang="ts">
	// Profile is a section of Settings now. Kept as a redirect for one release so bookmarks and older links
	// still land (#1330, expand/contract), then it goes.
	import { goto } from '$app/navigation';
	$effect(() => {
		void goto('/settings/profile', { replaceState: true });
	});
</script>
