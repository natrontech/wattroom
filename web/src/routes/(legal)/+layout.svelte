<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import { account } from '$lib/account.svelte';
	import { shellTitleBar } from '$lib/desktop';

	let { children } = $props();
	// Under the desktop shell's drag strip (#1188); 0 in a browser.
	const titleBar = shellTitleBar();
</script>

{#snippet footer()}
	<footer
		class="text-muted mt-12 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]"
	>
		<a href="/legal" class="hover:text-ink underline">legal notice</a>
		<span aria-hidden="true">·</span>
		<a href="/privacy" class="hover:text-ink underline">privacy</a>
		<span aria-hidden="true">·</span>
		<a href="/download" class="hover:text-ink underline">desktop app</a>
		<span aria-hidden="true">·</span>
		<a
			href="https://github.com/natrontech/wattroom"
			class="hover:text-ink underline">source on GitHub</a
		>
	</footer>
{/snippet}

{#if account.me}
	<!-- Signed in, the app's own shell frames these pages (#1859): the
	     sidebar stays, the page column is the shell's, and there is no
	     second logo or "to the rooms" to find. -->
	<main class="page">
		<div class="max-w-2xl">
			{@render children()}
			{@render footer()}
		</div>
	</main>
{:else}
	<!-- Shared shell for the public pages (#232) — legal, privacy, and the
	     desktop app's download (#296): quiet chrome, no glow. -->
	<main class="cave bg-surface text-ink relative min-h-dvh overflow-x-hidden">
		<div
			class="bg-gridlines pointer-events-none absolute inset-x-0 top-0 h-[30dvh] opacity-40"
			aria-hidden="true"
		></div>

		<!-- The phone-width guard (e2e/phone-width.spec.ts) measures this
		     container on every public page too: main's overflow-x-hidden would
		     only hide a page that grew sideways, not stop it. -->
		<div
			data-testid="page-body"
			class="relative z-10 mx-auto w-full max-w-2xl px-6 pt-5 pb-16"
			style={titleBar ? `padding-top: ${titleBar + 20}px` : ''}
		>
			<header class="flex items-center justify-between">
				<a href="/" aria-label="WattRoom home"><Logo size={28} wordmark /></a>
				<a href="/home" class="btn-link text-xs">to the rooms</a>
			</header>

			<div class="mt-10">
				{@render children()}
				{@render footer()}
			</div>
		</div>
	</main>
{/if}
