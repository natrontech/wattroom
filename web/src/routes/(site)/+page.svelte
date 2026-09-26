<script lang="ts">
	import Code from '@lucide/svelte/icons/code';
	import Headphones from '@lucide/svelte/icons/headphones';
	import Link from '@lucide/svelte/icons/link';
	import Shield from '@lucide/svelte/icons/shield';
	import Zap from '@lucide/svelte/icons/zap';
	import LandingHero from '$lib/brand/LandingHero.svelte';
	import { account } from '$lib/account.svelte';
	import { goto } from '$app/navigation';
	import { shellVersion } from '$lib/desktop';
	import CompareTable from '$lib/site/CompareTable.svelte';
	import CtaBand from '$lib/site/CtaBand.svelte';
	import Faq from '$lib/site/Faq.svelte';
	import FtpSlider from '$lib/site/FtpSlider.svelte';
	import GameModeCards from '$lib/site/GameModeCards.svelte';
	import Screen from '$lib/site/Screen.svelte';
	import SectionHead from '$lib/site/SectionHead.svelte';
	import Seo from '$lib/site/Seo.svelte';
	import SprintGame from '$lib/site/SprintGame.svelte';
	import { live } from '$lib/site/live.svelte';
	import { RIVALS } from '$lib/site/rivals';
	import { LANDING, REPO, siteGraph } from '$lib/site/seo';

	// The public face of wattroom.ch (#111, #2995), prerendered (ADR-0061).
	// The server sends a request carrying a session to /enter before this page
	// is served; a rider reaches it only by a client navigation, and goes the
	// same way. The desktop shell has already been installed: nobody in it
	// needs the pitch, and it has a sign-in of its own (#1188).
	$effect(() => {
		if (account.me)
			void goto(`/enter${location.search}`, { replaceState: true });
		else if (account.loaded && shellVersion())
			void goto('/login', { replaceState: true });
	});

	const steps = [
		{
			n: '1',
			title: 'Start a crew',
			body: 'Your crew gets text channels and voice channels, like a Discord server for your pain cave. Send its six-character code and everyone is in.',
		},
		{
			n: '2',
			title: 'Hop into voice, pair your trainer',
			body: 'Chrome or Edge talks to your smart trainer over Bluetooth. Nothing to install. Camera if you like, voice with one tap.',
		},
		{
			n: '3',
			title: 'Ride one workout together',
			body: 'Anyone in the channel starts a workout. Every trainer holds its own rider’s watts, the timeline runs for everyone at once, and you talk the whole way.',
		},
	];

	const features = [
		{
			screen: 'session',
			eyebrow: 'The session',
			title: 'Everyone’s numbers on one screen, everyone’s voice in your ears',
			body: 'Your watts big enough to read from the saddle, every rider’s watts, w/kg and cadence, how precisely each of you holds the target, the interval chart — and the crew’s jukebox beside it. A group ride, minus the road.',
			alt: 'A live WattRoom session: the rider’s own watts on target, the other riders’ tiles, everyone’s execution, the interval timeline and the jukebox',
		},
		{
			screen: 'crew',
			eyebrow: 'The crew',
			title: 'A crew is a place, not an event',
			body: 'Text channels for the week, voice channels for ride night, a schedule everyone can say yes to, and a board for the things you keep asking about. It is still there tomorrow.',
			alt: 'A crew in WattRoom: the sidebar with text and voice channels, and a text channel with messages',
		},
		{
			screen: 'jukebox',
			portrait: true,
			eyebrow: 'The jukebox',
			title: 'One soundtrack, in sync, for the whole crew',
			body: 'Paste a YouTube link or a playlist and it plays for everyone in the voice channel at the same moment. Vote tracks up. Duck it under the voices. Bring your own MP3s.',
			alt: 'The WattRoom jukebox: the track playing and the queue that plays next',
		},
		{
			screen: 'summary',
			eyebrow: 'After the ride',
			title: 'Every ride counts, and it stays yours',
			body: 'A summary with your power curve and zones, XP and trophies, a .fit file to download and one tap to Strava. Rides are private until you share them.',
			alt: 'A WattRoom ride summary with power, zones and medals',
		},
		{
			screen: 'workout-editor',
			eyebrow: 'Workouts',
			title: 'A library to start from, an editor for the rest',
			body: 'Pick from the curated library, build your own in the editor, or import the .zwo and .erg files you already have. Every target is a share of FTP, so one workout fits the whole crew.',
			alt: 'The WattRoom workout editor with an interval chart coloured by power zone',
		},
	];

	const faq = [
		{
			q: 'Do I need a smart trainer?',
			a: 'To be held on target in ERG mode, yes: any trainer that speaks Bluetooth FTMS, which most current smart trainers do. You can join a crew’s channels and its voice without one, and a power meter or heart-rate strap pairs the same way.',
		},
		{
			q: 'Which browsers work?',
			a: 'Chrome or Edge on Windows, macOS and Android: they speak Web Bluetooth, which is how WattRoom reaches your trainer with nothing to install. Or use the desktop app. On Linux, Chrome still keeps Web Bluetooth behind a flag. Safari and Firefox cannot talk to a trainer at all, so on an iPhone or iPad you can join the crew and the call, but not ride.',
		},
		{
			q: 'What does it cost?',
			a: 'Nothing. WattRoom is free and open source under the AGPL. There is no subscription, and nobody in your crew has to pay to ride with you.',
		},
		{
			q: 'Can riders of different strength ride together?',
			a: 'That is the point. Every target is a percentage of each rider’s own FTP, so the 180 W rider and the 320 W rider do the same workout, side by side, and it hurts both of them the same. Game modes like Backyard Ramp eliminate on your own FTP too.',
		},
		{
			q: 'Is anything recorded?',
			a: 'Voice and video are never recorded. Your ride data stays with your session, and rides are private by default. You can export or delete everything from your settings.',
		},
		{
			q: 'I don’t know my FTP.',
			a: 'Take the ramp test: a warm-up, then +20 W a minute until you cannot hold it, about 12–18 minutes in all. Your FTP is 75 % of your best minute.',
		},
	];
</script>

<Seo page={LANDING} ld={[siteGraph()]} />

<!-- Hero: the promise, and a session in miniature proving it. -->
<section
	class="mx-auto flex w-full max-w-4xl flex-col items-center px-4 pt-14 text-center sm:px-6 sm:pt-20"
>
	<!-- The category, before the promise (#2139): the search snippet calls
	     WattRoom a Zwift alternative, and Google rewrites a description the
	     page does not back up. -->
	<p class="eyebrow mb-3">Discord for indoor cycling · a Zwift alternative</p>
	<h1
		class="font-display text-5xl leading-[0.95] font-bold tracking-tight uppercase sm:text-7xl"
	>
		Train together,<br /><span class="text-neon">not alone.</span>
	</h1>
	<p class="text-muted mt-5 max-w-xl text-base text-balance sm:text-lg">
		Your crew, one structured workout, every trainer on its own rider’s FTP —
		and voice, so you suffer out loud. No virtual world: your watts are the
		game.
	</p>
	<!-- The promise Home keeps (#2184, ADR-0038 amended): a stranger arrives
	     with no invite, so the big button says what Home's does. -->
	<div class="mt-8 flex flex-wrap items-center justify-center gap-3">
		<a href="/login" class="btn btn-primary btn-lg">Start your crew</a>
		<a href="#sprint" class="btn btn-secondary btn-lg"
			><Zap size={18} /> Try the sprint</a
		>
	</div>
	<p class="text-muted mt-4 text-xs">
		Free · open source · runs in Chrome or Edge ·
		<a href="/download" class="hover:text-ink underline">desktop app</a>
	</p>
	{#if live.online > 0}
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
	<div class="mt-12 w-full max-w-2xl">
		<LandingHero />
	</div>
</section>

<!-- How it works -->
<section class="mx-auto mt-28 w-full max-w-6xl px-4 sm:px-6">
	<SectionHead
		center
		eyebrow="How it works"
		title="From group chat to group ride in three steps"
	/>
	<ol class="mt-10 grid gap-4 md:grid-cols-3">
		{#each steps as step (step.n)}
			<li class="panel panel-lg">
				<span
					class="font-display border-neon/50 text-ink grid h-9 w-9 place-items-center rounded-full border text-sm font-bold"
					>{step.n}</span
				>
				<h3 class="font-display mt-4 text-lg font-bold">{step.title}</h3>
				<p class="text-muted mt-2 text-sm leading-relaxed">{step.body}</p>
			</li>
		{/each}
	</ol>
</section>

<!-- The core idea, playable. -->
<section
	class="mx-auto mt-28 grid w-full max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.2fr]"
>
	<div>
		<SectionHead
			eyebrow="Same workout, your watts"
			title="Different FTPs. One session."
			lede="Friends never ride at the same watts. WattRoom never asks them to: a workout is written in percentages of FTP, and every trainer holds its own rider’s share. Drag your FTP and watch."
		/>
		<a href="/group-workouts" class="btn-link mt-5 inline-block text-sm"
			>How group workouts work</a
		>
	</div>
	<FtpSlider />
</section>

<!-- The product, as it looks. -->
<section
	class="mx-auto mt-28 flex w-full max-w-6xl flex-col gap-24 px-4 sm:px-6"
>
	{#each features as f, i (f.screen)}
		<div class="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
			<div class={i % 2 ? 'lg:order-2' : ''}>
				<SectionHead eyebrow={f.eyebrow} title={f.title} lede={f.body} />
			</div>
			{#if f.portrait}
				<Screen name={f.screen} alt={f.alt} width={399} height={826} narrow />
			{:else}
				<Screen name={f.screen} alt={f.alt} />
			{/if}
		</div>
	{/each}
</section>

<!-- Games -->
<section class="mx-auto mt-28 w-full max-w-6xl px-4 sm:px-6">
	<SectionHead
		center
		eyebrow="Seven game modes"
		title="No drafting. No power-ups. Just watts."
		lede="Every game is decided by power alone, scaled to each rider’s FTP — so the smallest engine in the crew can win Backyard Ramp."
	/>
	<div class="mt-10">
		<GameModeCards tryHref="#sprint" />
	</div>
	<p class="mt-6 text-center">
		<a href="/game-modes" class="btn-link text-sm"
			>All seven, and how they play</a
		>
	</p>
</section>

<section
	id="sprint"
	class="mx-auto mt-28 w-full max-w-3xl scroll-mt-24 px-4 sm:px-6"
>
	<SectionHead
		center
		eyebrow="Try it"
		title="Sprint Roulette, with your thumb"
		lede="In a session, five of these land at random with a klaxon three seconds before each. Here is one."
	/>
	<div class="mt-8">
		<SprintGame />
	</div>
</section>

<!-- Honest comparison -->
<section class="mx-auto mt-28 w-full max-w-6xl px-4 sm:px-6">
	<SectionHead
		eyebrow="Compared"
		title="What WattRoom is, beside what you know"
		lede="Zwift and MyWhoosh are worlds to ride in; TrainerRoad is a coach. WattRoom is a place for your crew. Pick the right one — sometimes it is not us."
	/>
	<div class="mt-8">
		<CompareTable rivals={RIVALS} />
	</div>
	<p class="mt-4">
		<a href="/zwift-alternative" class="btn-link text-sm"
			>The full comparison, with sources</a
		>
	</p>
</section>

<!-- What we promise -->
<section
	class="mx-auto mt-28 grid w-full max-w-6xl gap-4 px-4 sm:px-6 md:grid-cols-3"
>
	<div class="panel panel-xl">
		<Shield size={22} class="text-neon" />
		<h3 class="font-display mt-4 text-lg font-bold">Private by default</h3>
		<p class="text-muted mt-2 text-sm leading-relaxed">
			Voice and video are never recorded. Live numbers live and die with the
			session. Your rides are yours until you share one.
		</p>
	</div>
	<div class="panel panel-xl">
		<Code size={22} class="text-neon" />
		<h3 class="font-display mt-4 text-lg font-bold">Open source, all of it</h3>
		<p class="text-muted mt-2 text-sm leading-relaxed">
			The whole thing is on GitHub under the AGPL. A club can
			<a href="/self-host" class="hover:text-ink underline"
				>run its own server</a
			>
			with one Docker Compose stack.
		</p>
	</div>
	<div class="panel panel-xl">
		<Headphones size={22} class="text-neon" />
		<h3 class="font-display mt-4 text-lg font-bold">One tab, not three apps</h3>
		<p class="text-muted mt-2 text-sm leading-relaxed">
			No training app plus Discord plus a music player fighting over one
			headset. Workout, voice and soundtrack share a tab and a mixer.
		</p>
	</div>
</section>

<div class="mt-28">
	<Faq items={faq} />
</div>

<CtaBand />

<p
	class="text-muted mx-auto mt-10 flex max-w-md items-center justify-center gap-2 px-4 text-center text-xs"
>
	<Link size={14} />
	Built in the open —
	<a href={REPO} class="hover:text-ink underline">star it on GitHub</a>
	if you want more of it.
</p>
