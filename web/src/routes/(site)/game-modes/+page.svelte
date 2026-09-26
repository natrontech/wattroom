<script lang="ts">
	import CtaBand from '$lib/site/CtaBand.svelte';
	import Faq from '$lib/site/Faq.svelte';
	import GameModeCards from '$lib/site/GameModeCards.svelte';
	import PageHero from '$lib/site/PageHero.svelte';
	import SectionHead from '$lib/site/SectionHead.svelte';
	import Seo from '$lib/site/Seo.svelte';
	import SprintGame from '$lib/site/SprintGame.svelte';
	import { GAME_MODES } from '$lib/site/seo';

	// The seven modes, with their rules (#2995). Unique content — nobody else
	// has Watt Golf — and every number is docs/SPEC.md's, via game-modes.ts.
	const faq = [
		{
			q: 'Can a weaker rider really win?',
			a: 'Yes. Every mode measures against each rider’s own FTP — Backyard Ramp’s band, Floor is Lava’s zones, Watt Golf’s holes — so it is who rides their own numbers best, not whose numbers are biggest. Sprints score watts per kilo.',
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
			q: 'Do the games replace workouts?',
			a: 'They are sessions like any other — saved to everyone’s history with their numbers — just with a scoreboard. Most crews mix them in: workout on Tuesday, Backyard Ramp on Friday.',
		},
	];
</script>

<Seo page={GAME_MODES} />

<PageHero
	eyebrow="Indoor cycling game modes"
	title="Seven games where your watts are the whole game"
	lede="No world, no drafting, no power-ups. Every WattRoom game is decided by power alone and measured against each rider’s own FTP, so the smallest engine in the crew can win. Played in your crew’s voice channel, with everyone yelling."
/>

<section class="mx-auto w-full max-w-6xl px-4 sm:px-6">
	<GameModeCards full />
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
	<SectionHead title="Why games without a world?" />
	<div class="text-muted mt-5 flex flex-col gap-4 leading-relaxed">
		<p>
			A virtual world makes the ride about the world: drafting, route choice,
			whose avatar is where. WattRoom’s games are about the thing you are
			actually training — how much power you can hold, how precisely, and for
			how long.
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
