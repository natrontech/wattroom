<script lang="ts">
	import { queue } from './mockRoom.svelte';

	let { tall = false }: { tall?: boolean } = $props();
</script>

<!--
	YouTube RMF: ≥200×200, always visible while media plays, nothing drawn over it.
	Every layout renders exactly one of these — the floor is enforced here, once,
	rather than at each call site.
-->
<div
	class="relative grid min-h-[200px] min-w-[200px] place-items-center overflow-hidden rounded-lg ring-1 ring-white/10 {tall
		? 'aspect-video h-full'
		: ''}"
	style="background: linear-gradient(150deg, #1a0736, #05010f)"
>
	<div class="text-muted text-center text-[11px]">
		YouTube player tile<br />≥200×200, never overlaid
		{#if tall}
			<div class="mt-2 text-sm text-white">{queue[0].title}</div>
		{/if}
	</div>
</div>
