<script module lang="ts">
	export type MarkKind = 'bars' | 'trace' | 'frame' | 'ring' | 'bolt';
</script>

<script lang="ts">
	let { kind, size = 64 }: { kind: MarkKind; size?: number } = $props();

	// Bar heights trace a W valley: the interval graph is the letter.
	const bars = [
		{ x: 2, h: 46 },
		{ x: 15, h: 20 },
		{ x: 28, h: 34 },
		{ x: 41, h: 20 },
		{ x: 54, h: 46 },
	];

	// Riders around a room, one of them live.
	const riders = Array.from({ length: 8 }, (_, i) => {
		const angle = -Math.PI / 2 + (i * Math.PI) / 4;
		return { cx: 32 + 22 * Math.cos(angle), cy: 32 + 22 * Math.sin(angle) };
	});
</script>

<svg
	viewBox="0 0 64 64"
	width={size}
	height={size}
	fill="none"
	aria-hidden="true"
>
	{#if kind === 'bars'}
		{#each bars as bar, i (bar.x)}
			<rect
				x={bar.x}
				y={58 - bar.h}
				width="8"
				height={bar.h}
				rx="4"
				fill="currentColor"
				class={i === bars.length - 1 ? 'text-watt glow-stroke' : ''}
			/>
		{/each}
	{:else if kind === 'trace'}
		<path
			d="M5 18 L20 51 L32 29 L44 51 L59 18"
			stroke="currentColor"
			stroke-width="7"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
		<circle
			cx="59"
			cy="18"
			r="6"
			fill="currentColor"
			class="text-watt glow-stroke"
		/>
	{:else if kind === 'frame'}
		<rect
			x="4"
			y="4"
			width="56"
			height="56"
			rx="16"
			stroke="currentColor"
			stroke-width="5"
			opacity="0.55"
		/>
		<path
			d="M17 23 L26 43 L32 32 L38 43 L47 23"
			stroke="currentColor"
			stroke-width="5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="text-watt glow-stroke"
		/>
	{:else if kind === 'ring'}
		{#each riders as rider, i (i)}
			<circle
				cx={rider.cx}
				cy={rider.cy}
				r={i === 0 ? 6 : 5}
				fill="currentColor"
				class={i === 0 ? 'text-watt glow-stroke' : 'opacity-45'}
			/>
		{/each}
	{:else if kind === 'bolt'}
		<rect
			x="4"
			y="4"
			width="56"
			height="56"
			rx="16"
			stroke="currentColor"
			stroke-width="5"
			opacity="0.55"
		/>
		<path
			d="M36 12 L20 35 L30 35 L27 52 L44 29 L34 29 Z"
			fill="currentColor"
			class="text-watt glow-stroke"
		/>
	{/if}
</svg>
