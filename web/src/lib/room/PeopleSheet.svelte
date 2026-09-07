<script lang="ts">
	import Users from '@lucide/svelte/icons/users';
	import { countModal } from '$lib/modals.svelte';

	// The panel, summoned (#219, #504, #686). Below xl the room has no people
	// column, so the same panel arrives as a drawer instead — who is here, the
	// deck, and the line saying what you missed. The chat itself is a place
	// now, so the button no longer promises a log it cannot show.
	//
	// Lifted out of RoomShell along the seam the file already had. It owns
	// exactly one piece of state and renders the caller's panel; the shell
	// still decides what a panel IS.

	let {
		panel,
		missed = false,
		chatPlace = false,
		open = $bindable(false),
	}: {
		/** What the drawer draws — the same snippet the xl column renders. */
		panel: import('svelte').Snippet;
		/** Something was said while you were looking elsewhere. */
		missed?: boolean;
		/** The chat place puts its composer where the button would sit. */
		chatPlace?: boolean;
		/** Bindable so Escape, handled once for the whole shell, can close it. */
		open?: boolean;
	} = $props();
</script>

<button
	onclick={() => (open = true)}
	class="bg-surface-raised ring-ink/15 fixed right-4 z-40 grid h-12 w-12
	place-items-center rounded-full shadow-lg ring-1 xl:hidden {chatPlace
		? 'bottom-20'
		: 'bottom-4'}"
	aria-label="who is here"
>
	<Users size={18} />
	{#if missed}
		<!-- The bar it opens is off screen here, so the dot is the whole
		     signal: something was said. The count is on the bar itself. -->
		<span
			class="bg-neon ring-surface-raised absolute top-1 right-1 h-2.5 w-2.5 rounded-full ring-2"
		></span>
	{/if}
</button>

{#if open}
	<!-- Above the seated player, not under it (#483): the dock takes z-[56] to
	     sit inside the stage and TV mode, and a sheet the rider pulled open is
	     the one surface that must still win — below xl it carries the jukebox
	     transport, the people and the line saying what was said, and a video
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
		class="bg-paper/50 fixed inset-0 z-[60] xl:hidden"
		onclick={(e) => e.target === e.currentTarget && (open = false)}
	>
		<div class="bg-surface absolute inset-y-0 right-0 shadow-2xl">
			{@render panel()}
		</div>
	</div>
{/if}
