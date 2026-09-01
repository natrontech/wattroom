<script lang="ts">
	// ADR-0020 made clickable. One frame, four columns, every route rendered
	// inside it — so the shape is decided by looking rather than by argument.
	//
	// The toolbar controls exist because they are the three things the ADR is
	// least sure about: the members column (three answers, one has to win), the
	// viewport ladder (does 1280 px survive four columns), and the scheme (the
	// lounge is a desk surface, the ride is the cave — both have to hold).
	import EdgeScreens from './EdgeScreens.svelte';
	import PeopleColumn from './PeopleColumn.svelte';
	import PlacesColumn from './PlacesColumn.svelte';
	import RoomPlaces from './RoomPlaces.svelte';
	import RoomsColumn from './RoomsColumn.svelte';
	import SidebarColumn from './SidebarColumn.svelte';
	import YourPlaces from './YourPlaces.svelte';
	import YourStats from './YourStats.svelte';
	import { createRoom } from '../room/mockRoom.svelte';
	import { GROUPS, SCREENS } from './shape';
	import { onDestroy } from 'svelte';
	import { palette } from '$lib/palette.svelte';

	const room = createRoom();
	$effect(() => {
		void room.start();
		return room.stop;
	});

	let id = $state('room-lounge');
	let nav = $state<'one' | 'two'>('one');
	let members = $state<'stacked' | 'tabbed' | 'column'>('stacked');
	let width = $state(1600);
	let scheme = $state<'dark' | 'light'>('dark');

	const screen = $derived(SCREENS.find((s) => s.id === id)!);
	// The ladder from ADR-0020: column 2 collapses to icons below 1600, the
	// people column goes to a sheet below 1280. A media query in the real
	// build; a number here, so both sides are visible at once.
	const collapsed = $derived(width < 1600);
	const people = $derived(width >= 1280);
	const you = $derived(room.riders.find((r) => r.you)!);

	// The mock drives the simulated room into the state each screen needs.
	$effect(() => {
		const want =
			screen.caved && screen.id !== 'room-countdown'
				? 'live'
				: screen.id === 'room-countdown'
					? 'countdown'
					: 'lounge';
		if (room.phase !== want) room.setPhase(want);
	});

	const speaking = $derived(room.riders.find((r) => r.speaking)?.name ?? '');

	// data-theme on :root is what the app's own toggle sets, and it is the only
	// lever that re-resolves the tokens — light-dark() cannot be un-resolved
	// further down the tree, so an inline color-scheme on the frame does
	// nothing. The attribute alone is not enough either: the palette writes the
	// resolved tokens onto :root, so it has to re-render under the new scheme —
	// which is exactly what theme.svelte.ts does after flipping.
	$effect(() => {
		document.documentElement.dataset.theme = screen.caved ? 'dark' : scheme;
		palette.refresh();
	});
	onDestroy(() => {
		delete document.documentElement.dataset.theme;
		palette.refresh();
	});
	const navWidth = $derived(
		screen.context === 'bare'
			? 0
			: nav === 'one'
				? 240
				: 208 + (collapsed ? 56 : 176),
	);
	const contentWidth = $derived(
		width -
			navWidth -
			(screen.context === 'room' && people
				? members === 'column'
					? 480
					: 272
				: 0),
	);
</script>

<div class="flex h-full min-h-0 flex-col">
	<!-- Toolbar. Not part of the design — it is the mock's own chrome. -->
	<div
		class="border-muted/15 bg-surface-raised flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2 text-xs"
	>
		<label class="flex items-center gap-1.5">
			<span class="text-muted">screen</span>
			<select bind:value={id} class="input input-xs">
				{#each GROUPS as group (group)}
					<optgroup label={group}>
						{#each SCREENS.filter((s) => s.group === group) as entry (entry.id)}
							<option value={entry.id}>{entry.label}</option>
						{/each}
					</optgroup>
				{/each}
			</select>
		</label>

		<label class="flex items-center gap-1.5">
			<span class="text-muted">nav</span>
			<select bind:value={nav} class="input input-xs">
				<option value="one">one sidebar — rooms open into their places</option>
				<option value="two">two columns — Discord's literal shape</option>
			</select>
		</label>

		<label class="flex items-center gap-1.5">
			<span class="text-muted">members</span>
			<select bind:value={members} class="input input-xs">
				<option value="stacked">stacked — roster above chat</option>
				<option value="tabbed">tabbed — chat / members</option>
				<option value="column">column — its own, beside chat</option>
			</select>
		</label>

		<label class="flex items-center gap-1.5">
			<span class="text-muted">viewport</span>
			<select bind:value={width} class="input input-xs">
				<option value={1920}>1920</option>
				<option value={1600}>1600</option>
				<option value={1440}>1440</option>
				<option value={1280}>1280</option>
			</select>
		</label>

		<label class="flex items-center gap-1.5">
			<span class="text-muted">scheme</span>
			<select
				bind:value={scheme}
				disabled={screen.caved}
				class="input input-xs"
			>
				<option value="dark">dark</option>
				<option value="light">light</option>
			</select>
			{#if screen.caved}
				<span class="text-muted/60">the ride is always the cave</span>
			{/if}
		</label>

		<span class="text-muted/70 ml-auto tabular-nums"
			>content column ≈ {Math.max(0, contentWidth)} px</span
		>
	</div>

	<p
		class="text-muted border-muted/15 shrink-0 border-b px-4 py-1.5 text-[11px]"
	>
		{screen.note}
	</p>

	<div class="min-h-0 flex-1 overflow-auto p-4">
		<!-- The dev layout forces .cave; a desk surface has to be able to say no,
		     or half of ADR-0020 cannot be looked at. -->
		<div
			class="ring-muted/20 mx-auto overflow-hidden rounded-lg ring-1 {screen.caved
				? 'cave'
				: ''} bg-surface text-ink"
			style="width: {width}px; max-width: 100%; height: 860px"
		>
			{#if screen.context === 'bare'}
				<EdgeScreens
					screen={screen.id}
					riders={room.riders}
					segments={room.segments}
					total={room.total}
					elapsed={room.elapsed}
					block={room.block}
				/>
			{:else}
				<div class="relative flex h-full">
					{#if nav === 'one'}
						<SidebarColumn
							context={screen.context}
							place={screen.place}
							connectedSlug="thursday-sufferfest"
							live={room.phase === 'live'}
						/>
					{:else}
						<RoomsColumn
							activeSlug={screen.context === 'room'
								? 'thursday-sufferfest'
								: ''}
							connectedSlug="thursday-sufferfest"
							live={room.phase === 'live'}
						/>
						<PlacesColumn
							context={screen.context}
							place={screen.place}
							roomName="Thursday Sufferfest"
							roomIcon="🔥"
							live={room.phase === 'live'}
							{collapsed}
						/>
					{/if}
					<main class="min-w-0 flex-1 overflow-hidden">
						{#if screen.group === 'In a room'}
							<RoomPlaces
								screen={screen.id}
								riders={room.riders}
								segments={room.segments}
								total={room.total}
								elapsed={room.elapsed}
								block={room.block}
								bias={room.bias}
								countdown={room.countdown}
							/>
						{:else if ['home', 'rooms', 'sessions', 'workouts', 'editor'].includes(screen.id)}
							<YourPlaces
								screen={screen.id}
								segments={room.segments}
								total={room.total}
							/>
						{:else}
							<YourStats
								screen={screen.id}
								segments={room.segments}
								total={room.total}
								elapsed={room.elapsed}
								{you}
							/>
						{/if}
					</main>
					{#if screen.context === 'room' && people}
						<PeopleColumn
							riders={room.riders}
							variant={members}
							speakingName={speaking}
						/>
					{/if}
					<!-- Overlays render over the frame they belong to. -->
					{#if screen.id === 'room-picker' || screen.id === 'room-summary'}
						<EdgeScreens
							screen={screen.id}
							riders={room.riders}
							segments={room.segments}
							total={room.total}
							elapsed={room.elapsed}
							block={room.block}
						/>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
