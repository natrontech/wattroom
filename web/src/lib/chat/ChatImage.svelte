<script lang="ts">
	import { ExternalLink, Link } from '@lucide/svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { openImage } from './viewer.svelte';

	// One picture in a message (#279): a pasted upload or an allowlisted GIF.
	// Click opens it big in the app's own viewer (#510) — a new browser tab
	// used to swallow the room whole. The thumbnail is capped so a tall
	// screenshot can't push the conversation off screen.
	let {
		src,
		alt,
		menu,
	}: {
		src: string;
		alt: string;
		/**
		 * What the message around it offers. The picture's own menu swallows
		 * the right-click that used to reach the row, so a surface with a
		 * message menu hands it down — react to a picture, copy the line it
		 * came with.
		 */
		menu?: () => MenuEntry[];
	} = $props();

	// Absolute: a chat image src is a server path, and both menu items hand
	// the URL to something outside the app.
	const url = $derived(new URL(src, location.origin).href);

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(url);
			toasts.push('Image link copied');
		} catch {
			toasts.push('Could not copy the link', { tone: 'error' });
		}
	}
</script>

<!-- No loading="lazy": the img carries no dimensions, so its box is 0x0 until
     it decodes, the lazy threshold never fires and it never loads. -->
<button
	onclick={() => openImage(src, alt)}
	title={MENU_HINT}
	aria-label="{alt} — open it big"
	class="block w-fit cursor-zoom-in"
	{@attach contextMenu(() => {
		const own: MenuEntry[] = [
			{
				label: 'Open in a new tab',
				icon: ExternalLink,
				onSelect: () => window.open(url, '_blank', 'noopener,noreferrer'),
			},
			{
				label: 'Copy the image link',
				icon: Link,
				onSelect: () => void copyLink(),
			},
		];
		const rest = menu?.() ?? [];
		return rest.length ? [...own, 'separator', ...rest] : own;
	})}
>
	<img {src} {alt} class="ring-ink/10 mt-1 max-h-40 rounded ring-1" />
</button>
