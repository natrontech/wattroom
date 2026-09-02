<script lang="ts">
	import { countModal } from '$lib/modals.svelte';
	import type { Snippet } from 'svelte';

	// The one modal (#230). Call sites keep their {#if} — mounting IS opening.
	// Backdrop click and Escape both close; focus is trapped and restored.
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

	function trap(node: HTMLElement) {
		const prev = document.activeElement as HTMLElement | null;
		const focusables = () =>
			Array.from(
				node.querySelectorAll<HTMLElement>(
					'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
				),
			);
		(focusables()[0] ?? node).focus();
		function onKeydown(event: KeyboardEvent) {
			if (event.key !== 'Tab') return;
			const items = focusables();
			if (!items.length) return;
			const first = items[0];
			const last = items[items.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				last.focus();
				event.preventDefault();
			} else if (!event.shiftKey && document.activeElement === last) {
				first.focus();
				event.preventDefault();
			}
		}
		node.addEventListener('keydown', onKeydown);
		return {
			destroy() {
				node.removeEventListener('keydown', onKeydown);
				prev?.focus();
			},
		};
	}
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	{@attach countModal}
	class="bg-paper/50 fixed inset-0 z-40 flex items-center justify-center p-4"
	onclick={(event) => event.target === event.currentTarget && onclose()}
>
	<div
		class="panel w-full p-5 {cls}"
		role="dialog"
		aria-modal="true"
		aria-label={label}
		tabindex="-1"
		use:trap
	>
		{@render children()}
	</div>
</div>
