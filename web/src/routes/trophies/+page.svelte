<script lang="ts">
	// The trophy case is your own rider page now. Kept as a redirect for one release so bookmarks and older links
	// still land (#1330, expand/contract), then it goes.
	import { goto } from '$app/navigation';
	$effect(() => {
		void goto('/u/me', { replaceState: true });
	});
</script>
