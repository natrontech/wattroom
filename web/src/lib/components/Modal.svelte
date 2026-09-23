<script lang="ts">
	import { untrack } from 'svelte';
	import { countModal, modals } from '$lib/modals.svelte';
	import { focusTrap } from './focus-trap';
	import { fly } from 'svelte/transition';
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
		placement = 'center',
		children,
	}: {
		/** aria-label for the dialog. */
		label: string;
		onclose: () => void;
		/** Width/extra classes for the dialog box. */
		class?: string;
		/** `right`: a full-height sheet from the right edge (#2588). */
		placement?: 'center' | 'right';
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
	class="bg-paper/50 fixed inset-0 z-40 flex {placement === 'right'
		? 'justify-end'
		: 'items-center justify-center p-4'}"
	onclick={(event) => event.target === event.currentTarget && onclose()}
>
	<!-- The dialog never grows past the window (#2178): two call sites spelled
	     their own cap and the rest had none, so a sheet taller than a landscape
	     phone was clipped at both ends with no way to scroll it. -->
	<div
		class={placement === 'right'
			? `bg-surface border-ink/10 h-dvh w-full overflow-y-auto border-l shadow-2xl ${cls}`
			: `panel panel-lg max-h-[calc(100dvh-2rem)] w-full overflow-y-auto ${cls}`}
		in:fly={placement === 'right' ? { x: 48, duration: 180 } : { duration: 0 }}
		role="dialog"
		aria-modal="true"
		aria-label={label}
		tabindex="-1"
		use:focusTrap
	>
		{@render children()}
	</div>
</div>
