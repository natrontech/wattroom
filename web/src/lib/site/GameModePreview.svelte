<script lang="ts">
	// A game mode in one looping line (#2995): what the rider would see on the
	// session's chart, drawn as a toy. Watt is the live trace and the only
	// thing that glows (ADR-0005); zones colour the targets. CSS animation
	// only, and reduced motion gets the still frame.
	let { mode }: { mode: string } = $props();
</script>

<svg viewBox="0 0 120 48" class="h-full w-full" aria-hidden="true">
	{#if mode === 'sprint-roulette'}
		<line x1="0" y1="40" x2="120" y2="40" class="axis" />
		<rect x="70" y="4" width="10" height="40" rx="2" class="klaxon-flash" />
		<polyline
			points="0,34 30,33 60,34 72,34 74,8 80,6 84,33 120,34"
			class="trace draw"
		/>
	{:else if mode === 'points-race'}
		{#each [0, 1, 2, 3] as i (i)}
			<rect
				x={4 + i * 29}
				y="20"
				width="24"
				height="20"
				rx="2"
				style="fill: var(--color-z4)"
				class="block"
			/>
		{/each}
		<text x="18" y="14" class="pop" style="animation-delay: 0s">+5</text>
		<text x="49" y="14" class="pop" style="animation-delay: 0.8s">+3</text>
		<text x="78" y="14" class="pop" style="animation-delay: 1.6s">+2</text>
		<text x="107" y="14" class="pop" style="animation-delay: 2.4s">+1</text>
	{:else if mode === 'watt-golf'}
		<line x1="0" y1="18" x2="120" y2="18" class="target" />
		<line x1="96" y1="18" x2="96" y2="4" class="flag-pole" />
		<path d="M96 4 L108 8 L96 12 Z" style="fill: var(--color-z5)" />
		<polyline points="0,38 20,30 40,24 55,20" class="trace" />
		<polyline points="55,20 75,17 95,19" class="trace hidden-meter" />
		<text x="66" y="42" class="label">meter off</text>
	{:else if mode === 'backyard-ramp'}
		<path d="M0 40 H30 V32 H60 V24 H90 V16 H120" class="stairs" />
		<circle cx="112" cy="12" r="3" class="rider" />
		<circle cx="104" cy="12" r="3" class="rider" />
		<circle cx="96" cy="12" r="3" class="rider dropping" />
	{:else if mode === 'collective-ramp'}
		<path d="M0 40 H30 V33 H60 V26 H90 V19 H120" class="stairs" />
		<polyline
			points="0,36 30,35 45,29 60,30 75,22 90,23 105,15 120,16"
			class="trace draw"
		/>
		<circle cx="100" cy="9" r="2.5" class="rider" />
		<circle cx="108" cy="22" r="2.5" class="rider" />
		<circle cx="116" cy="13" r="2.5" class="rider" />
	{:else if mode === 'floor-is-lava'}
		<rect
			x="0"
			y="14"
			width="120"
			height="14"
			style="fill: var(--color-z3)"
			class="band"
		/>
		<rect
			x="0"
			y="40"
			width="120"
			height="8"
			style="fill: var(--color-z6)"
			class="lava"
		/>
		<polyline
			points="0,22 10,18 20,24 30,20 40,17 50,25 60,21 70,19 80,23 90,18 100,22 110,20 120,21"
			class="trace wiggle"
		/>
	{:else}
		{#each [0, 1, 2] as i (i)}
			<rect
				x={10 + i * 38}
				width="24"
				rx="2"
				class="relay"
				style="animation-delay: {i * -2}s; fill: var(--color-z5)"
			/>
		{/each}
	{/if}
</svg>

<style>
	svg * {
		vector-effect: non-scaling-stroke;
	}
	.axis,
	.target,
	.flag-pole {
		stroke: var(--color-muted-dim);
		stroke-width: 1;
		stroke-dasharray: 3 3;
		fill: none;
	}
	.flag-pole {
		stroke-dasharray: none;
	}
	.trace {
		stroke: var(--color-watt);
		stroke-width: 2;
		fill: none;
		stroke-linejoin: round;
		stroke-linecap: round;
		filter: drop-shadow(
			0 0 3px color-mix(in oklab, var(--color-watt) 60%, transparent)
		);
	}
	.stairs {
		stroke: var(--color-neon);
		stroke-width: 2;
		fill: none;
	}
	.rider {
		fill: var(--color-ink);
	}
	.label,
	.pop {
		font: 700 9px var(--font-display);
		fill: var(--color-ink);
	}
	.label {
		fill: var(--color-muted);
		font-weight: 400;
	}
	.band,
	.block {
		fill-opacity: 0.55;
	}
	.lava {
		fill-opacity: 0.8;
	}
	.klaxon-flash {
		fill: var(--color-watt);
		fill-opacity: 0;
	}

	@media (prefers-reduced-motion: no-preference) {
		.draw {
			stroke-dasharray: 260;
			animation: draw 3.2s ease-in-out infinite;
		}
		.klaxon-flash {
			animation: flash 3.2s steps(1) infinite;
		}
		.pop {
			opacity: 0;
			animation: pop 3.2s ease-out infinite;
		}
		.hidden-meter {
			animation: blink 2.4s ease-in-out infinite;
		}
		.dropping {
			animation: drop 3s ease-in infinite;
		}
		.wiggle {
			animation: wiggle 1.6s ease-in-out infinite alternate;
		}
		.lava {
			animation: lava 1.2s ease-in-out infinite alternate;
		}
		.relay {
			animation: relay 6s ease-in-out infinite;
		}
	}
	/* The relay's still frame: one rider on the front. */
	.relay {
		y: 24px;
		height: 16px;
	}
	.relay:first-child {
		y: 6px;
		height: 34px;
	}

	@keyframes draw {
		from {
			stroke-dashoffset: 260;
		}
		60%,
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes flash {
		0%,
		48% {
			fill-opacity: 0;
		}
		50%,
		54% {
			fill-opacity: 0.3;
		}
		56%,
		to {
			fill-opacity: 0;
		}
	}
	@keyframes pop {
		0%,
		10% {
			opacity: 0;
			transform: translateY(4px);
		}
		20%,
		70% {
			opacity: 1;
			transform: translateY(0);
		}
		to {
			opacity: 0;
		}
	}
	@keyframes blink {
		0%,
		30% {
			opacity: 1;
		}
		50%,
		to {
			opacity: 0;
		}
	}
	@keyframes drop {
		0%,
		40% {
			transform: translateY(0);
			opacity: 1;
		}
		to {
			transform: translateY(30px);
			opacity: 0;
		}
	}
	@keyframes wiggle {
		to {
			transform: translateY(3px);
		}
	}
	@keyframes lava {
		to {
			fill-opacity: 0.5;
		}
	}
	@keyframes relay {
		0%,
		28% {
			y: 6px;
			height: 34px;
		}
		33%,
		95% {
			y: 24px;
			height: 16px;
		}
		to {
			y: 6px;
			height: 34px;
		}
	}
</style>
