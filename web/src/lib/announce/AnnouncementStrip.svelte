<script lang="ts">
	// The strip a coach's announcement draws as (#2408), at the top of the
	// Lounge and of Chat. It is persistent status, not a toast: a rider is on
	// a bike three metres from the screen and does not watch it (`ux.md`), so
	// the thing they must not miss waits for them rather than expiring while
	// they were pedalling.
	//
	// Nothing here composes one. The coach marks a line in chat — the menu
	// item lives on the message, where the sentence already is.
	import { formatWhen } from '$lib/format';
	import type { Announcement } from '$lib/channels';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import X from '@lucide/svelte/icons/x';

	let {
		announcement,
		canClear = false,
		onclear,
	}: {
		announcement: Announcement | null;
		/** The coach's and the owner's, per docs/SPEC.md's roles matrix. */
		canClear?: boolean;
		/**
		 * Take it down. Undo, not a confirm (errors.md): the message is still
		 * in chat and can be marked again, and #1493's ask is for what cannot
		 * be undone. The undo toast is the caller's, because re-marking is a
		 * request rather than a local reversal.
		 */
		onclear?: () => void;
	} = $props();
</script>

{#if announcement}
	<!-- Neon, not watt: ADR-0005 keeps the glow and the magenta for live data,
	     and a notice is chrome however much it matters. -->
	<div
		class="border-neon/40 bg-neon/5 mb-4 flex items-start gap-3 rounded-lg border px-4 py-3"
	>
		<Megaphone size={16} class="text-muted mt-0.5 shrink-0" />
		<div class="min-w-0 flex-1">
			<p class="text-sm">{announcement.text}</p>
			<p class="text-muted mt-1 text-xs">
				{announcement.from} · {formatWhen(announcement.at)}
			</p>
		</div>
		{#if canClear}
			<button
				onclick={() => onclear?.()}
				class="text-muted hover:text-ink icon-btn shrink-0"
				aria-label="Take the announcement down"
				title="Take the announcement down"><X size={16} /></button
			>
		{/if}
	</div>
{/if}
