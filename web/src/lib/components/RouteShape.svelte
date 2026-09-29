<script lang="ts">
	import { planPath } from '$lib/road/draw';

	/**
	 * A route from above, north up: the owner's shape, drawn in their own
	 * browser and shown to nobody else (ADR-0063). No tiles, so the page's
	 * img-src stays as it is.
	 */
	let { x, z }: { x: ArrayLike<number>; z: ArrayLike<number> } = $props();

	const W = 600;
	const H = 300;
	const plan = $derived(planPath(x, z, W, H));
</script>

<figure>
	<svg
		viewBox="0 0 {W} {H}"
		width="100%"
		class="text-ink"
		role="img"
		aria-label="Your route from above, north up"
	>
		<path
			d={plan}
			fill="none"
			stroke="currentColor"
			stroke-width="3"
			stroke-linejoin="round"
		/>
	</svg>
	<figcaption class="text-muted mt-1 text-xs">
		From above, north up. Only you ever see this.
	</figcaption>
</figure>
