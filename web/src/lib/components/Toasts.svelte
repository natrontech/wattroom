<script lang="ts">
	import { toasts } from '$lib/toast.svelte';
</script>

<!-- Above MobileNav's bar on phones, bottom-center on desks. -->
<div
	class="pointer-events-none fixed bottom-16 left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4 md:bottom-6"
	aria-live="polite"
>
	{#each toasts.items as toast (toast.id)}
		<div
			class="panel pointer-events-auto flex w-full items-center gap-3 px-4 py-3 text-sm shadow-lg {toast.tone ===
			'error'
				? 'border-z6/40'
				: ''}"
		>
			<span class="flex-1">{toast.text}</span>
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
				class="text-muted hover:text-ink shrink-0"
				aria-label="Dismiss"
				onclick={() => toasts.dismiss(toast.id)}>×</button
			>
		</div>
	{/each}
</div>
