<script lang="ts">
	let { tall = false, title = '' }: { tall?: boolean; title?: string } =
		$props();
</script>

<!--
	YouTube RMF: ≥200×200, always visible while media plays, nothing drawn over it.
	Every layout renders exactly one of these — the floor is enforced here, once,
	rather than at each call site.
-->
<div
	class="ring-ink/10 relative grid min-h-[200px] min-w-[200px] place-items-center overflow-hidden rounded-lg ring-1 {tall
		? 'aspect-video h-full'
		: ''}"
	style="background: linear-gradient(150deg, var(--color-surface-raised), var(--color-surface))"
>
	<div class="text-muted text-center text-[11px]">
		YouTube player tile<br />≥200×200, never overlaid
		{#if tall && title}
			<div class="text-ink mt-2 text-sm">{title}</div>
		{/if}
	</div>
</div>
