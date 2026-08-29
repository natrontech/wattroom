<script module lang="ts">
	export interface Medal {
		/** Names and criteria are fixed in docs/SPEC.md — never invent new ones here. */
		name: string;
		criterion: string;
		rider: string;
		value: string;
		unit: string;
		kj: number;
		xp: number;
	}
</script>

<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';

	let { medal, roomName = 'WattRoom' }: { medal: Medal; roomName?: string } =
		$props();

	const uid = $props.id();
</script>

<!--
	Screenshot-first: 4:5, the shape that survives a group chat without being cropped.
	The sun-and-grid scene lives here rather than on a working screen — on a poster it
	is decoration, which is exactly what it is good at.
-->
<figure
	class="bg-surface relative aspect-[4/5] w-full max-w-[400px] overflow-hidden rounded-xl ring-1 ring-white/10"
>
	<svg
		viewBox="0 0 400 500"
		class="absolute inset-0 h-full w-full"
		aria-hidden="true"
	>
		<defs>
			<linearGradient id="{uid}-sun" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="var(--color-watt)" />
				<stop offset="100%" stop-color="var(--color-neon)" />
			</linearGradient>
			<mask id="{uid}-slices">
				<rect x="0" y="0" width="400" height="500" fill="white" />
				<rect x="0" y="286" width="400" height="7" fill="black" />
				<rect x="0" y="304" width="400" height="10" fill="black" />
				<rect x="0" y="328" width="400" height="14" fill="black" />
			</mask>
		</defs>
		<circle
			cx="200"
			cy="270"
			r="105"
			fill="url(#{uid}-sun)"
			mask="url(#{uid}-slices)"
			opacity="0.4"
		/>
		<g class="text-neon" opacity="0.35">
			{#each [-160, -60, 40, 140, 240, 340, 440, 540] as x (x)}
				<line
					x1={x}
					y1="500"
					x2="200"
					y2="352"
					stroke="currentColor"
					stroke-width="1"
				/>
			{/each}
			{#each [358, 372, 392, 420, 458, 500] as y (y)}
				<line
					x1="0"
					y1={y}
					x2="400"
					y2={y}
					stroke="currentColor"
					stroke-width="1"
				/>
			{/each}
		</g>
		<line
			x1="0"
			y1="352"
			x2="400"
			y2="352"
			stroke="var(--color-neon)"
			stroke-width="2"
		/>
	</svg>

	<div class="relative flex h-full flex-col p-7">
		<div class="flex items-center gap-2">
			<Logo size={22} />
			<span class="font-display text-sm font-bold">WattRoom</span>
		</div>

		<div class="mt-10">
			<p class="text-muted text-[11px] tracking-[0.25em] uppercase">
				{medal.criterion}
			</p>
			<h2
				class="font-display mt-1 text-4xl leading-none font-bold tracking-tight"
			>
				{medal.name}
			</h2>
		</div>

		<div class="mt-8 flex items-baseline gap-2">
			<span
				class="text-watt glow-text-strong font-display text-7xl leading-none font-bold tabular-nums"
				>{medal.value}</span
			>
			<span class="text-muted text-lg">{medal.unit}</span>
		</div>

		<p class="font-display mt-6 text-2xl font-bold">{medal.rider}</p>

		<div class="mt-auto">
			<p class="text-sm">{roomName}</p>
			<p class="text-muted text-xs">Sweet Spot 2×20 · 25 Aug 2026</p>
			<p class="text-muted mt-3 font-mono text-[11px] tabular-nums">
				{medal.kj} kJ · {medal.xp} XP
			</p>
		</div>
	</div>
</figure>
