<script lang="ts">
	/**
	 * The floating soundboard (#877), dragged where the rider wants it — the
	 * same `dragPane` the popped-out stage uses, so a board and a stage behave
	 * identically once they are loose.
	 *
	 * ONE surface with three faces (#981): the pads, your clips, and the trim
	 * editor. They used to be a floating panel with a modal on it and a second
	 * modal on that — three deep, and because the board counts modals to know
	 * when to get out of the way, opening the library dimmed the board it was
	 * opened from. Faces of one panel cannot do that to themselves.
	 *
	 * This file is the shell: the frame, the header, the keyboard, the fader
	 * and the strip. Each face draws itself.
	 */
	import {
		ArrowLeft,
		GripHorizontal,
		Library,
		Volume2,
		X,
	} from '@lucide/svelte';
	import { dragPane } from '$lib/pane';
	import { account } from '$lib/account.svelte';
	import { board, type Clip } from '$lib/board/clips.svelte';
	import { isToggle } from '$lib/board/toggle-key.svelte';
	import { boardPanel } from '$lib/board/panel.svelte';
	import { modals } from '$lib/modals.svelte';
	import { mixer } from '$lib/sound/mixer.svelte';
	import {
		applyLevels,
		fire as playClip,
		preview,
		stopAll,
	} from '$lib/sound/board.svelte';
	import { UNIT_FADER } from '$lib/sound/fader';
	import BoardFace from '$lib/board/BoardFace.svelte';
	import ClipsFace from '$lib/board/ClipsFace.svelte';
	import TrimFace from '$lib/board/TrimFace.svelte';
	import type { Board } from '$lib/protocol';

	let {
		fires,
		onFire,
	}: {
		/** This tick's fires, so the strip can say who pressed what. */
		fires: Board[] | undefined;
		onFire: (clipId: string) => void;
	} = $props();

	const PANE = 'soundboard';

	let last = $state<{ from: string; name: string; at: number } | undefined>();
	let seenTick: Board[] | undefined;

	$effect(() => {
		const batch = fires;
		if (!batch || batch.length === 0 || batch === seenTick) return;
		seenTick = batch;
		// Playing is not the panel's job to be open for: a rider who hid the
		// board still hears the room — this component stays mounted and
		// renders nothing while it is closed.
		for (const shot of batch) {
			// Only your OWN clips carry an edit here — a board is one rider's, so
			// somebody else's trim rides with their audio, not with the fire.
			const known = board.clips.find((c) => c.id === shot.clipId);
			void playClip(shot.clipId, shot.fromId ?? '', known);
		}
		const newest = batch[batch.length - 1];
		last = {
			from: newest.from ?? 'someone',
			// Only your own clips have names here — a board is one rider's.
			name: board.clips.find((c) => c.id === newest.clipId)?.name ?? 'a sound',
			at: Date.now(),
		};
	});

	// Playing is per rider, not per pad: what YOUR pad shows is your own fire.
	let mine = $state<{ pad: number; until: number } | undefined>();

	const me = $derived(account.me?.id ?? '');
	const face = $derived(boardPanel.face);
	const trimmed = $derived(
		boardPanel.trimming
			? board.clips.find((c) => c.id === boardPanel.trimming)
			: undefined,
	);

	// Floating chrome yields to a surface the rider opened, the way the
	// jukebox dock does (modals.svelte). The board's own faces are not modals
	// any more, so this counts only what somebody else put on top.
	const covered = $derived(modals.open > 0);

	function press(pad: number, alt: boolean) {
		const clip = board.onPad(pad);
		if (!clip) {
			// The empty pad IS the affordance: it is where a rider looking for
			// somewhere to put a sound is already looking.
			boardPanel.go('clips');
			return;
		}
		// Alt is the audition (#981): only you hear it, and nothing reaches
		// the hub. The pad does not glow, because nothing live happened in
		// the room.
		if (alt) void preview(clip.id, me, clip);
		else fireClip(clip);
	}

	/** Fire by key or by tap — both land here, so both light the pad. */
	function fireClip(clip: Clip) {
		onFire(clip.id);
		const pad = clip.pad;
		if (pad === undefined) return;
		mine = { pad, until: Date.now() + clip.millis };
		setTimeout(() => {
			if (mine?.pad === pad) mine = undefined;
		}, clip.millis);
	}

	function keys(event: KeyboardEvent) {
		const el = event.target as HTMLElement | null;
		const typing =
			el?.isContentEditable ||
			['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName ?? '');
		if (typing) return;
		// The toggle carries a modifier now, so it survives focus sitting on a
		// button or the page itself — which is exactly where a bare `b` used to
		// fire the board at riders who were not asking for it.
		if (isToggle(event)) {
			event.preventDefault();
			boardPanel.toggle();
			return;
		}
		// A pad fires whether the panel is showing or not (#982). Hitting it
		// without looking is the whole pitch, and a rider hides the board
		// precisely once they have learnt the keys and want the screen back
		// for the ride. What must still stop a pad is a surface the rider
		// opened over it, and a face that is not the pads: the clips and trim
		// faces are where a digit means a pad number, not a sound.
		if (covered) return;
		if (event.key === 'Escape') {
			if (boardPanel.open) boardPanel.hide();
			return;
		}
		if (boardPanel.open && face !== 'board') return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const clip = board.onKey(event.key);
		if (clip) {
			event.preventDefault();
			fireClip(clip);
		}
	}

	$effect(() => {
		void board.load();
		// Leaving the room stops what it was playing: a 60 s clip must not
		// follow the rider out of the room that fired it.
		return stopAll;
	});

	const megabytes = (bytes: number) => `${(bytes / (1 << 20)).toFixed(1)} MB`;
	const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
</script>

<svelte:window onkeydown={keys} />

{#if boardPanel.open}
	<!-- The trim face needs room for a waveform with two handles in it; the
	     other two are a 364 px column. `motion-reduce` takes the width without
	     the slide. -->
	<div
		data-pane={PANE}
		class="bg-surface ring-ink/15 fixed top-32 left-4 rounded-lg p-1.5 shadow-2xl ring-1 transition-[width] duration-200 motion-reduce:transition-none md:left-72 {face ===
		'trim'
			? 'w-[min(600px,calc(100vw-2rem))]'
			: 'w-[364px]'} {covered ? 'z-30' : 'z-[55]'}"
	>
		<div
			{@attach dragPane}
			class="text-muted flex cursor-grab touch-none items-center gap-2 px-1 pb-1.5 text-[11px] active:cursor-grabbing"
		>
			{#if face === 'board'}
				<GripHorizontal size={14} class="shrink-0 opacity-60" />
				<span class="truncate">soundboard</span>
				<button
					onclick={() => boardPanel.go('clips')}
					class="hover:text-ink ml-auto shrink-0"
					aria-label="your clips"><Library size={13} /></button
				>
				<button
					onclick={() => boardPanel.hide()}
					class="hover:text-ink shrink-0"
					aria-label="close the soundboard"><X size={13} /></button
				>
			{:else}
				<button
					onclick={() => boardPanel.back()}
					class="hover:text-ink shrink-0"
					aria-label="back to the pads"><ArrowLeft size={14} /></button
				>
				<span class="truncate"
					>{face === 'clips'
						? 'your clips'
						: `trim ${trimmed?.name ?? ''}`}</span
				>
				<span class="font-display ml-auto shrink-0 tabular-nums">
					{#if face === 'clips'}
						{megabytes(board.used)} of {megabytes(board.limit)}
					{:else if trimmed}
						source {seconds(trimmed.millis)}
					{/if}
				</span>
			{/if}
		</div>

		{#if face === 'board'}
			<BoardFace mine={mine?.pad} onPress={press} />

			<!-- The board's own fader (ADR-0033): pulling the cues down for a quiet
			     ride never silences it, and this never costs you the countdown. -->
			<label class="flex items-center gap-2 px-1.5 pt-3 pb-1.5">
				<Volume2 size={14} class="text-muted shrink-0" />
				<span class="sr-only">soundboard volume</span>
				<input
					type="range"
					{...UNIT_FADER}
					value={mixer.board}
					oninput={(e) => {
						mixer.setBoard(Number(e.currentTarget.value));
						applyLevels();
					}}
					class="min-w-0 flex-1"
					aria-label="soundboard volume"
				/>
				<span
					class="font-display w-9 shrink-0 text-right text-[11px] tabular-nums"
					>{Math.round(mixer.board * 100)}%</span
				>
			</label>

			{#if last}
				<p
					class="border-ink/5 text-muted flex items-center gap-2 border-t px-1.5 py-1.5 text-[11px]"
				>
					<span class="text-ink/85 truncate">{last.from}</span>
					<span class="shrink-0">fired</span>
					<span class="font-display text-ink/85 min-w-0 flex-1 truncate"
						>{last.name}</span
					>
				</p>
			{/if}
		{:else if face === 'clips'}
			<ClipsFace {me} />
		{:else if trimmed}
			<TrimFace clip={trimmed} {me} />
		{/if}
	</div>
{/if}
