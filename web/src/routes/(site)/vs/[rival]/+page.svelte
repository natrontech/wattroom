<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import CompareTable from '$lib/site/CompareTable.svelte';
	import CtaBand from '$lib/site/CtaBand.svelte';
	import PageHero from '$lib/site/PageHero.svelte';
	import SectionHead from '$lib/site/SectionHead.svelte';
	import Seo from '$lib/site/Seo.svelte';
	import { RIVALS } from '$lib/site/rivals';
	import { article, CHECKED, monthYear, versusPage } from '$lib/site/seo';

	// WattRoom beside one rival (#2995): a disclosure, their best case made
	// fairly, and sources for every claim about them.
	let { data } = $props();
	const r = $derived(data.rival);
	const page = $derived(versusPage(r.slug, r.name));
</script>

<Seo {page} ld={[article(page)]} />

<PageHero
	eyebrow="WattRoom vs {r.name}"
	title="WattRoom or {r.name}? It depends what you want from a ride"
	lede={r.summary}
>
	<a href="/login" class="btn btn-primary btn-lg">Try WattRoom free</a>
	<a href={r.url} class="btn btn-secondary btn-lg" rel="nofollow"
		>Visit {r.name}</a
	>
</PageHero>

<section class="mx-auto w-full max-w-5xl px-4 sm:px-6">
	<p class="text-muted mb-4 text-sm">
		We make WattRoom. Everything said here about {r.name} links to where we checked
		it, in {monthYear(CHECKED)}; if something has changed, tell us on
		<a
			href="https://github.com/natrontech/wattroom/issues"
			class="hover:text-ink underline">GitHub</a
		>.
	</p>
	<CompareTable rivals={[r]} />
</section>

<section
	class="mx-auto mt-16 grid w-full max-w-5xl gap-4 px-4 sm:px-6 md:grid-cols-2"
>
	<div class="panel panel-xl">
		<h2 class="font-display text-xl font-bold">Pick {r.name} if…</h2>
		<ul class="mt-4 flex flex-col gap-3">
			{#each r.pickThem as reason (reason)}
				<li class="flex gap-3 text-sm leading-relaxed">
					<Check size={18} class="text-muted mt-0.5 shrink-0" />{reason}
				</li>
			{/each}
		</ul>
	</div>
	<div class="panel panel-xl border-neon/40">
		<h2 class="font-display text-xl font-bold">Pick WattRoom if…</h2>
		<ul class="mt-4 flex flex-col gap-3">
			{#each r.pickUs as reason (reason)}
				<li class="flex gap-3 text-sm leading-relaxed">
					<Check size={18} class="text-neon mt-0.5 shrink-0" />{reason}
				</li>
			{/each}
		</ul>
	</div>
</section>

<section class="mx-auto mt-16 w-full max-w-5xl px-4 sm:px-6">
	<SectionHead title="Sources" />
	<ul class="text-muted mt-4 flex flex-col gap-1.5 text-sm">
		{#each r.sources as s (s.url)}
			<li><a href={s.url} class="hover:text-ink underline">{s.label}</a></li>
		{/each}
	</ul>
	<p class="text-muted mt-4 text-xs">
		{r.name} is a trademark of its owner. WattRoom is not affiliated with
		{r.name}.
	</p>
	<p class="mt-8 text-sm">
		More:
		{#each RIVALS.filter((o) => o.slug !== r.slug) as o, i (o.slug)}
			{#if i > 0}·{/if}
			<a href="/vs/{o.slug}" class="btn-link">WattRoom vs {o.name}</a>
		{/each}
		·
		<a href="/zwift-alternative" class="btn-link">every alternative at once</a>
	</p>
</section>

<CtaBand />
