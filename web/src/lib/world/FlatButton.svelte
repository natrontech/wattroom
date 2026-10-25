<script lang="ts">
	/**
	 * The world's half of the Flat / 3D switch (#3084): a 44 px icon in slot 1's
	 * row while the world draws. It sets the World control to Flat on this
	 * device; the flat road's own line offers "Ride in 3D" straight back.
	 */
	import ChartArea from '@lucide/svelte/icons/chart-area';

	let { onflat, class: cls }: { onflat: () => void; class: string } = $props();
</script>

<button
	onclick={onflat}
	class={cls}
	aria-label="Flat road"
	title="Flat road — ride the Skyline instead of 3D"
	data-testid="flat-button"><ChartArea size={20} /></button
>
