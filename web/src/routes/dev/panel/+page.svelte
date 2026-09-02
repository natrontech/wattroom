<script lang="ts">
	// MOCK (#504): four ways to arrange the room's right column, at true size.
	// Today's column stacks roster + jukebox + chat in 320 px and each of the
	// three fights the other two for height. Static data, no room state.
	import Avatar from '$lib/components/Avatar.svelte';
	import {
		Bell,
		ChevronDown,
		ChevronRight,
		Crown,
		Flame,
		Headphones,
		ListPlus,
		MessageSquare,
		Mic,
		MicOff,
		Music,
		Pause,
		Pencil,
		SkipForward,
		Video,
		Volume2,
	} from '@lucide/svelte';

	type Rider = {
		name: string;
		voice: boolean;
		speaking?: boolean;
		muted?: boolean;
		cam?: boolean;
		coach?: boolean;
	};

	const riders: Rider[] = [
		{ name: 'Jan Lauber', voice: true, speaking: true, cam: true, coach: true },
		{ name: 'David Kneubühler', voice: true, cam: true },
		{ name: 'Sven Gerber', voice: true, muted: true },
		{ name: 'Mike Weber', voice: false },
		{ name: 'Lena Roth', voice: false },
	];
	const inVoice = riders.filter((r) => r.voice);
	const inRoom = riders.filter((r) => !r.voice);

	const queue = [
		{ title: 'Fred again.. — Delilah (pull me out of this)', by: 'David' },
		{ title: 'Justice — Genesis', by: 'Jan' },
		{ title: 'Bicep — Glue', by: 'Sven' },
	];

	const chat = [
		{ from: 'Sven Gerber', at: '23:24', text: 'ftp test next week?' },
		{ from: 'Jan Lauber', at: '23:26', text: 'after the block, yeah' },
		{
			from: 'David Kneubühler',
			at: '23:31',
			text: 'queue this one → youtu.be/LwFo68d3Lx0',
			react: 3,
		},
		{ from: 'Sven Gerber', at: '23:32', text: 'good call' },
		{ from: 'Jan Lauber', at: '23:33', text: 'warming up now, 2 min' },
		{ from: 'Mike Weber', at: '23:34', text: 'joining in 5' },
	];

	// B is only judgeable if the tabs move; C only if the roster expands.
	let tab = $state<'people' | 'music' | 'chat'>('chat');
	let peopleOpen = $state(false);
</script>

{#snippet person(r: Rider, dense = false)}
	<li
		class="flex items-center gap-2 rounded px-2 {dense
			? 'min-h-8 py-0.5'
			: 'min-h-11 py-1'} text-xs {r.speaking ? 'text-ink' : 'text-ink/70'}"
	>
		<span class="relative shrink-0">
			<Avatar name={r.name} size={dense ? 18 : 22} />
			<span
				class="bg-z4 ring-surface absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ring-2"
			></span>
		</span>
		<span class="min-w-0 flex-1 truncate {r.speaking ? 'font-medium' : ''}"
			>{r.name}</span
		>
		{#if r.coach}<Crown size={11} class="text-muted shrink-0" />{/if}
		{#if r.cam}<Video size={11} class="text-muted shrink-0" />{/if}
		{#if r.speaking}<Mic
				size={11}
				class="text-z4 shrink-0"
			/>{:else if r.muted}<MicOff
				size={11}
				class="text-muted/50 shrink-0"
			/>{/if}
		{#if r.voice && !dense}<Volume2
				size={12}
				class="text-muted/50 shrink-0"
			/>{/if}
	</li>
{/snippet}

{#snippet voiceBar()}
	<div class="flex flex-wrap items-center gap-1.5 px-3 pb-2">
		<button class="btn btn-secondary btn-xs"><Mic size={13} /> Mic</button>
		<button class="btn btn-secondary btn-xs"><Video size={13} /> Camera</button>
	</div>
{/snippet}

{#snippet nowPlaying(compact = false)}
	<div class="flex items-center gap-2 px-3 {compact ? 'py-2' : 'py-3'}">
		<Music size={13} class="text-muted shrink-0" />
		<span class="min-w-0 flex-1 truncate text-xs">Fred again.. — Delilah</span>
		<button class="text-muted hover:text-ink" aria-label="pause"
			><Pause size={14} /></button
		>
		<button class="text-muted hover:text-ink" aria-label="skip"
			><SkipForward size={14} /></button
		>
	</div>
{/snippet}

{#snippet queueList()}
	<ul class="space-y-1 px-3 pb-3">
		{#each queue as q (q.title)}
			<li class="flex items-baseline gap-2 text-[11px]">
				<span class="text-muted/50 shrink-0 font-mono">·</span>
				<span class="min-w-0 flex-1 truncate">{q.title}</span>
				<span class="text-muted/50 shrink-0">{q.by}</span>
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet chatLog(lines: typeof chat)}
	<ul class="mt-auto space-y-2 px-3 py-2">
		{#each lines as m (m.at)}
			<li class="text-xs leading-snug">
				<div class="flex items-baseline gap-1.5">
					<span class="text-muted truncate font-medium">{m.from}</span>
					<span class="text-muted/40 font-mono text-[10px]">{m.at}</span>
				</div>
				<div class="text-ink/85 wrap-anywhere">{m.text}</div>
				{#if m.react}
					<span
						class="border-muted/20 text-muted mt-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]"
						><Flame size={10} /> {m.react}</span
					>
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet composer()}
	<div class="border-ink/5 border-t p-3">
		<div class="flex gap-1.5">
			<span
				class="input input-xs text-muted/50 min-w-0 flex-1 truncate leading-6"
				>Say something…</span
			>
			<button class="btn btn-secondary btn-xs">Send</button>
		</div>
	</div>
{/snippet}

{#snippet frame(title: string, note: string, accent: boolean)}
	<div class="flex w-80 shrink-0 flex-col gap-2">
		<div class="flex items-baseline gap-2">
			<span class="font-display text-sm {accent ? 'text-neon' : 'text-ink'}"
				>{title}</span
			>
		</div>
		<p class="text-muted h-16 text-xs leading-snug">{note}</p>
	</div>
{/snippet}

<div class="page space-y-8 py-8">
	<header class="space-y-2">
		<h1 class="font-display text-2xl">The room's right column</h1>
		<p class="text-muted max-w-2xl text-sm">
			Members, the jukebox and the chat share 320 px and none of them has
			enough. Four arrangements at true size — today's, then three ways out.
			Tabs and the roster in C are live; everything else is static.
		</p>
	</header>

	<div class="flex gap-6 overflow-x-auto pb-4">
		<!-- ============ TODAY ============ -->
		<div class="w-80 shrink-0 space-y-2">
			{@render frame(
				'Today',
				'Roster capped at 14 rem, deck capped at 45%, chat takes what is left. The deck holds a hole open for a player that is docked on the stage, so the log is down to a couple of lines.',
				false,
			)}
			<div
				class="border-ink/10 bg-surface flex h-[700px] flex-col overflow-hidden rounded border"
			>
				<div class="border-ink/5 max-h-56 shrink-0 overflow-y-auto border-b">
					<div class="eyebrow flex items-center gap-1.5 px-3 pt-3 pb-1">
						<Headphones size={10} /> in voice — 3
					</div>
					{@render voiceBar()}
					<ul class="px-1">
						{#each inVoice as r (r.name)}{@render person(r)}{/each}
					</ul>
					<div class="eyebrow px-3 pt-2 pb-1">in the room — 2</div>
					<ul class="px-1 pb-2">
						{#each inRoom as r (r.name)}{@render person(r)}{/each}
					</ul>
				</div>
				<div class="border-ink/5 shrink-0 border-b">
					<div
						class="bg-surface-raised text-muted/50 m-3 flex h-[200px] items-center justify-center rounded text-[11px]"
					>
						the player docks here
					</div>
					{@render nowPlaying()}
				</div>
				<div class="eyebrow shrink-0 px-3 pt-2">chat</div>
				<div
					{@attach (n) => void (n.scrollTop = n.scrollHeight)}
					class="flex min-h-0 flex-1 flex-col overflow-y-auto"
				>
					{@render chatLog(chat.slice(-3))}
				</div>
				{@render composer()}
			</div>
		</div>

		<!-- ============ A ============ -->
		<div class="w-80 shrink-0 space-y-2">
			{@render frame(
				'A — chat is a place',
				'The column is people + jukebox only. Chat moves to the room’s own place, next to Lounge and Training, and is the full-width view we already render at /messages. The column gets a one-line unread bar instead.',
				true,
			)}
			<div
				class="border-ink/10 bg-surface flex h-[700px] flex-col overflow-hidden rounded border"
			>
				<div class="border-ink/5 min-h-0 flex-1 overflow-y-auto border-b">
					<div class="eyebrow flex items-center gap-1.5 px-3 pt-3 pb-1">
						<Headphones size={10} /> in voice — 3
					</div>
					{@render voiceBar()}
					<ul class="px-1">
						{#each inVoice as r (r.name)}{@render person(r)}{/each}
					</ul>
					<div class="eyebrow px-3 pt-2 pb-1">in the room — 2</div>
					<ul class="px-1 pb-2">
						{#each inRoom as r (r.name)}{@render person(r)}{/each}
					</ul>
				</div>
				<div class="shrink-0">
					<div class="eyebrow px-3 pt-3 pb-1">jukebox</div>
					{@render nowPlaying(true)}
					{@render queueList()}
					<div class="px-3 pb-3">
						<button class="btn btn-secondary btn-xs w-full"
							><ListPlus size={13} /> Queue something</button
						>
					</div>
				</div>
				<!-- The one thing chat leaves behind: a bar that says what you missed. -->
				<button
					class="border-ink/5 bg-surface-raised hover:bg-surface-raised/70 flex shrink-0 items-center gap-2 border-t px-3 py-3 text-left"
				>
					<span class="bg-neon relative flex h-2 w-2 shrink-0 rounded-full"
					></span>
					<span class="min-w-0 flex-1 truncate text-xs"
						><span class="text-muted">David:</span> queue this one</span
					>
					<span class="text-muted shrink-0 text-[10px]">3 new</span>
					<ChevronRight size={13} class="text-muted shrink-0" />
				</button>
			</div>
		</div>

		<!-- ============ B ============ -->
		<div class="w-80 shrink-0 space-y-2">
			{@render frame(
				'B — one column, three tabs',
				'A permanent avatar rail keeps the "who is here" read, then People / Music / Chat take turns at full height. Badges say what happened on the tabs you are not looking at. Click the tabs.',
				true,
			)}
			<div
				class="border-ink/10 bg-surface flex h-[700px] flex-col overflow-hidden rounded border"
			>
				<!-- The rail is the answer to what tabbing costs: the roster is never
				     fully gone, it is just small. -->
				<div class="border-ink/5 flex shrink-0 items-center gap-1 border-b p-2">
					{#each riders as r (r.name)}
						<span
							class="relative {r.speaking ? 'ring-z4 rounded-full ring-2' : ''}"
						>
							<Avatar name={r.name} size={24} />
						</span>
					{/each}
					<span class="text-muted ml-auto text-[10px]">5 here · 3 in voice</span
					>
				</div>
				<div class="border-ink/5 flex shrink-0 border-b text-xs">
					{#each [{ id: 'people', label: 'People', badge: '' }, { id: 'music', label: 'Music', badge: '' }, { id: 'chat', label: 'Chat', badge: '3' }] as t (t.id)}
						<button
							onclick={() => (tab = t.id as typeof tab)}
							class="flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2 {tab ===
							t.id
								? 'border-neon text-ink'
								: 'text-muted hover:text-ink border-transparent'}"
						>
							{t.label}
							{#if t.badge && tab !== t.id}
								<span
									class="bg-neon text-paper rounded-full px-1.5 text-[10px] leading-4"
									>{t.badge}</span
								>
							{/if}
						</button>
					{/each}
				</div>
				<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
					{#if tab === 'people'}
						<div class="eyebrow flex items-center gap-1.5 px-3 pt-3 pb-1">
							<Headphones size={10} /> in voice — 3
						</div>
						{@render voiceBar()}
						<ul class="px-1">
							{#each inVoice as r (r.name)}{@render person(r)}{/each}
						</ul>
						<div class="eyebrow px-3 pt-2 pb-1">in the room — 2</div>
						<ul class="px-1 pb-2">
							{#each inRoom as r (r.name)}{@render person(r)}{/each}
						</ul>
					{:else if tab === 'music'}
						{@render nowPlaying()}
						<div class="eyebrow px-3 pt-2 pb-1">up next — 3</div>
						{@render queueList()}
						<div class="px-3">
							<button class="btn btn-secondary btn-xs w-full"
								><ListPlus size={13} /> Queue something</button
							>
						</div>
					{:else}
						{@render chatLog(chat)}
					{/if}
				</div>
				{@render composer()}
			</div>
		</div>

		<!-- ============ C ============ -->
		<div class="w-80 shrink-0 space-y-2">
			{@render frame(
				'C — the column collapses what you are not using',
				'Nothing moves and nothing hides: people become an avatar wrap you can open, the jukebox becomes one line while its player is docked elsewhere, and chat takes every pixel that frees up. Click the roster.',
				true,
			)}
			<div
				class="border-ink/10 bg-surface flex h-[700px] flex-col overflow-hidden rounded border"
			>
				<button
					onclick={() => (peopleOpen = !peopleOpen)}
					class="border-ink/5 flex w-full shrink-0 items-center gap-2 border-b px-3 py-2 text-left"
				>
					<span class="flex flex-1 flex-wrap items-center gap-1">
						{#each riders as r (r.name)}
							<span class={r.speaking ? 'ring-z4 rounded-full ring-2' : ''}>
								<Avatar name={r.name} size={22} />
							</span>
						{/each}
					</span>
					<span class="text-muted shrink-0 text-[10px]">5 · 3 in voice</span>
					{#if peopleOpen}<ChevronDown
							size={13}
							class="text-muted shrink-0"
						/>{:else}<ChevronRight size={13} class="text-muted shrink-0" />{/if}
				</button>
				{#if peopleOpen}
					<div class="border-ink/5 shrink-0 border-b">
						{@render voiceBar()}
						<ul class="px-1 pb-2">
							{#each riders as r (r.name)}{@render person(r, true)}{/each}
						</ul>
					</div>
				{/if}
				<div class="border-ink/5 shrink-0 border-b">
					{@render nowPlaying(true)}
				</div>
				<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
					{@render chatLog(chat)}
				</div>
				{@render composer()}
			</div>
		</div>
	</div>

	<!-- ============ WHERE THE UNREAD SHOWS ============ -->
	<section class="space-y-3">
		<h2 class="font-display text-lg">
			Where "someone wrote" shows when chat is not on screen
		</h2>
		<p class="text-muted max-w-2xl text-sm">
			Only A and B can hide the chat, so only they need this. Three surfaces, in
			order of how loud they are.
		</p>
		<div class="grid gap-4 md:grid-cols-3">
			<div class="panel space-y-2 p-4">
				<div class="eyebrow">1 — the room's place, in the sidebar</div>
				<div class="bg-surface space-y-1 rounded p-2 text-sm">
					<div class="text-muted flex items-center gap-2 px-2 py-1">
						<Headphones size={13} /> Lounge
					</div>
					<div
						class="bg-surface-raised flex items-center gap-2 rounded px-2 py-1"
					>
						<MessageSquare size={13} /> Chat
						<span
							class="bg-neon text-paper ml-auto rounded-full px-1.5 text-[10px] leading-4"
							>3</span
						>
					</div>
					<div class="text-muted flex items-center gap-2 px-2 py-1">
						<Pencil size={13} /> Training
					</div>
				</div>
				<p class="text-muted text-xs">
					Always on. The count is the room's unread, the same badge the sidebar
					already draws for a room you are not in.
				</p>
			</div>
			<div class="panel space-y-2 p-4">
				<div class="eyebrow">2 — a line in the column</div>
				<div class="bg-surface rounded p-2">
					<div class="text-muted flex items-center gap-1.5 px-1 py-1 text-xs">
						<span class="bg-z4 h-1.5 w-1.5 animate-pulse rounded-full"></span>
						David is typing…
					</div>
					<button
						class="bg-surface-raised mt-1 flex w-full items-center gap-2 rounded px-2 py-2 text-left"
					>
						<span class="bg-neon h-2 w-2 shrink-0 rounded-full"></span>
						<span class="min-w-0 flex-1 truncate text-xs"
							><span class="text-muted">David:</span> queue this one</span
						>
						<ChevronRight size={13} class="text-muted shrink-0" />
					</button>
				</div>
				<p class="text-muted text-xs">
					Quiet and glanceable from a bike. Typing lives here too — it is the
					only place it makes sense when the log is elsewhere.
				</p>
			</div>
			<div class="panel space-y-2 p-4">
				<div class="eyebrow">3 — a toast, for a mention only</div>
				<div class="bg-surface rounded p-2">
					<div
						class="border-neon/40 bg-surface-raised flex items-start gap-2 rounded border px-3 py-2"
					>
						<Bell size={13} class="text-neon mt-0.5 shrink-0" />
						<span class="text-xs"
							><span class="font-medium">David</span> mentioned you — "@jan queue
							this one"</span
						>
					</div>
				</div>
				<p class="text-muted text-xs">
					Every message as a toast is unusable mid-ride. A mention is the one
					thing worth interrupting for, and it is the rule the rest of the app
					already follows.
				</p>
			</div>
		</div>
	</section>

	<section class="panel max-w-3xl space-y-3 p-5">
		<h2 class="font-display text-lg">What I would build</h2>
		<p class="text-sm">
			<span class="text-neon font-medium">C now, A next.</span> C is the smallest
			change that fixes the actual complaint — the deck's 200 px hole and the roster's
			14 rem are what is eating the chat, and collapsing both gives chat roughly 380
			px in the same column without moving anything or teaching anyone a new place.
		</p>
		<p class="text-sm">
			A is the better end state and it is half-built already: the room's chat
			renders full-width at <span class="font-mono text-xs"
				>/messages/r/&lt;slug&gt;</span
			>
			today. Making it a room place is mostly routing plus the unread bar and the
			sidebar badge. Do it once C proves how much of the column people actually want
			back.
		</p>
		<p class="text-sm">
			B I would not build. The rail costs the roster its execution bars
			mid-ride, the tabs put chat one click away without giving it a place of
			its own, and a badge you have to notice is worse than a place you can go
			to.
		</p>
	</section>
</div>
