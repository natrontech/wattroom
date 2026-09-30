<script lang="ts">
	/**
	 * Why this ride is on the Skyline (#3080): a persistent line in slot 1,
	 * never a toast (errors.md), and the one way back when there is one.
	 */
	import { REASONS, type SkylineReason } from './ride-view';

	let { reason, onretry }: { reason: SkylineReason; onretry: () => void } =
		$props();
</script>

<div class="flex flex-wrap items-center gap-3 pt-2">
	<p role="status" data-testid="flat-road" class="text-muted text-sm">
		{REASONS[reason].line}
	</p>
	{#if REASONS[reason].retry}
		<button onclick={onretry} class="btn btn-secondary btn-lg"
			>Try 3D again</button
		>
	{/if}
</div>
