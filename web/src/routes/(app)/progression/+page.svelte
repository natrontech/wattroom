<script lang="ts">
	// Retired by ADR-0020: one subject split down the middle — the charts on
	// this page, the rides they are drawn from on /history, and every
	// drilldown a navigation between the two. Rides carries both now.
	import { goto } from '$app/navigation';
	$effect(() => {
		void goto('/history', { replaceState: true });
	});
</script>
