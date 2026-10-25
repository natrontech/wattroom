<script lang="ts">
	import {
		LastLightDefaultMinutes,
		WheelraceDefaultMinutes,
		WheelraceMaxMinutes,
		WheelraceMinMinutes,
	} from '$lib/protocol';
	import {
		LAST_LIGHT_MINUTES,
		RACES,
		raceStart,
		type GameStart,
	} from './modes';

	/**
	 * Race it (#3777, ADR-0067): which race the picked road runs, and its
	 * minutes. `race` is the control's fields but the road; null while a
	 * Wheelrace's par is out of bounds, so nothing starts that the hub refuses.
	 */
	let { race = $bindable() }: { race: Omit<GameStart, 'route'> | null } =
		$props();

	let mode = $state(RACES[0].id);
	let clock = $state(LastLightDefaultMinutes);
	let par = $state<number | null>(WheelraceDefaultMinutes);
	$effect(() => {
		race = raceStart(mode, clock, par);
	});
	const parOk = $derived(raceStart('wheelrace', clock, par) !== null);
</script>

<p class="eyebrow mt-4">which race</p>
<div class="mt-2 grid gap-2 sm:grid-cols-3">
	{#each RACES as r (r.id)}
		<button
			onclick={() => (mode = r.id)}
			aria-pressed={mode === r.id}
			class="rounded-lg border px-3 py-3 text-left {mode === r.id
				? 'border-neon bg-surface-raised text-ink'
				: 'border-frame text-muted hover:text-ink'}"
		>
			<span class="font-display block text-sm font-bold">{r.label}</span>
			<span class="mt-1 block text-xs leading-relaxed">{r.blurb}</span>
		</button>
	{/each}
</div>

{#if mode === 'last-light'}
	<p class="eyebrow mt-4">how long</p>
	<div class="mt-2 flex flex-wrap gap-2">
		{#each LAST_LIGHT_MINUTES as m (m)}
			<button
				onclick={() => (clock = m)}
				aria-pressed={clock === m}
				class="btn num {clock === m ? 'btn-secondary' : 'btn-ghost'}"
				>{m} min</button
			>
		{/each}
	</div>
{:else if mode === 'wheelrace'}
	<label class="text-muted mt-4 block text-xs">
		<span class="eyebrow">par</span>
		<span class="mt-1 flex items-center gap-2">
			<input
				type="number"
				min={WheelraceMinMinutes}
				max={WheelraceMaxMinutes}
				step="1"
				bind:value={par}
				aria-invalid={!parOk}
				class="input num w-24"
			/>
			min
		</span>
	</label>
	{#if !parOk}
		<p class="text-danger mt-1 text-xs" role="alert">
			A Wheelrace's par is {WheelraceMinMinutes} to {WheelraceMaxMinutes} minutes.
		</p>
	{/if}
{/if}
