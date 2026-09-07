<script lang="ts">
	/**
	 * Trim a clip, fade its ends, push or pull its level (#934) — face 3 of the
	 * board panel (#981), where it used to be a modal on top of a modal.
	 *
	 * Nothing here re-encodes anything: the edit is five numbers stored beside
	 * the untouched upload and applied when it plays (ADR-0033). So an edit is
	 * undoable forever, costs no second copy of the audio, and needs no encoder
	 * a browser does not have. That is also what makes previewing the edit
	 * cheap: the same five numbers go to `preview`, and the rider hears exactly
	 * what a fire would sound like — to themselves alone.
	 */
	import { Pause, Play } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { saveEdit, type Clip, type Edit } from '$lib/board/clips.svelte';
	import { boardPanel } from '$lib/board/panel.svelte';
	import {
		peaks,
		preview,
		previewAt,
		previewing,
		stopPreview,
	} from '$lib/sound/board.svelte';
	import { waveform } from '$lib/board/waveform';

	let { clip, me }: { clip: Clip; me: string } = $props();

	/** SPEC's ceiling, and the reason a handle stops where it does. */
	const MAX_MS = 60_000;
	const BARS = 96;
	const W = 900;
	const H = 132;

	let start = $state(untrack(() => clip.startMs));
	let end = $state(untrack(() => clip.endMs || clip.millis));
	let gainDb = $state(untrack(() => clip.gainDb));
	let fadeIn = $state(untrack(() => clip.fadeInMs));
	let fadeOut = $state(untrack(() => clip.fadeOutMs));
	let refusal = $state<string | undefined>();
	let saving = $state(false);
	/** Seconds into the kept range, or null when nothing is sounding. */
	let head = $state<number | null>(null);

	// The real envelope when the audio decodes; the pad's id-derived shape
	// until then, so the editor draws something the instant it opens.
	// The editor edits a snapshot: it opens on one clip and closes, so reading
	// the props once is the intent, not a missed dependency.
	let shape = $state<number[]>(
		untrack(() => waveform(clip.id, BARS).map((bar) => bar.h / 30)),
	);
	$effect(() => {
		void peaks(clip.id, BARS).then((real) => {
			if (real) shape = real;
		});
	});

	const kept = $derived(end - start);
	const tooLong = $derived(kept > MAX_MS);
	const sounding = $derived(previewing() === clip.id);
	const x = (ms: number) => (ms / clip.millis) * W;

	const bars = $derived(
		shape.map((level, i) => {
			const h = Math.max(3, level * (H - 12));
			const ms = (i / BARS) * clip.millis;
			return {
				x: +((i * W) / BARS).toFixed(2),
				y: +((H - h) / 2).toFixed(2),
				h: +h.toFixed(2),
				inside: ms >= start && ms <= end,
			};
		}),
	);

	function clampAll() {
		start = Math.max(0, Math.min(start, clip.millis - 100));
		end = Math.max(start + 100, Math.min(end, clip.millis));
		const span = end - start;
		fadeIn = Math.max(0, Math.min(fadeIn, span));
		fadeOut = Math.max(0, Math.min(fadeOut, span - fadeIn));
	}

	const edit = (): Edit => ({
		startMs: Math.round(start),
		endMs: Math.round(end),
		gainDb,
		fadeInMs: Math.round(fadeIn),
		fadeOutMs: Math.round(fadeOut),
	});

	/** Hear the edit, looping, to yourself alone. */
	function listen() {
		if (sounding) stopPreview();
		else void preview(clip.id, me, edit(), true);
	}

	/**
	 * A slider moved while it loops. Re-aiming a running source would mean
	 * rebuilding its fade envelope mid-pass, so the loop restarts instead —
	 * debounced, or a drag would restart it sixty times a second.
	 */
	let rearm: ReturnType<typeof setTimeout> | undefined;
	function moved() {
		clampAll();
		if (!sounding) return;
		clearTimeout(rearm);
		rearm = setTimeout(() => void preview(clip.id, me, edit(), true), 150);
	}

	// The playhead rides the audio clock rather than a store that ticks: a
	// per-frame value in state is a per-frame pass through the effect graph,
	// which is what #494 died of.
	$effect(() => {
		if (!sounding) {
			head = null;
			return;
		}
		let frame = requestAnimationFrame(function step() {
			head = previewAt();
			frame = requestAnimationFrame(step);
		});
		return () => cancelAnimationFrame(frame);
	});

	// Leaving the face stops what only this rider could hear.
	$effect(() => stopPreview);

	async function save() {
		clampAll();
		saving = true;
		refusal = undefined;
		const failed = await saveEdit(clip.id, edit());
		saving = false;
		if (failed) refusal = failed.message;
		else boardPanel.back();
	}

	const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
</script>

<div
	class="border-edge rounded-lg border p-2"
	style="background: color-mix(in oklab, var(--color-surface) 70%, transparent)"
>
	<svg
		viewBox="0 0 {W} {H}"
		width="100%"
		height="132"
		preserveAspectRatio="none"
	>
		<rect
			x={x(start)}
			width={Math.max(0, x(end) - x(start))}
			y="0"
			height={H}
			fill="color-mix(in oklab, var(--color-neon) 8%, transparent)"
		/>
		{#each bars as bar, i (i)}
			<rect
				x={bar.x}
				y={bar.y}
				width="6"
				height={bar.h}
				rx="3"
				fill="currentColor"
				class={bar.inside ? 'text-neon/60' : 'text-neon/15'}
			/>
		{/each}
		<!-- The fade envelope: the two knees say where full level starts and
		     stops, which is what a rider is actually setting. -->
		<polyline
			points="{x(start)},{H - 6} {x(start + fadeIn)},6 {x(end - fadeOut)},6 {x(
				end,
			)},{H - 6}"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linejoin="round"
			class="text-neon/85"
		/>
		<rect
			x={x(start) - 1.5}
			y="0"
			width="3"
			height={H}
			class="text-neon fill-current"
		/>
		<rect
			x={x(end) - 1.5}
			y="0"
			width="3"
			height={H}
			class="text-neon fill-current"
		/>
		{#if head !== null}
			<!-- Where the sound has got to: live data, so the one thing on this
			     face that glows (ADR-0005). -->
			<rect
				x={x(start + head * 1000) - 1}
				y="0"
				width="2"
				height={H}
				class="text-watt glow-stroke fill-current"
			/>
		{/if}
	</svg>
</div>

<div class="mt-2.5 grid grid-cols-2 gap-x-5 gap-y-2.5">
	<label class="block text-xs">
		<span class="text-muted"
			>start · <span class="font-display tabular-nums">{seconds(start)}</span
			></span
		>
		<input
			type="range"
			min="0"
			max={clip.millis}
			step="10"
			bind:value={start}
			oninput={moved}
			class="mt-0.5 w-full"
		/>
	</label>
	<label class="block text-xs">
		<span class="text-muted"
			>end · <span class="font-display tabular-nums">{seconds(end)}</span></span
		>
		<input
			type="range"
			min="0"
			max={clip.millis}
			step="10"
			bind:value={end}
			oninput={moved}
			class="mt-0.5 w-full"
		/>
	</label>
	<label class="block text-xs">
		<span class="text-muted"
			>fade in · <span class="font-display tabular-nums">{seconds(fadeIn)}</span
			></span
		>
		<input
			type="range"
			min="0"
			max={Math.max(100, kept)}
			step="10"
			bind:value={fadeIn}
			oninput={moved}
			class="mt-0.5 w-full"
		/>
	</label>
	<label class="block text-xs">
		<span class="text-muted"
			>fade out · <span class="font-display tabular-nums"
				>{seconds(fadeOut)}</span
			></span
		>
		<input
			type="range"
			min="0"
			max={Math.max(100, kept)}
			step="10"
			bind:value={fadeOut}
			oninput={moved}
			class="mt-0.5 w-full"
		/>
	</label>
	<label class="col-span-2 block text-xs">
		<span class="text-muted"
			>gain · <span class="font-display tabular-nums"
				>{gainDb > 0 ? '+' : ''}{gainDb.toFixed(1)} dB</span
			></span
		>
		<input
			type="range"
			min="-12"
			max="12"
			step="0.5"
			bind:value={gainDb}
			oninput={moved}
			class="mt-0.5 w-full"
		/>
	</label>
</div>

{#if tooLong}
	<p
		class="border-danger/40 text-danger mt-2.5 rounded border px-3 py-2 text-xs"
	>
		A clip can be at most 60 seconds — this keeps {seconds(kept)}. Move a handle
		in.
	</p>
{:else if refusal}
	<p
		class="border-danger/40 text-danger mt-2.5 rounded border px-3 py-2 text-xs"
	>
		{refusal}
	</p>
{/if}

<div class="mt-3 flex items-center gap-2">
	<button
		onclick={listen}
		title={sounding
			? 'stop — only you hear this'
			: 'preview the edit — only you'}
		class="btn btn-secondary btn-xs {sounding ? 'text-watt' : ''}"
	>
		{#if sounding}<Pause size={13} />{:else}<Play size={13} />{/if}
		{sounding ? 'playing · only you' : 'Preview'}
	</button>
	<span class="text-muted font-display text-xs tabular-nums"
		>keeps {seconds(kept)}{sounding ? ' · loops' : ''}</span
	>
	<span class="flex-1"></span>
	<button onclick={() => boardPanel.back()} class="btn btn-ghost btn-xs"
		>Cancel</button
	>
	<button
		onclick={() => void save()}
		disabled={saving || tooLong}
		class="btn btn-primary btn-xs">{saving ? 'Saving…' : 'Save'}</button
	>
</div>
