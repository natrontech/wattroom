<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';

	let { children } = $props();
</script>

<!-- Shared shell for the public legal pages (#232): quiet chrome, no glow. -->
<main class="cave bg-surface text-ink relative min-h-dvh overflow-x-hidden">
	<div
		class="bg-gridlines pointer-events-none absolute inset-x-0 top-0 h-[30dvh] opacity-40"
		aria-hidden="true"
	></div>

	<div class="relative z-10 mx-auto w-full max-w-2xl px-6 pt-5 pb-16">
		<header class="flex items-center justify-between">
			<a href="/" aria-label="WattRoom home"><Logo size={28} wordmark /></a>
			<a href="/home" class="text-muted hover:text-ink text-xs underline"
				>to the rooms</a
			>
		</header>

		{@render children()}

		<footer
			class="text-muted mt-12 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]"
		>
			<a href="/legal" class="hover:text-ink underline">legal notice</a>
			<span aria-hidden="true">·</span>
			<a href="/privacy" class="hover:text-ink underline">privacy</a>
			<span aria-hidden="true">·</span>
			<a
				href="https://github.com/natrontech/wattroom"
				class="hover:text-ink underline">source on GitHub</a
			>
		</footer>
	</div>
</main>
