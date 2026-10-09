<script lang="ts">
	import CheerIcon from '$lib/components/CheerIcon.svelte';
	import { account } from '$lib/account.svelte';
	import { BELL } from '$lib/icons';
	import { unlockCues } from '$lib/sound/cues';

	// The deck (#2722, #3022): the rider's own four cheers, then the
	// roadside's bell — one row of bike-side targets, 44 px each way (TARGETS
	// G5, #3828), and never typing. The bell is in every deck whatever the
	// rider's set holds (ADR-0064): the roadside's one sound means the same
	// thing on every screen that hears it.
	let {
		onCheer,
	}: {
		onCheer: (key: string) => void;
	} = $props();

	function send(key: string) {
		// Inside the tap: the one moment a phone lets the cue bus open, so the
		// cheer coming back on the next tick is heard (#3022).
		unlockCues();
		onCheer(key);
	}
</script>

<div class="flex flex-wrap gap-1.5">
	{#each account.cheers.slice(0, 4) as cheer (cheer)}
		<button
			onclick={() => send(cheer)}
			aria-label={cheer}
			title={cheer}
			class="border-muted/20 hover:border-muted/50 flex min-h-11 min-w-11 flex-1 items-center justify-center rounded border"
			><CheerIcon {cheer} size={18} /></button
		>
	{/each}
	<button
		onclick={() => send(BELL)}
		aria-label="Ring the cowbell"
		title="Ring the cowbell"
		class="border-muted/20 hover:border-muted/50 flex min-h-11 min-w-11 flex-1 items-center justify-center rounded border"
		><CheerIcon cheer={BELL} size={18} /></button
	>
</div>
