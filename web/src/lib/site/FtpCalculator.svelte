<script lang="ts">
	import { RAMP } from '$lib/workout/ramp';
	import { ZONE_NAMES, ZONE_VAR, zoneBands } from '$lib/components/zones';

	// An FTP from a number the rider already has, and the seven zones it
	// makes (#2995). Both factors are docs/SPEC.md's: 75 % of a ramp test's
	// best minute (RAMP.ftpFraction), and 95 % of a best 20 minutes — the
	// "FTP suggestions" rule under Stats formulas.
	const TWENTY_MINUTES = 0.95;

	let from = $state<'ramp' | 'twenty'>('ramp');
	let watts = $state(300);

	const ftp = $derived(
		Math.round(
			(watts || 0) * (from === 'ramp' ? RAMP.ftpFraction : TWENTY_MINUTES),
		),
	);
	// Zone boundaries come from the one place that owns them. On an axis
	// twice FTP tall every edge lands inside it, Z6's top included, so Z7
	// gets a band — at 1.5× Z6 would fill the axis and Z7 would vanish.
	const zones = $derived(
		ftp > 0
			? zoneBands(ftp, ftp * 2).map((b) => ({
					zone: b.zone,
					low: Math.round(b.from * ftp * 2),
					high: b.zone === 7 ? null : Math.round(b.to * ftp * 2),
				}))
			: [],
	);
</script>

<div class="shell-card bg-surface-raised/60 w-full p-5 backdrop-blur sm:p-6">
	<fieldset class="flex flex-wrap gap-2">
		<legend class="eyebrow mb-3">Work it out from</legend>
		<label
			class="btn btn-xs {from === 'ramp'
				? 'btn-primary'
				: 'btn-secondary'} cursor-pointer"
		>
			<input type="radio" class="sr-only" value="ramp" bind:group={from} />
			A ramp test’s best minute
		</label>
		<label
			class="btn btn-xs {from === 'twenty'
				? 'btn-primary'
				: 'btn-secondary'} cursor-pointer"
		>
			<input type="radio" class="sr-only" value="twenty" bind:group={from} />
			Your best 20 minutes
		</label>
	</fieldset>

	<label class="mt-5 flex flex-wrap items-center gap-3">
		<span class="text-muted text-sm">
			{from === 'ramp' ? 'Best minute' : 'Best 20 minutes'}, average watts
		</span>
		<input
			type="number"
			min="50"
			max="2000"
			inputmode="numeric"
			bind:value={watts}
			class="input num w-28 text-lg"
		/>
	</label>

	<p class="mt-5" aria-live="polite">
		<span class="eyebrow">Your FTP</span><br />
		<span class="num text-watt glow-text-strong text-5xl font-bold">{ftp}</span>
		<span class="text-muted text-xl">W</span>
		<span class="text-muted ml-2 text-sm">
			= {Math.round(
				(from === 'ramp' ? RAMP.ftpFraction : TWENTY_MINUTES) * 100,
			)} % of {watts || 0} W
		</span>
	</p>

	{#if zones.length}
		<table class="mt-5 w-full text-sm">
			<caption class="sr-only">Power zones for an FTP of {ftp} W</caption>
			<tbody>
				{#each zones as z (z.zone)}
					<tr class="border-muted/10 border-b last:border-0">
						<td class="w-4 py-2">
							<span
								class="block h-3 w-3 rounded-full"
								style="background: {ZONE_VAR[z.zone]}"
								aria-hidden="true"
							></span>
						</td>
						<th scope="row" class="py-2 pl-2 text-left font-normal">
							Z{z.zone} <span class="text-muted">{ZONE_NAMES[z.zone]}</span>
						</th>
						<td class="num py-2 text-right">
							{z.high === null ? `over ${z.low} W` : `${z.low}–${z.high} W`}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
