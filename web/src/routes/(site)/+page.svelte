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
			body: 'Your crew gets chat channels and voice channels, like a Discord server for your pain cave. Send its six-character code and everyone is in.',
		},
		{
			n: '2',
			title: 'Join voice, pair your trainer',
			body: 'Chrome or Edge talks to your smart trainer over Bluetooth, or use the desktop app. Voice is one tap, and the crew’s jukebox plays in sync and ducks when someone speaks.',
		},
		{
			n: '3',
			title: 'Start a session',
			body: 'Anyone in the voice channel starts one: a free ride on a road, a workout, a race or a game. Everyone rides it at once and talks the whole way.',
		},
	];

	/** The road, the work and the controls: what a rider does on WattRoom (#4198). */
	const features = [
		{
			screen: 'world-blocks',
			eyebrow: 'Workouts on the road',
			title: 'The next blocks are painted on the road ahead',
			body: 'Ride a workout on one of your roads and its next three blocks are painted on the asphalt, each with its name and your target where it starts. A sprint gets a banner across the road from 1 km out.',
			alt: 'A workout ridden on a mountain road in the 3D world: the next block painted across the road ahead with its target, the workout’s clock and graph above, the bike computer at the left',
		},
		{
			screen: 'workout-flat',
			eyebrow: 'Or on the graph',
			title: 'Without a road, the workout is the picture',
			body: 'Every block on the interval graph is labelled with its watts and length, and the panel above holds your target. Fill the shelf from the library, the editor, or the .zwo and .erg files you already have.',
			alt: 'A workout ridden without a road: the interval graph with each block labelled with its watts and length, and the watts and target in the panel above',
		},
		{
			screen: 'world-ghost',
			eyebrow: 'Your ghost',
			title: 'Ride a road again and race your earlier self',
			body: 'Start a road of yours from the beginning and the rider you were last time rides beside you, a see-through figure in your own kit. The bike computer says the gap in words: “4 s behind”.',
			alt: 'A free ride on a mountain road in the 3D world: the rider’s ghost from an earlier ride just ahead, the bike computer reading 4 s behind, and Easier and Harder in the panel above',
		},
	];

	const faq = [
		{
			q: 'Do I need a smart trainer?',
			a: 'To be held on target in ERG mode, yes: any trainer that speaks Bluetooth FTMS, which most current smart trainers do. You can join a crew’s channels and its voice without one, and a power meter or heart-rate strap pairs the same way.',
		},
		{
			q: 'Where do the roads come from?',
			a: 'From you. Import a GPX, TCX or FIT file of a route you know, and WattRoom reads its climbs and grades. The world is a switch on each device: set it to Full and the road is drawn in 3D, or leave it on Flat and the road rides as its profile.',
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
		Ride your own roads in a 3D world with your crew, or one structured workout
		with every trainer on its own rider’s FTP. Voice is built in, so you talk
		the whole way.
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
		<!-- The dot is watt, flat; the words are ink (#1965). -->
		<p
			class="text-ink font-display mt-4 flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase"
			aria-live="polite"
		>
			<span
				class="bg-watt h-1.5 w-1.5 rounded-full motion-safe:animate-pulse"
				aria-hidden="true"
			></span>
			{live.online} rider{live.online === 1 ? '' : 's'} online now
		</p>
	{/if}
	<div class="mt-12 w-full max-w-2xl">
		<LandingHero />
	</div>
</section>

<!-- The world: a crew on one road (#4198). -->
<section id="world" class="mx-auto mt-28 w-full max-w-6xl px-4 sm:px-6">
	<SectionHead
		center
		eyebrow="Ride a road together"
		title="Your roads in 3D, with your crew on them"
		lede="Import a route and ride it in a 3D world: the climbs, the hairpins and every crewmate where their own watts have taken them. The numbers sit at the edges, so the road stays in view."
	/>
	<div class="mt-10">
		<Screen
			name="world-crew"
			alt="Two riders of a crew side by side in a session on a mountain road in the 3D world, the workout’s clock above, the bike computer at the left and the riders’ watts per kilo at the right"
			width={1440}
			height={900}
		/>
	</div>
</section>

<!-- Workouts and the ghost, as they look. -->
<section
	class="mx-auto mt-28 flex w-full max-w-6xl flex-col gap-24 px-4 sm:px-6"
>
	{#each features as f, i (f.screen)}
		<div class="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
			<div class={i % 2 ? 'lg:order-2' : ''}>
				<SectionHead eyebrow={f.eyebrow} title={f.title} lede={f.body} />
			</div>
			<Screen name={f.screen} alt={f.alt} width={1440} height={900} />
		</div>
	{/each}
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
		<a href="/group-workouts" class="btn-link link-standalone mt-5 text-sm"
			>How group workouts work</a
		>
	</div>
	<FtpSlider />
</section>

<!-- Gears, and the phone as the remote. -->
<section
	class="mx-auto mt-28 grid w-full max-w-6xl items-center gap-8 px-4 sm:px-6 lg:grid-cols-2 lg:gap-14"
>
	<SectionHead
		eyebrow="Gears and your phone"
		title="Shift from the screen, the keys, a Cog or your phone"
		lede="On a road, Easier and Harder shift virtual gears: tap them, press − and +, or ride a Zwift Cog. In an ERG workout the same controls trim your target. Open WattRoom on your phone while the desk rides and the phone becomes your remote, and one tap moves your voice to it."
	/>
	<Screen
		name="phone-remote"
		alt="A phone as the rider’s remote while the desk rides: big Easier and Harder buttons, and buttons to turn the bike computer’s page, cheer back and talk"
		width={375}
		height={698}
		narrow
	/>
</section>

<!-- Sessions with voice. -->
<section class="mx-auto mt-28 w-full max-w-6xl px-4 sm:px-6">
	<SectionHead
		center
		eyebrow="Sessions with voice"
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

<!-- Races and games -->
<section class="mx-auto mt-28 w-full max-w-6xl px-4 sm:px-6">
	<SectionHead
		center
		eyebrow="Races and games"
		title="Race your roads, or play on watts alone"
		lede="Pick a road in the session picker, tap Race it, and choose Race, Last Light or Wheelrace: a race on W/kg, with results by category on the closing card. Or play one of seven games scaled to each rider’s FTP, so the smallest engine in the crew can win Backyard Ramp."
	/>
	<div class="mt-10 grid gap-3 lg:grid-cols-2">
		<Screen
			name="race-picker"
			alt="The session picker with a road picked and its races offered: Race, Last Light and Wheelrace"
			width={1440}
			height={900}
			caption="Race it, from the session picker."
		/>
		<Screen
			name="world-sprint"
			alt="A sprint’s window open in a session on the road: the moment card over the 3D world, the riders ranked live"
			width={1440}
			height={900}
			caption="A sprint lands mid-session."
		/>
	</div>
	<div class="mt-12">
		<GameModeCards tryHref="#sprint" />
	</div>
	<p class="mt-6 text-center">
		<a href="/game-modes" class="btn-link text-sm"
			>All seven games, and how they play</a
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
		lede="Zwift and MyWhoosh are worlds you share with everyone who rides them, and TrainerRoad is a coach. WattRoom is a place for your crew, on the roads you bring. Pick the one that fits: sometimes it is one of them."
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
			session. Each ride saves privately, with a .fit file to download and one
			tap to Strava.
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
		<h3 class="font-display mt-4 text-lg font-bold">
			Ride, voice and music in one tab
		</h3>
		<p class="text-muted mt-2 text-sm leading-relaxed">
			The ride, the call and the crew’s soundtrack share one tab and one mixer,
			so a single headset hears all three.
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
	Built in the open.
	<a href={REPO} class="hover:text-ink underline">Star it on GitHub</a>
	if you want more of it.
</p>
