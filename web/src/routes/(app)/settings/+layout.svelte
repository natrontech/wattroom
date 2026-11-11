<script lang="ts">
	// Settings has an address (#1330, ADR-0020 amended: places and settings).
	// What a rider sets once lived in five homes reached through a 16 px gear;
	// now it is one tree with a section per route, so every part of it can be
	// linked to from wherever it is needed — the voice channel's Sound panel, a
	// suggested FTP, the first-run card.
	import { page } from '$app/state';
	import { api } from '#lib/api.ts';
	import { buildLine } from '#lib/build-line.ts';
	import SectionTabs from '#lib/components/SectionTabs.svelte';

	let { children }: { children: import('svelte').Snippet } = $props();

	// The footer's build line (#345). Read here, not in a load(), which held
	// every settings page — Appearance and Voice included — until this
	// decorative line answered (#2845).
	let data = $state(buildLine(null));
	void api<{ commit: string; version?: string }>('/api/version').then((res) => {
		if (res.ok) data = buildLine(res.data);
	});

	const SECTIONS = [
		{ href: '/settings/profile', label: 'You' },
		{ href: '/settings/equipment', label: 'Devices' },
		{ href: '/settings/appearance', label: 'Look' },
		{ href: '/settings/data', label: 'Data' },
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
	<div class="mt-4">
		<SectionTabs
			tabs={SECTIONS}
			current={current?.href}
			label="settings sections"
		/>
	</div>

	{@render children()}

	<footer class="text-muted-dim mt-10 text-center font-mono text-[11px]">
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
