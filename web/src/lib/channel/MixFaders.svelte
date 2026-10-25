<script lang="ts">
	import { people } from '$lib/people.svelte';
	import StatusMark from '$lib/status-line/StatusMark.svelte';
	// Every level in one place (#179): the music ceiling, the cues, and how far
	// both dip under a voice. Ducking happens on top of the music level — it
	// never fights these faders.
	//
	// Rendered by both homes of the mix (#477): the Sound panel and
	// /settings/voice. One set of faders, two surfaces. Each fader is one row,
	// its name in a fixed column and its value right-aligned, so the names
	// share one left edge and the values one right edge (#4170).
	import { mixer } from '$lib/sound/mixer.svelte';
	import { play } from '$lib/sound/cues';
	import { applyLevels } from '$lib/sound/board.svelte';
	import {
		MUSIC_FADER,
		RIDER_FADER,
		UNIT_FADER,
		type Fader,
	} from '$lib/sound/fader';

	let {
		onRiderGain,
		onShareGain,
	}: {
		/** Resets go through av, so a rider still in voice hears the change. */
		onRiderGain?: (id: string, gain: number) => void;
		/** The same for a shared machine, so it dips while the drag happens. */
		onShareGain?: (gain: number) => void;
	} = $props();

	// Through av when there is one, so a rider still in voice is heard at the
	// new level the moment it moves.
	const setRider = (id: string, gain: number) =>
		onRiderGain ? onRiderGain(id, gain) : mixer.setRiderGain(id, gain);
	const setShare = (gain: number) =>
		onShareGain ? onShareGain(gain) : mixer.setShare(gain);

	const percent = (gain: number) => `${Math.round(gain * 100)}%`;

	const faders: {
		name: string;
		shown: string;
		travel: Fader;
		value: number;
		set: (v: number) => void;
		/** A cue on release, so the rider hears the level they left. */
		release?: () => void;
		aria?: string;
	}[] = $derived([
		{
			name: 'music',
			shown: `${mixer.music}%`,
			travel: MUSIC_FADER,
			value: mixer.music,
			set: (v) => mixer.setMusic(v),
		},
		{
			name: 'cues',
			shown: percent(mixer.cues),
			travel: UNIT_FADER,
			value: mixer.cues,
			set: (v) => mixer.setCues(v),
			release: () => play('block'),
		},
		// Its own channel, never the cues fader (#877, ADR-0033): a quiet ride
		// must not silence the board, and turning the board down must not cost
		// the rider their countdown cue.
		{
			name: 'soundboard',
			shown: percent(mixer.board),
			travel: UNIT_FADER,
			value: mixer.board,
			set: (v) => {
				mixer.setBoard(v);
				applyLevels();
			},
		},
		// Somebody else's computer, coming through the call (#1124, #1699): the
		// loudest thing in the call was the one source a rider could only turn
		// down by asking the person sharing it.
		{
			name: 'shared screens',
			shown: percent(mixer.share),
			travel: UNIT_FADER,
			value: mixer.share,
			set: setShare,
			aria: "how loud a shared screen's sound is",
		},
		{
			name: 'dip under voices',
			shown: mixer.duck === 1 ? 'off' : `−${percent(1 - mixer.duck)}`,
			travel: UNIT_FADER,
			value: mixer.duck,
			set: (v) => mixer.setDuck(v),
			release: () => play('block'),
			aria: 'how far music and cues dip under a voice',
		},
	]);

	// Taken once, on purpose: unity forgets a rider (mixer.svelte.ts), so a
	// live list would delete the row under the thumb the moment a drag passed
	// 100 %. The levels below still read live.
	const listed = mixer.mixedRiders;
	// A crew's list grows with the crew: the first few, then the rest on ask.
	const FIRST_RIDERS = 3;
	let everyone = $state(false);
	const shownRiders = $derived(
		everyone ? listed : listed.slice(0, FIRST_RIDERS),
	);
	const allAtUnity = $derived(
		listed.every((rider) => mixer.riderGain(rider.id) === 1),
	);
</script>

{#snippet level(shown: string)}
	<span class="font-display w-11 shrink-0 text-right text-sm tabular-nums"
		>{shown}</span
	>
{/snippet}

{#if mixer.muted}
	<!-- The faders keep their values while away (#875), so say why nothing is
	     coming out rather than showing every slider dragged to zero. -->
	<p class="text-muted mb-1 text-xs">Muted while you are away.</p>
{/if}
{#each faders as fader (fader.name)}
	<label class="flex items-center gap-3">
		<span class="w-28 shrink-0 truncate text-sm">{fader.name}</span>
		<input
			type="range"
			{...fader.travel}
			value={fader.value}
			oninput={(e) => fader.set(Number(e.currentTarget.value))}
			onchange={fader.release}
			aria-label={fader.aria}
			class="min-w-0 flex-1"
		/>
		{@render level(fader.shown)}
	</label>
{/each}
<!-- The fader above says how far; this says whose voice counts, and the
     default is right for almost everyone (ux.md's 95% rule) — folded, the way
     sprint grade is (#1860, #2181). -->
<details>
	<summary class="text-muted hover:text-ink cursor-pointer py-1 text-xs"
		>Advanced</summary
	>
	<label class="mt-1 flex items-center gap-2 text-sm">
		<input
			type="checkbox"
			checked={mixer.duckSelf}
			onchange={(e) => mixer.setDuckSelf(e.currentTarget.checked)}
		/>
		My voice dips them too
	</label>
</details>
<!-- A rider's volume lives in their right-click menu now (#874), anywhere
     they appear. Here so it is never ONLY in a menu (ux.md), and so the
     riders you have moved are in one list to undo. -->
<div class="mt-4 flex items-center gap-3">
	<span class="eyebrow">riders, yours only</span>
	{#if listed.length > 0}
		<button
			onclick={() => listed.forEach((rider) => setRider(rider.id, 1))}
			disabled={allAtUnity}
			class="btn btn-ghost btn-xs -mr-3 ml-auto">Reset all</button
		>
	{/if}
</div>
{#if listed.length > 0}
	<ul>
		{#each shownRiders as rider (rider.id)}
			{@const gain = mixer.riderGain(rider.id)}
			<li>
				<label class="flex items-center gap-3">
					<span class="flex w-28 shrink-0 items-center gap-1 text-sm">
						<span class="truncate">{rider.name}</span>
						<StatusMark line={people.face(rider.id)?.statusLine} size={11} />
					</span>
					<input
						type="range"
						{...RIDER_FADER}
						value={Math.round(gain * 100)}
						oninput={(e) =>
							setRider(rider.id, Number(e.currentTarget.value) / 100)}
						aria-label="{rider.name}'s volume"
						class="min-w-0 flex-1"
					/>
					{@render level(percent(gain))}
				</label>
			</li>
		{/each}
	</ul>
	{#if listed.length > FIRST_RIDERS}
		<button
			onclick={() => (everyone = !everyone)}
			aria-expanded={everyone}
			class="btn btn-ghost btn-xs -ml-3"
			>{everyone ? 'Fewer' : `${listed.length - FIRST_RIDERS} more`}</button
		>
	{/if}
{:else}
	<p class="text-muted-dim mt-1 text-xs">
		Everyone at 100%. Right-click a rider to set theirs.
	</p>
{/if}
