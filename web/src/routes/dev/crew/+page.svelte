<script lang="ts">
	// MOCK (#1023): crew navigation, drawn rather than argued.
	//
	// ADR-0038 puts a crew above the room and amends ADR-0020's sizing
	// argument — "WattRoom has five rooms of five places" was why the tree got
	// one column, and the tree is now three deep. This page is the re-argument,
	// at true width, with the states the cutover (#1106) must not lose.
	//
	// Static data, real tokens. Nothing here is wired to a room.
	import Column from './Column.svelte';
	import RoomIcon from '$lib/components/RoomIcon.svelte';
	import Ban from '@lucide/svelte/icons/ban';
	import Eye from '@lucide/svelte/icons/eye';
	import Lock from '@lucide/svelte/icons/lock';
	import Pencil from '@lucide/svelte/icons/pencil';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';

	const options = [
		{
			shape: 'indent' as const,
			name: 'A · Indent it',
			claim:
				'The crew is a third level in the same column. Collapsible; a shut crew keeps a pulse so it still answers "where is everyone".',
			cost: 'Two indents. The room row and the place row are 4 px apart in meaning and 16 px apart on screen, and three crews of four rooms is a column you scroll to reach Settings.',
		},
		{
			shape: 'rail' as const,
			name: 'B · Crew rail',
			claim:
				'Discord literally: crews in a 48 px icon strip, the selected crew’s rooms in the column.',
			cost: 'The shape ADR-0020 rejected on sight — "two vertical navigations side by side read as confusion". 48 px cannot say "Sweet Spot, 12 min in", so the rail spends a dot on what the column spells out.',
		},
		{
			shape: 'switcher' as const,
			name: 'C · Crew is a mode',
			claim:
				'One crew at a time. The column below keeps exactly the two-deep shape ADR-0020 sized for; the third level becomes a switch, not an indent.',
			cost: 'The other crews go dark. The strip under the switcher is the price — it has to carry their live state, or the sidebar stops being the radar ADR-0010 makes it.',
		},
	];

	const access = [
		{
			icon: null,
			label: 'Open to the crew',
			body: 'ADR-0038’s default for rooms made after the cutover. No mark — the absence of one is the state.',
		},
		{
			icon: Eye,
			label: 'Private, and you are in it',
			body: 'Crew role plus named exceptions. Every room that exists at migration lands here, with its current membership as the exceptions.',
		},
		{
			icon: Lock,
			label: 'Private, and you are not',
			body: 'Visible because you are crew, not enterable. The row must not look like a room you failed to load.',
		},
		{
			icon: SlidersHorizontal,
			label: 'Yours to administer, not to read',
			body: 'A crew admin who never joined: manage its permissions, see it listed. Not rename, not ban, not enter, not read.',
		},
	];
</script>

<main class="mx-auto max-w-6xl px-6 py-12">
	<a href="/dev" class="text-muted hover:text-ink text-sm">← Design mocks</a>
	<h1 class="font-display mt-4 text-3xl font-bold tracking-tight">
		Crew navigation
	</h1>
	<p class="text-muted mt-2 max-w-2xl text-sm">
		ADR-0038 puts a crew above the room, so the tree is
		<span class="text-ink font-medium">crew → room → place</span>. ADR-0020 gave
		the sidebar one column because “WattRoom has five rooms of five places”, and
		says explicitly that the arithmetic must be re-argued rather than quietly
		inherited. Three answers, same rooms, same 240 px.
	</p>

	<section class="mt-10 grid gap-8 lg:grid-cols-3">
		{#each options as option (option.shape)}
			<div>
				<h2 class="font-display text-lg font-semibold">{option.name}</h2>
				<p class="text-muted mt-1 text-[13px]">{option.claim}</p>
				<p class="text-muted/80 mt-2 text-[13px]">
					<span class="text-ink/70 font-medium">Costs:</span>
					{option.cost}
				</p>
				<div class="mt-4 flex">
					<Column shape={option.shape} />
				</div>
			</div>
		{/each}
	</section>

	<p class="text-muted mt-6 max-w-3xl text-[13px]">
		All three are operable — collapse a crew in A, pick one in B and C. The one
		thing to try before reacting: <span class="text-ink"
			>shut every crew in A</span
		>, and
		<span class="text-ink">switch away from Natron in C</span>. Both are the
		moment the shape either keeps answering “where is everyone right now” or
		stops.
	</p>

	<section class="mt-14">
		<h2 class="font-display text-xl font-semibold">
			Permission state, on the row
		</h2>
		<p class="text-muted mt-1 max-w-2xl text-sm">
			A room private to part of the crew has to look different from an open one
			without opening it, and different again from one you may administer but
			not read. Four states, one column of 240 px.
		</p>
		<ul class="mt-5 grid gap-3 sm:grid-cols-2">
			{#each access as state (state.label)}
				<li class="card p-4">
					<span class="flex items-center gap-2">
						{#if state.icon}<state.icon
								size={13}
								class="text-muted/60"
							/>{:else}<span class="inline-block w-[13px]"></span>{/if}
						<span class="text-sm font-medium">{state.label}</span>
					</span>
					<p class="text-muted mt-1.5 text-[13px]">{state.body}</p>
				</li>
			{/each}
		</ul>
	</section>

	<section class="mt-14">
		<h2 class="font-display text-xl font-semibold">
			Two bans, and they must not be confused
		</h2>
		<p class="text-muted mt-1 max-w-2xl text-sm">
			ADR-0038 keeps the room ban exactly as it is and adds a crew ban that
			removes a person from every room in the crew and prevents rejoining. Same
			word, different blast radius — so they cannot share a control.
		</p>
		<div class="mt-5 grid gap-4 sm:grid-cols-2">
			<div class="card p-4">
				<span class="flex items-center gap-2 text-sm font-medium">
					<Ban size={14} class="text-danger" /> Ban from this room
				</span>
				<p class="text-muted mt-1.5 text-[13px]">
					A room-level act, from the room’s own Members page, by its owner or
					coach. Keeps the seat: the membership row stays so a rejoin by code
					lands back on the ban.
				</p>
				<p class="text-muted/70 mt-2 text-[13px]">
					Reaches: <span class="text-ink/80">Thursday Threshold.</span> They stay
					in Natron and keep every other room.
				</p>
			</div>
			<div class="card border-danger/40 p-4">
				<span class="flex items-center gap-2 text-sm font-medium">
					<Ban size={14} class="text-danger" /> Ban from the crew
				</span>
				<p class="text-muted mt-1.5 text-[13px]">
					A crew-level act, from the crew’s own people list, by a crew admin.
					Never offered from inside a room — the two live in different places
					precisely so one cannot be clicked in mistake for the other.
				</p>
				<p class="text-muted/70 mt-2 text-[13px]">
					Reaches: <span class="text-ink/80">all four Natron rooms</span>, and
					no code will let them back into any of them.
				</p>
			</div>
		</div>
	</section>

	<section class="mt-14">
		<h2 class="font-display text-xl font-semibold">Day one</h2>
		<p class="text-muted mt-1 max-w-2xl text-sm">
			The migration gives every owner one crew named after them, holding their
			rooms, private, with today’s membership as the named exceptions. This is
			the first screen anyone sees, and the rename is the first thing anyone
			does — so it is one field, not a settings page.
		</p>
		<div class="mt-5 flex flex-wrap items-start gap-6">
			<div class="bg-surface border-ink/5 w-60 shrink-0 rounded-lg border p-3">
				<span class="flex items-center gap-2">
					<RoomIcon icon="zap" size={16} />
					<span class="font-display truncate text-sm font-bold">Jan’s crew</span
					>
					<Pencil size={13} class="text-muted ml-auto shrink-0" />
				</span>
				<p class="text-muted/70 mt-2 text-[11px]">
					3 rooms · named after you · rename it
				</p>
			</div>
			<p class="text-muted max-w-md text-[13px]">
				Two things this screen must not do. It must not present the name as a
				decision already made — “Jan’s crew” is a placeholder wearing a real
				name, and a rider who does not notice it is editable will keep it
				forever. And it must not announce a privacy change, because there isn’t
				one: every migrated room lands private with exactly the people who were
				already in it. Nothing became visible to anyone on day one.
			</p>
		</div>
	</section>

	<section class="mt-14">
		<h2 class="font-display text-xl font-semibold">
			Where this disagrees with the issue
		</h2>
		<ul class="text-muted mt-3 max-w-3xl list-disc space-y-2 pl-5 text-[13px]">
			<li>
				<span class="text-ink"
					>“A rider who belongs to a crewless room, alongside crews.”</span
				>
				ADR-0038 settled after that was written and says crewless rooms do not exist
				— every room belongs to a crew permanently, and the migration is what makes
				that survivable. So it is not drawn. If crewless rooms should exist, that
				reopens the ADR rather than this mock.
			</li>
			<li>
				<span class="text-ink">Crew chat</span> is drawn nowhere yet. ADR-0038 gives
				the crew a chat, rooms already have theirs, and #1017 is rationalising the
				messages section in parallel — three surfaces converging, and guessing at
				the answer here would collide with that work. It wants its own pass once #1017
				lands.
			</li>
		</ul>
	</section>
</main>
