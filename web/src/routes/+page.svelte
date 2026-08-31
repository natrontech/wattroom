<script lang="ts">
	import LandingHero from '$lib/brand/LandingHero.svelte';
	import Logo from '$lib/brand/Logo.svelte';
	import { GITHUB_MARK } from '$lib/brand/icons';
	import { account } from '$lib/account.svelte';

	void account.load();

	const repo = 'https://github.com/natrontech/wattroom';

	// Selling points as glanceable chips — the hero scene does the talking.
	// Icon = feather-style inner SVG (24×24, stroked with currentColor).
	const features: {
		label: string;
		sub: string;
		icon: string;
		href?: string;
	}[] = [
		{
			label: 'Ride together',
			sub: 'rooms with voice & camera',
			icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
		},
		{
			label: 'Structured workouts',
			sub: 'ERG control, scaled to your FTP',
			icon: '<path d="M4 20v-6"/><path d="M9 20V10"/><path d="M14 20v-8"/><path d="M19 20V4"/>',
		},
		{
			label: 'Seven game modes',
			sub: 'sprint klaxons & eliminations',
			icon: '<path d="M13 2 3 14h7l-1 8 11-14h-7l1-6z"/>',
		},
		{
			label: 'Shared jukebox',
			sub: 'one soundtrack for the room',
			icon: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
		},
		{
			label: 'Private by default',
			sub: 'AV never recorded, rides are yours',
			icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
		},
		{
			label: 'Free & open source',
			sub: 'AGPL — star it on GitHub',
			icon: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
			href: repo,
		},
	];
</script>

{#if !account.loaded}
	<!-- Hold: a signed-in rider must never flash the marketing page. -->
	<div class="grid min-h-dvh place-items-center" aria-busy="true"></div>
{:else if !account.me}
	<!-- The public face of wattroom.ch (#111): one screen tells the story. -->
	<main
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
				</a>
				<a
					href="/login"
					class="bg-ink text-paper hover:bg-ink/90 rounded-lg px-3.5 py-1.5 text-xs font-semibold"
					>Sign in</a
				>
			</div>
		</header>

		<section
			class="relative mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-10 text-center"
		>
			<h1
				class="font-display text-4xl leading-[0.95] font-bold tracking-tight uppercase sm:text-6xl"
			>
				Train together,<br /><span class="text-neon">not alone.</span>
			</h1>
			<p class="text-muted mt-4 max-w-md text-sm text-balance sm:text-base">
				Discord for indoor cycling — no virtual world, your watts are the game.
			</p>
			<a
				href="/login"
				class="bg-ink text-paper hover:bg-ink/90 mt-6 rounded-lg px-7 py-3 text-sm font-semibold"
				>Open your first room</a
			>

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
						<svg
							viewBox="0 0 24 24"
							class="text-neon h-5 w-5 shrink-0"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round">{@html f.icon}</svg
						>
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
			<a href="/legal" class="hover:text-ink underline">legal</a>
			<span aria-hidden="true">·</span>
			<a href="/privacy" class="hover:text-ink underline">privacy</a>
		</footer>
	</main>
{:else}
	<!-- Redirecting to /rooms (the layout owns that effect). -->
	<div class="grid min-h-dvh place-items-center" aria-busy="true"></div>
{/if}
