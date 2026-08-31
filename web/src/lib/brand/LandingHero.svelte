<script lang="ts">
	// The landing's signature (#111, ADR-0005 restraint rule): a live room in
	// miniature — three rider tiles over the session timeline, in the exact
	// visual language of the real room, so the page demos the product instead
	// of describing it. Pure SVG + CSS, no dependencies. Watts tick with one
	// tiny interval; reduced motion gets the finished picture, steady numbers.

	import ClayRider from '$lib/brand/ClayRider.svelte';
	import Logo from '$lib/brand/Logo.svelte';

	const uid = $props.id();

	// Only "you" glow — same rule as the real room's tiles.
	const riders = [
		{
			name: 'Mara',
			hue: 205,
			base: 231,
			pct: 68,
			zone: 'z3',
			cam: true,
			speaking: true,
			you: false,
		},
		{
			name: 'you',
			hue: 275,
			base: 297,
			pct: 92,
			zone: 'z5',
			cam: false,
			speaking: false,
			you: true,
		},
		{
			name: 'Ines',
			hue: 25,
			base: 176,
			pct: 54,
			zone: 'z2',
			cam: true,
			speaking: false,
			you: false,
		},
	];

	let watts = $state(riders.map((r) => r.base));
	$effect(() => {
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const tick = setInterval(() => {
			watts = riders.map(
				(r) => r.base + Math.round((Math.random() - 0.5) * 16),
			);
		}, 900);
		return () => clearInterval(tick);
	});

	// A sweet-spot shape, hand-placed for the silhouette — not a real workout,
	// so no product numbers involved.
	const blocks = [
		{ w: 10, h: 28, z: 1 },
		{ w: 8, h: 42, z: 2 },
		{ w: 14, h: 74, z: 4 },
		{ w: 6, h: 38, z: 2 },
		{ w: 14, h: 74, z: 4 },
		{ w: 6, h: 38, z: 2 },
		{ w: 10, h: 88, z: 5 },
		{ w: 4, h: 100, z: 7 },
		{ w: 12, h: 46, z: 3 },
		{ w: 16, h: 24, z: 1 },
	];
	const ZONE = ['', 'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7'];
	let at = 0;
	const rects = blocks.map((b) => {
		const r = { x: at, ...b };
		at += b.w;
		return r;
	});

	// The trace rides the top of the blocks with a little wobble baked in.
	const trace = rects
		.flatMap((r) => {
			const y = 100 - r.h;
			return [
				`${r.x + 1},${y + 3}`,
				`${r.x + r.w / 2},${y - 1}`,
				`${r.x + r.w - 1},${y + 2}`,
			];
		})
		.join(' ');
</script>

<div
	class="border-muted/20 bg-surface-raised/60 w-full rounded-xl border p-2.5 backdrop-blur sm:p-3"
>
	<div class="mb-2 flex items-center justify-between px-1">
		<span
			class="text-muted font-display text-[10px] font-semibold tracking-[0.2em] uppercase"
			>Tuesday crew · sweet spot</span
		>
		<span
			class="text-watt glow-text font-display flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase"
			><span class="live-dot h-1.5 w-1.5 rounded-full bg-current"
			></span>live</span
		>
	</div>

	<div class="grid grid-cols-3 gap-2">
		{#each riders as r, i (r.name)}
			<div
				class="bg-surface-raised relative aspect-video overflow-hidden rounded-lg ring-1 {r.speaking
					? 'ring-neon shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-neon)_35%,transparent)]'
					: 'ring-ink/10'}"
			>
				{#if r.cam}
					<!-- Stand-in for a camera feed, same gradient as the real tile —
					     with a clay cyclist grinding away in front of it. -->
					<div
						class="absolute inset-0"
						style="background:
							radial-gradient(120% 90% at 50% 15%, hsl({r.hue} 45% 42%), transparent 70%),
							linear-gradient(160deg, hsl({r.hue} 40% 22%), hsl({r.hue + 30} 35% 10%))"
					></div>
					<ClayRider hue={r.hue} speed={r.base / 240} flip={i > 0} />
				{:else}
					<div
						class="absolute inset-0"
						style="background: linear-gradient(160deg, hsl({r.hue} 30% 15%), hsl({r.hue +
							30} 25% 7%))"
					></div>
					<div class="absolute inset-0 grid place-items-center">
						<Logo size={34} live />
					</div>
				{/if}

				<div class="absolute top-1.5 left-2 flex items-center gap-1.5">
					<span class="text-ink text-[9px] font-medium drop-shadow sm:text-xs"
						>{r.name}</span
					>
					{#if r.speaking}
						<span class="bg-z4 h-1.5 w-1.5 rounded-full" title="in voice"
						></span>
					{/if}
				</div>

				<div class="absolute top-1.5 right-2 text-right">
					<span
						class="font-display text-xs font-bold sm:text-base {r.you
							? 'text-watt glow-text-strong'
							: 'text-ink'}">{watts[i]}</span
					><span class="text-ink/60 ml-0.5 text-[9px]">w</span>
				</div>

				<div class="absolute inset-x-0 bottom-0 h-1 bg-black/30">
					<div
						class="h-full"
						style="width: {r.pct}%; background: var(--color-{r.zone})"
					></div>
				</div>
			</div>
		{/each}
	</div>

	<div class="mt-2 h-14 sm:h-20">
		<svg
			viewBox="0 0 100 104"
			preserveAspectRatio="none"
			class="h-full w-full"
			aria-hidden="true"
		>
			<defs>
				<!-- The trace reveals left-to-right at constant x-speed, so its tip
				     always sits exactly on the sweeping now-line (a dash-offset draw
				     moves at path-length speed and drifts off it). -->
				<clipPath id="{uid}-reveal">
					<rect class="reveal" x="0" y="-2" width="100" height="108" />
				</clipPath>
			</defs>
			{#each rects as r (r.x)}
				<rect
					x={r.x + 0.4}
					y={100 - r.h}
					width={r.w - 0.8}
					height={r.h}
					rx="0.6"
					fill="var(--color-{ZONE[r.z]})"
					opacity="0.55"
				/>
			{/each}
			<polyline
				points={trace}
				fill="none"
				stroke="var(--color-watt)"
				stroke-width="1.1"
				stroke-linejoin="round"
				vector-effect="non-scaling-stroke"
				clip-path="url(#{uid}-reveal)"
				class="trace"
			/>
			<line
				x1="0"
				y1="0"
				x2="0"
				y2="104"
				stroke="white"
				stroke-width="0.4"
				opacity="0.6"
				class="now"
			/>
		</svg>
	</div>
</div>

<style>
	.trace {
		filter: drop-shadow(0 0 4px var(--color-watt));
	}
	.reveal {
		transform-origin: 0 0;
		animation: reveal 7s linear infinite;
	}
	.now {
		animation: sweep 7s linear infinite;
	}
	.live-dot {
		animation: blink 1.4s ease-in-out infinite;
	}
	@keyframes reveal {
		from {
			transform: scaleX(0);
		}
		to {
			transform: scaleX(1);
		}
	}
	@keyframes sweep {
		from {
			transform: translateX(0);
		}
		to {
			transform: translateX(100px);
		}
	}
	@keyframes blink {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.reveal {
			animation: none;
		}
		.now {
			display: none;
		}
		.live-dot {
			animation: none;
		}
	}
</style>
