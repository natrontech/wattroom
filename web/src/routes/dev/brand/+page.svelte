<script lang="ts">
	import Mark, { type MarkKind } from './Mark.svelte';

	const marks: { kind: MarkKind; name: string; idea: string }[] = [
		{
			kind: 'bars',
			name: 'Bar W',
			idea: 'The interval graph is the letter. Last bar is live.',
		},
		{
			kind: 'trace',
			name: 'Trace W',
			idea: 'A power trace drawing a W, cursor still riding.',
		},
		{
			kind: 'frame',
			name: 'Framed W',
			idea: 'The frame is the room, the W is what happens in it.',
		},
		{
			kind: 'ring',
			name: 'Rider ring',
			idea: 'Eight riders around a room — or a chainring. One lit.',
		},
		{
			kind: 'bolt',
			name: 'Bolt room',
			idea: 'Watts in a room, read at a glance. Least specific.',
		},
	];

	const typeDirections = [
		{
			name: 'A — Space Grotesk',
			display: "'Space Grotesk Variable', sans-serif",
			body: "'Space Grotesk Variable', sans-serif",
			note: 'One family everywhere. Techy but restrained; slightly quirky numerals.',
		},
		{
			name: 'B — Barlow Condensed',
			display: "'Barlow Condensed', sans-serif",
			body: "'Barlow', sans-serif",
			note: 'Broadcast/sport. Condensed numerals fit huge across-the-room sizes.',
		},
		{
			name: 'C — Chakra Petch',
			display: "'Chakra Petch', sans-serif",
			body: "'Barlow', sans-serif",
			note: 'Full synthwave — angled cuts, arcade feel. Closest to the brief, riskiest.',
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
		Pick one mark and one type direction. Everything downstream — favicon,
		social preview, TV splash, medal cards — falls out of that choice.
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

	<!-- Type directions, each carrying the selected mark -->
	<h2 class="text-muted mt-14 text-xs tracking-[0.2em] uppercase">
		Type directions
	</h2>
	<div class="mt-4 grid gap-4 lg:grid-cols-3">
		{#each typeDirections as type (type.name)}
			<section class="border-muted/15 bg-surface-raised rounded-lg border p-6">
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
			</section>
		{/each}
	</div>

	<!-- The accent-in-chrome question -->
	<h2 class="text-muted mt-14 text-xs tracking-[0.2em] uppercase">
		Does the wordmark get the accent?
	</h2>
	<p class="text-muted mt-2 max-w-2xl text-sm">
		The restraint rule says watt-yellow marks live data, never chrome — and a
		wordmark is chrome. Either the logo is the one licensed exception, or the
		accent lives only inside the mark.
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
			<span class="text-2xl font-bold tracking-tight"
				>Watt<span class="text-muted">Room</span></span
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
