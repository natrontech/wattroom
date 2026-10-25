<script lang="ts">
	// Every level in one place (#179): the music ceiling, the cues, and how far
	// both dip under a voice. Ducking happens on top of the music level — it
	// never fights these faders.
	//
	// Rendered by both homes of the mix (#477): the Sound panel and
	// /settings/voice. One set of faders, two surfaces. The riders' volumes
	// beside them are `RiderVolumes`, so the Sound panel can give them their
	// own column (#4170).
	import FaderRow from '$lib/channel/FaderRow.svelte';
	import { mixer } from '$lib/sound/mixer.svelte';
	import { play } from '$lib/sound/cues';
	import { applyLevels } from '$lib/sound/board.svelte';
	import { MUSIC_FADER, UNIT_FADER, type Fader } from '$lib/sound/fader';

	let {
		onShareGain,
	}: {
		/** Through av, so a shared machine dips while the drag happens. */
		onShareGain?: (gain: number) => void;
	} = $props();

	const setShare = (gain: number) =>
		onShareGain ? onShareGain(gain) : mixer.setShare(gain);

	const percent = (gain: number) => `${Math.round(gain * 100)}%`;

	const faders: {
		id: string;
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
			id: 'music',
			name: 'music',
			shown: `${mixer.music}%`,
			travel: MUSIC_FADER,
			value: mixer.music,
			set: (v) => mixer.setMusic(v),
		},
		{
			id: 'cues',
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
			id: 'board',
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
			id: 'share',
			name: 'shared screens',
			shown: percent(mixer.share),
			travel: UNIT_FADER,
			value: mixer.share,
			set: setShare,
			aria: "how loud a shared screen's sound is",
		},
		{
			id: 'duck',
			name: 'dip under voices',
			shown: mixer.duck === 1 ? 'off' : `−${percent(1 - mixer.duck)}`,
			travel: UNIT_FADER,
			value: mixer.duck,
			set: (v) => mixer.setDuck(v),
			release: () => play('block'),
			aria: 'how far music and cues dip under a voice',
		},
	]);
</script>

{#if mixer.muted}
	<!-- The faders keep their values while away (#875), so say why nothing is
	     coming out rather than showing every slider dragged to zero. -->
	<p class="text-muted mb-1 text-xs">Muted while you are away.</p>
{/if}
{#each faders as fader (fader.id)}
	<FaderRow
		name={fader.name}
		shown={fader.shown}
		travel={fader.travel}
		value={fader.value}
		onvalue={fader.set}
		onrelease={fader.release}
		aria={fader.aria}
	/>
{/each}
<!-- The fader above says how far; this says whose voice counts, and the
     default is right for almost everyone (ux.md's 95% rule) — folded, the way
     sprint grade is (#1860, #2181). -->
<details>
	<summary class="text-muted hover:text-ink cursor-pointer py-1 text-xs"
		>Advanced</summary
	>
	<label class="mt-1 flex min-h-6 items-center gap-2 text-sm">
		<input
			type="checkbox"
			checked={mixer.duckSelf}
			onchange={(e) => mixer.setDuckSelf(e.currentTarget.checked)}
		/>
		My voice dips them too
	</label>
</details>
