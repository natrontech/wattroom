<script lang="ts">
	// MOCK (#451): messages as a place you can be in without being in the
	// room — rooms and DMs side by side, unread first, a room's chat readable
	// (and writable) without joining its voice or its ride. Static data.
	import Avatar from '$lib/components/Avatar.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import {
		BicepsFlexed,
		Flame,
		Headphones,
		Image as ImageIcon,
		PartyPopper,
		Radio,
		Search,
		Skull,
		Users,
	} from '@lucide/svelte';

	const threads = [
		{
			kind: 'room',
			name: 'Schwitzchaste',
			unread: 3,
			preview: 'David: queue this one',
			when: '23:33',
			here: 3,
			voice: 2,
			riding: true,
		},
		{
			kind: 'dm',
			name: 'Sven Gerber',
			unread: 1,
			preview: 'ftp test next week?',
			when: '23:29',
		},
		{
			kind: 'room',
			name: 'Thursday Sufferfest',
			unread: 0,
			preview: 'now playing: Fred again..',
			when: '22:03',
			here: 1,
			voice: 0,
			riding: false,
		},
		{
			kind: 'dm',
			name: 'David Kneubühler',
			unread: 0,
			preview: 'you: lol',
			when: 'Mon',
		},
		{
			kind: 'room',
			name: 'Test',
			unread: 0,
			preview: 'Mike: Was geht',
			when: 'Mon',
			here: 0,
			voice: 0,
			riding: false,
		},
	];
	const open = threads[0];
	const messages = [
		{ from: 'Sven Gerber', at: '23:29', text: '# test', reactions: [] },
		{
			from: 'Jan Lauber',
			at: '23:30',
			text: 'lol',
			reactions: [{ icon: Skull, n: 2 }],
		},
		{
			from: 'David Kneubühler',
			at: '23:33',
			text: 'https://www.youtube.com/watch?v=LwFo68d3Lx0',
			link: true,
			reactions: [
				{ icon: Flame, n: 3 },
				{ icon: PartyPopper, n: 1 },
			],
		},
		{ unreadFrom: true },
		{
			from: 'Mike Frei',
			at: '08:12',
			text: 'Was geht — who is riding tonight?',
			reactions: [],
		},
		{
			from: 'David Kneubühler',
			at: '08:14',
			text: 'me, 19:30. @Jan you in?',
			mention: true,
			reactions: [{ icon: BicepsFlexed, n: 1 }],
		},
		{
			from: 'David Kneubühler',
			at: '08:14',
			event: "David queued Fred again.. — brandon's night pt.1",
		},
	];
</script>

<main class="flex h-full min-h-0 flex-col">
	<p class="eyebrow px-6 pt-5">mock · chat as a place (#451)</p>
	<div
		class="border-ink/5 mt-2 grid min-h-0 flex-1 grid-cols-[18rem_minmax(0,1fr)] border-t"
	>
		<!-- The list: rooms and DMs together, unread on top, one line each. -->
		<aside class="border-ink/5 flex min-h-0 flex-col border-r">
			<div class="px-3 pt-3 pb-2">
				<label class="input input-xs flex items-center gap-2"
					><Search size={12} class="text-muted" /><input
						class="min-w-0 flex-1 bg-transparent outline-none"
						placeholder="Search messages"
					/></label
				>
			</div>
			<ul class="min-h-0 flex-1 overflow-y-auto px-2">
				{#each threads as t (t.name)}
					<li>
						<a
							href="/dev/chat"
							class="flex items-center gap-2.5 rounded px-2 py-2 {t === open
								? 'bg-surface-raised'
								: 'hover:bg-surface-raised/60'}"
						>
							{#if t.kind === 'room'}
								<span
									class="bg-surface grid h-8 w-8 shrink-0 place-items-center rounded"
									><Users size={14} class="text-muted" /></span
								>
							{:else}
								<Avatar name={t.name} size={32} />
							{/if}
							<span class="min-w-0 flex-1">
								<span class="flex items-baseline gap-2">
									<span
										class="truncate text-sm {t.unread ? 'font-semibold' : ''}"
										>{t.name}</span
									>
									<span
										class="text-muted/60 ml-auto shrink-0 font-mono text-[10px]"
										>{t.when}</span
									>
								</span>
								<span class="flex items-center gap-1.5">
									<span
										class="text-muted min-w-0 flex-1 truncate text-xs {t.unread
											? 'text-ink/80'
											: ''}">{t.preview}</span
									>
									{#if t.unread}<span
											class="bg-watt text-paper shrink-0 rounded-full px-1.5 text-[10px] font-bold tabular-nums"
											>{t.unread}</span
										>{/if}
								</span>
								{#if t.kind === 'room' && (t.here || t.voice)}
									<span
										class="text-muted/70 mt-0.5 flex items-center gap-1.5 text-[10px]"
									>
										{#if t.riding}<RidingBars size={8} />{/if}
										{t.here} here{#if t.voice}
											· <Headphones size={9} /> {t.voice}{/if}
									</span>
								{/if}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</aside>

		<!-- The thread: a room's chat without being in the room. -->
		<section class="flex min-h-0 flex-col">
			<header
				class="border-ink/5 flex h-[3.25rem] shrink-0 items-center gap-3 border-b px-5"
			>
				<span class="bg-surface grid h-7 w-7 place-items-center rounded"
					><Users size={14} class="text-muted" /></span
				>
				<span class="min-w-0">
					<span class="block truncate text-sm font-medium">{open.name}</span>
					<span class="text-muted flex items-center gap-1.5 text-[11px]"
						><RidingBars size={8} />
						{open.here} in the room · <Headphones size={10} />
						{open.voice} in voice · you are reading from outside</span
					>
				</span>
				<a href="/dev/chat" class="btn btn-accent btn-xs ml-auto shrink-0"
					><Radio size={13} /> Join the room</a
				>
			</header>
			<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
				<div class="space-y-2">
					{#each messages as m, i (i)}
						{#if m.unreadFrom}
							<div class="flex items-center gap-3 py-1">
								<span class="bg-watt/60 h-px flex-1"></span><span
									class="text-watt text-[10px] tracking-widest uppercase"
									>3 new</span
								><span class="bg-watt/60 h-px flex-1"></span>
							</div>
						{:else if m.event}
							<p class="text-muted/70 pl-9 text-[11px] italic">{m.event}</p>
						{:else}
							<div class="flex gap-2.5">
								<span class="w-7 shrink-0"
									><Avatar name={m.from ?? ''} size={28} /></span
								>
								<span class="min-w-0 flex-1">
									<span class="flex items-baseline gap-2"
										><span class="text-sm font-medium">{m.from}</span><span
											class="text-muted/40 font-mono text-[10px]">{m.at}</span
										></span
									>
									<span
										class="text-ink/85 block text-sm {m.mention
											? 'border-watt/60 bg-watt/5 -ml-2 rounded border-l-2 py-0.5 pl-2'
											: ''}"
									>
										{#if m.link}<a href="/dev/chat" class="text-neon underline"
												>{m.text}</a
											>{:else}{m.text}{/if}
									</span>
									{#if m.reactions?.length}
										<span class="mt-1 inline-flex gap-1">
											{#each m.reactions as r (r.n + '' + r.icon)}
												<span
													class="border-ink/10 inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] tabular-nums"
													><r.icon size={11} /> {r.n}</span
												>
											{/each}
										</span>
									{/if}
								</span>
							</div>
						{/if}
					{/each}
				</div>
			</div>
			<div class="border-ink/5 shrink-0 border-t px-5 py-3">
				<form class="flex items-center gap-2">
					<button
						type="button"
						class="text-muted hover:text-ink p-1"
						aria-label="attach an image"><ImageIcon size={16} /></button
					>
					<input
						class="input min-w-0 flex-1"
						placeholder="Message Schwitzchaste — you are not in the room, they still see it"
					/>
					<button class="btn btn-primary">Send</button>
				</form>
				<p class="text-muted/70 mt-1.5 text-[10px]">
					Reactions, links and the queue button work here exactly as in the
					room. Being in the room adds voice, the ride and the jukebox — not the
					words.
				</p>
			</div>
		</section>
	</div>
</main>
