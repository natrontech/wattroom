<script lang="ts">
	import { toasts } from '$lib/toast.svelte';
	import X from '@lucide/svelte/icons/x';
</script>

<!-- Bottom-centre on a desk. On a phone the bottom is spoken for — the
     drawer and people buttons in the corners, and the jukebox's corner
     player from 80 px up, which nothing may cover (WATTROOM.md's player
     rule, #1626) — so the stack drops from the top instead. -->
<!-- A live region that exists before anything lands in it, and one that is
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
	class="pointer-events-none fixed left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4 max-md:top-4 md:bottom-6"
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
				     anchor, so the router does the navigating. -->
				<a
					href={toast.href}
					onclick={() => toasts.dismiss(toast.id)}
					class="min-w-0 flex-1 truncate hover:underline">{toast.text}</a
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
