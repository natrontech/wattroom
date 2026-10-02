<script lang="ts">
	import { formatClockLong, formatKm } from '$lib/format';
	import type { ClimbBest } from '$lib/road/attempts';
	import { classedOf, type Climb } from '$lib/road/climbs';

	/**
	 * A road's classed climbs, one row each (#3680): its name, class, length
	 * and average, gain and where it tops out, and — given `bests` — the
	 * owner's best time up it or “—”. Names are generated, “Climb 2”, the way
	 * the climb card counts them, until real ones arrive (#3136). Numerals
	 * right-aligned; the table scrolls in its own box on a phone. Under a
	 * profile it goes without its header row, as the profile's own facts.
	 */
	let {
		climbs,
		bests,
		head = true,
	}: { climbs: Climb[]; bests?: ClimbBest[] | null; head?: boolean } = $props();

	const rows = $derived(classedOf(climbs));
	// `null` is “still loading”: the column holds its place, saying nothing yet.
	const withBests = $derived(bests !== undefined);
	const bestOf = (startM: number) => bests?.find((b) => b.startM === startM);
	const avg = (c: Climb) => (c.gainM / (c.topM - c.startM || 1)) * 100;
</script>

{#if rows.length > 0}
	<div class="overflow-x-auto">
		<table class="w-full min-w-[17rem] text-xs" aria-label="Climbs">
			<thead class={head ? '' : 'sr-only'}>
				<tr class="text-muted border-frame border-b text-left">
					<th class="eyebrow py-2 pr-2 font-normal sm:pr-3">Climb</th>
					<th class="eyebrow py-2 pr-2 font-normal sm:pr-3">Class</th>
					<th class="eyebrow py-2 pr-2 text-right font-normal sm:pr-3">Gain</th>
					<th class="eyebrow py-2 pr-2 text-right font-normal sm:pr-3"
						>Top at</th
					>
					{#if withBests}
						<th class="eyebrow py-2 text-right font-normal">Best</th>
					{/if}
				</tr>
			</thead>
			<tbody class="divide-frame divide-y">
				{#each rows as c, i (c.startM)}
					{@const best = bestOf(c.startM)}
					<tr>
						<td class="py-2 pr-2 sm:pr-3"
							><span class="text-ink mr-2">Climb {i + 1}</span>
							<span class="text-muted font-display block tabular-nums sm:inline"
								>{formatKm(c.topM - c.startM)} km · {avg(c).toFixed(1)} %</span
							></td
						>
						<td class="py-2 pr-2 sm:pr-3"
							><span
								class="bg-neon text-on-neon font-display inline-block w-8 rounded text-center font-bold"
								>{c.cls}</span
							></td
						>
						<td class="font-display py-2 pr-2 text-right tabular-nums sm:pr-3"
							>{Math.round(c.gainM)} m</td
						>
						<td class="font-display py-2 pr-2 text-right tabular-nums sm:pr-3"
							>{head ? '' : 'top at '}km {formatKm(c.topM)}</td
						>
						{#if withBests}
							<td class="font-display py-2 text-right tabular-nums">
								{#if best}
									<a href="/history/{best.rideId}" class="hover:underline"
										>{formatClockLong(best.seconds)}</a
									>
								{:else if bests}
									<span class="text-muted">—</span>
								{/if}
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
