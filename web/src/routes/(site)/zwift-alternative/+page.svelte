<script lang="ts">
	import CompareTable from '$lib/site/CompareTable.svelte';
	import CtaBand from '$lib/site/CtaBand.svelte';
	import Faq from '$lib/site/Faq.svelte';
	import PageHero from '$lib/site/PageHero.svelte';
	import SectionHead from '$lib/site/SectionHead.svelte';
	import Seo from '$lib/site/Seo.svelte';
	import { RIVALS } from '$lib/site/rivals';
	import {
		article,
		CHECKED,
		monthYear,
		ZWIFT_ALTERNATIVE,
	} from '$lib/site/seo';

	// The hub for "zwift alternative" (#2995). What ranks for it is honest
	// comparison: a table, dated prices, sources, and saying plainly when
	// another app is the better pick. Every rival fact lives in rivals.ts.
	const others = [
		{
			name: 'Rouvy',
			url: 'https://rouvy.com/',
			line: 'Real-route video you ride through; part of Zwift since April 2026.',
			source:
				'https://www.dcrainmaker.com/2026/04/zwift-acquires-rouvy-including-fulgaz.html',
		},
		{
			name: 'TrainingPeaks Virtual',
			url: 'https://www.trainingpeaks.com/virtual/',
			line: 'Virtual group rides, included with a TrainingPeaks Premium plan.',
		},
		{
			name: 'Wahoo SYSTM',
			url: 'https://eu.wahoofitness.com/systm',
			line: 'Structured training plans and video workouts from Wahoo.',
		},
		{
			name: 'icTrainer',
			url: 'https://ictrainer.de/en/',
			line: 'A German training app with built-in video calls for groups.',
		},
		{
			name: 'Auuki',
			url: 'https://github.com/dvmarinoff/Auuki',
			line: 'Open source, in the browser, for riding a workout on your own.',
		},
		{
			name: 'dundring',
			url: 'https://github.com/sivertschou/dundring',
			line: 'Open source, in the browser, group sessions with live data — no voice.',
		},
	];

	const faq = [
		{
			q: 'Is WattRoom really free?',
			a: 'Yes. No subscription, no trial, no paid tier. It is open source under the AGPL, and anyone can run their own server.',
		},
		{
			q: 'Can I bring my Zwift workouts?',
			a: 'Yes: import your .zwo files (and .erg files from other apps) into the workout editor. Every target is a percentage of FTP, so they ride the same.',
		},
		{
			q: 'Is there racing?',
			a: 'Not the way Zwift has it: there is no world, no drafting and no public race calendar. There are seven game modes decided by watts alone — sprints, eliminations, Watt Golf — played inside your own crew.',
		},
		{
			q: 'Does my trainer work?',
			a: 'If it speaks Bluetooth FTMS, which most current smart trainers do, and you use Chrome or Edge on a laptop, desktop or Android phone — or the desktop app.',
		},
		{
			q: 'Can I use WattRoom and Zwift together?',
			a: 'Not on the same trainer at the same time: one app controls it. But plenty of crews ride Zwift on race night and WattRoom on workout night.',
		},
	];
</script>

<Seo page={ZWIFT_ALTERNATIVE} ld={[article(ZWIFT_ALTERNATIVE)]} />

<PageHero
	eyebrow="A free Zwift alternative"
	title="Ride with your friends, not in a video game"
	lede="WattRoom is for crews who want to train together: a standing space with text and voice channels, structured ERG workouts ridden in sync with every trainer on its own FTP, and games decided by watts. No subscription, no install, no world to steer."
/>

<section class="mx-auto w-full max-w-6xl px-4 sm:px-6">
	<SectionHead
		eyebrow="Side by side"
		title="WattRoom, Zwift, TrainerRoad and MyWhoosh"
		lede="We make WattRoom, so read this knowing that. Every claim about the others links to where we checked it, in {monthYear(
			CHECKED,
		)}."
	/>
	<div class="mt-8">
		<CompareTable rivals={RIVALS} />
	</div>
</section>

<section class="mx-auto mt-20 w-full max-w-6xl px-4 sm:px-6">
	<SectionHead title="One comparison at a time" />
	<div class="mt-8 grid gap-4 md:grid-cols-3">
		{#each RIVALS as r (r.slug)}
			<a href="/vs/{r.slug}" class="panel panel-xl hover:border-neon/50 block">
				<p class="eyebrow">Compare</p>
				<h3 class="font-display mt-2 text-xl font-bold">
					WattRoom vs {r.name}
				</h3>
				<p class="text-muted mt-3 text-sm leading-relaxed">{r.pickThem[0]}</p>
				<p class="mt-4 text-sm underline">Read the comparison</p>
			</a>
		{/each}
	</div>
</section>

<section
	class="mx-auto mt-20 grid w-full max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-2"
>
	<div>
		<SectionHead title="What WattRoom is not" />
		<ul
			class="text-muted mt-5 flex list-disc flex-col gap-2 pl-5 leading-relaxed"
		>
			<li>A world. There are no roads, no avatars and no drafting.</li>
			<li>
				A racing scene. Games happen inside your crew, not on a public calendar.
			</li>
			<li>
				A coach. There are no adaptive plans; there is a library and an editor.
			</li>
			<li>
				On your iPhone. Safari cannot talk to a trainer, so iOS riders join the
				crew and the call from a phone, and ride from a laptop.
			</li>
		</ul>
	</div>
	<div>
		<SectionHead title="Other apps worth knowing" />
		<ul class="mt-5 flex flex-col gap-3">
			{#each others as o (o.url)}
				<li class="text-sm leading-relaxed">
					<a href={o.url} class="font-semibold hover:underline" rel="nofollow"
						>{o.name}</a
					>
					<span class="text-muted">— {o.line}</span>
					{#if o.source}
						<a
							href={o.source}
							class="text-muted hover:text-ink text-xs underline">source</a
						>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
</section>

<section class="mx-auto mt-20 w-full max-w-6xl px-4 sm:px-6">
	<details class="panel">
		<summary class="cursor-pointer text-sm font-semibold"
			>Sources for the table</summary
		>
		<ul class="text-muted mt-3 flex flex-col gap-1.5 text-sm">
			{#each RIVALS.flatMap((r) => r.sources) as s (s.url)}
				<li><a href={s.url} class="hover:text-ink underline">{s.label}</a></li>
			{/each}
		</ul>
		<p class="text-muted mt-3 text-xs">
			Zwift, TrainerRoad and MyWhoosh are trademarks of their owners. WattRoom
			is not affiliated with any of them.
		</p>
	</details>
</section>

<div class="mt-24">
	<Faq items={faq} />
</div>

<CtaBand />
