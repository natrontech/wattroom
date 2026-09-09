<script lang="ts">
	/**
	 * The flags a ride raised, after it: a note each and one Send. Drawn by
	 * /ride and /ramp under their summaries (#1799).
	 */
	import Banner from '$lib/components/Banner.svelte';
	import type { createRideFlags } from '$lib/ride/flags.svelte';

	let { flags }: { flags: ReturnType<typeof createRideFlags> } = $props();
</script>

{#if flags.error}
	<div class="mt-2"><Banner tone="error">{flags.error}</Banner></div>
{/if}

{#if flags.unsent.length > 0}
	<div class="border-muted/15 mt-4 grid gap-2 border-t pt-3">
		<span class="eyebrow">your flags</span>
		{#each flags.unsent as flag (flag.clientMs)}
			<div class="flex items-center gap-2">
				<span class="text-muted font-mono text-xs"
					>{new Date(flag.clientMs).toLocaleTimeString()}</span
				>
				<input
					bind:value={flag.note}
					placeholder="what went wrong? (optional)"
					aria-label="what went wrong"
					class="input input-xs min-w-0 flex-1"
				/>
			</div>
		{/each}
		<button
			onclick={() => void flags.send()}
			disabled={flags.sending}
			class="btn btn-secondary justify-self-start"
			>{flags.sending ? 'Sending…' : 'Send to the developers'}</button
		>
	</div>
{:else if flags.sent > 0}
	<p class="text-z4 mt-3 text-xs">
		Thanks — {flags.sent} flag{flags.sent > 1 ? 's' : ''} sent.
	</p>
{/if}
