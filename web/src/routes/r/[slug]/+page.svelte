<script lang="ts">
	// The Lounge: the room's default place (ADR-0020). Was a tab inside
	// RoomLive; it is a URL now.
	//
	// One fused grid — camera and metrics on the same tile (#181) — with the
	// stage above it only when someone is actually sharing. Tapping a tile
	// focuses that rider: what "video-first" used to be a whole layout for,
	// as a tap rather than a mode you have to remember you are in.
	import RiderTile from '$lib/room/RiderTile.svelte';
	import Stage from '$lib/room/Stage.svelte';
	import { pickStage, pictureKey } from '$lib/room/stage';
	import { useRoom } from '$lib/room/context';
	import { formatWhen } from '$lib/format';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { contextMenu, type MenuEntry } from '$lib/context-menu.svelte';
	import { personMenu } from '$lib/person-menu';
	import { clampSize, dividerDrag } from '$lib/divider';
	import { toasts } from '$lib/toast.svelte';
	import { goto } from '$app/navigation';
	import {
		Focus,
		CalendarClock,
		Columns2,
		Coffee,
		MonitorPlay,
		MonitorUp,
		PanelRight,
		ShieldBan,
		UserPlus,
	} from '@lucide/svelte';

	const room = useRoom();
	const av = $derived(roomConnection.current?.av);
	const isOwner = $derived(room.myRole === 'owner');

	// Banning is reversible (Unban sets the role right back), so it gets an
	// undo toast rather than a confirm dialog (errors.md) — same pattern as
	// the Members page and settings' ban list (#666).
	function ban(id: string, name: string) {
		const previousRole =
			room.members.find((m) => m.id === id)?.role ?? 'member';
		room.setRole(id, 'banned');
		toasts.push(`Banned ${name}.`, {
			undo: () => room.setRole(id, previousRole),
		});
	}

	// The tile's right-click (#465): focus is the click, the rest is what
	// every person in WattRoom offers — their page, the DM, the friend ask,
	// and — for the owner — the ban a griefer needs met where they are, not
	// three screens away in Settings (#666).
	function tileMenu(rider: () => (typeof room.riders)[number]) {
		return contextMenu(() => {
			const entries: MenuEntry[] = [
				{
					label:
						rider().id === room.focusId ? 'Unfocus' : `Focus ${rider().name}`,
					icon: Focus,
					onSelect: () =>
						room.setFocus(rider().id === room.focusId ? null : rider().id),
				},
				...personMenu(rider().id, goto, {
					you: rider().you,
					poke: {
						onSelect: () => room.poke(rider().id),
					},
				}),
			];
			if (isOwner && !rider().you)
				entries.push('separator', {
					label: 'Ban from the room',
					icon: ShieldBan,
					onSelect: () => ban(rider().id, rider().name),
					danger: true,
				});
			return entries;
		});
	}

	// Quick layouts for watching together (#464, reworked #427): what deserves
	// the room differs per rider — the picture for some, the cams for others,
	// and for a third the video belongs in the people column where it plays on
	// every other page anyway. Three presets, one tap, remembered per device.
	type Layout = 'stage' | 'split' | 'sidebar';
	const LAYOUT_KEY = 'wattroom.lounge.layout.v1';
	const LAYOUTS: {
		id: Layout;
		label: string;
		hint: string;
		icon: typeof MonitorPlay;
	}[] = [
		{
			id: 'stage',
			label: 'Stage',
			hint: 'the picture big, the crew below',
			icon: MonitorPlay,
		},
		{
			id: 'split',
			label: 'Split',
			hint: 'picture and crew side by side',
			icon: Columns2,
		},
		{
			id: 'sidebar',
			label: 'Sidebar',
			hint: 'the video plays in the people column only',
			icon: PanelRight,
		},
	];
	let layout = $state<Layout>('stage');
	try {
		const saved = localStorage.getItem(LAYOUT_KEY);
		if (saved === 'split' || saved === 'sidebar') layout = saved;
	} catch {
		/* desk preference; the default is fine */
	}
	function setLayout(next: Layout) {
		layout = next;
		try {
			if (next === 'stage') localStorage.removeItem(LAYOUT_KEY);
			else localStorage.setItem(LAYOUT_KEY, next);
		} catch {
			/* fine — the choice just won't survive a reload */
		}
	}
	// Sidebar is only a choice while there IS a video to send there; a shared
	// screen cannot play in a 240 px column and never moves.
	const options = $derived(
		LAYOUTS.filter(
			(option) =>
				option.id !== 'sidebar' ||
				room.stageSources.some((source) => source.kind === 'jukebox'),
		),
	);

	// The lounge's own stage, not the shell's: in the Sidebar layout the video
	// is simply not a source here, so a shared screen takes the surface and
	// with nothing shared the lounge is all crew.
	const sources = $derived(
		layout === 'sidebar'
			? room.stageSources.filter((source) => source.kind !== 'jukebox')
			: room.stageSources,
	);
	const onStage = $derived(pickStage(sources, av?.stagePick ?? null));
	/** Stage above, crew below — the shape both Stage and Sidebar draw. */
	const stacked = $derived(layout !== 'split');
	const wrap = $derived(
		!onStage || stacked
			? ''
			: // The frame has a 320 px floor (RMF's 200×200 with chrome): the
				// stage column must never shrink below it, or it runs under the
				// people column.
				'grid items-start gap-3 lg:grid-cols-[minmax(20rem,1fr)_minmax(0,1fr)]',
	);

	// How tall the picture is, in the one layout where there is room to argue
	// about it (#427). It is a divider between the stage and the crew, not a
	// grip on the frame: the frame keeps the picture's own shape at whatever
	// height this is, centred in the column.
	const STAGE_H_KEY = 'wattroom.lounge.stage-h.v1';
	/** RMF's floor, and the frame's own min-height. */
	const STAGE_H_MIN = 200;
	function storedHeight() {
		try {
			const saved = Number(localStorage.getItem(STAGE_H_KEY));
			if (saved >= STAGE_H_MIN) return saved;
		} catch {
			/* desk preference */
		}
		return 420;
	}
	let stageH = $state(storedHeight());
	/** What the frame reports it can reach before its column caps the width. */
	let stageFit = $state(Infinity);
	/** Never so tall that the crew is pushed off the bottom entirely. */
	function tallest() {
		return Math.max(STAGE_H_MIN, Math.min(stageFit, window.innerHeight - 260));
	}
	function stageDivider(grip: HTMLElement) {
		return dividerDrag(grip, {
			axis: 'y',
			from: () => stageH,
			to: (h) => (stageH = clampSize(h, STAGE_H_MIN, tallest())),
			done: () => {
				try {
					localStorage.setItem(STAGE_H_KEY, String(stageH));
				} catch {
					/* fine — the drag just won't survive a reload */
				}
			},
		});
	}

	// Whoever's camera is ON the stage is not also a tile (#506): the room
	// showed the same person twice, big and small, which reads as a bug the
	// moment the tiles are a grid rather than a strip under the picture.
	const staged = $derived(
		onStage?.kind === 'cam' ? onStage.riderId : undefined,
	);
	const tiles = $derived(room.riders.filter((r) => r.id !== staged));
	// Focus belongs to the Stage layout, where there IS a big slot to focus
	// into. Side by side and the grid already show everyone at one size, so a
	// focused rider there was a third size for no reason.
	const focusable = $derived(!onStage || stacked);
	const focused = $derived(
		focusable ? tiles.find((r) => r.id === room.focusId) : undefined,
	);
	const others = $derived(tiles.filter((r) => r.id !== focused?.id));
</script>

{#snippet tile(rider: (typeof room.riders)[number])}
	<RiderTile
		{rider}
		phase={room.phase}
		videoKey={room.videoOf(rider.id) ?? 0}
		videoAttach={room.videoOf(rider.id)
			? (node) => room.attachVideo(rider.id, node)
			: undefined}
	/>
{/snippet}

<div class="flex h-full flex-col px-8 py-6">
	<!-- No page header: the sidebar says which room this is and the people
	     column says who is in it. What is left is what the lounge can DO. -->
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<button
			onclick={() => room.setAway(!room.away)}
			aria-pressed={room.away}
			class="btn {room.away ? 'btn-primary' : 'btn-secondary'}"
			><Coffee size={14} /> {room.away ? "I'm back" : 'Away'}</button
		>
		{#if room.stageSources.length > 0}
			<div
				class="border-muted/20 ml-auto flex gap-0.5 rounded border p-0.5"
				role="group"
				aria-label="layout"
			>
				{#each options as option (option.id)}
					<button
						onclick={() => setLayout(option.id)}
						aria-pressed={layout === option.id}
						title="{option.label} — {option.hint}"
						aria-label="{option.label} layout"
						class="rounded px-2 py-1 {layout === option.id
							? 'bg-surface-raised text-ink'
							: 'text-muted hover:text-ink'}"><option.icon size={13} /></button
					>
				{/each}
			</div>
		{/if}
		<button
			onclick={() => room.openTv()}
			class="btn btn-ghost btn-xs {room.stageSources.length ? '' : 'ml-auto'}"
			><MonitorUp size={13} /> TV</button
		>
	</div>

	<div class={wrap}>
		{#if onStage}
			<!-- The stage (#280): many people may share at once, so the picker
			     chooses; the frame zooms and pans. Stacked it takes the height
			     the divider below sets and centres itself at the picture's own
			     shape; side by side it simply fills its column (#427). -->
			<div class="min-w-0 shrink-0">
				<Stage
					{sources}
					activeKey={onStage.key}
					trackKey={pictureKey(onStage)}
					height={stacked
						? clampSize(stageH, STAGE_H_MIN, tallest())
						: undefined}
					onFit={(max) => (stageFit = max)}
					onPick={(key) => room.pickStage(key)}
					attach={(node) => room.attachStage(node, onStage!.key)}
				/>
			</div>
			{#if stacked}
				<!-- The one way the picture is resized (#427): the seam between it
				     and the crew, dragged. There is no grip on the frame itself —
				     a corner of diagonal lines nobody could find, and one that
				     RMF would not let us draw over the player anyway. -->
				<div
					{@attach stageDivider}
					class="group mb-3 flex h-4 w-full cursor-row-resize touch-none items-center justify-center"
					role="separator"
					aria-orientation="horizontal"
					aria-label="resize the stage"
					title="drag to resize the picture"
				>
					<!-- The strip is the target; the pill is what says so. Chrome, so
					     it takes the structural accent and never glows (ADR-0005). -->
					<span
						class="bg-muted/30 group-hover:bg-neon group-active:bg-neon h-1 w-16 rounded-full transition-colors"
					></span>
				</div>
			{/if}
		{/if}
		<div class="min-w-0">
			{#if focused}
				<!-- Focus narrows what you are looking at; it does not empty the room,
		     so everyone else stays beside them. -->
				<div
					class="grid min-h-0 shrink-0 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]"
				>
					<div>
						<button
							onclick={() => room.setFocus(null)}
							class="block w-full text-left"
							title="tap to unfocus"
							{@attach tileMenu(() => focused!)}>{@render tile(focused)}</button
						>
						<p class="text-muted mt-2 text-xs">
							<span class="text-ink font-medium">{focused.name}</span> is focused
							— tap again to let go.
						</p>
					</div>
					<div class="grid grid-cols-3 gap-2 lg:grid-cols-1">
						{#each others as rider (rider.id)}
							<button
								onclick={() => room.setFocus(rider.id)}
								class="block text-left"
								title="focus {rider.name}"
								{@attach tileMenu(() => rider)}>{@render tile(rider)}</button
							>
						{/each}
					</div>
				</div>
			{:else}
				<div
					class="grid shrink-0 gap-3 {onStage && !stacked
						? 'grid-cols-2'
						: 'sm:grid-cols-2 2xl:grid-cols-3'}"
				>
					{#each tiles as rider (rider.id)}
						{#if focusable}
							<button
								onclick={() => room.setFocus(rider.id)}
								class="block text-left"
								title="focus {rider.name}"
								{@attach tileMenu(() => rider)}>{@render tile(rider)}</button
							>
						{:else}
							<div {@attach tileMenu(() => rider)}>{@render tile(rider)}</div>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	</div>

	{#if room.phase === 'lounge'}
		<!-- The room's dashboard, when nothing is running: what this room is
		     adding up to and the three things you do to it. It lives on the
		     Lounge rather than a sixth place — Discord's server home IS its
		     first channel. -->
		<section class="mt-6">
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div class="panel px-4 py-3">
					<p class="eyebrow">riders</p>
					<p class="font-display text-2xl font-bold tabular-nums">
						{room.members.length}
					</p>
					<p class="text-muted text-[11px]">
						{room.riders.length} here now
					</p>
				</div>
				<div class="panel px-4 py-3">
					<p class="eyebrow">streak</p>
					<p class="font-display text-2xl font-bold tabular-nums">
						{room.streakWeeks}<span class="text-muted ml-1 text-sm"
							>wk{room.streakWeeks === 1 ? '' : 's'}</span
						>
					</p>
					<p class="text-muted text-[11px]">a session every week</p>
				</div>
				<div class="panel px-4 py-3">
					<p class="eyebrow">this month</p>
					<p class="font-display text-2xl font-bold tabular-nums">
						{Math.round(room.monthKj).toLocaleString()}<span
							class="text-muted ml-1 text-sm">kJ</span
						>
					</p>
					<p class="text-muted text-[11px]">everyone, together</p>
				</div>
				<div class="panel px-4 py-3">
					<p class="eyebrow">medals</p>
					<p class="font-display text-2xl font-bold tabular-nums">
						{room.medals.length}
					</p>
					<p class="text-muted text-[11px]">earned in this room</p>
				</div>
			</div>

			<div class="mt-4 flex flex-wrap items-center gap-2">
				{#if room.upcoming[0]}
					{@const next = room.upcoming[0]}
					<a
						href="/r/{room.slug}/sessions"
						class="panel hover:border-muted/40 flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5"
					>
						<CalendarClock size={15} class="text-muted shrink-0" />
						<span class="min-w-0">
							<span class="eyebrow">next session</span>
							<span class="block truncate text-sm font-medium"
								>{next.workoutName}</span
							>
							<span class="text-muted block text-[11px]"
								>{formatWhen(next.startsAt, true)} · planned by {next.createdBy}</span
							>
						</span>
					</a>
				{:else if room.canControl}
					<button
						onclick={() => room.openPicker('plan')}
						class="btn btn-secondary"
						><CalendarClock size={14} /> Plan a session</button
					>
				{/if}
				<a href="/r/{room.slug}/members" class="btn btn-ghost"
					><UserPlus size={14} /> Invite</a
				>
			</div>
		</section>
	{/if}
</div>
