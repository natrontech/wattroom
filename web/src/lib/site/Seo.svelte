<script lang="ts">
	import { TRANSLATIONS } from './pages';
	import {
		DEFAULT_IMAGE,
		jsonLd,
		SITE_NAME,
		SITE_ORIGIN,
		type SitePage,
	} from './seo';

	// A public page's head (ADR-0061): the same tags the server splices into
	// the app's fallback (og.go), written at build time instead.
	let {
		page,
		image = DEFAULT_IMAGE,
		ld = [],
	}: { page: SitePage; image?: string; ld?: unknown[] } = $props();

	const url = $derived(SITE_ORIGIN + page.path);
	// A page with a translation names both, and English as the default —
	// Google wants the pair declared from each side, or it ignores both.
	const other = $derived(TRANSLATIONS[page.path]);
	const alternates = $derived(
		other
			? [
					{ lang: page.lang ?? 'en', href: url },
					{ lang: other.lang ?? 'en', href: SITE_ORIGIN + other.path },
					{
						lang: 'x-default',
						href: SITE_ORIGIN + (page.lang ? other.path : page.path),
					},
				]
			: [],
	);
</script>

<svelte:head>
	<title>{page.title}</title>
	<meta name="description" content={page.description} />
	<link rel="canonical" href={url} />
	{#each alternates as alt (alt.lang)}
		<link rel="alternate" hreflang={alt.lang} href={alt.href} />
	{/each}
	<meta property="og:site_name" content={SITE_NAME} />
	<meta property="og:type" content="website" />
	<meta property="og:locale" content={page.lang === 'de' ? 'de_CH' : 'en'} />
	<meta property="og:title" content={page.title} />
	<meta property="og:description" content={page.description} />
	<meta property="og:url" content={url} />
	<meta property="og:image" content={image} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
	{#each ld as doc, i (i)}
		<!-- jsonLd escapes <, > and &: the text cannot end the element. -->
		{@html `<script type="application/ld+json">${jsonLd(doc)}</script>`}
	{/each}
</svelte:head>
