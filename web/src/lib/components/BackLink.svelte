<script lang="ts">
	// The way back off a page the sidebar does not list (lib/back-link.ts):
	// the page that opened it, else the page's own parent.
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import type { BackLink } from '#lib/back-link.ts';

	let { back, class: extra = '' }: { back: BackLink; class?: string } =
		$props();
</script>

<a
	href={back.href}
	class="text-muted hover:text-ink link-standalone gap-1.5 text-xs {extra}"
>
	<ArrowLeft size={14} />
	{back.label}
</a>
