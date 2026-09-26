<script lang="ts">
	import { page } from '$app/state';
	import LandingHero from '$lib/brand/LandingHero.svelte';
	import Logo from '$lib/brand/Logo.svelte';
	import { SITE_PAGES } from '$lib/site/pages';
	import { LANDING } from '$lib/site/seo';

	// The share card for a public page (#2995), drawn with the real brand
	// components and shot by `make screenshots` into web/static/cards/ — the
	// og:image each page's head names. ?path= picks the page, ?w=&h= the size
	// (1200×630 for Open Graph, 1280×640 for GitHub's social preview).
	// Centred on purpose: iMessage and WhatsApp crop toward the middle.
	const path = $derived(page.url.searchParams.get('path') ?? '/');
	const w = $derived(Number(page.url.searchParams.get('w') ?? 1200));
	const h = $derived(Number(page.url.searchParams.get('h') ?? 630));
	const site = $derived(SITE_PAGES.find((p) => p.path === path) ?? LANDING);
	const headline = $derived(
		site.title.replace(/ — WattRoom$/, '').replace(/^WattRoom — /, ''),
	);
</script>

<div
	id="card"
	class="cave bg-surface text-ink relative flex flex-col items-center overflow-hidden text-center"
	style="width: {w}px; height: {h}px"
>
	<div
		class="bg-gridlines pointer-events-none absolute inset-0 opacity-50"
		aria-hidden="true"
	></div>
	<div class="relative mt-12">
		<Logo size={48} wordmark />
	</div>
	<h1
		class="font-display relative mt-7 max-w-[980px] text-[64px] leading-[1.02] font-bold tracking-tight text-balance uppercase"
	>
		{headline}
	</h1>
	<p class="text-muted relative mt-4 text-2xl">
		{site.lang === 'de'
			? 'wattroom.ch · kostenlos · Open Source · im Browser'
			: 'wattroom.ch · free · open source · in your browser'}
	</p>
	<div class="relative mt-10 w-[760px] shrink-0">
		<LandingHero />
	</div>
</div>
