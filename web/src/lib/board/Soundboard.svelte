<script lang="ts">
	/**
	 * The floating soundboard (#877), dragged where the rider wants it — the
	 * same `dragPane` the popped-out stage uses, so a board and a stage behave
	 * identically once they are loose.
	 *
	 * The grid grows with the board and scrolls rather than running off the
	 * screen; nine is only where an empty one starts.
	 *
	 * A pad's face is its own waveform, so a sound is found by silhouette at
	 * arm's length rather than read. Idle is violet and flat because chrome
	 * never glows; the part that has already played takes the live hue,
	 * because that is what ADR-0005 reserves it for.
	 */
	import { GripHorizontal, Library, Plus, Volume2, X } from '@lucide/svelte';
	import { dragPane } from '$lib/pane';
	import { board, type Clip } from '$lib/board/clips.svelte';
	import { isToggle } from '$lib/board/toggle-key.svelte';
	import { boardPanel } from '$lib/board/panel.svelte';
	import { modals } from '$lib/modals.svelte';
	import { mixer } from '$lib/sound/mixer.svelte';
	import {
		applyLevels,
		fire as playClip,
		stopAll,
	} from '$lib/sound/board.svelte';
	import { UNIT_FADER } from '$lib/sound/fader';
	import { learn, shapeOf } from '$lib/board/shapes.svelte';
	import ClipLibrary from '$lib/board/ClipLibrary.svelte';
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
	let library = $state(false);

	// Floating chrome yields to a surface the rider opened, the way the
	// jukebox dock does (modals.svelte) — including the clip library, which is
	// reached from this very panel and would otherwise open underneath it.
	const covered = $derived(modals.open > 0);

	function press(pad: number) {
		const clip = board.onPad(pad);
		if (!clip) {
			// The empty pad IS the affordance: it is where a rider looking for
			// somewhere to put a sound is already looking.
			library = true;
			return;
		}
		fireClip(clip);
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
		// for the ride — the same reason this component stays mounted while it
		// is closed. What must still stop a pad is a surface the rider opened
		// over it: it cannot go off behind the library or the editor.
		if (covered) return;
		if (event.key === 'Escape') {
			if (boardPanel.open) boardPanel.hide();
			return;
		}
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

	const pads = $derived(
		Array.from({ length: board.padCount }, (_, i) => ({
			slot: i + 1,
			clip: board.onPad(i + 1),
		})),
	);

	// The real envelope once the audio has been decoded for playback, the
	// id-derived shape until then — the pad never waits to draw.
	function bars(clip: Clip) {
		learn(clip.id, 20);
		return shapeOf(clip.id, 20);
	}
</script>

<svelte:window onkeydown={keys} />

{#if boardPanel.open}
	<div
		data-pane={PANE}
		class="bg-surface ring-ink/15 fixed top-32 left-4 w-[364px] rounded-lg p-1.5 shadow-2xl ring-1 md:left-72 {covered
			? 'z-30'
			: 'z-[55]'}"
	>
		<div
			{@attach dragPane}
			class="text-muted flex cursor-grab touch-none items-center gap-2 px-1 pb-1.5 text-[11px] active:cursor-grabbing"
		>
			<GripHorizontal size={14} class="shrink-0 opacity-60" />
			<span class="truncate">soundboard</span>
			<button
				onclick={() => (library = true)}
				class="hover:text-ink ml-auto shrink-0"
				aria-label="your clips"><Library size={13} /></button
			>
			<button
				onclick={() => boardPanel.hide()}
				class="hover:text-ink shrink-0"
				aria-label="close the soundboard"><X size={13} /></button
			>
		</div>

		<div
			class="grid max-h-[min(60vh,32rem)] grid-cols-3 gap-2 overflow-y-auto px-0.5"
		>
			{#each pads as { slot, clip } (slot)}
				{@const playing = mine?.pad === slot}
				<button
					onclick={() => press(slot)}
					title={clip
						? `${clip.name} — key ${slot}`
						: `Pad ${slot} is empty — add a clip`}
					class="relative flex h-23 flex-col gap-1 overflow-hidden rounded border p-2 text-left {clip
						? playing
							? 'border-watt/50 bg-watt/8'
							: 'border-muted/20 bg-surface-raised hover:border-muted/40'
						: 'border-muted/20 border-dashed'}"
				>
					{#if clip}
						<span class="flex items-start">
							<span class="flex-1"></span>
							<!-- Only a pad a key actually fires wears one. A badge on
							     pad 10 would draw a shortcut that does nothing, and a
							     control that does something else than it draws is not
							     a control (ux.md). -->
							{#if clip.key}
								<span
									class="font-display rounded-[3px] border px-1.5 py-0.5 text-[10px] leading-none {playing
										? 'border-watt/40 text-watt'
										: 'border-muted/25 text-muted'} uppercase">{clip.key}</span
								>
							{/if}
						</span>
						<span class="flex flex-1 items-center">
							<svg
								viewBox="0 0 104 34"
								width="100%"
								height="34"
								preserveAspectRatio="none"
								aria-hidden="true"
							>
								<g class={playing ? 'text-watt glow-stroke' : 'text-neon/55'}>
									{#each bars(clip) as bar, i (i)}
										<rect
											x={bar.x}
											y={bar.y}
											width="3"
											height={bar.h}
											rx="1.5"
											fill="currentColor"
										/>
									{/each}
								</g>
							</svg>
						</span>
						<span
							class="truncate text-[11px] leading-tight {playing
								? 'font-medium'
								: 'text-ink/85'}">{clip.name}</span
						>
					{:else}
						<span
							class="text-muted/55 absolute inset-0 flex flex-col items-center justify-center gap-1"
						>
							<Plus size={16} />
							<span class="text-[10px]">empty</span>
						</span>
					{/if}
				</button>
			{/each}
		</div>

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
	</div>
{/if}

{#if library}
	<ClipLibrary onclose={() => (library = false)} />
{/if}
