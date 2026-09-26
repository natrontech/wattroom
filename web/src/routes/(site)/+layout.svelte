<script lang="ts">
	import Menu from '@lucide/svelte/icons/menu';
	import Logo from '$lib/brand/Logo.svelte';
	import { GITHUB_MARK } from '$lib/brand/icons';
	import { account } from '$lib/account.svelte';
	import { browser } from '$app/environment';
	import { live, watchLive } from '$lib/site/live.svelte';
	import { REPO } from '$lib/site/seo';
	import { RIVALS } from '$lib/site/rivals';

	// The public pages' frame (ADR-0061): one header and one footer, so every
	// page links every other — which is also how a crawler finds them.
	// Prerendered as a stranger sees it; a signed-in rider's header changes
	// once /api/me answers.
	let { children } = $props();

	if (browser) void account.load();
	$effect(() => watchLive());

	const nav = [
		{ href: '/group-workouts', label: 'Group workouts' },
		{ href: '/game-modes', label: 'Game modes' },
		{ href: '/ftp-test', label: 'FTP test' },
		{ href: '/zwift-alternative', label: 'Compare' },
		{ href: '/self-host', label: 'Self-host' },
	];

	const footer = [
		{
			heading: 'Ride',
			links: [
				{ href: '/group-workouts', label: 'Group workouts with friends' },
				{ href: '/game-modes', label: 'Game modes' },
				{ href: '/ftp-test', label: 'Free FTP ramp test' },
				{ href: '/smart-trainer-app', label: 'Smart trainer in the browser' },
				{ href: '/download', label: 'Desktop app' },
			],
		},
		{
			heading: 'Compare',
			links: [
				{ href: '/zwift-alternative', label: 'A free Zwift alternative' },
				...RIVALS.map((r) => ({
					href: `/vs/${r.slug}`,
					label: `WattRoom vs ${r.name}`,
				})),
			],
		},
		{
			heading: 'Open source',
			links: [
				{ href: REPO, label: 'Source on GitHub' },
				{ href: '/self-host', label: 'Self-host it' },
				{ href: `${REPO}/blob/main/LICENSE`, label: 'AGPL-3.0 license' },
			],
		},
		{
			heading: 'WattRoom',
			links: [
				{ href: '/de', label: 'Auf Deutsch' },
				{ href: '/legal', label: 'Legal notice' },
				{ href: '/terms', label: 'Terms' },
				{ href: '/privacy', label: 'Privacy' },
			],
		},
	];
</script>

<div
	data-site
	class="cave bg-surface text-ink relative flex min-h-dvh flex-col"
>
	<div
		class="bg-gridlines pointer-events-none absolute inset-x-0 top-0 h-[60dvh] opacity-40"
		aria-hidden="true"
	></div>

	<header
		class="relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 pt-5 sm:px-6"
	>
		<a href="/" aria-label="WattRoom home"><Logo size={28} wordmark /></a>

		<nav aria-label="Site" class="hidden items-center gap-5 text-sm lg:flex">
			{#each nav as item (item.href)}
				<a href={item.href} class="text-muted hover:text-ink">{item.label}</a>
			{/each}
		</nav>

		<div class="flex items-center gap-2">
			<a
				href={REPO}
				class="border-muted/25 hover:border-neon/60 flex h-9 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium"
				aria-label="Star WattRoom on GitHub"
			>
				<svg viewBox="0 0 24 24" class="h-4 w-4 fill-current" aria-hidden="true"
					><path d={GITHUB_MARK} /></svg
				>
				<span class="hidden sm:inline">Star</span>
				{#if live.stars > 0}
					<span class="text-muted num">{live.stars}</span>
				{/if}
			</a>
			{#if account.me}
				<a href="/enter" class="btn btn-primary btn-xs h-9">Open WattRoom</a>
			{:else}
				<a href="/login" class="btn btn-primary btn-xs h-9">Sign in</a>
			{/if}
			<!-- The nav on a phone: a disclosure needs no script, so it works
			     before the page hydrates and for a reader that runs none. -->
			<details class="relative lg:hidden">
				<summary
					class="border-muted/25 grid h-9 w-9 cursor-pointer list-none place-items-center rounded-lg border [&::-webkit-details-marker]:hidden"
					aria-label="Menu"
				>
					<Menu size={18} />
				</summary>
				<nav
					aria-label="Site"
					class="panel panel-flush bg-surface-raised absolute right-0 mt-2 flex w-56 flex-col overflow-hidden shadow-xl"
				>
					{#each nav as item (item.href)}
						<a
							href={item.href}
							class="hover:bg-ink/5 rounded px-3 py-2.5 text-sm">{item.label}</a
						>
					{/each}
				</nav>
			</details>
		</div>
	</header>

	<div class="relative z-10 flex-1">
		{@render children()}
	</div>

	<footer class="border-muted/15 relative z-10 mt-24 border-t">
		<div
			class="mx-auto grid w-full max-w-6xl grid-cols-2 gap-8 px-4 py-12 sm:grid-cols-4 sm:px-6"
		>
			{#each footer as column (column.heading)}
				<div>
					<p class="eyebrow mb-3">{column.heading}</p>
					<ul class="flex flex-col gap-2 text-sm">
						{#each column.links as link (link.href)}
							<li>
								<a href={link.href} class="text-muted hover:text-ink"
									>{link.label}</a
								>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
		<p class="text-muted mx-auto w-full max-w-6xl px-4 pb-8 text-xs sm:px-6">
			Free and open source under the AGPL · built by
			<a href="https://natron.io" class="hover:text-ink underline">Natron</a>
			in Switzerland · Chrome or Edge and a smart trainer
		</p>
	</footer>
</div>
