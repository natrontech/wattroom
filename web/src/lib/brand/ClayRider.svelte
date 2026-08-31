<script lang="ts">
	// A claymation-style cyclist for the landing's fake camera feeds: chunky
	// rounded shapes, scissoring legs, spinning spokes, a little saddle bob.
	// Pure SVG + CSS — no assets, no deps. Reduced motion gets the still pose.
	let {
		hue = 205,
		speed = 1,
		flip = false,
	}: { hue?: number; speed?: number; flip?: boolean } = $props();

	const jersey = `hsl(${hue} 62% 56%)`;
	const jerseyDark = `hsl(${hue} 48% 36%)`;
	const skin = 'hsl(28 55% 66%)';
	const helmet = `hsl(${hue + 150} 70% 60%)`;
	const frame = `hsl(${hue + 40} 28% 24%)`;
	const cycle = 0.9 / speed;
</script>

<svg
	viewBox="0 0 100 72"
	class="absolute inset-0 m-auto h-[72%] w-auto {flip ? '-scale-x-100' : ''}"
	style="--cycle: {cycle}s"
	aria-hidden="true"
>
	<g class="bob">
		<!-- wheels -->
		{#each [28, 72] as cx (cx)}
			<g class="wheel" style="transform-origin: {cx}px 52px">
				<line x1={cx - 9.6} y1="52" x2={cx + 9.6} y2="52" class="spoke" />
				<line x1={cx - 4.8} y1="43.7" x2={cx + 4.8} y2="60.3" class="spoke" />
				<line x1={cx - 4.8} y1="60.3" x2={cx + 4.8} y2="43.7" class="spoke" />
			</g>
			<circle
				{cx}
				cy="52"
				r="12"
				fill="none"
				stroke="#191029"
				stroke-width="3.5"
			/>
			<circle
				{cx}
				cy="52"
				r="9.6"
				fill="none"
				stroke="rgba(255,255,255,0.22)"
				stroke-width="1"
			/>
		{/each}

		<!-- frame, saddle, handlebar -->
		<path
			d="M28 52 L39 27 M28 52 L46 49 L64 26 L72 52 M39 27 L46 49"
			stroke={frame}
			stroke-width="3"
			stroke-linecap="round"
			fill="none"
		/>
		<path
			d="M34.5 26.5 h9"
			stroke="#191029"
			stroke-width="3.5"
			stroke-linecap="round"
		/>
		<path
			d="M64 26 q4.5 -1 4.5 3"
			stroke="#191029"
			stroke-width="2.5"
			stroke-linecap="round"
			fill="none"
		/>
		<circle cx="46" cy="49" r="2.4" fill="#191029" />

		<!-- back leg -->
		<g class="leg leg-b">
			<path
				d="M40.5 28.5 Q43 39 45 44.5"
				stroke={jerseyDark}
				stroke-width="5.5"
				stroke-linecap="round"
				fill="none"
			/>
			<circle cx="45" cy="44.5" r="2.4" fill={jerseyDark} />
		</g>

		<!-- torso + arm -->
		<path
			d="M40 28.5 L57 16"
			stroke={jersey}
			stroke-width="9"
			stroke-linecap="round"
		/>
		<path
			d="M56 16.5 L65 25.5"
			stroke={skin}
			stroke-width="4"
			stroke-linecap="round"
		/>

		<!-- front leg -->
		<g class="leg leg-a">
			<path
				d="M40.5 28.5 Q46 39 48.5 49.5"
				stroke={jersey}
				stroke-width="5.5"
				stroke-linecap="round"
				fill="none"
			/>
			<circle cx="48.5" cy="49.5" r="2.6" fill={jersey} />
		</g>

		<!-- head -->
		<circle cx="63.5" cy="9.5" r="5.5" fill={skin} />
		<ellipse
			cx="63"
			cy="6.2"
			rx="6.4"
			ry="4"
			fill={helmet}
			transform="rotate(-8 63 6.2)"
		/>
		<circle cx="66.5" cy="9" r="0.9" fill="#191029" />
	</g>
</svg>

<style>
	.wheel {
		animation: spin var(--cycle) linear infinite;
	}
	.spoke {
		stroke: rgba(255, 255, 255, 0.3);
		stroke-width: 1.2;
	}
	.leg {
		transform-origin: 40.5px 28.5px;
	}
	.leg-a {
		animation: pedal-a var(--cycle) ease-in-out infinite;
	}
	.leg-b {
		animation: pedal-b var(--cycle) ease-in-out infinite;
	}
	.bob {
		animation: bob var(--cycle) ease-in-out infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@keyframes pedal-a {
		0%,
		100% {
			transform: rotate(-13deg);
		}
		50% {
			transform: rotate(14deg);
		}
	}
	@keyframes pedal-b {
		0%,
		100% {
			transform: rotate(14deg);
		}
		50% {
			transform: rotate(-13deg);
		}
	}
	@keyframes bob {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(1.3px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.wheel,
		.leg-a,
		.leg-b,
		.bob {
			animation: none;
		}
	}
</style>
