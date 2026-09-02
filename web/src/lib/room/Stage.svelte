<script lang="ts">
	import {
		GripHorizontal,
		Maximize,
		Music,
		PictureInPicture2,
		RotateCcw,
		ScreenShare,
		Video as VideoIcon,
		ZoomIn,
		ZoomOut,
	} from '@lucide/svelte';
	import { dragPane } from '$lib/pane';
	import { offerSeat, STAGE_SEAT } from '$lib/room/stage-slot.svelte';
	import { contextMenu } from '$lib/context-menu.svelte';
	import {
		FIT,
		MAX_ZOOM,
		panBy,
		type StageView,
		zoomAbout,
	} from '$lib/room/stage';

	/**
	 * The stage (#280): the one big surface, and the rider decides what is on
	 * it. Many people can share at once, so the picker is the feature — plus
	 * zoom, because a 1440p screenshare letterboxed into a room panel is
	 * unreadable exactly when it matters (a chart, a route, a settings dialog).
	 *
	 * The frame is never resized from itself (#427). Either it fills the
	 * column it was given, or the place hands it a `height` and it takes the
	 * picture's own shape at that height, centred — the lounge's divider
	 * between the stage and the crew is what moves that number.
	 */
	interface StageSource {
		key: string;
		kind: 'screen' | 'cam' | 'jukebox';
		label: string;
	}

	let {
		sources,
		activeKey,
		trackKey,
		height,
		onFit,
		onPick,
		attach,
	}: {
		sources: StageSource[];
		activeKey: string;
		/** `pictureKey` of the active source — activeKey plus the track
		 *  generation. Remounts the video, and refits the zoom, on a fresh track. */
		trackKey: string;
		/**
		 * Frame height in px, from the place's divider. Absent = fill the
		 * column, which is what the side-by-side layouts want.
		 */
		height?: number;
		/**
		 * The height at which the column, not the divider, becomes the limit.
		 * The place clamps its divider to it, so dragging past the column's
		 * edge moves a number nothing renders.
		 */
		onFit?: (maxHeight: number) => void;
		onPick: (key: string) => void;
		/** Mounts the active source's video into the surface. */
		attach: (node: HTMLElement) => void;
	} = $props();

	/** Where a popped-out stage was left; nothing about its size. */
	const PANE = 'stage-v2';

	const active = $derived(sources.find((source) => source.key === activeKey));
	/** The jukebox player is an iframe that can never be reparented — the
	 *  stage holds a seat open for it instead (#316). */
	const seated = $derived(active?.kind === 'jukebox');

	let frame = $state<HTMLElement | null>(null);
	let view = $state<StageView>(FIT);

	// The frame takes the picture's own shape. A fixed-height box gave a 16:9
	// screenshare fat black bands above and below — dead space exactly where
	// the detail is.
	const DEFAULT_RATIO = 16 / 9;
	let ratio = $state(DEFAULT_RATIO);

	// A new picture — another source, or the same sharer's screen back on a
	// fresh track — starts at fit: inherited zoom would land you staring at a
	// corner of someone else's screen, and an inherited shape would letterbox
	// it until the first frame arrives.
	//
	// The guard is the point (#523). `trackKey` reaches us as a getter over a
	// derived that the room rebuilds on every tick, so this effect re-runs
	// about once a second — four times a second inside a sprint window — with
	// the picture unchanged. Resetting on each of those runs zoomed a reading
	// rider back out half a second after they zoomed in. Plain `let`: only the
	// effect touches it, and making it state would re-trigger the effect.
	let shown: string | null = null;
	$effect(() => {
		if (trackKey === shown) return;
		shown = trackKey;
		view = FIT;
		ratio = DEFAULT_RATIO;
	});

	/**
	 * A <video> knows its own size once metadata lands, and says so again when
	 * a sharer switches window mid-share. Neither event bubbles, so the frame
	 * listens in the capture phase and survives the {#key} block below it.
	 */
	function aspect(node: HTMLElement) {
		const read = () => {
			const video = node.querySelector('video');
			if (video?.videoWidth) ratio = video.videoWidth / video.videoHeight;
		};
		node.addEventListener('loadedmetadata', read, true);
		node.addEventListener('resize', read, true);
		read();
		return () => {
			node.removeEventListener('loadedmetadata', read, true);
			node.removeEventListener('resize', read, true);
		};
	}

	function rezoom(zoom: number, atX = 0, atY = 0) {
		const next = zoomAbout(
			view,
			zoom,
			atX,
			atY,
			frame?.clientWidth ?? 0,
			frame?.clientHeight ?? 0,
		);
		const moved = next.zoom !== view.zoom;
		view = next;
		return moved;
	}

	function wheelZoom(node: HTMLElement) {
		// Svelte's onwheel is passive, and this one must be able to cancel the
		// page scroll — hence the manual listener.
		const onWheel = (event: WheelEvent) => {
			if (seated) return; // the player owns its own surface
			const rect = node.getBoundingClientRect();
			const moved = rezoom(
				view.zoom * Math.exp(-event.deltaY / 400),
				event.clientX - rect.left - rect.width / 2,
				event.clientY - rect.top - rect.height / 2,
			);
			// At a zoom limit the gesture was really a scroll: let the page have it.
			if (moved) event.preventDefault();
		};
		node.addEventListener('wheel', onWheel, { passive: false });
		return () => node.removeEventListener('wheel', onWheel);
	}

	/** How tall this picture can get before the column caps its width. */
	function fit(node: HTMLElement) {
		const shape = ratio; // re-attaches when the picture changes shape
		const observer = new ResizeObserver(() =>
			onFit?.(Math.floor(node.clientWidth / shape)),
		);
		observer.observe(node);
		return () => observer.disconnect();
	}

	/** Shrinking the frame while zoomed would strand the picture off-centre. */
	function reclamp(node: HTMLElement) {
		const observer = new ResizeObserver(() => {
			view = panBy(view, 0, 0, node.clientWidth, node.clientHeight);
		});
		observer.observe(node);
		return () => observer.disconnect();
	}

	/** Popped out (#280): the stage leaves the column and floats, Discord's
	 * stream popout. Ephemeral like the source pick — a glance, not a setting.
	 * Never for the jukebox: the room's video has one home per window width
	 * and a floating window is not one of them (#427). */
	let popped = $state(false);
	$effect(() => {
		if (seated) popped = false;
	});

	let dragging = $state(false);
	function startPan(event: PointerEvent) {
		if (view.zoom === 1) return;
		dragging = true;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}
	function pan(event: PointerEvent) {
		if (!dragging) return;
		view = panBy(
			view,
			event.movementX,
			event.movementY,
			frame?.clientWidth ?? 0,
			frame?.clientHeight ?? 0,
		);
	}
</script>

<div
	data-pane={PANE}
	{@attach fit}
	class={popped
		? 'bg-surface ring-ink/15 fixed top-24 left-24 z-[55] rounded-lg p-1.5 shadow-2xl ring-1'
		: 'mb-3'}
>
	{#if popped}
		<div
			{@attach dragPane}
			class="text-muted flex cursor-grab touch-none items-center gap-2 px-1 pb-1.5 text-[11px] active:cursor-grabbing"
		>
			<GripHorizontal size={14} class="shrink-0 opacity-60" />
			<span class="truncate">{active?.label ?? 'stage'}</span>
			<button
				onclick={() => (popped = false)}
				class="hover:text-ink ml-auto shrink-0 underline">dock</button
			>
		</div>
	{/if}
	<div
		bind:this={frame}
		{@attach contextMenu(() => [
			{
				label: 'Fit to frame',
				icon: RotateCcw,
				onSelect: () => (view = FIT),
				disabled: view.zoom === 1 || seated,
			},
			{
				label: popped ? 'Dock the stage' : 'Pop the stage out',
				icon: PictureInPicture2,
				onSelect: () => (popped = !popped),
				disabled: seated,
			},
			{
				label: 'Fullscreen',
				icon: Maximize,
				onSelect: () => void frame?.requestFullscreen?.(),
			},
		])}
		{@attach wheelZoom}
		{@attach reclamp}
		{@attach aspect}
		class="ring-neon/40 relative overflow-hidden rounded-lg bg-black ring-1 {popped
			? 'w-[720px] max-w-[90vw]'
			: height
				? 'mx-auto'
				: 'w-full max-w-full'}"
		style="aspect-ratio: {ratio}; min-width: 320px; min-height: 200px;
			{popped || !height
			? 'max-height: 70vh'
			: // The WIDTH carries the dragged height, so the aspect ratio
				// always has the last word: a frame given both a height and a
				// max-width ends up taller than its picture, black bands and all.
				`width: min(${Math.round(height * ratio)}px, 100%)`}"
	>
		{#if seated}
			<!-- The player itself flies here (#316). Nothing may be drawn over
			     it — YouTube RMF — so the frame stays empty and the chrome
			     below is suppressed while it is seated. -->
			<div
				class="h-full w-full"
				{@attach (node) => offerSeat(node, STAGE_SEAT)}
			></div>
		{:else}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="h-full w-full"
				style="transform: translate({view.x}px, {view.y}px) scale({view.zoom}); transition: {dragging
					? 'none'
					: 'transform 120ms ease-out'}; cursor: {view.zoom === 1
					? 'default'
					: dragging
						? 'grabbing'
						: 'grab'}"
				onpointerdown={startPan}
				onpointermove={pan}
				onpointerup={() => (dragging = false)}
				onpointercancel={() => (dragging = false)}
				ondblclick={() => (view = FIT)}
			>
				{#key trackKey}
					<div class="h-full w-full" {@attach attach}></div>
				{/key}
			</div>

			<!-- Zoom chrome sits on the frame, never on the picture's middle. -->
			<div
				class="bg-surface/80 ring-ink/10 absolute right-2 bottom-2 flex items-center gap-1 rounded-full px-1.5 py-1 ring-1 backdrop-blur"
			>
				<button
					onclick={() => rezoom(view.zoom / 1.5)}
					disabled={view.zoom === 1}
					class="text-muted hover:text-ink disabled:opacity-30"
					aria-label="zoom out"><ZoomOut size={14} /></button
				>
				<span class="font-display text-muted w-9 text-center text-[10px]"
					>{view.zoom.toFixed(1)}×</span
				>
				<button
					onclick={() => rezoom(view.zoom * 1.5)}
					disabled={view.zoom === MAX_ZOOM}
					class="text-muted hover:text-ink disabled:opacity-30"
					aria-label="zoom in"><ZoomIn size={14} /></button
				>
				<button
					onclick={() => (view = FIT)}
					disabled={view.zoom === 1}
					class="text-muted hover:text-ink disabled:opacity-30"
					aria-label="fit to frame"><RotateCcw size={13} /></button
				>
				<button
					onclick={() => (popped = !popped)}
					class="text-muted hover:text-ink"
					aria-label={popped ? 'dock the stage' : 'pop the stage out'}
					><PictureInPicture2 size={13} /></button
				>
				<button
					onclick={() => void frame?.requestFullscreen?.()}
					class="text-muted hover:text-ink"
					aria-label="fullscreen"><Maximize size={13} /></button
				>
			</div>
		{/if}
	</div>

	<!-- Who is on stage, and who else could be. One tap swaps. -->
	<div class="mt-1.5 flex flex-wrap items-center gap-1.5">
		{#each sources as source (source.key)}
			<button
				onclick={() => onPick(source.key)}
				class="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] {source.key ===
				activeKey
					? 'border-neon/60 text-ink'
					: 'border-muted/20 text-muted hover:text-ink'}"
			>
				{#if source.kind === 'screen'}<ScreenShare
						size={12}
					/>{:else if source.kind === 'jukebox'}<Music
						size={12}
					/>{:else}<VideoIcon size={12} />{/if}
				{source.label}
			</button>
		{/each}
		<span class="text-muted/70 ml-auto text-[10px]"
			>{seated
				? 'the room is watching together'
				: 'scroll to zoom · drag to pan'}{popped
				? ' · drag the bar to move'
				: ''}</span
		>
	</div>
</div>
