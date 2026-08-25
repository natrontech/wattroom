<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';

	const metrics = [
		{ label: 'watts', value: '312' },
		{ label: 'rpm', value: '94' },
		{ label: 'bpm', value: '161' },
		{ label: 'elapsed', value: '24:07' },
	];
</script>

<main class="mx-auto max-w-5xl px-6 py-12">
	<h1 class="font-display text-3xl font-bold tracking-tight">Brand</h1>
	<p class="text-muted mt-2 max-w-2xl text-sm">
		Locked in <a
			href="https://github.com/natrontech/wattroom/blob/main/docs/decisions"
			class="underline">ADR-0005</a
		>: equalizer W, Outrun palette, Chakra Petch over Barlow, wordmark stays
		white.
	</p>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">Lockups</h2>
	<!-- The full lockup needs a whole row: at size 72 it is ~410px wide. -->
	<div class="mt-4 grid gap-3">
		<div
			class="border-muted/15 bg-surface-raised flex items-center justify-center rounded-lg border p-8"
		>
			<Logo size={72} wordmark />
		</div>
		<div class="grid gap-3 sm:grid-cols-2">
			<div
				class="border-muted/15 bg-surface-raised flex items-center justify-center rounded-lg border p-8"
			>
				<Logo size={72} />
			</div>
			<div
				class="border-muted/15 flex items-center justify-center rounded-lg border bg-white p-8"
			>
				<Logo size={72} />
			</div>
		</div>
	</div>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		The mark, alive
	</h2>
	<p class="text-muted mt-2 max-w-2xl text-sm">
		Idle the bars sit still; while a session runs they move — nav, TV mode,
		anywhere the mark appears. Placeholder loop here; the real one is driven by
		the 1 Hz tick.
	</p>
	<div class="mt-4 grid gap-3 sm:grid-cols-2">
		<div
			class="border-muted/15 bg-surface-raised flex items-center gap-5 rounded-lg border p-6"
		>
			<Logo size={56} />
			<div>
				<p class="text-sm font-medium">Idle</p>
				<p class="text-muted mt-0.5 text-xs">No session running.</p>
			</div>
		</div>
		<div
			class="border-muted/15 bg-surface-raised flex items-center gap-5 rounded-lg border p-6"
		>
			<Logo size={56} live />
			<div>
				<p class="text-sm font-medium">Riding</p>
				<p class="text-muted mt-0.5 text-xs">
					Bars breathe while the tick arrives.
				</p>
			</div>
		</div>
	</div>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">Favicon</h2>
	<div class="mt-4 grid gap-3 sm:grid-cols-2">
		<div class="border-muted/15 bg-surface-raised rounded-lg border p-5">
			<div class="flex items-center gap-2 rounded-t-md bg-[#2b2b31] px-3 py-2">
				<Logo size={16} />
				<span class="text-xs text-white/80">WattRoom — Sweet Spot 2×20</span>
			</div>
			<p class="text-muted mt-3 text-xs">Dark browser chrome.</p>
		</div>
		<div class="border-muted/15 bg-surface-raised rounded-lg border p-5">
			<div class="flex items-center gap-2 rounded-t-md bg-[#dedee3] px-3 py-2">
				<Logo size={16} />
				<span class="text-xs text-black/80">WattRoom — Sweet Spot 2×20</span>
			</div>
			<p class="text-muted mt-3 text-xs">Light chrome — magenta still holds.</p>
		</div>
	</div>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">Type</h2>
	<div class="border-muted/15 bg-surface-raised mt-4 rounded-lg border p-6">
		<div class="flex items-baseline gap-2">
			<span
				class="text-watt glow-text-strong font-display text-7xl leading-none font-bold tabular-nums"
				>312</span
			>
			<span class="text-muted text-xl">W</span>
		</div>
		<div class="mt-6 grid grid-cols-4 gap-2 sm:max-w-md">
			{#each metrics as metric (metric.label)}
				<div>
					<div class="font-display text-xl font-semibold tabular-nums">
						{metric.value}
					</div>
					<div class="text-muted text-[10px] tracking-wider uppercase">
						{metric.label}
					</div>
				</div>
			{/each}
		</div>
		<p class="text-muted mt-6 text-sm">
			Sweet Spot 2×20 · your coach starts the session in 30 seconds. Barlow
			reads the sentences; Chakra Petch takes every number and heading.
		</p>
	</div>
</main>
