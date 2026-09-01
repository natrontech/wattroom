<script lang="ts">
	// A game in the focus slot (#390, ADR-0020). Backyard Ramp is the flagship
	// mode and the one with elimination, so it is what the mock shows.
	//
	// Every number here is docs/SPEC.md's, never invented: 3-minute rounds,
	// start 80 % FTP, +5 % FTP per round, eliminated after 10 s continuously
	// below the band, and eliminated riders get 50 % FTP ERG and STAY IN THE
	// ROOM — that last rule is the whole social point of the mode, so being out
	// has to look like still being here rather than like being dropped.
	import RidingBars from './RidingBars.svelte';
	import { wkg } from '$lib/format';
	import type { RoomRider } from '$lib/room/view';

	let { riders }: { riders: RoomRider[] } = $props();

	// Round 4 of a backyard: 80 % + 3 × 5 %.
	const round = 4;
	const linePct = 80 + (round - 1) * 5;
	const you = $derived(riders.find((r) => r.you)!);
	// Two out, the rest still in — enough to show both states at once.
	const out = $derived(
		riders.filter((r) => r.id === 'milo' || r.id === 'tobi'),
	);
	const alive = $derived(riders.filter((r) => !out.includes(r)));
</script>

<div class="grid h-full min-h-0 grid-rows-[auto_auto_1fr] gap-4">
	<div class="flex items-end gap-6">
		<div>
			<p class="eyebrow">backyard ramp · round {round}</p>
			<h2 class="font-display text-3xl leading-none font-bold">
				{linePct}% of your FTP
			</h2>
			<p class="text-muted mt-1 text-xs">
				Hold the line for 3 minutes. Drop below it for 10 seconds and you are
				out — next round is {linePct + 5}%.
			</p>
		</div>
		<div class="ml-auto text-right">
			<p class="eyebrow">round ends in</p>
			<p class="font-display text-4xl leading-none font-bold tabular-nums">
				1:12
			</p>
		</div>
	</div>

	<!-- Your own line, because in a backyard the only question is "am I above
	     it". Same instrument idea as the workout target, one threshold instead
	     of a band. -->
	<div class="bg-surface-raised relative h-16 overflow-hidden rounded-lg">
		<div
			class="bg-z4/25 absolute inset-y-0 left-0"
			style="width: {Math.min(100, (you.watts / (you.ftp * 1.5)) * 100)}%"
		></div>
		<div
			class="bg-watt glow-stroke absolute inset-y-0 w-1"
			style="left: {(((linePct / 100) * you.ftp) / (you.ftp * 1.5)) * 100}%"
		></div>
		<div class="absolute inset-0 flex items-center gap-4 px-4">
			<span
				class="font-display text-watt glow-text-strong text-4xl leading-none font-bold tabular-nums"
				>{you.watts}</span
			>
			<span class="eyebrow">watts</span>
			<span
				class="ml-auto text-sm tabular-nums {you.watts >=
				(linePct / 100) * you.ftp
					? 'text-z4'
					: 'text-z5'}"
				>{you.watts >= (linePct / 100) * you.ftp
					? 'above the line'
					: `${Math.round((linePct / 100) * you.ftp - you.watts)} W under — 6 s`}</span
			>
		</div>
	</div>

	<div class="grid min-h-0 gap-4 lg:grid-cols-[2fr_1fr]">
		<div class="min-h-0">
			<p class="eyebrow mb-2">still in — {alive.length}</p>
			<ul class="space-y-1.5">
				{#each alive as rider (rider.id)}
					<li class="flex items-center gap-3 text-sm">
						<RidingBars size={9} />
						<span
							class="min-w-0 flex-1 truncate {rider.you ? 'font-semibold' : ''}"
							>{rider.name}</span
						>
						<span class="font-display font-bold tabular-nums"
							>{rider.watts}</span
						>
						<span class="text-muted w-14 text-right text-xs tabular-nums"
							>{wkg(rider.watts, rider.kg)} w/kg</span
						>
					</li>
				{/each}
			</ul>
		</div>
		<div class="min-h-0">
			<p class="eyebrow mb-2">out — {out.length}</p>
			<!-- Out is not gone: SPEC keeps them in the room on 50 % ERG. Dimmed,
			     not removed — the roster is the point of riding together. -->
			<ul class="space-y-1.5">
				{#each out as rider, i (rider.id)}
					<li class="text-muted flex items-center gap-2 text-sm">
						<span class="w-5 shrink-0 text-xs tabular-nums"
							>{out.length - i}.</span
						>
						<span class="min-w-0 flex-1 truncate">{rider.name}</span>
						<span class="text-[11px]">round {round - 1 - i}</span>
					</li>
				{/each}
			</ul>
			<p class="text-muted/70 mt-3 text-[11px] leading-snug">
				Still here, spinning at 50% — the room does not thin out when people go
				out.
			</p>
		</div>
	</div>
</div>
