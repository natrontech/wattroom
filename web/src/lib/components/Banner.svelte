<script lang="ts">
	import type { Snippet } from 'svelte';

	// Inline status banner (#230): submit failures, degraded states, quiet
	// successes. Ride-critical faults stay FaultBanner — never this.
	let {
		tone = 'error',
		children,
		action,
	}: {
		tone?: 'error' | 'warn' | 'ok';
		children: Snippet;
		/** Optional right-aligned affordance (a Retry button). */
		action?: Snippet;
	} = $props();

	const tones = {
		error: 'border-danger/40 bg-danger/10',
		warn: 'border-z5/40 bg-z5/10',
		ok: 'border-z4/40 bg-z4/10',
	};
</script>

<!-- A banner appears in answer to something (a failed save, a paused
     session): a screen reader hears it arrive. Errors interrupt, the rest
     waits its turn (audit 2026-09-09). -->
<div
	role={tone === 'error' ? 'alert' : 'status'}
	class="{tones[
		tone
	]} flex items-center gap-3 rounded-lg border px-4 py-3 text-sm"
>
	<div class="flex-1">{@render children()}</div>
	{#if action}{@render action()}{/if}
</div>
