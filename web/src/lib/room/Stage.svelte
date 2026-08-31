<script lang="ts">
	import { Maximize2, ScreenShare, Video } from '@lucide/svelte';
	import type { StageSource } from '$lib/room/av.svelte';
	import { keepSize } from '$lib/room/keep-size';
	import { clampPan, zoomAt, type View } from '$lib/room/stage';

	/**
	 * The big surface (#280). #206 put ONE screenshare in a fixed 880 px box:
	 * a second sharer silently replaced the first, and you could not centre,
	 * zoom or resize what you got. Here every live source is a chip, the frame
	 * resizes like a Discord pane, and the picture zooms at the cursor —
	 * because the thing people actually share is a wall of small text.
	 */
	let {
		sources = [],
		stage = null,
		stageKey = 0,
		onPick,
		attach,
	}: {
		/** Every live screen and camera, in the order the chips should read. */
		sources?: { kind: 'screen' | 'camera'; id: string; label: string }[];
		/** What is on the stage right now — may be a fallback, not the pick. */
		stage?: StageSource | null;
		/** Bumped when the staged track is replaced, so the attach re-runs. */
		stageKey?: number;
		onPick?: (source: StageSource) => void;
		attach?: (node: HTMLElement) => void;
	} = $props();

	let frame = $state<HTMLDivElement | null>(null);
	// Hoisted, never inline: an attachment re-runs when its function identity
	// changes, and a fresh `keepSize(...)` every render would re-apply the
	// STORED size mid-drag — the pane could never actually be resized.
	const rememberSize = keepSize('wattroom.pane.stage');

	// ── Zoom and pan (geometry lives in stage.ts, with its tests) ────────────
	let view = $state<View>({ zoom: 1, tx: 0, ty: 0 });

	function reset() {
		view = { zoom: 1, tx: 0, ty: 0 };
	}

	// Svelte cannot promise a non-passive wheel listener, and a passive one
	// cannot preventDefault — so the page would scroll under the zoom.
	$effect(() => {
		const node = frame;
		if (!node) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			const rect = node.getBoundingClientRect();
			view = zoomAt(
				view,
				event.clientX - rect.left,
				event.clientY - rect.top,
				event.deltaY < 0 ? 1.15 : 1 / 1.15,
				rect,
			);
		};
		node.addEventListener('wheel', onWheel, { passive: false });
		return () => node.removeEventListener('wheel', onWheel);
	});

	function startPan(event: PointerEvent) {
		if (view.zoom <= 1) return; // nothing to pan; let the click through
		const node = event.currentTarget as HTMLElement;
		const rect = node.getBoundingClientRect();
		const from = { px: event.clientX, py: event.clientY, ...view };
		try {
			node.setPointerCapture(event.pointerId);
		} catch {
			// no capture: panning still tracks while the pointer is over the frame
		}
		const move = (moved: PointerEvent) => {
			view = clampPan(
				{
					zoom: from.zoom,
					tx: from.tx + moved.clientX - from.px,
					ty: from.ty + moved.clientY - from.py,
				},
				rect,
			);
		};
		const done = () => {
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', done);
			node.removeEventListener('pointercancel', done);
		};
		node.addEventListener('pointermove', move);
		node.addEventListener('pointerup', done);
		node.addEventListener('pointercancel', done);
	}

	// A new source is a new picture: whatever you had zoomed into is gone.
	// Compared as a string — `stage` is a fresh object on every derivation.
	const sourceId = $derived(stage ? `${stage.kind}:${stage.id}` : '');
	let lastSource = '';
	$effect(() => {
		if (sourceId === lastSource) return;
		lastSource = sourceId;
		reset();
	});

	const isStaged = (source: { kind: string; id: string }) =>
		stage?.kind === source.kind && stage?.id === source.id;
</script>

<div class="mb-3">
	{#if sources.length > 1 || view.zoom > 1}
		<div class="mb-1.5 flex flex-wrap items-center gap-1.5">
			{#each sources as source (source.kind + source.id)}
				<button
					onclick={() => onPick?.({ kind: source.kind, id: source.id })}
					class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] {isStaged(
						source,
					)
						? 'border-neon/60 text-ink'
						: 'border-muted/25 text-muted hover:text-ink'}"
				>
					{#if source.kind === 'screen'}<ScreenShare size={11} />{:else}<Video
							size={11}
						/>{/if}
					{source.label}
				</button>
			{/each}
			{#if view.zoom > 1}
				<button
					onclick={reset}
					class="text-muted hover:text-ink ml-auto text-[11px] underline"
					>{Math.round(view.zoom * 100)}% · reset</button
				>
			{/if}
		</div>
	{/if}

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={frame}
		{@attach rememberSize}
		onpointerdown={startPan}
		ondblclick={reset}
		class="ring-neon/40 w-full overflow-hidden rounded-lg bg-black ring-1 {view.zoom >
		1
			? 'cursor-grab'
			: ''}"
		style="height: 420px; resize: both"
	>
		{#key stageKey}
			<div
				class="h-full w-full origin-top-left"
				style="transform: translate({view.tx}px, {view.ty}px) scale({view.zoom})"
				{@attach (node) => attach?.(node)}
			></div>
		{/key}
	</div>

	<p class="text-muted mt-1 flex items-center gap-1.5 text-[11px]">
		<Maximize2 size={11} class="shrink-0" />
		scroll to zoom · drag to pan · double-click to reset · drag the corner to resize
	</p>
</div>
