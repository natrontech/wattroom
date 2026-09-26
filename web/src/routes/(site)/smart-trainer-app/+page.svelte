<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';
	import X from '@lucide/svelte/icons/x';
	import CtaBand from '$lib/site/CtaBand.svelte';
	import Faq from '$lib/site/Faq.svelte';
	import PageHero from '$lib/site/PageHero.svelte';
	import Screen from '$lib/site/Screen.svelte';
	import SectionHead from '$lib/site/SectionHead.svelte';
	import Seo from '$lib/site/Seo.svelte';
	import { SMART_TRAINER_APP } from '$lib/site/seo';

	// "smart trainer app free", "erg mode app", "zwift chromebook" (#2995).
	// The browser matrix is ADR-0004's decision, said honestly: where Web
	// Bluetooth is missing, it is missing.
	const where: {
		place: string;
		state: 'yes' | 'partly' | 'no';
		note: string;
	}[] = [
		{
			place: 'Chrome or Edge on Windows',
			state: 'yes',
			note: 'Full: trainer, sensors, voice.',
		},
		{
			place: 'Chrome or Edge on macOS',
			state: 'yes',
			note: 'Full: trainer, sensors, voice.',
		},
		{
			place: 'Chrome on Android',
			state: 'yes',
			note: 'Full, on a phone or a tablet.',
		},
		{
			place: 'The desktop app',
			state: 'yes',
			note: 'macOS, Windows and Linux; its own window, and a floating HUD.',
		},
		{
			place: 'Chrome on a Chromebook',
			state: 'partly',
			note: 'Chrome ships Web Bluetooth there; tell us how your trainer does.',
		},
		{
			place: 'Chrome on Linux',
			state: 'partly',
			note: 'Web Bluetooth is still behind a flag in Chrome on Linux.',
		},
		{
			place: 'iPhone and iPad',
			state: 'no',
			note: 'No browser on iOS can reach a trainer. Join the crew and the call; ride from a laptop.',
		},
		{
			place: 'Firefox and Safari',
			state: 'no',
			note: 'Neither implements Web Bluetooth.',
		},
	];

	const pairs = [
		{
			title: 'Smart trainers (FTMS)',
			body: 'Any trainer that speaks Bluetooth FTMS, which most current smart trainers do. ERG mode holds your watts; a sprint or a free ride switches it to a grade you push against.',
		},
		{
			title: 'Heart-rate straps',
			body: 'Any Bluetooth heart-rate strap or armband. Your heart rate shows on your tile and in your ride.',
		},
		{
			title: 'Power meters and cadence sensors',
			body: 'Pedals, cranks and hub sensors over Bluetooth, when you would rather trust your own power than the trainer’s.',
		},
	];

	const faq = [
		{
			q: 'Do I have to install anything?',
			a: 'No. Chrome and Edge talk to Bluetooth devices themselves (Web Bluetooth), so you open the page, click Pair, and pick your trainer. A desktop app exists if you prefer a window of its own.',
		},
		{
			q: 'Does my trainer work?',
			a: 'If other apps control it over Bluetooth FTMS, very likely. Older Wahoo KICKRs that predate FTMS use Wahoo’s own protocol, which WattRoom does not speak yet. ANT+ is not supported in the browser.',
		},
		{
			q: 'What is ERG mode?',
			a: 'The trainer sets the resistance so you ride at a given wattage, whatever your cadence. A workout’s target becomes the trainer’s job, and yours is to keep pedalling.',
		},
		{
			q: 'What if my cadence collapses in ERG?',
			a: 'WattRoom watches for the spiral — cadence falling while ERG raises resistance to hold the watts — and releases the target for a moment so you can spin back up.',
		},
		{
			q: 'Can my phone be a second screen?',
			a: 'Yes. Open the crew on your phone and it follows the session — everyone’s numbers, the chat and the voice channel — while the laptop runs the trainer.',
		},
	];
</script>

<Seo page={SMART_TRAINER_APP} />

<PageHero
	eyebrow="A free smart trainer app"
	title="Your smart trainer, straight from the browser"
	lede="Pair an FTMS smart trainer from Chrome or Edge and ride structured workouts in ERG mode — alone, or with your crew in a voice channel. No install, no subscription, and your heart-rate strap and power meter pair the same way."
/>

<section class="mx-auto w-full max-w-5xl px-4 sm:px-6">
	<Screen
		name="workout-editor"
		eager
		alt="WattRoom’s workout editor: an interval chart coloured by power zone"
		caption="Pick a workout, pair the trainer, ride. Every target scales to your FTP."
	/>
</section>

<section class="mx-auto mt-24 w-full max-w-6xl px-4 sm:px-6">
	<SectionHead
		eyebrow="What pairs"
		title="Trainer, heart rate, power, cadence"
	/>
	<div class="mt-8 grid gap-4 md:grid-cols-3">
		{#each pairs as p (p.title)}
			<div class="panel panel-xl">
				<h3 class="font-display text-lg font-bold">{p.title}</h3>
				<p class="text-muted mt-2 text-sm leading-relaxed">{p.body}</p>
			</div>
		{/each}
	</div>
</section>

<section class="mx-auto mt-24 w-full max-w-4xl px-4 sm:px-6">
	<SectionHead
		eyebrow="Where it runs"
		title="Chrome or Edge, on a laptop or an Android phone"
		lede="Web Bluetooth is what lets a web page reach your trainer, and not every browser has it. Here is exactly where WattRoom can ride."
	/>
	<ul class="panel panel-flush divide-edge mt-8 divide-y">
		{#each where as w (w.place)}
			<li class="flex items-start gap-3 px-4 py-3">
				<span
					class="mt-0.5 shrink-0"
					aria-label={w.state === 'yes'
						? 'Works'
						: w.state === 'partly'
							? 'Partly'
							: 'No trainer'}
				>
					{#if w.state === 'yes'}
						<Check size={18} class="text-neon" />
					{:else if w.state === 'partly'}
						<Minus size={18} class="text-muted" />
					{:else}
						<X size={18} class="text-muted" />
					{/if}
				</span>
				<span>
					<span class="font-semibold">{w.place}</span>
					<span class="text-muted block text-sm">{w.note}</span>
				</span>
			</li>
		{/each}
	</ul>
</section>

<div class="mt-24">
	<Faq items={faq} />
</div>

<CtaBand title="Pair it and ride." />
