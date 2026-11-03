<script lang="ts">
	import CtaBand from '$lib/site/CtaBand.svelte';
	import Faq from '$lib/site/Faq.svelte';
	import GameModeCards from '$lib/site/GameModeCards.svelte';
	import PageHero from '$lib/site/PageHero.svelte';
	import Screen from '$lib/site/Screen.svelte';
	import SectionHead from '$lib/site/SectionHead.svelte';
	import Seo from '$lib/site/Seo.svelte';
	import SprintGame from '$lib/site/SprintGame.svelte';
	import { RACE_LIST } from '$lib/site/game-modes';
	import { GAME_MODES } from '$lib/site/seo';

	// The seven games and the three races, with their rules (#2995, #3177).
	// Unique content — nobody else has Watt Golf — and every number is
	// docs/SPEC.md's, via game-modes.ts.
	const faq = [
		{
			q: 'Can a weaker rider really win?',
			a: 'Yes. Every game measures against each rider’s own FTP — Backyard Ramp’s band, Floor is Lava’s zones, Watt Golf’s holes — so it is who rides their own numbers best, not whose numbers are biggest. Sprints score watts per kilo.',
		},
		{
			q: 'What happens when I am eliminated?',
			a: 'You stay in the session, the trainer drops you to an easy spin, and you get to heckle. Nobody leaves the call because they lost.',
		},
		{
			q: 'What if my trainer disconnects mid-game?',
			a: 'Elimination modes give you 30 seconds to reconnect, and what you pedalled meanwhile is kept and counted when you are back.',
		},
		{
			q: 'Who wins a race?',
			a: 'The first over the line in their Category, or in Last Light the farthest when the clock runs out. Speed comes from your watts per kilo, so a light climber and a heavy rouleur ride the same physics. Results are per Category, D to A, on the closing card, so you are placed among riders of your own fitness. A race needs at least two riders, and a weight changed in the last 14 days rides unranked.',
		},
		{
			q: 'Do the games replace workouts?',
			a: 'They are sessions like any other — saved to everyone’s history with their numbers — just with a scoreboard. Most crews mix them in: workout on Tuesday, Backyard Ramp on Friday.',
		},
	];
</script>

<Seo page={GAME_MODES} />

<PageHero
	eyebrow="Indoor cycling game modes"
	title="Seven games and three races, and no power-ups"
	lede="Games are decided by watts alone, measured against each rider’s own FTP, so the smallest engine in the crew can win. Races run on one of your roads, on W/kg, in a real bunch, with results per Category. All of it in your crew’s voice channel, with everyone yelling."
/>

<section class="mx-auto w-full max-w-6xl px-4 sm:px-6">
	<GameModeCards full />
</section>

<section
	id="races"
	class="mx-auto mt-24 w-full max-w-6xl scroll-mt-24 px-4 sm:px-6"
>
	<SectionHead
		eyebrow="Races on a road"
		title="Race your roads in a real bunch"
		lede="Pick one of your roads in the session picker and tap Race it. A 10-second countdown, three minutes of neutral zone at 0 %, then the klaxon at km 0. The wheels ahead shelter you, up to half the air, and results are per Category, D to A."
	/>
	<div class="mt-8 grid items-start gap-8 lg:grid-cols-2">
		<ul class="flex flex-col gap-3">
			{#each RACE_LIST as race (race.slug)}
				<li id={race.slug} class="panel panel-lg scroll-mt-24">
					<h2 class="font-display text-xl font-bold">{race.name}</h2>
					<p class="text-muted mt-1 text-sm">{race.line}</p>
					<p class="mt-3 text-sm leading-relaxed">{race.rules}</p>
				</li>
			{/each}
		</ul>
		<Screen
			name="race-picker"
			alt="The session picker with a road picked and its races offered: Race, Last Light and Wheelrace"
			width={1440}
			height={900}
			caption="Race it, from the session picker."
		/>
	</div>
</section>

<section
	class="mx-auto mt-24 grid w-full max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-2"
>
	<Screen
		name="game-modes"
		alt="Starting a session in WattRoom: the Games tab lists all seven modes with their rules"
		caption="Pick a game when you start the session."
	/>
	<Screen
		name="sprint"
		alt="A sprint in a live session: the countdown, the rider’s watts, and the crew ranked by watts per kilo"
		caption="A sprint mid-session: the crew ranked live by w/kg."
	/>
</section>

<section class="mx-auto mt-24 w-full max-w-3xl px-4 sm:px-6">
	<SectionHead
		center
		eyebrow="Try one"
		title="A Sprint Roulette sprint, right here"
		lede="Arm it, wait for the klaxon, and tap as fast as you can — or hold the pad down."
	/>
	<div class="mt-8">
		<SprintGame />
	</div>
</section>

<section class="mx-auto mt-24 w-full max-w-3xl px-4 sm:px-6">
	<SectionHead title="Why games decided by watts?" />
	<div class="text-muted mt-5 flex flex-col gap-4 leading-relaxed">
		<p>
			A race is about position: whose wheel you sit on, when you go, who is
			where at the line. The races are for that. The games are about the thing
			you are actually training — how much power you can hold, how precisely,
			and for how long.
		</p>
		<p>
			And because every target is a share of your own FTP, the games work for a
			crew of mixed fitness. The rider who is new to structured training and the
			one who races on weekends play the same game, and either can win.
		</p>
	</div>
</section>

<div class="mt-24">
	<Faq items={faq} />
</div>

<CtaBand title="Pick a game for Friday." />
