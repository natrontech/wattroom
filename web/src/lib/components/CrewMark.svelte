<script lang="ts">
	// A crew's face, everywhere it is drawn (#1237): the picture when there
	// is one, else the icon, else the initial — one component so the
	// switcher, the crew page and the door cannot disagree. Chrome, not data.
	import RoomIcon from '$lib/components/RoomIcon.svelte';
	import { iconFor } from '$lib/icons';

	let {
		name,
		icon,
		imageUrl,
		size = 20,
		class: cls = 'rounded',
	}: {
		name: string;
		icon?: string;
		imageUrl?: string;
		/** The box, in px; the glyph and the initial scale from it. */
		size?: number;
		class?: string;
	} = $props();
	// Cache-busted by the browser's own revalidation (the server sets an
	// ETag), so the URL itself can stay stable across re-uploads.
</script>

<span
	class="bg-ink/5 text-ink/80 grid shrink-0 place-items-center overflow-hidden {cls}"
	style="width:{size}px;height:{size}px"
	aria-hidden="true"
>
	{#if imageUrl}
		<img src={imageUrl} alt="" class="h-full w-full object-cover" />
	{:else if iconFor(icon)}
		<RoomIcon {icon} size={Math.round(size * 0.55)} />
	{:else}
		<span
			class="font-display font-bold"
			style="font-size:{Math.round(size * 0.5)}px"
			>{name.slice(0, 1).toUpperCase()}</span
		>
	{/if}
</span>
