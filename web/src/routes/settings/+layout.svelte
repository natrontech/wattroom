<script lang="ts">
	// Settings has an address (#1330, ADR-0020 amended: places and settings).
	// What a rider sets once lived in five homes reached through a 16 px gear;
	// now it is one tree with a section per route, so every part of it can be
	// linked to from wherever it is needed — the room's Sound panel, a
	// suggested FTP, the first-run card.
	import { page } from '$app/state';
	import type { LayoutData } from './$types';

	let {
		data,
		children,
	}: { data: LayoutData; children: import('svelte').Snippet } = $props();

	const SECTIONS = [
		{ href: '/settings/profile', label: 'Profile' },
		{ href: '/settings/equipment', label: 'Equipment' },
		{ href: '/settings/voice', label: 'Voice & audio' },
		{ href: '/settings/appearance', label: 'Appearance' },
		{ href: '/settings/notifications', label: 'Notifications' },
		{ href: '/settings/data', label: 'Your data' },
	];
	const current = $derived(
		SECTIONS.find((s) => page.url.pathname.startsWith(s.href)),
	);
</script>

<svelte:head
	><title>{current ? `${current.label} · ` : ''}Settings · WattRoom</title
	></svelte:head
>

<main class="page">
	<h1 class="page-title">Settings</h1>
	<!-- The sections, as a row of links: one address each, the current one
	     lit. Wraps on a phone; never scrolls sideways (ux.md). -->
	<nav class="mt-4 flex flex-wrap gap-1" aria-label="settings sections">
		{#each SECTIONS as s (s.href)}
			<a
				href={s.href}
				aria-current={current?.href === s.href ? 'page' : undefined}
				class="rounded px-3 py-1.5 text-sm {current?.href === s.href
					? 'bg-ink/10 text-ink font-medium'
					: 'text-muted hover:bg-ink/5 hover:text-ink'}">{s.label}</a
			>
		{/each}
	</nav>

	{@render children()}

	<footer class="text-muted/60 mt-10 text-center font-mono text-[11px]">
		<p>
			wattroom
			{#if data.release}
				<a href="/whats-new" class="hover:text-ink underline">{data.release}</a>
			{/if}
			{#if data.version && data.version !== 'dev'}
				<!-- +dirty is display-only; the commit link needs the bare sha. -->
				<a
					href="https://github.com/natrontech/wattroom/commit/{data.version.replace(
						'+dirty',
						'',
					)}"
					class="hover:text-ink underline">{data.version}</a
				>
			{:else if data.version}
				{data.version}
			{/if}
		</p>
		<p class="mt-1">
			free &amp; open source (AGPL) —
			<a
				href="https://github.com/natrontech/wattroom"
				class="hover:text-ink underline">GitHub</a
			>
			· <a href="/download" class="hover:text-ink underline">desktop app</a>
			· by
			<a href="https://natron.io" class="hover:text-ink underline"
				>Natron Tech</a
			>
		</p>
	</footer>
</main>
