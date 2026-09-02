<script lang="ts">
	import { X, ZoomIn, ZoomOut } from '@lucide/svelte';
	import { countModal } from '$lib/modals.svelte';
	import { focusTrap } from '$lib/components/focus-trap';
	import { closeImage, image, toggleActual } from './viewer.svelte';

	// The picture a rider clicked, big, on the page they clicked it (#510).
	// One host in the root layout, like Toasts and ContextMenuHost: every chat
	// on every surface opens the same viewer, and a room's chat sheet can't
	// clip it. Escape, the backdrop and one big button all close it; z-[65]
	// clears that sheet (see lib/room/stacking.test.ts).
	//
	// `cave` on the backdrop: a picture wants a dark, neutral ground on every
	// palette, the same reason the stage letterboxes video in black — and a
	// root-mounted overlay is OUTSIDE the ride's cave, so a daylight palette
	// would otherwise flash white over a room with the lights down.

	// The window listener lives outside the {#if} — <svelte:window> cannot sit
	// inside a block — so it asks for itself whether a picture is open, and
	// leaves Escape to the room's own handlers when none is.
	function onkeydown(event: KeyboardEvent) {
		if (image.src && event.key === 'Escape') closeImage();
	}
</script>

<svelte:window {onkeydown} />

{#if image.src}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		{@attach countModal}
		class="cave bg-paper/95 fixed inset-0 z-[65] flex flex-col gap-2 p-3"
		onclick={(event) => event.target === event.currentTarget && closeImage()}
	>
		<div
			class="flex min-h-0 flex-1 flex-col gap-2"
			role="dialog"
			aria-modal="true"
			aria-label={image.alt || 'Image'}
			tabindex="-1"
			use:focusTrap
		>
			<div class="flex shrink-0 items-center gap-2">
				<span class="text-muted truncate text-xs">{image.alt}</span>
				<button
					onclick={toggleActual}
					class="bg-surface-raised ring-ink/10 text-muted hover:text-ink ml-auto grid h-11 w-11 place-items-center rounded-full ring-1"
					aria-label={image.actual ? 'Fit to the window' : 'Show at full size'}
					title={image.actual ? 'Fit to the window' : 'Show at full size'}
				>
					{#if image.actual}<ZoomOut size={20} />{:else}<ZoomIn
							size={20}
						/>{/if}
				</button>
				<button
					onclick={closeImage}
					class="bg-surface-raised ring-ink/10 text-muted hover:text-ink grid h-11 w-11 place-items-center rounded-full ring-1"
					aria-label="Close the image"
					title="Close the image (Esc)"><X size={20} /></button
				>
			</div>
			<!-- Fit: the whole picture, no scrolling. Full size: its own pixels,
			     scrolled — a screenshot fit to a laptop's height is unreadable.
			     Clicking the empty space around it closes, like the backdrop. -->
			<div
				class="flex min-h-0 flex-1 items-center justify-center {image.actual
					? 'overflow-auto'
					: 'overflow-hidden'}"
				onclick={(event) =>
					event.target === event.currentTarget && closeImage()}
			>
				<!-- Clicking the picture zooms it, the way every image viewer
				     works. Mouse convenience only: the keyboard path is the
				     toolbar button above, which says the same thing. -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<img
					src={image.src}
					alt={image.alt}
					onclick={toggleActual}
					class="rounded {image.actual
						? 'max-w-none cursor-zoom-out'
						: 'max-h-full max-w-full cursor-zoom-in object-contain'}"
				/>
			</div>
		</div>
	</div>
{/if}
