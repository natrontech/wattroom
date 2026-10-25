<script lang="ts">
	/**
	 * A road's stat row (#3680) in the display face, as statRow parts it: the
	 * route page's and the importer's (#3684).
	 */
	let { parts }: { parts: string[] } = $props();
</script>

<p class="font-display text-muted mt-1 text-sm tabular-nums">
	<!-- Numbers in ink, their units muted (v3-roads). -->
	{#each parts as part, i (part)}
		{@const n = part.match(/^([\d.]+)(.*)$/)}{i ? ' · ' : ''}<span
			class="whitespace-nowrap"
			>{#if n}<span class="text-ink">{n[1]}</span>{n[2]}{:else}{part}{/if}</span
		>{/each}
</p>
