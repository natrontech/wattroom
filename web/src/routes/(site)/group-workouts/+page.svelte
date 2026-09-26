<script lang="ts">
	import CtaBand from '$lib/site/CtaBand.svelte';
	import Faq from '$lib/site/Faq.svelte';
	import FtpSlider from '$lib/site/FtpSlider.svelte';
	import PageHero from '$lib/site/PageHero.svelte';
	import Screen from '$lib/site/Screen.svelte';
	import SectionHead from '$lib/site/SectionHead.svelte';
	import Seo from '$lib/site/Seo.svelte';
	import { GROUP_WORKOUTS } from '$lib/site/seo';

	// Answers "zwift workout with friends", "does zwift have voice chat" and
	// "create a group workout" (#2995) — the queries that fit best and are
	// easiest to rank for.
	const session = [
		{
			title: 'Walk into the voice channel',
			body: 'Your crew’s voice channel is always there. Click it and you are in the call; your trainer pairs from the same page.',
		},
		{
			title: 'Anyone starts the workout',
			body: 'Whoever starts a session picks the workout — from the library, from their own shelf, or a .zwo file they imported — and becomes its coach. No event to schedule first.',
		},
		{
			title: 'Ten seconds, then everyone rides',
			body: 'A countdown, and the timeline runs on the server for everyone at once. Each trainer holds its own rider’s share of every block in ERG mode.',
		},
		{
			title: 'Talk the whole way',
			body: 'Voice is one tap and the camera is yours to switch on. The music ducks when someone speaks. A sprint flips the trainer out of ERG so you can empty the tank.',
		},
	];

	const faq = [
		{
			q: 'Does Zwift have voice chat?',
			a: 'Not built in: Zwift’s chat is typed, and riders who want to hear each other run Discord beside it. In WattRoom the voice channel is the room the workout happens in.',
		},
		{
			q: 'Can we ride a workout together if our FTPs are different?',
			a: 'Yes, and it is the normal case. Workouts are written in percentages of FTP and every trainer holds its own rider’s watts, so the whole crew rides the same shape at the same moment and it hurts everyone equally.',
		},
		{
			q: 'Do we have to schedule it?',
			a: 'No. Anyone in the voice channel can start a session whenever the crew is there. If you like a fixed night, put it on the crew’s schedule: members say they are in or out, and it can land in their own calendar.',
		},
		{
			q: 'Can two groups ride different workouts at once?',
			a: 'Yes, in two voice channels. Each voice channel runs one session at a time, and a crew can have several.',
		},
		{
			q: 'What if someone’s trainer drops out?',
			a: 'A trainer that goes quiet for three seconds is flagged at once, and the connection recovers by itself — with one big button if it cannot. The session keeps running for everyone else.',
		},
		{
			q: 'Can someone just ride along without the workout?',
			a: 'Yes. Anyone in a voice channel can free ride — set watts or a grade by hand — and stay in the call with their numbers showing.',
		},
	];
</script>

<Seo page={GROUP_WORKOUTS} />

<PageHero
	eyebrow="Group workouts with friends"
	title="One workout. Your whole crew. Voice built in."
	lede="Ride the same structured workout at the same moment as your friends, every trainer on its own rider’s FTP, talking the whole way. No Meetup to set up and no second app for voice. Free, in Chrome or Edge."
/>

<section class="mx-auto w-full max-w-5xl px-4 sm:px-6">
	<Screen
		name="session"
		eager
		alt="A WattRoom group session: several riders’ watts and heart rate beside the shared interval timeline"
		caption="One timeline, every rider’s numbers, and the voice channel it runs in."
	/>
</section>

<section
	class="mx-auto mt-24 grid w-full max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.2fr]"
>
	<SectionHead
		eyebrow="Same workout, your watts"
		title="Nobody waits, nobody gets dropped"
		lede="Outside, a group splits on the first climb. Indoors it does not have to: the workout is shared and the watts are personal. Drag your FTP and watch your targets move while the workout stays the same."
	/>
	<FtpSlider />
</section>

<section class="mx-auto mt-24 w-full max-w-6xl px-4 sm:px-6">
	<SectionHead
		eyebrow="How a session works"
		title="From “anyone up for a ride?” to riding"
	/>
	<ol class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		{#each session as step, i (step.title)}
			<li class="panel panel-lg">
				<span class="num text-muted text-sm">0{i + 1}</span>
				<h3 class="font-display mt-2 text-lg font-bold">{step.title}</h3>
				<p class="text-muted mt-2 text-sm leading-relaxed">{step.body}</p>
			</li>
		{/each}
	</ol>
</section>

<section
	class="mx-auto mt-24 grid w-full max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-2"
>
	<div>
		<SectionHead
			eyebrow="Why a crew, not an event"
			title="The ride is better when the room is still there tomorrow"
		/>
		<div class="text-muted mt-5 flex flex-col gap-4 text-base leading-relaxed">
			<p>
				In most training apps a group workout is something you set up: build it,
				schedule it, invite people, and open a voice app on the side. WattRoom
				starts from the other end. Your crew has a standing place — text
				channels for the week, voice channels for ride night — and the workout
				happens in it.
			</p>
			<p>
				So the chat before the ride, the ride, and the “that last interval was
				brutal” afterwards all happen in the same place, with the same people,
				and nobody had to organise anything.
			</p>
		</div>
	</div>
	<Screen
		name="crew"
		alt="A WattRoom crew: the sidebar with its text and voice channels, and a text channel"
	/>
</section>

<div class="mt-24">
	<Faq items={faq} />
</div>

<CtaBand title="Your crew rides tonight." />
