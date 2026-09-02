<script lang="ts">
	import { countModal } from '$lib/modals.svelte';
	import { focusTrap } from './focus-trap';
	import type { Snippet } from 'svelte';

	// The one modal (#230). Call sites keep their {#if} — mounting IS opening.
	// Backdrop click and Escape both close; focus is trapped and restored.
	//
	// It moves to <body> on mount: `fixed` is relative to the nearest
	// transformed ancestor, and the sidebar wrapper animates its drawer with a
	// translate, so a modal opened from inside it was clipped to 240 px.
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		// Svelte removes the node from where it THOUGHT it was, so a portalled
		// one has to take itself down.
		return () => node.remove();
	}
	let {
		label,
		onclose,
		class: cls = 'max-w-md',
		children,
	}: {
		/** aria-label for the dialog. */
		label: string;
		onclose: () => void;
		/** Width/extra classes for the dialog box. */
		class?: string;
		children: Snippet;
	} = $props();
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	{@attach countModal}
	{@attach portal}
	class="bg-paper/50 fixed inset-0 z-40 flex items-center justify-center p-4"
	onclick={(event) => event.target === event.currentTarget && onclose()}
>
	<div
		class="panel w-full p-5 {cls}"
		role="dialog"
		aria-modal="true"
		aria-label={label}
		tabindex="-1"
		use:focusTrap
	>
		{@render children()}
	</div>
</div>
