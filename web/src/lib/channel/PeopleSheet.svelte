<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { focusTrap } from '$lib/components/focus-trap';
	import { countModal } from '$lib/modals.svelte';

	// The panel, summoned: who is here, the jukebox and the cheers. The channel
	// has no people column; the now bar's people button opens this sheet.
	//
	// Lifted out of ChannelShell along the seam the file already had. It owns
	// exactly one piece of state and renders the caller's panel; the shell
	// still decides what a panel IS.

	let {
		panel,
		open = $bindable(false),
	}: {
		panel: import('svelte').Snippet;
		/** Bindable so Escape, handled once for the whole shell, can close it. */
		open?: boolean;
	} = $props();
</script>

{#if open}
	<!-- Above the seated player, not under it (#483): the dock takes z-[56] to
	     sit inside the stage and TV mode, and a sheet the rider pulled open is
	     the one surface that must still win — it carries the jukebox
	     transport and the people, and a video
	     parked on top of it left nothing to press. RMF forbids OUR chrome over
	     the player, never a drawer the rider opened.
	     But the panel this sheet draws is the shell's `panel()` again — a
	     second Jukebox, mounted fresh, offering its own 200 px hole (#643).
	     That hole sits behind this sheet's own opaque backdrop, so the dock
	     used to fly INTO the drawer that was about to paint over it: seated
	     and invisible at once, with playback and auto-advance both still
	     running — exactly what RMF forbids. `countModal` marks the sheet a
	     covering surface the same way Modal.svelte, SessionPicker.svelte and
	     ImageViewer.svelte already do: the dock un-seats and drops to its
	     corner, which yields to an open overlay like any other floating chrome
	     (JukeboxDock.svelte comment above `seat`) instead of quietly claiming
	     a hole it cannot actually show. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		{@attach countModal}
		class="bg-paper/50 fixed inset-0 z-[60]"
		onclick={(e) => e.target === e.currentTarget && (open = false)}
	>
		<!-- A dialog in fact as well as in shape (audit 2026-09-09): focus
		     moves in, Tab stays in, Escape and the close button hand it back. -->
		<div
			class="bg-surface border-ink/15 absolute inset-y-0 right-0 border-l pt-(--safe-top) pr-(--safe-right) pb-(--safe-bottom)"
			role="dialog"
			aria-modal="true"
			aria-label="who is here"
			tabindex="-1"
			use:focusTrap
		>
			<button
				onclick={() => (open = false)}
				class="icon-btn text-muted hover:text-ink absolute top-2 right-2 z-10"
				aria-label="close"><X size={16} /></button
			>
			{@render panel()}
		</div>
	</div>
{/if}
