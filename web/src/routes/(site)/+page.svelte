<script lang="ts">
	import type { Component } from 'svelte';
	import ChartColumn from '@lucide/svelte/icons/chart-column';
	import Music from '@lucide/svelte/icons/music';
	import Shield from '@lucide/svelte/icons/shield';
	import Star from '@lucide/svelte/icons/star';
	import Users from '@lucide/svelte/icons/users';
	import Zap from '@lucide/svelte/icons/zap';
	import LandingHero from '$lib/brand/LandingHero.svelte';
	import Logo from '$lib/brand/Logo.svelte';
	import { GITHUB_MARK } from '$lib/brand/icons';
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { shellVersion } from '$lib/desktop';
	import Seo from '$lib/site/Seo.svelte';
	import { LANDING, siteIdentity } from '$lib/site/seo';

	if (browser) void account.load();

	// The server sends a request carrying a session to /enter before this
	// page is ever served (ADR-0061); a rider reaches it here only by a
	// client navigation, and goes the same way. The desktop shell has
	// already been installed: nobody in it needs the pitch, and it has a
	// sign-in of its own (#1188).
	$effect(() => {
		if (account.me)
			void goto(`/enter${location.search}`, { replaceState: true });
		else if (account.loaded && shellVersion())
			void goto('/login', { replaceState: true });
	});

	// The public page's live numbers: riders online right now, and the repo's
	// stars. Both come from the server (one poll, no visitor calls GitHub); a
	// failure or a zero just hides the line rather than advertising that
	// nobody is here.
	let live = $state<{ online: number; stars: number } | null>(null);
	$effect(() => {
		if (!account.loaded || account.me) return;
		const tick = async () => {
			const res = await api<{ online: number; stars: number }>('/api/live');
			live = res.ok ? res.data : null;
		};
		void tick();
		const id = setInterval(tick, 20_000);
		return () => clearInterval(id);
	});

	const repo = 'https://github.com/natrontech/wattroom';

	// Selling points as glanceable chips — the hero scene does the talking.
	// The kit's icons, not hand-drawn paths (web/AGENTS.md, #2178): six feather
	// outlines lived here as `{@html}` strings, the last inline icon set in
	// the app.
	const features: {
		label: string;
		sub: string;
		icon: Component<{ size?: number | string; class?: string }>;
		href?: string;
	}[] = [
		{
			label: 'Ride together',
			sub: 'crews with voice & camera',
			icon: Users,
		},
		{
			label: 'Structured workouts',
			sub: 'ERG control, scaled to your FTP',
			icon: ChartColumn,
		},
		{
			label: 'Seven game modes',
			sub: 'sprint klaxons & eliminations',
			icon: Zap,
		},
		{
			label: 'Shared jukebox',
			sub: 'one soundtrack per voice channel',
			icon: Music,
		},
		{
			label: 'Private by default',
			sub: 'AV never recorded, rides are yours',
			icon: Shield,
		},
		{
			label: 'Free & open source',
			sub: 'AGPL — star it on GitHub',
			icon: Star,
			href: repo,
		},
	];
</script>

<Seo page={LANDING} ld={[siteIdentity()]} />

{#if account.me}
	<!-- Hold: a signed-in rider must never flash the marketing page — and a
	     void reads as broken, so the mark holds the screen (errors.md). -->
	<div class="grid min-h-dvh place-items-center" aria-busy="true">
		<div class="text-center">
			<Logo size={40} />
			<p class="text-muted mt-4 text-sm">Opening WattRoom…</p>
		</div>
	</div>
{:else}
	<!-- The public face of wattroom.ch (#111): one screen tells the story. -->
	<main
		data-site
		class="cave bg-surface text-ink relative flex min-h-dvh flex-col overflow-hidden"
	>
		<div
			class="bg-gridlines pointer-events-none absolute inset-x-0 top-0 h-[50dvh] opacity-40"
			aria-hidden="true"
		></div>

		<header
			class="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-6 pt-5"
		>
			<Logo size={28} wordmark />
			<div class="flex items-center gap-2.5">
				<a
					href={repo}
					class="border-muted/25 hover:border-neon/60 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium sm:px-3"
					aria-label="Star WattRoom on GitHub"
				>
					<svg
						viewBox="0 0 24 24"
						class="h-4 w-4 fill-current sm:h-3.5 sm:w-3.5"
						><path d={GITHUB_MARK} /></svg
					>
					<span class="hidden sm:inline">Star on GitHub</span>
					{#if live && live.stars > 0}
						<span class="text-muted tabular-nums">{live.stars}</span>
					{/if}
				</a>
				<a href="/login" class="btn btn-primary btn-xs">Sign in</a>
			</div>
		</header>

		<section
			class="relative mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-10 text-center"
		>
			<!-- The category, before the promise (#2139). The search snippet
			     calls WattRoom a Zwift alternative — WATTROOM.md's own words —
			     and Google rewrites a description the page does not back up.
			     Quiet on purpose: an eyebrow, not a claim competing with the
			     h1 under it. -->
			<p class="eyebrow mb-3">A Zwift alternative</p>
			<h1
				class="font-display text-4xl leading-[0.95] font-bold tracking-tight uppercase sm:text-6xl"
			>
				Train together,<br /><span class="text-neon">not alone.</span>
			</h1>
			<p class="text-muted mt-4 max-w-md text-sm text-balance sm:text-base">
				Discord for indoor cycling — no virtual world, your watts are the game.
			</p>
			<!-- The promise Home keeps (#2184, ADR-0038 amended 2026-09-17): a
			     stranger arrives with no invite, so Home's big button says
			     "Start a crew" too (#2480). Joining a crew leads only for a
			     rider who was sent to a door. -->
			<a href="/login" class="btn btn-primary btn-lg mt-6">Start your crew</a>
			<a href="/download" class="btn-link mt-3 text-xs"
				>or get the desktop app</a
			>

			{#if live && live.online > 0}
				<!-- The watt glows on the dot; the words are ink (#1965). -->
				<p
					class="text-ink font-display mt-4 flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase"
					aria-live="polite"
				>
					<span
						class="bg-watt glow-stroke h-1.5 w-1.5 rounded-full motion-safe:animate-pulse"
						aria-hidden="true"
					></span>
					{live.online} rider{live.online === 1 ? '' : 's'} online now
				</p>
			{/if}

			<!-- The one glowing thing: a session in progress. -->
			<div class="mt-10 w-full max-w-2xl">
				<LandingHero />
			</div>

			<div class="mt-8 grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
				{#each features as f (f.label)}
					<svelte:element
						this={f.href ? 'a' : 'div'}
						href={f.href}
						class="border-muted/15 bg-surface-raised/70 flex items-center gap-3 rounded-lg border px-3.5 py-3 text-left {f.href
							? 'hover:border-neon/50'
							: ''}"
					>
						<f.icon size={20} class="text-neon shrink-0" />
						<span class="min-w-0">
							<span class="font-display block text-[13px] font-bold"
								>{f.label}</span
							>
							<span class="text-muted block text-[11px]">{f.sub}</span>
						</span>
					</svelte:element>
				{/each}
			</div>
		</section>

		<footer
			class="text-muted relative z-10 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-6 pb-6 text-center text-[11px]"
		>
			<span>free &amp; open source (AGPL)</span>
			<span aria-hidden="true">·</span>
			<a href={repo} class="hover:text-ink underline">star the repo</a>
			<span aria-hidden="true">·</span>
			<span
				>built by <a href="https://natron.io" class="hover:text-ink underline"
					>Natron</a
				></span
			>
			<span aria-hidden="true">·</span>
			<span>Chrome or Edge · FTMS smart trainer</span>
			<span aria-hidden="true">·</span>
			<a href="/download" class="hover:text-ink underline">desktop app</a>
			<span aria-hidden="true">·</span>
			<a href="/legal" class="hover:text-ink underline">legal</a>
			<span aria-hidden="true">·</span>
			<a href="/terms" class="hover:text-ink underline">terms</a>
			<span aria-hidden="true">·</span>
			<a href="/privacy" class="hover:text-ink underline">privacy</a>
		</footer>
	</main>
{/if}
