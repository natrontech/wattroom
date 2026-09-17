<script lang="ts">
	import { toasts } from '$lib/toast.svelte';
	import X from '@lucide/svelte/icons/x';
</script>

<!-- Bottom-centre on a desk. On a phone the bottom is spoken for — the
     drawer and people buttons in the corners, and the jukebox's corner
     player from 80 px up, which nothing may cover (WATTROOM.md's player
     rule, #1626) — so the stack drops from the top instead, BELOW the
     header bar rather than over it (#2210): at top-4 it covered the one
     button that opens navigation, for as long as it was up, and an undo
     toast is up until it is dismissed. -->
<!-- Above the drawer, under the player (#2153). A toast raised from the
     drawer's own menus — or a DM landing while it is open — used to paint
     behind it at the same z-50, DOM order deciding, with only its right
     sliver showing. It stays BELOW the popped-out stage (z-[55]) and the
     seated dock (z-[56]): those are the YouTube player, which none of our
     chrome may cover (WATTROOM.md, #483).
     A live region that exists before anything lands in it, and one that is
     early in the tab order (mounted right after the skip link, #1961): the
     Undo used to sit after every control on the page and expire under the
     rider reaching for it. Timed toasts hold while the pointer or focus is
     on the stack. -->
<div
	role="region"
	aria-label="notifications"
	aria-live="polite"
	onmouseenter={() => toasts.hold()}
	onmouseleave={() => toasts.release()}
	onfocusin={() => toasts.hold()}
	onfocusout={(e) => {
		if (!e.currentTarget.contains(e.relatedTarget as Node | null))
			toasts.release();
	}}
	class="pointer-events-none fixed left-1/2 z-[52] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4 max-md:top-16 md:bottom-6"
>
	{#each toasts.items as toast (toast.id)}
		<div
			role={toast.tone === 'error' ? 'alert' : 'status'}
			class="panel pointer-events-auto flex w-full items-center gap-3 px-4 py-3 text-sm shadow-lg {toast.tone ===
			'error'
				? 'border-danger/40'
				: ''}"
		>
			{#if toast.href}
				<!-- A message toast IS the way to the thread (#568) — a plain
				     anchor, so the router does the navigating. A refusal keeps
				     its words instead (#2157): it carries the reply the rider
				     typed, and one truncated line is where that reply went
				     missing. -->
				<a
					href={toast.href}
					onclick={() => toasts.dismiss(toast.id)}
					class="min-w-0 flex-1 hover:underline {toast.tone === 'error'
						? ''
						: 'truncate'}">{toast.text}</a
				>
			{:else}
				<span class="flex-1">{toast.text}</span>
			{/if}
			{#if toast.undo}
				<button
					class="btn btn-secondary btn-xs shrink-0"
					onclick={() => {
						toast.undo?.();
						toasts.dismiss(toast.id);
					}}>Undo</button
				>
			{/if}
			<button
				class="icon-btn text-muted hover:text-ink -my-2 -mr-2 h-8 w-8"
				aria-label="Dismiss"
				onclick={() => toasts.dismiss(toast.id)}><X size={14} /></button
			>
		</div>
	{/each}
</div>
