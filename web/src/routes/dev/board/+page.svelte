<script lang="ts">
	// Three arrangements of a board for a channel and for a crew, holding pins,
	// announcements and posts (#2413), drawn side by side so the choice is
	// made by looking rather than by argument. Mockups: nothing here is
	// wired, and two of the three describe things that do not exist yet.
	//
	// The question each one answers differently is NOT where the cards go. It
	// is what a **post** is, and whether pushing and pulling belong on one
	// surface — a pin is looked up on purpose, an announcement has to arrive.
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Pencil from '@lucide/svelte/icons/pencil';
	import PinIcon from '@lucide/svelte/icons/pin';
	import Plus from '@lucide/svelte/icons/plus';

	let scopeA = $state<'room' | 'crew'>('room');
	let scopeB = $state<'room' | 'crew'>('crew');

	const PINS = [
		{
			title: 'Minecraft',
			lines: [
				['Address', 'mc.natron.io:25565'],
				['Password', 'kilojoule-hammer-42'],
			] as [string, string][],
			note: 'Whitelist is on — ask Nina.',
			scope: 'crew' as const,
		},
		{
			title: 'The garage',
			lines: [['Door code', '4417']] as [string, string][],
			note: 'Last one out shuts the roller door.',
			scope: 'crew' as const,
		},
		{
			title: 'Tuesday intervals',
			lines: [['Workout', '4 × 8 @ 105%']] as [string, string][],
			note: 'We ride this one every Tuesday.',
			scope: 'room' as const,
		},
	];
</script>

{#snippet pinCard(pin: (typeof PINS)[number], compact = false)}
	<li class="panel panel-flush overflow-hidden">
		<div class="flex items-start gap-2 px-4 pt-3 pb-2">
			<p class="eyebrow min-w-0 flex-1 truncate">{pin.title}</p>
			<span class="text-muted -mt-1 -mr-2 shrink-0"><Pencil size={14} /></span>
		</div>
		{#each pin.lines as [label, value] (label)}
			<div class="flex items-baseline gap-3 px-4 py-2">
				<span class="text-muted w-20 shrink-0 truncate text-xs">{label}</span>
				<span class="min-w-0 flex-1 font-mono text-sm break-all">{value}</span>
			</div>
		{/each}
		{#if !compact}
			<p class="text-muted px-4 pt-1 pb-3 text-xs">{pin.note}</p>
		{/if}
		<div class="pb-1"></div>
	</li>
{/snippet}

{#snippet strip()}
	<div
		class="border-neon/40 bg-neon/5 flex items-start gap-3 rounded-lg border px-4 py-3"
	>
		<Megaphone size={16} class="text-muted mt-0.5 shrink-0" />
		<div class="min-w-0 flex-1">
			<p class="text-sm">
				No session Thursday — I'm away. Back the week after.
			</p>
			<p class="text-muted mt-1 text-xs">Nina · Today 18:15</p>
		</div>
	</div>
{/snippet}

{#snippet post(author: string, when: string, title: string, body: string)}
	<li class="panel">
		<p class="font-display text-sm font-bold">{title}</p>
		<p class="text-muted mt-1 text-xs">{body}</p>
		<p class="text-muted-dim mt-2 text-[11px]">{author} · {when} · 4 replies</p>
	</li>
{/snippet}

{#snippet scopeSwitch(
	value: 'room' | 'crew',
	set: (v: 'room' | 'crew') => void,
)}
	<div class="flex items-center gap-1">
		<button
			onclick={() => set('room')}
			class="btn btn-xs {value === 'room' ? 'btn-primary' : 'btn-ghost'}"
			>Velvet Hammer</button
		>
		<button
			onclick={() => set('crew')}
			class="btn btn-xs {value === 'crew' ? 'btn-primary' : 'btn-ghost'}"
			>Natron</button
		>
	</div>
{/snippet}

{#snippet sidebar(rows: string[], lit: string)}
	<div class="border-muted/15 w-40 shrink-0 border-r pr-3">
		<p class="eyebrow mb-2">velvet hammer</p>
		<ul class="space-y-0.5">
			{#each rows as row (row)}
				<li
					class="rounded px-2 py-1 text-xs {row === lit
						? 'bg-ink/5 text-ink font-medium'
						: 'text-muted'}"
				>
					{row}
				</li>
			{/each}
		</ul>
	</div>
{/snippet}

<main class="mx-auto max-w-5xl px-6 py-12">
	<h1 class="page-title">Board — three arrangements</h1>
	<p class="text-muted mt-2 max-w-2xl text-sm">
		A board for a room <em>and</em> for a crew, holding pins, announcements and posts
		(#2413). Nothing here is wired. The three differ on one question, and it is not
		where the cards go.
	</p>
	<div
		class="border-neon/40 bg-neon/5 mt-5 max-w-2xl rounded-lg border px-4 py-3"
	>
		<p class="eyebrow">decided: A, with the row at the top</p>
		<p class="text-muted mt-2 text-xs">
			One board, and its row sits <strong class="text-ink"
				>above the Lounge</strong
			>
			— which answers the objection filed against A below. That objection assumed
			a row somewhere down the list, where a notice is filed; on the first row a rider
			entering the room passes it. Shipped as
			<code>/r/[slug]/board</code>, holding the announcement and the pins. The
			Lounge keeps its strip for whoever is already inside.
		</p>
		<p class="text-muted mt-2 text-xs">
			The three pictures stay because the costs under them are still real, and
			because the next card types — a posted workout, a ride worth showing —
			meet the same question. Posts are not built: what a post can do that a
			chat message cannot is answered by the card's SHAPE, and each shape is its
			own decision.
		</p>
	</div>

	<div class="panel panel-lg mt-5 max-w-2xl">
		<p class="eyebrow">the question underneath</p>
		<p class="text-muted mt-2 text-xs">
			A <strong class="text-ink">pin</strong> is pulled: a rider goes looking
			for the server address. An <strong class="text-ink">announcement</strong>
			is pushed: it has to reach someone who was not looking. A
			<strong class="text-ink">post</strong>
			is the one with no agreed meaning yet — if it is "a message that does not scroll
			away", the room already has chat, and the honest version of that idea is a thread,
			not a card. Each arrangement below answers it differently, and the third declines
			to answer it at all.
		</p>
	</div>

	<!-- ─────────────────────────────────────────────────────────────────── -->
	<h2 class="eyebrow mt-12">A · one Board, cards of three kinds</h2>
	<p class="text-muted mt-2 max-w-2xl text-xs">
		One place per scope. The announcement is the first card, pins follow, posts
		below them. Scope is a switch at the top: this room, or the crew. Closest to
		what a Discord forum channel feels like.
	</p>
	<div class="panel panel-lg mt-4 flex gap-5">
		{@render sidebar(
			['Lounge', 'Chat', 'Training', 'Sessions', 'Board', 'Members'],
			'Board',
		)}
		<div class="min-w-0 flex-1">
			<div class="mb-1 flex items-center gap-3">
				<h3 class="font-display text-xl font-bold">Board</h3>
				<span class="ml-auto"
					>{@render scopeSwitch(scopeA, (v) => (scopeA = v))}</span
				>
			</div>
			<p class="text-muted mb-4 text-xs">
				{scopeA === 'room'
					? 'What this room keeps needing.'
					: 'What Natron keeps needing — the same board in every room of it.'}
			</p>
			{#if scopeA === 'room'}
				<div class="mb-3">{@render strip()}</div>
			{/if}
			<ul
				class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] items-start gap-3"
			>
				{#each PINS.filter((p) => p.scope === scopeA) as pin (pin.title)}
					{@render pinCard(pin, true)}
				{/each}
			</ul>
			<ul class="mt-3 space-y-2">
				{@render post(
					'Ruben',
					'Tuesday',
					'New wheels, worth it?',
					'Rode the 50s on Sunday and the crosswind was…',
				)}
			</ul>
			<div class="mt-3 flex gap-2">
				<button class="btn btn-secondary btn-xs"
					><PinIcon size={13} /> Pin</button
				>
				<button class="btn btn-secondary btn-xs"
					><MessageSquare size={13} /> Post</button
				>
			</div>
		</div>
	</div>
	<p class="text-muted-dim mt-2 max-w-2xl text-[11px]">
		<strong>Cost:</strong> the announcement stops arriving. It draws here, on a page
		a rider has to open, which is the one thing an announcement must not depend on.
		Keeping the strip on the Lounge as well means it is in two places.
	</p>

	<!-- ─────────────────────────────────────────────────────────────────── -->
	<h2 class="eyebrow mt-12">
		B · Board is the crew's; the room keeps its strip
	</h2>
	<p class="text-muted mt-2 max-w-2xl text-xs">
		The board is a crew surface — pins and posts, reached from the crew and from
		any of its rooms. The announcement stays what it is: a strip at the top of
		the room, pushed, not filed. Two surfaces, each doing one job.
	</p>
	<div class="panel panel-lg mt-4 flex gap-5">
		{@render sidebar(
			['Lounge', 'Chat', 'Training', 'Sessions', 'Board', 'Members'],
			'Lounge',
		)}
		<div class="min-w-0 flex-1">
			<div class="mb-3">{@render strip()}</div>
			<div class="border-muted/15 mt-4 border-t pt-4">
				<div class="mb-1 flex items-center gap-3">
					<h3 class="font-display text-xl font-bold">Natron's board</h3>
					<span class="ml-auto"
						>{@render scopeSwitch(scopeB, (v) => (scopeB = v))}</span
					>
				</div>
				<p class="text-muted mb-4 text-xs">
					Pins and posts belong to the crew; every room of it opens the same
					one.
				</p>
				<ul
					class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] items-start gap-3"
				>
					{#each PINS.filter((p) => p.scope === scopeB) as pin (pin.title)}
						{@render pinCard(pin, true)}
					{/each}
				</ul>
			</div>
		</div>
	</div>
	<p class="text-muted-dim mt-2 max-w-2xl text-[11px]">
		<strong>Cost:</strong> two homes to learn. A rider asking "where do I write something
		the room should see" has to know whether it is a notice or a note.
	</p>

	<!-- ─────────────────────────────────────────────────────────────────── -->
	<h2 class="eyebrow mt-12">C · what shipped, plus one thing</h2>
	<p class="text-muted mt-2 max-w-2xl text-xs">
		Pins are the crew's place, the announcement is the strip, and a
		<strong class="text-ink">post</strong>
		is a chat message with a title that keeps its own thread — drawn in the log where
		the conversation already is, rather than filed on a board nobody visits.
	</p>
	<div class="panel panel-lg mt-4 flex gap-5">
		{@render sidebar(
			['Lounge', 'Chat', 'Training', 'Sessions', 'Pins', 'Members'],
			'Chat',
		)}
		<div class="min-w-0 flex-1">
			<div class="mb-4">{@render strip()}</div>
			<ul class="space-y-2">
				<li class="text-muted text-xs">
					<span class="text-ink font-medium">Ruben</span> 18:22 · anyone riding tomorrow?
				</li>
				{@render post(
					'Ruben',
					'Tuesday',
					'New wheels, worth it?',
					'Rode the 50s on Sunday and the crosswind was…',
				)}
				<li class="text-muted text-xs">
					<span class="text-ink font-medium">Nina</span> 18:31 · depends how windy
					your Tuesdays are
				</li>
			</ul>
			<div class="border-muted/15 mt-4 flex items-center gap-2 border-t pt-3">
				<span class="input text-muted-dim flex-1 text-xs"
					>Message Velvet Hammer…</span
				>
				<button class="btn btn-secondary btn-xs"><Plus size={13} /> Post</button
				>
			</div>
		</div>
	</div>
	<p class="text-muted-dim mt-2 max-w-2xl text-[11px]">
		<strong>Cost:</strong> no single page that is "everything this crew wrote down".
		Posts are found by scrolling or searching chat, the way they are in every messenger.
	</p>

	<div class="panel panel-lg mt-10 max-w-2xl">
		<p class="eyebrow">what I argued at the time (A won, and was right to)</p>
		<p class="text-muted mt-2 text-xs">
			<strong class="text-ink">B</strong>, and only if a post is a real thing.
			It keeps the announcement arriving and gives the crew one page for what it
			wrote down. <strong class="text-ink">A</strong> reads best in a screenshot
			and quietly breaks the announcement, which is the whole reason it is not
			on a page today. <strong class="text-ink">C</strong> is the smallest and is
			right if "post" turns out to mean "a message I can find again" — that is a thread,
			and chat already holds threads.
		</p>
		<p class="text-muted mt-3 text-xs">
			So the question back is not which picture. It is:
			<strong class="text-ink"
				>what can a post do that a chat message cannot?</strong
			> If the answer is "stay put", B. If it is "have a title and replies", C with
			threads. If it is "be read by people not in the room", that is a third thing
			neither picture draws.
		</p>
	</div>
</main>
