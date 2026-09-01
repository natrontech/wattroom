<script lang="ts">
	// Retired by ADR-0020: the sidebar IS the room list, and the two things
	// this page carried beyond it — open a room, join with a code — are the
	// `+` beside "your rooms". Invites and medal history live in the room's
	// own Members place. Kept as a redirect so shared links still land.
	import { goto } from '$app/navigation';
	$effect(() => {
		void goto('/home#rooms', { replaceState: true });
	});
</script>
