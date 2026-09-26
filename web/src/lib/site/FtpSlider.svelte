<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { ZONE_NAMES, ZONE_VAR, zoneOf } from '$lib/components/zones';
	import { reducedMotion } from '$lib/motion';

	// The idea WattRoom rests on, in five seconds (#2995): one workout, and
	// every trainer holds its own rider's share of it. Drag your FTP and the
	// watts move while the shape does not. The workout is hand-placed for the
	// picture and the riders are made up — no product numbers here.
	const blocks = [
		{ min: 6, pct: 0.5 },
		{ min: 4, pct: 0.7 },
		{ min: 5, pct: 1 },
		{ min: 3, pct: 0.55 },
		{ min: 5, pct: 1 },
		{ min: 3, pct: 0.55 },
		{ min: 5, pct: 1 },
		{ min: 1, pct: 1.2 },
		{ min: 5, pct: 0.45 },
	];
	const riders = [
		{ name: 'Ines', ftp: 185 },
		{ name: 'Luca', ftp: 250 },
		{ name: 'Mara', ftp: 320 },
	];

	let yours = $state(230);
	let at = $state(2);
	let touched = $state(false);

	const block = $derived(blocks[at]);
	const zone = $derived(zoneOf(block.pct * 100, 100));
	const rows = $derived([
		...riders.map((r) => ({ ...r, you: false })),
		{ name: 'You', ftp: yours, you: true },
	]);
	// Scaled to the hardest block for the strongest engine on the page, so a
	// bar's length is watts and nothing else.
	const most = $derived(
		Math.max(...rows.map((r) => r.ftp)) * Math.max(...blocks.map((b) => b.pct)),
	);

	// It rides itself until someone touches it — a session in miniature.
	$effect(() => {
		if (touched || reducedMotion()) return;
		const id = setInterval(() => (at = (at + 1) % blocks.length), 1800);
		return () => clearInterval(id);
	});

	function pick(i: number) {
		touched = true;
		at = (i + blocks.length) % blocks.length;
	}
</script>

<div class="shell-card bg-surface-raised/60 w-full p-4 backdrop-blur sm:p-6">
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<p class="eyebrow">Tuesday threshold · one workout, four riders</p>
		<p class="text-muted text-xs">
			Block {at + 1} of {blocks.length} · {block.min} min at
			<span class="text-ink num">{Math.round(block.pct * 100)} %</span> FTP ·
			{ZONE_NAMES[zone]}
		</p>
	</div>

	<!-- The workout: every block a button, width its minutes, height its
	     share of FTP — the same shape whoever rides it. -->
	<div class="mt-4 flex items-center gap-2">
		<button
			class="icon-btn icon-btn-sm btn-ghost"
			aria-label="Previous block"
			onclick={() => pick(at - 1)}><ChevronLeft size={16} /></button
		>
		<div
			class="flex h-28 flex-1 items-end gap-0.5"
			role="group"
			aria-label="Workout blocks"
		>
			{#each blocks as b, i (i)}
				<button
					class="rounded-t-sm transition-[filter,outline] {i === at
						? 'outline-ink outline-2 outline-offset-2'
						: 'hover:brightness-125'}"
					style="flex: {b.min} 1 0; height: {(b.pct / 1.2) *
						100}%; background: {ZONE_VAR[zoneOf(b.pct * 100, 100)]}"
					aria-label="Block {i + 1}: {b.min} minutes at {Math.round(
						b.pct * 100,
					)} % of FTP"
					aria-pressed={i === at}
					onclick={() => pick(i)}
				></button>
			{/each}
		</div>
		<button
			class="icon-btn icon-btn-sm btn-ghost"
			aria-label="Next block"
			onclick={() => pick(at + 1)}><ChevronRight size={16} /></button
		>
	</div>

	<ul class="mt-5 flex flex-col gap-2.5" aria-live="polite">
		{#each rows as r, i (i)}
			{@const watts = Math.round(r.ftp * block.pct)}
			<li class="grid grid-cols-[4.5rem_1fr_4.5rem] items-center gap-3">
				<span class="text-sm {r.you ? 'text-ink font-semibold' : 'text-muted'}"
					>{r.name}
					<span class="text-muted num block text-[11px]">FTP {r.ftp} W</span
					></span
				>
				<span class="bg-ink/5 h-3 overflow-hidden rounded-full">
					<span
						class="block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
						style="width: {(watts / most) * 100}%; background: {ZONE_VAR[zone]}"
					></span>
				</span>
				<span
					class="num text-right text-lg font-bold {r.you
						? 'text-watt glow-text'
						: ''}">{watts} W</span
				>
			</li>
		{/each}
	</ul>

	<label class="mt-5 flex flex-wrap items-center gap-3 text-sm">
		<span class="text-muted">Your FTP</span>
		<input
			type="range"
			min="100"
			max="450"
			step="5"
			bind:value={yours}
			oninput={() => (touched = true)}
			class="accent-neon h-6 min-w-40 flex-1"
		/>
		<span class="num w-14 text-right font-bold">{yours} W</span>
	</label>
</div>
