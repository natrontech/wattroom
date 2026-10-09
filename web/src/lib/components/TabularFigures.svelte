<script lang="ts">
	/**
	 * A number whose figures keep one width (TARGETS G4, #3869). Chakra Petch
	 * has no `tnum` feature (its GSUB holds ccmp, frac, liga and locl), so
	 * `tabular-nums` does nothing and "1098" sat 24 px wider than "1100" at
	 * 104 px. Each figure is drawn in its own cell instead: 0.62 em holds the
	 * widest ink, the 4 at 0.559 em, with room either side.
	 *
	 * The drawn figures are generated content, so the value stays one text
	 * node: what a screen reader reads, and the one watt figure the design
	 * probe and world-docks count (G2).
	 */
	let { value }: { value: string | number } = $props();

	const text = $derived(String(value));
</script>

<span class="sr-only">{text}</span><span aria-hidden="true"
	>{#each [...text] as char, i (i)}{#if char >= '0' && char <= '9'}<span
				data-figure={char}
				class="inline-flex w-[0.62em] justify-center before:content-[attr(data-figure)]"
			></span>{:else}{char}{/if}{/each}</span
>
