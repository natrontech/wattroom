<script lang="ts">
	import Mark, { type MarkKind } from './Mark.svelte';

	const marks: { kind: MarkKind; name: string; idea: string }[] = [
		{
			kind: 'bars',
			name: 'Equalizer W',
			idea: 'Bar heights trace a W. The interval graph is the letter.',
		},
		{
			kind: 'reflect',
			name: 'Equalizer horizon',
			idea: 'Same bars standing on the horizon, neon puddle beneath.',
		},
		{
			kind: 'sundisc',
			name: 'Sunset equalizer',
			idea: 'Bars in the foreground, sun setting behind them.',
		},
		{
			kind: 'ring',
			name: 'Room ring',
			idea: 'A room seen from above — every spoke a rider, one of them you.',
		},
		{
			kind: 'framed',
			name: 'Framed bars',
			idea: 'Watts inside a room. Chunkiest, best app-icon silhouette.',
		},
	];

	const typeDirections = [
		{
			name: 'A — Orbitron',
			display: "'Orbitron', sans-serif",
			body: "'Barlow', sans-serif",
			note: 'Retro-futurist wordmark, sober UI underneath. The most 1984-poster of the four.',
		},
		{
			name: 'B — Chakra Petch',
			display: "'Chakra Petch', sans-serif",
			body: "'Barlow', sans-serif",
			note: 'Angled cuts, arcade cabinet. Synthwave without going full chrome.',
		},
		{
			name: 'C — Space Grotesk',
			display: "'Space Grotesk Variable', sans-serif",
			body: "'Space Grotesk Variable', sans-serif",
			note: 'One family everywhere. Lets the palette carry the era so the type never dates.',
		},
		{
			name: 'D — Barlow Condensed',
			display: "'Barlow Condensed', sans-serif",
			body: "'Barlow', sans-serif",
			note: 'Broadcast sport. Condensed numerals win at across-the-room sizes.',
		},
	];

	const metrics = [
		{ label: 'watts', value: '312' },
		{ label: 'rpm', value: '94' },
		{ label: 'bpm', value: '161' },
		{ label: 'elapsed', value: '24:07' },
	];

	let chosen = $state<MarkKind>('bars');
</script>

<main class="mx-auto max-w-5xl px-6 py-12">
	<h1 class="text-3xl font-semibold tracking-tight">Brand</h1>
	<p class="text-muted mt-2 max-w-2xl text-sm">
		Switch palettes in the nav — every mark, wordmark and number below recolours
		live. Pick one palette, one mark, one type direction.
	</p>

	<!-- Marks -->
	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">Marks</h2>
	<div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each marks as mark (mark.kind)}
			<button
				type="button"
				onclick={() => (chosen = mark.kind)}
				class="rounded-lg border p-5 text-left transition-colors {chosen ===
				mark.kind
					? 'bg-surface-raised border-white/40'
					: 'border-muted/15 hover:border-muted/40'}"
			>
				<div class="flex items-center gap-5">
					<Mark kind={mark.kind} size={64} />
					<div class="rounded bg-white p-2 text-black">
						<Mark kind={mark.kind} size={40} />
					</div>
					<div class="flex items-end gap-2">
						<Mark kind={mark.kind} size={24} />
						<Mark kind={mark.kind} size={16} />
					</div>
				</div>
				<p class="mt-4 text-sm font-medium">{mark.name}</p>
				<p class="text-muted mt-0.5 text-xs">{mark.idea}</p>
			</button>
		{/each}
	</div>

	<!-- The mark as a live instrument -->
	<h2 class="text-muted mt-14 text-xs tracking-[0.2em] uppercase">
		The mark, alive
	</h2>
	<p class="text-muted mt-2 max-w-2xl text-sm">
		An equalizer is the one mark shape that can be driven by data. Idle it sits
		still; while a session is running the bars move — in the nav, in the tab, on
		the TV. The logo becomes the quietest possible “you are riding” indicator,
		and no other brand in this space has one.
	</p>
	<div class="mt-4 grid gap-3 sm:grid-cols-2">
		<div
			class="border-muted/15 bg-surface-raised flex items-center gap-5 rounded-lg border p-6"
		>
			<Mark kind={chosen} size={56} />
			<div>
				<p class="text-sm font-medium">Idle</p>
				<p class="text-muted mt-0.5 text-xs">No session running.</p>
			</div>
		</div>
		<div
			class="border-muted/15 bg-surface-raised flex items-center gap-5 rounded-lg border p-6"
		>
			<Mark kind={chosen} size={56} live />
			<div>
				<p class="text-sm font-medium">Riding</p>
				<p class="text-muted mt-0.5 text-xs">
					Placeholder loop here; the real one is driven by the 1 Hz tick.
				</p>
			</div>
		</div>
	</div>

	<!-- Favicon reality check -->
	<h2 class="text-muted mt-14 text-xs tracking-[0.2em] uppercase">
		Favicon check
	</h2>
	<div class="mt-4 grid gap-3 sm:grid-cols-2">
		<div class="border-muted/15 bg-surface-raised rounded-lg border p-5">
			<div class="flex items-center gap-2 rounded-t-md bg-[#2b2b31] px-3 py-2">
				<Mark kind={chosen} size={16} />
				<span class="text-xs text-white/80">WattRoom — Sweet Spot 2×20</span>
			</div>
			<p class="text-muted mt-3 text-xs">Dark browser chrome.</p>
		</div>
		<div class="border-muted/15 bg-surface-raised rounded-lg border p-5">
			<div class="flex items-center gap-2 rounded-t-md bg-[#dedee3] px-3 py-2">
				<Mark kind={chosen} size={16} />
				<span class="text-xs text-black/80">WattRoom — Sweet Spot 2×20</span>
			</div>
			<p class="text-muted mt-3 text-xs">
				Light chrome — where thin strokes disappear.
			</p>
		</div>
	</div>

	<!-- Type directions, each carrying the selected mark -->
	<h2 class="text-muted mt-14 text-xs tracking-[0.2em] uppercase">
		Type directions
	</h2>
	<div class="mt-4 grid gap-4 lg:grid-cols-2">
		{#each typeDirections as type (type.name)}
			<section
				class="border-muted/15 bg-surface-raised relative overflow-hidden rounded-lg border"
			>
				<div
					class="bg-gridlines pointer-events-none absolute inset-x-0 bottom-0 h-24 opacity-40"
				></div>
				<div class="relative p-6">
					<p class="text-muted text-xs">{type.name}</p>

					<div class="mt-5 flex items-center gap-3">
						<Mark kind={chosen} size={34} />
						<span
							class="text-2xl font-bold tracking-tight"
							style="font-family: {type.display}">WattRoom</span
						>
					</div>

					<div class="mt-8 flex items-baseline gap-2">
						<span
							class="text-watt glow-text-strong text-7xl leading-none font-bold tabular-nums"
							style="font-family: {type.display}">312</span
						>
						<span class="text-muted text-xl" style="font-family: {type.body}"
							>W</span
						>
					</div>

					<div class="mt-6 grid grid-cols-4 gap-2">
						{#each metrics as metric (metric.label)}
							<div>
								<div
									class="text-xl font-semibold tabular-nums"
									style="font-family: {type.display}"
								>
									{metric.value}
								</div>
								<div class="text-muted text-[10px] tracking-wider uppercase">
									{metric.label}
								</div>
							</div>
						{/each}
					</div>

					<p class="text-muted mt-6 text-sm" style="font-family: {type.body}">
						Sweet Spot 2×20 · your coach starts the session in 30 seconds.
					</p>
					<p class="text-muted/70 mt-4 text-xs">{type.note}</p>
				</div>
			</section>
		{/each}
	</div>

	<!-- Wordmark treatments -->
	<h2 class="text-muted mt-14 text-xs tracking-[0.2em] uppercase">
		Wordmark treatments
	</h2>
	<p class="text-muted mt-2 max-w-2xl text-sm">
		The live hue marks live data, so spending it on a wordmark costs signal. A
		gradient or the secondary neon keeps the logo loud without burning the
		accent.
	</p>
	<div class="mt-4 grid gap-3 sm:grid-cols-3">
		<div
			class="border-muted/15 bg-surface-raised flex items-center gap-3 rounded-lg border p-6"
		>
			<Mark kind={chosen} size={34} />
			<span class="text-2xl font-bold tracking-tight">WattRoom</span>
		</div>
		<div
			class="border-muted/15 bg-surface-raised flex items-center gap-3 rounded-lg border p-6"
		>
			<Mark kind={chosen} size={34} />
			<span
				class="to-neon bg-gradient-to-b from-white bg-clip-text text-2xl font-bold tracking-tight text-transparent"
				>WattRoom</span
			>
		</div>
		<div
			class="border-muted/15 bg-surface-raised flex items-center gap-3 rounded-lg border p-6"
		>
			<Mark kind={chosen} size={34} />
			<span class="text-2xl font-bold tracking-tight"
				>Watt<span class="text-watt glow-text">Room</span></span
			>
		</div>
	</div>
</main>
