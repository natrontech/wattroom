<script lang="ts">
	/**
	 * Why this ride is on the Skyline (#3080): a persistent line in slot 1,
	 * never a toast (errors.md), and the one way into 3D when there is one.
	 */
	import { REASONS, type SkylineReason } from './ride-view';

	let { reason, onretry }: { reason: SkylineReason; onretry: () => void } =
		$props();
</script>

<!-- One line at the riding floor's 24 px (G4: a canon status line). -->
<div data-status-line class="flex flex-wrap items-center gap-3">
	<p
		role="status"
		data-testid="flat-road"
		class="text-muted text-2xl leading-7"
	>
		{REASONS[reason].line}
	</p>
	{#if REASONS[reason].button}
		<button onclick={onretry} class="btn btn-secondary btn-ride"
			>{REASONS[reason].button}</button
		>
	{/if}
</div>
