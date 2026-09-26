<script lang="ts">
	import CtaBand from '$lib/site/CtaBand.svelte';
	import Faq from '$lib/site/Faq.svelte';
	import FtpCalculator from '$lib/site/FtpCalculator.svelte';
	import PageHero from '$lib/site/PageHero.svelte';
	import SectionHead from '$lib/site/SectionHead.svelte';
	import Seo from '$lib/site/Seo.svelte';
	import { FTP_TEST } from '$lib/site/seo';
	import { RAMP, RAMP_TAKES } from '$lib/workout/ramp';

	// "ramp test online", "ftp test", "ftp calculator" (#2995). Every number
	// is the ramp the app runs (RAMP — docs/SPEC.md's), never retyped here.
	const shown = 12;
	const steps = Array.from(
		{ length: shown },
		(_, i) => RAMP.startWatts + i * RAMP.stepWatts,
	);
	const top = steps[shown - 1];

	const faq = [
		{
			q: 'How long does the ramp test take?',
			a: `The whole test takes ${RAMP_TAKES}: ${RAMP.warmupSeconds / 60} minutes of warm-up, then steps until you cannot hold the target. Most riders fail somewhere between the seventh and the thirteenth step.`,
		},
		{
			q: 'Why 75 % of the best minute?',
			a: 'A ramp test finds your maximal aerobic power — the last minute you could sustain. For most riders an hour’s best power sits between 72 and 77 % of that, and 75 % is the middle every platform uses. It is an estimate within about ±5 %: very aerobic riders read low, punchy ones high.',
		},
		{
			q: 'Do I need a smart trainer?',
			a: 'For WattRoom’s ramp test, yes: the trainer holds each step’s watts for you in ERG mode, so all you do is keep the pedals turning. A heart-rate strap is optional and adds an estimate of your threshold heart rate.',
		},
		{
			q: 'When does the test end?',
			a: 'When you do. If your power falls well below the step for a few seconds, the test notices and stops — nobody at the end of a ramp is going to reach for a button.',
		},
		{
			q: 'Is it free?',
			a: 'Yes. Sign in (free), open the ramp test, pair your trainer. The result becomes your FTP if you accept it, and the test is saved as a ride.',
		},
	];
</script>

<Seo page={FTP_TEST} />

<PageHero
	eyebrow="Free online FTP test"
	title="Find your FTP with a ramp test in your browser"
	lede="A {RAMP.warmupSeconds /
		60}-minute warm-up, then the trainer adds {RAMP.stepWatts} W every minute until you cannot hold it. Your FTP is {RAMP.ftpFraction *
		100} % of your best minute. Free, {RAMP_TAKES}, and every workout after it is scaled to the number it finds."
>
	<a href="/ramp" class="btn btn-primary btn-lg">Take the ramp test</a>
	<a href="#calculator" class="btn btn-secondary btn-lg"
		>Calculate from a number</a
	>
</PageHero>

<section class="mx-auto w-full max-w-5xl px-4 sm:px-6">
	<figure class="shell-card bg-surface-raised/60 p-5 sm:p-6">
		<svg
			viewBox="0 0 {shown * 10 + 25} 100"
			class="h-48 w-full"
			role="img"
			aria-label="The ramp: a warm-up, then a step up of {RAMP.stepWatts} W every minute"
		>
			<rect
				x="0"
				y="70"
				width="24"
				height="30"
				rx="1.5"
				style="fill: var(--color-z1)"
			/>
			{#each steps as w, i (i)}
				<rect
					x={25 + i * 10}
					y={100 - (w / top) * 90}
					width="9"
					height={(w / top) * 90}
					rx="1.5"
					style="fill: var(--color-z{Math.min(7, 2 + Math.floor(i / 2))})"
				/>
			{/each}
		</svg>
		<figcaption
			class="text-muted mt-3 flex flex-wrap justify-between gap-2 text-sm"
		>
			<span>{RAMP.warmupSeconds / 60} min warm-up</span>
			<span class="num">{RAMP.startWatts} W, +{RAMP.stepWatts} W a minute…</span
			>
			<span>…until you cannot hold it</span>
		</figcaption>
	</figure>
</section>

<section
	class="mx-auto mt-24 grid w-full max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.1fr]"
>
	<div>
		<SectionHead
			eyebrow="How it works"
			title="The trainer does the pacing. You do the suffering."
		/>
		<ol
			class="text-muted mt-6 flex list-decimal flex-col gap-3 pl-5 leading-relaxed"
		>
			<li>Pair your smart trainer in Chrome or Edge — no install.</li>
			<li>
				Warm up for {RAMP.warmupSeconds / 60} minutes. The trainer holds an easy effort
				in ERG mode.
			</li>
			<li>
				The ramp starts at {RAMP.startWatts} W and adds {RAMP.stepWatts} W every minute.
				Keep your cadence up; the trainer sets the watts.
			</li>
			<li>
				When you can no longer hold the step, the test sees your power fall and
				stops by itself.
			</li>
			<li>
				Your FTP is {RAMP.ftpFraction * 100} % of your best rolling minute — the last
				full minute you held, not a step boundary.
			</li>
		</ol>
	</div>
	<div id="calculator" class="scroll-mt-24">
		<SectionHead
			eyebrow="Already have a number?"
			title="FTP and zones calculator"
		/>
		<div class="mt-6">
			<FtpCalculator />
		</div>
	</div>
</section>

<section class="mx-auto mt-24 w-full max-w-3xl px-4 sm:px-6">
	<SectionHead title="Then ride it with your crew" />
	<p class="text-muted mt-4 leading-relaxed">
		FTP is the number every WattRoom workout is written against. Once yours is
		set, you can ride the same workout as friends who are much faster or much
		slower than you — each trainer holds its own rider’s share — in a voice
		channel, talking the whole way. That is
		<a href="/group-workouts" class="hover:text-ink underline"
			>what WattRoom is for</a
		>.
	</p>
</section>

<div class="mt-24">
	<Faq items={faq} />
</div>

<CtaBand title="Know your number. Then bring your crew." />
