<script lang="ts">
	import { untrack } from 'svelte';
	import { countModal, modals } from '$lib/modals.svelte';
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

	/** This modal's place in the stack: Escape is its while it is the top. */
	let depth = $state(0);
</script>

<!-- Escape closes the topmost layer only (#1969): every mounted Modal used
     to answer it, so a dialog over a sheet took both down at once. -->
<svelte:window
	onkeydown={(event) =>
		event.key === 'Escape' && depth === modals.open && onclose()}
/>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	{@attach () => {
		const off = countModal();
		// untrack: this attachment just bumped the count it would otherwise
		// depend on, and re-ran itself forever (effect_update_depth_exceeded)
		// — after which Svelte abandons the flush and every binding on the
		// page goes dead. The depth is a fact of the mount, not a dependency.
		depth = untrack(() => modals.open);
		return off;
	}}
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
