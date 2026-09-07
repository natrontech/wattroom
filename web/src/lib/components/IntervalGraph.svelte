<script lang="ts">
	import { formatClock } from '$lib/format';
	import type { Segment } from '$lib/workout/types';
	import { splitTrace, type TracePoint } from './trace';
	import { CEILING, ZONE_NAMES, ZONE_TEXT, zoneOf } from './zones';
	import {
		fractionAt,
		grabAt,
		SCALE,
		secondsAt,
		SNAP_FRACTION,
		SNAP_SECONDS,
		stepFraction,
		stepSeconds,
		VIEW,
		type GraphEdit,
		type GrabKind,
	} from './graph-edit';
	import { sameParent } from '$lib/workout/tree';

	let {
		segments,
		total,
		elapsed,
		ftp,
		trace,
		compact = false,
		selectedPath = null,
		onSelect,
		editable = false,
		onEdit,
	}: {
		segments: Segment[];
		total: number;
		elapsed: number;
		ftp: number;
		trace: TracePoint[];
		compact?: boolean;
		/** Editor hooks: present ⇒ blocks are clickable and select their step.
		    A path, not an index, so a repeat's child selects itself (#1004). */
		selectedPath?: number[] | null;
		onSelect?: (stepPath: number[]) => void;
		/**
		 * Shaping on the graph (#1006). Off everywhere but the editor: the ride
		 * screens and the workouts list render exactly as they did before, and
		 * nothing below runs when this is false.
		 */
		editable?: boolean;
		onEdit?: (edit: GraphEdit) => void;
	} = $props();

	const W = VIEW.width;
	const H = VIEW.height;
	const BASE = VIEW.base;

	interface Drag {
		kind: GrabKind;
		path: number[];
		/** The timeline the drag is drawn against, frozen at pointerdown. */
		span: number;
		/** Where this block starts, so a duration drag is pointer-minus-start. */
		startSeconds: number;
		/** What the block shows while the hand is on it, and where. */
		readout: string;
		at: number;
	}
	let drag = $state<Drag | null>(null);
	let svg: SVGSVGElement | undefined = $state();

	// A duration drag changes the total, which would rescale the timeline under
	// the pointer and make the edge run away from the hand. The whole graph is
	// drawn against the span the drag started with, and snaps to the new one on
	// release.
	const span = $derived(drag?.span ?? total);
	const x = (seconds: number) => (seconds / span) * W;
	const y = (fraction: number) => BASE - Math.min(fraction, CEILING) * SCALE;

	function targetText(seg: Segment, from: number, to: number): string {
		if (seg.watts !== undefined) return `${seg.watts} W`;
		const a = Math.round(from * 100);
		const b = Math.round(to * 100);
		return a === b ? `${a}% FTP` : `${a} → ${b}% FTP`;
	}

	const blocks = $derived(
		segments.map((seg) => {
			const from =
				seg.kind === 'sprint'
					? CEILING
					: seg.watts !== undefined
						? seg.watts / ftp
						: (seg.fromFraction ?? 0);
			const to =
				seg.kind === 'sprint'
					? CEILING
					: seg.watts !== undefined
						? from
						: (seg.toFraction ?? from);
			const x0 = x(seg.startSeconds);
			const x1 = x(seg.startSeconds + seg.seconds);
			const zone =
				seg.kind === 'sprint' ? 7 : zoneOf(((from + to) / 2) * ftp, ftp);
			return {
				points: `${x0},${BASE} ${x0},${y(from)} ${x1},${y(to)} ${x1},${BASE}`,
				edge: `${x0},${y(from)} ${x1},${y(to)}`,
				zone,
				path: seg.stepPath,
				sprint: seg.kind === 'sprint',
				x0,
				x1,
				yFrom: y(from),
				yTo: y(to),
				kind: seg.kind,
				startSeconds: seg.startSeconds,
				seconds: seg.seconds,
				fromFraction: from,
				toFraction: to,
				label:
					seg.kind === 'sprint'
						? `Sprint — all out · ${formatClock(seg.seconds)}`
						: `Z${zone} ${ZONE_NAMES[zone]} · ${targetText(seg, from, to)} · ${formatClock(seg.seconds)}`,
			};
		}),
	);

	// --- Shaping on the graph (#1006). None of this runs unless `editable`.

	/** Client pixels → viewBox units. The SVG stretches, so both axes scale. */
	function view(event: PointerEvent): { vx: number; vy: number } {
		const rect = svg!.getBoundingClientRect();
		return {
			vx: ((event.clientX - rect.left) / rect.width) * W,
			vy: ((event.clientY - rect.top) / rect.height) * H,
		};
	}

	function startDrag(event: PointerEvent, block: (typeof blocks)[number]) {
		if (!editable || !onEdit) return;
		const { vx, vy } = view(event);
		// Selecting on the way down is what makes the inspector track the drag.
		onSelect?.(block.path);
		drag = {
			kind: grabAt(vx, vy, block),
			path: block.path,
			span: total,
			startSeconds: block.startSeconds,
			readout: '',
			at: vx,
		};
		(event.currentTarget as Element).setPointerCapture(event.pointerId);
		event.preventDefault();
	}

	function moveDrag(event: PointerEvent) {
		if (!drag || !onEdit) return;
		const { vx, vy } = view(event);
		const free = event.altKey;
		drag.at = vx;

		if (drag.kind === 'seconds') {
			const seconds = stepSeconds(
				secondsAt(vx, drag.span) - drag.startSeconds,
				free,
			);
			drag.readout = formatClock(seconds);
			onEdit({ kind: 'seconds', path: drag.path, seconds });
			return;
		}

		if (drag.kind === 'reorder') {
			const over = blocks.find((b) => vx >= b.x0 && vx < b.x1);
			if (!over || !sameParent(over.path, drag.path)) return;
			const from = drag.path[drag.path.length - 1];
			const to =
				over.path[over.path.length - 1] +
				(vx > (over.x0 + over.x1) / 2 ? 1 : 0);
			if (to === from || to === from + 1) return;
			onEdit({ kind: 'reorder', path: drag.path, to });
			drag.path = [...drag.path.slice(0, -1), to > from ? to - 1 : to];
			return;
		}

		const fraction = stepFraction(fractionAt(vy), free);
		drag.readout = `${Math.round(fraction * 100)}% FTP · ${Math.round(fraction * ftp)} W`;
		onEdit({ kind: drag.kind, path: drag.path, fraction });
	}

	const endDrag = () => (drag = null);

	/**
	 * The same operations without a mouse. The step list is a complete keyboard
	 * path on its own; this is the shortcut for a rider already on the graph.
	 */
	function editKeys(event: KeyboardEvent, block: (typeof blocks)[number]) {
		if (!editable || !onEdit) return;
		const by = event.altKey ? 1 : SNAP_SECONDS;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			const now = block.seconds;
			const seconds = stepSeconds(
				now + (event.key === 'ArrowRight' ? by : -by),
				true,
			);
			event.preventDefault();
			onEdit({ kind: 'seconds', path: block.path, seconds });
			return;
		}
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		if (block.kind === 'sprint') return;
		const step = event.key === 'ArrowUp' ? SNAP_FRACTION : -SNAP_FRACTION;
		event.preventDefault();
		// A ramp keeps its shape: both ends move together, so arrows raise the
		// whole ramp rather than silently flattening it.
		if (block.kind === 'ramp') {
			onEdit({
				kind: 'rampFrom',
				path: block.path,
				fraction: stepFraction(block.fromFraction + step),
			});
			onEdit({
				kind: 'rampTo',
				path: block.path,
				fraction: stepFraction(block.toFraction + step),
			});
			return;
		}
		onEdit({
			kind: 'target',
			path: block.path,
			fraction: stepFraction(block.fromFraction + step),
		});
	}

	// One polyline per continuously-ridden run: skip and extend make the clock jump,
	// and a single line across those jumps draws work that never happened.
	const runs = $derived(
		splitTrace(trace).map((run) =>
			run.map((sample) => `${x(sample.t)},${y(sample.w / ftp)}`).join(' '),
		),
	);
</script>

<div class="relative">
	<svg
		bind:this={svg}
		viewBox="0 0 {W} {H}"
		class="w-full {compact ? 'h-14' : 'h-28'}"
		preserveAspectRatio="none"
	>
		{#each blocks as block, i (i)}
			{@const picked =
				selectedPath !== null &&
				block.path.join('.') === selectedPath.join('.')}
			<!-- Opacity via class, not attribute, so hover/selected states can win.
			     tabindex/role/keydown appear together or not at all — the static
			     checker can't see that through the conditionals. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<polygon
				points={block.points}
				class="{ZONE_TEXT[block.zone]} {picked
					? 'opacity-80'
					: block.sprint
						? 'opacity-30'
						: 'opacity-45'} {onSelect
					? 'cursor-pointer outline-none hover:opacity-70 focus-visible:outline-2 focus-visible:outline-current'
					: ''}"
				fill="currentColor"
				role={onSelect || editable ? 'button' : undefined}
				tabindex={onSelect || editable ? 0 : undefined}
				aria-label={onSelect ? block.label : undefined}
				onclick={onSelect && (() => onSelect(block.path))}
				onpointerdown={editable ? (e) => startDrag(e, block) : undefined}
				onpointermove={editable ? moveDrag : undefined}
				onpointerup={editable ? endDrag : undefined}
				onpointercancel={editable ? endDrag : undefined}
				onkeydown={onSelect &&
					((e) => {
						if (e.key === 'Enter' || e.key === ' ') onSelect(block.path);
						else editKeys(e, block);
					})}
			>
				<title>{block.label}</title>
			</polygon>
		{/each}
		<!-- Crisp top edge per block: the profile's shape, not just its tint. -->
		{#each blocks as block, i (i)}
			<polyline
				points={block.edge}
				class={ZONE_TEXT[block.zone]}
				fill="none"
				stroke="currentColor"
				stroke-width={compact ? 1.5 : 2}
				opacity="0.9"
				vector-effect="non-scaling-stroke"
			/>
		{/each}

		<!-- FTP reference over the fills: the one line that gives every block scale. -->
		<line
			x1="0"
			y1={y(1)}
			x2={W}
			y2={y(1)}
			class="text-muted opacity-50"
			stroke="currentColor"
			stroke-width="1"
			stroke-dasharray="6 5"
			vector-effect="non-scaling-stroke"
		/>

		{#each runs as points, i (i)}
			<!-- ink, not white (ADR-0005): the trace has to survive daylight surfaces. -->
			<polyline
				{points}
				class="text-ink"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				opacity="0.7"
				vector-effect="non-scaling-stroke"
			/>
		{/each}

		{#if elapsed > 0}
			<!-- watt marks live data only — previews pass elapsed 0 and get no cursor. -->
			<line
				x1={x(elapsed)}
				y1="0"
				x2={x(elapsed)}
				y2={BASE}
				class="text-watt glow-stroke"
				stroke="currentColor"
				stroke-width="2"
				vector-effect="non-scaling-stroke"
			/>
		{/if}
		<line
			x1="0"
			y1={BASE}
			x2={W}
			y2={BASE}
			stroke="currentColor"
			stroke-width="1"
			class="text-muted opacity-40"
			vector-effect="non-scaling-stroke"
		/>
	</svg>
	{#if drag?.readout}
		<!-- The number where the hand is. HTML for the same reason as the FTP
		     label below: the stretched viewBox would distort <text>. -->
		<span
			class="bg-surface-raised text-ink border-muted/30 pointer-events-none absolute top-1 rounded border px-1.5 py-0.5 font-mono text-[10px] tabular-nums"
			style="left: {Math.min(78, (drag.at / W) * 100)}%">{drag.readout}</span
		>
	{/if}
	{#if !compact}
		<!-- HTML, not <text>: preserveAspectRatio="none" would stretch glyphs. -->
		<span
			class="text-muted pointer-events-none absolute right-1.5 -translate-y-full font-mono text-[9px] tracking-widest"
			style="top: {(y(1) / H) * 100}%">FTP</span
		>
	{/if}
</div>
