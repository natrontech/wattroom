<script lang="ts">
	/**
	 * "Riding now", as motion rather than as a coloured dot.
	 *
	 * A magenta dot sitting next to a green presence dot reads as a traffic
	 * light, and the pink end of this palette is close enough to the danger
	 * ramp (z6) that the first thought is "something is broken" — rider
	 * feedback, and it is right. Errors do not dance, so movement cannot be
	 * mistaken for one.
	 *
	 * The form is the WattRoom mark's own: the equalizer bars from
	 * `Logo.svelte`, which ADR-0005 already animates while a session runs. This
	 * is that idea at status size, so "riding" looks the same everywhere it
	 * appears — the rail, the roster, the friends list.
	 *
	 * The glow sits on each bar, never on the span: a filter over animated
	 * content is blurred again on every frame at the display's refresh rate,
	 * ~5% GPU per copy on a 165 Hz 5K display (#2998). On the bar it is
	 * rasterised once and the compositor scales it.
	 */
	let { size = 11 }: { size?: number } = $props();
</script>

<span
	class="text-watt inline-flex shrink-0 items-end gap-[1.5px]"
	style="height: {size}px"
	title="riding now"
	aria-label="riding now"
>
	{#each [0, 1, 2] as i (i)}
		<i
			class="bar glow-stroke block w-[2px] rounded-full bg-current"
			style="--i: {i}"
		></i>
	{/each}
</span>

<style>
	/* app.css's stepped `equalizer` (#3199). */
	.bar {
		--eq-low: 0.35;
		height: 100%;
		transform-origin: bottom;
		animation: equalizer 1.1s step-end infinite;
		animation-delay: calc(var(--i) * -0.28s);
	}
	/* Still legible standing still: the bars hold the letter's own heights. */
	@media (prefers-reduced-motion: reduce) {
		.bar {
			animation: none;
		}
		.bar:nth-child(1) {
			height: 60%;
		}
		.bar:nth-child(3) {
			height: 75%;
		}
	}
</style>
