<script lang="ts">
	/**
	 * The floating soundboard (#877). Nine pads, keys 1–9, dragged where the
	 * rider wants it — the same `dragPane` the popped-out stage uses, so a
	 * board and a stage behave identically once they are loose.
	 *
	 * A pad's face is its own waveform, so a sound is found by silhouette at
	 * arm's length rather than read. Idle is violet and flat because chrome
	 * never glows; the part that has already played takes the live hue,
	 * because that is what ADR-0005 reserves it for.
	 */
	import { ChevronUp, GripHorizontal, Plus, Volume2, X } from '@lucide/svelte';
	import { dragPane } from '$lib/pane';
	import { board, PADS, type Clip } from '$lib/board/clips.svelte';
	import { boardPanel } from '$lib/board/panel.svelte';
	import { mixer } from '$lib/sound/mixer.svelte';
	import {
		applyLevels,
		fire as playClip,
		stopAll,
	} from '$lib/sound/board.svelte';
	import { UNIT_FADER } from '$lib/sound/fader';
	import { waveform } from '$lib/board/waveform';
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
		// board still hears the room. This component is always mounted — the
		// chip below is what it renders when closed.
		for (const shot of batch) void playClip(shot.clipId, shot.fromId ?? '');
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

	function press(pad: number) {
		const clip = board.onPad(pad);
		if (!clip) return;
		onFire(clip.id);
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
		if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key === 'b' || event.key === 'B') {
			boardPanel.toggle();
			return;
		}
		if (!boardPanel.open) return;
		if (event.key === 'Escape') {
			boardPanel.hide();
			return;
		}
		const pad = Number(event.key);
		if (Number.isInteger(pad) && pad >= 1 && pad <= PADS) {
			event.preventDefault();
			press(pad);
		}
	}

	$effect(() => {
		void board.load();
		// Leaving the room stops what it was playing: a 60 s clip must not
		// follow the rider out of the room that fired it.
		return stopAll;
	});

	const pads = $derived(
		Array.from({ length: PADS }, (_, i) => ({
			slot: i + 1,
			clip: board.onPad(i + 1),
		})),
	);

	function bars(clip: Clip): { x: number; y: number; h: number }[] {
		return waveform(clip.id, 20);
	}
</script>

<svelte:window onkeydown={keys} />

{#if !boardPanel.open}
	<!-- Never only a key (ux.md): the way back is always on screen. -->
	<button
		onclick={() => boardPanel.show()}
		class="bg-surface-raised ring-ink/15 text-muted hover:text-ink fixed bottom-4 left-4 z-[54] flex h-12 items-center gap-2 rounded-full px-4 shadow-lg ring-1 md:left-64"
		title="Show your soundboard (B)"
	>
		<Volume2 size={16} />
		<span class="text-xs">board</span>
	</button>
{:else}
	<div
		data-pane={PANE}
		class="bg-surface ring-ink/15 fixed top-32 left-4 z-[55] w-[364px] rounded-lg p-1.5 shadow-2xl ring-1 md:left-72"
	>
		<div
			{@attach dragPane}
			class="text-muted flex cursor-grab touch-none items-center gap-2 px-1 pb-1.5 text-[11px] active:cursor-grabbing"
		>
			<GripHorizontal size={14} class="shrink-0 opacity-60" />
			<span class="truncate">soundboard</span>
			<button
				onclick={() => boardPanel.hide()}
				class="hover:text-ink ml-auto shrink-0"
				aria-label="hide the soundboard"><ChevronUp size={13} /></button
			>
			<button
				onclick={() => boardPanel.hide()}
				class="hover:text-ink shrink-0"
				aria-label="close the soundboard"><X size={13} /></button
			>
		</div>

		<div class="grid grid-cols-3 gap-2 px-0.5">
			{#each pads as { slot, clip } (slot)}
				{@const playing = mine?.pad === slot}
				<button
					onclick={() => press(slot)}
					disabled={!clip}
					title={clip ? `${clip.name} — key ${slot}` : `Pad ${slot} is empty`}
					class="relative flex h-23 flex-col gap-1 overflow-hidden rounded border p-2 text-left {clip
						? playing
							? 'border-watt/50 bg-watt/8'
							: 'border-muted/20 bg-surface-raised hover:border-muted/40'
						: 'border-muted/20 border-dashed'}"
				>
					{#if clip}
						<span class="flex items-start">
							<span class="flex-1"></span>
							<span
								class="font-display rounded-[3px] border px-1.5 py-0.5 text-[10px] leading-none {playing
									? 'border-watt/40 text-watt'
									: 'border-muted/25 text-muted'}">{slot}</span
							>
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
