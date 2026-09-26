<script lang="ts">
	import Zap from '@lucide/svelte/icons/zap';
	import { reducedMotion } from '$lib/motion';
	import { bestFive, follow, SPRINT, target } from './sprint';

	// "Try the sprint" (#2995): Sprint Roulette's moment, played with a thumb.
	// Tap the pad (or Space) as fast as you can, or hold it down — the no-mash
	// way to play. Silent on purpose: the klaxon is a flash, never a sound on
	// a page nobody asked to make noise. The rivals are made up.
	const field = [
		{ name: 'Mara', watts: 1190 },
		{ name: 'Luca', watts: 980 },
		{ name: 'Ines', watts: 720 },
	];

	type Phase = 'idle' | 'armed' | 'sprint' | 'done';
	let phase = $state<Phase>('idle');
	let power = $state(0);
	let left = $state(0);
	let score = $state(0);
	let pad = $state<HTMLButtonElement>();

	let taps: number[] = [];
	let pressedSince: number | null = null;
	let samples: number[] = [];
	let frame = 0;

	const podium = $derived(
		[...field, { name: 'You', watts: score, you: true }].sort(
			(a, b) => b.watts - a.watts,
		),
	);
	const place = $derived(podium.findIndex((r) => 'you' in r) + 1);

	function arm() {
		cancelAnimationFrame(frame);
		taps = [];
		samples = [];
		pressedSince = null;
		power = 0;
		score = 0;
		phase = 'armed';
		const armedAt = performance.now();
		const countdown = () => {
			const now = performance.now();
			left = Math.max(0, SPRINT.warning - (now - armedAt));
			if (left > 0) frame = requestAnimationFrame(countdown);
			else go();
		};
		frame = requestAnimationFrame(countdown);
	}

	function go() {
		phase = 'sprint';
		const start = performance.now();
		let last = start;
		let sampled = start;
		const tick = () => {
			const now = performance.now();
			power = follow(power, target(taps, now, pressedSince), now - last);
			last = now;
			while (now - sampled >= SPRINT.sampleEvery) {
				samples.push(power);
				sampled += SPRINT.sampleEvery;
			}
			left = Math.max(0, SPRINT.length - (now - start));
			if (left > 0) frame = requestAnimationFrame(tick);
			else finish();
		};
		frame = requestAnimationFrame(tick);
	}

	function finish() {
		score = bestFive(samples);
		power = 0;
		phase = 'done';
	}

	function press() {
		if (phase !== 'sprint' && phase !== 'armed') return;
		const now = performance.now();
		if (phase === 'sprint') taps.push(now);
		pressedSince ??= now;
	}

	function release() {
		pressedSince = null;
	}

	// Arming is the rider's own move, so the pad takes focus and Space works
	// at once (ux.md: focus follows deliberate navigation).
	$effect(() => {
		if (phase === 'armed') pad?.focus();
	});
	$effect(() => () => cancelAnimationFrame(frame));
</script>

<div
	class="shell-card bg-surface-raised/60 relative w-full overflow-hidden p-5 backdrop-blur sm:p-6 {phase ===
		'armed' && !reducedMotion()
		? 'klaxon'
		: ''}"
>
	<div class="grid items-center gap-6 sm:grid-cols-[1fr_auto]">
		<div aria-live="polite">
			{#if phase === 'idle'}
				<p class="font-display text-xl font-bold">
					Ten seconds. Everything you have.
				</p>
				<p class="text-muted mt-1 text-sm">
					Arm it, wait for the klaxon, then tap the pad as fast as you can — or
					press Space, or just hold it down. Your best five seconds count.
				</p>
			{:else if phase === 'armed'}
				<p class="font-display text-xl font-bold">Klaxon! Sprint in…</p>
				<p class="num text-watt glow-text-strong text-6xl font-bold">
					{Math.ceil(left / 1000)}
				</p>
			{:else if phase === 'sprint'}
				<p class="eyebrow">Sprinting · {(left / 1000).toFixed(1)} s left</p>
				<p class="num text-watt glow-text-strong text-6xl font-bold">
					{Math.round(power)}<span class="text-muted ml-1 text-2xl">W</span>
				</p>
				<div class="bg-ink/5 mt-3 h-3 overflow-hidden rounded-full">
					<div
						class="bg-watt glow-stroke h-full rounded-full"
						style="width: {(power / SPRINT.max) * 100}%"
					></div>
				</div>
			{:else}
				<p class="eyebrow">Your best five seconds</p>
				<p class="num text-watt glow-text-strong text-6xl font-bold">
					{score}<span class="text-muted ml-1 text-2xl">W</span>
				</p>
				<ol class="mt-3 flex flex-col gap-1 text-sm">
					{#each podium as r, i (i)}
						<li
							class="flex justify-between gap-4 {'you' in r
								? 'text-ink font-semibold'
								: 'text-muted'}"
						>
							<span>{i + 1}. {r.name}</span>
							<span class="num">{r.watts} W</span>
						</li>
					{/each}
				</ol>
				<p class="text-muted mt-3 text-sm">
					{place === 1
						? 'Top of the podium. Now do it on a trainer, with your crew yelling.'
						: 'On a trainer, with your crew yelling, you would have had them.'}
				</p>
			{/if}
		</div>

		<div class="flex flex-col items-center gap-3">
			{#if phase === 'idle' || phase === 'done'}
				<button class="btn btn-primary btn-lg w-44" onclick={arm}>
					<Zap size={18} />
					{phase === 'idle' ? 'Arm the sprint' : 'Again'}
				</button>
			{:else}
				<!-- The pad: a button, so Space and Enter reach it and a
				     screen reader names it. Its own keydown takes Space before
				     the browser would scroll the page or fire a click on keyup. -->
				<button
					bind:this={pad}
					class="border-watt/60 bg-watt/10 active:bg-watt/25 grid h-40 w-40 touch-none place-items-center rounded-full border-2 select-none"
					aria-label="Sprint pad: tap, press Space, or hold"
					onpointerdown={press}
					onpointerup={release}
					onpointercancel={release}
					onpointerleave={release}
					onkeydown={(e) => {
						if (e.key !== ' ' && e.key !== 'Enter') return;
						e.preventDefault();
						if (!e.repeat) press();
					}}
					onkeyup={(e) => {
						if (e.key === ' ' || e.key === 'Enter') release();
					}}
				>
					<span class="font-display text-lg font-bold">TAP</span>
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	/* The klaxon, seen rather than heard: the frame flashes in the watt
	   colour while the countdown runs. Reduced motion gets no class at all. */
	.klaxon {
		animation: klaxon 0.5s steps(2, jump-none) infinite;
	}
	@keyframes klaxon {
		from {
			border-color: var(--color-watt);
		}
		to {
			border-color: transparent;
		}
	}
</style>
