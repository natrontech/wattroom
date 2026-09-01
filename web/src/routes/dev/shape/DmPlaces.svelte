<script lang="ts">
	// Messages, as places rather than as a drawer.
	//
	// Today a DM is a 320×384 box pinned bottom-right — with a `right-[392px]`
	// in DmDrawer.svelte so it does not land on the jukebox dock. It cannot
	// show who you are talking to, scrollback is a thumbnail, and it is a mode
	// you have to remember you are in: exactly the argument ADR-0020 makes
	// against switchable layouts, applied to a conversation.
	//
	// Nothing is lost by promoting it. The room connection survives navigation
	// (#191), so opening a thread does not drop you out of the room or out of
	// voice — the sidebar keeps its green dot. And mid-ride you are in the cave,
	// where typing is off the table anyway (ux.md).
	import Avatar from '$lib/components/Avatar.svelte';
	import { MessageCircle, Radio, UserPlus } from '@lucide/svelte';

	let { screen }: { screen: string } = $props();

	let tab = $state<'online' | 'all' | 'requests'>('online');

	const thread = [
		{ mine: false, at: '19:12', text: 'you riding thursday?' },
		{ mine: true, at: '19:14', text: 'yeah, assuming my knee behaves' },
		{ mine: true, at: '19:14', text: 'what are we doing' },
		{ mine: false, at: '19:20', text: 'sweet spot 2×20, i planned it already' },
		{
			mine: false,
			at: '19:20',
			text: 'bring the good headphones, tobi queued nightcall again',
		},
		{ mine: true, at: '19:22', text: '😤' },
	];

	const friends = [
		{ name: 'Nina', online: true, room: 'Thursday Sufferfest', riding: true },
		{ name: 'Ruben', online: true, room: 'Thursday Sufferfest', riding: true },
		{ name: 'Jonas', online: true, room: 'mfw-5', riding: false },
		{ name: 'Lea', online: true, room: '', riding: false },
		{ name: 'Sara', online: false, room: '', riding: false },
		{ name: 'Milo', online: false, room: '', riding: false },
	];
	const shown = $derived(
		tab === 'online' ? friends.filter((f) => f.online) : friends,
	);
</script>

{#if screen === 'dm'}
	<!-- One column, one conversation. The header is what the drawer could never
	     afford: who they are, whether they are around, and the one thing you
	     actually want from a friend who is riding — the way in. -->
	<div class="flex h-full min-h-0 flex-col">
		<header
			class="border-ink/5 flex h-[3.25rem] shrink-0 items-center gap-3 border-b px-5"
		>
			<span class="relative shrink-0">
				<Avatar name="Nina" size={28} />
				<span
					class="bg-z4 ring-surface absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2"
					title="online"
				></span>
			</span>
			<span class="min-w-0">
				<span class="block truncate text-sm font-medium">Nina</span>
				<span class="text-muted block truncate text-[11px]"
					>riding in Thursday Sufferfest</span
				>
			</span>
			<a href="#room-lounge" class="btn btn-accent btn-xs ml-auto shrink-0"
				><Radio size={13} /> Join her</a
			>
		</header>

		<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
			<div class="mx-auto flex h-full max-w-2xl flex-col">
				<div class="mt-auto">
					<div class="mb-5 text-center">
						<Avatar name="Nina" size={48} />
						<p class="font-display mt-2 text-base font-bold">Nina</p>
						<p class="text-muted mt-0.5 text-xs">
							Just you two — messages stay between friends, last 500 kept.
						</p>
					</div>
					<p
						class="text-muted/50 mb-3 text-center text-[10px] tracking-widest uppercase"
					>
						yesterday
					</p>
					<ul class="space-y-2">
						{#each thread as message, i (message.text)}
							{@const grouped = thread[i - 1]?.mine === message.mine}
							<li class="flex gap-2.5 {grouped ? '-mt-1' : ''}">
								<span class="w-7 shrink-0">
									{#if !grouped}
										<Avatar name={message.mine ? 'You' : 'Nina'} size={28} />
									{/if}
								</span>
								<span class="min-w-0 flex-1">
									{#if !grouped}
										<span class="flex items-baseline gap-2">
											<span class="text-sm font-medium"
												>{message.mine ? 'You' : 'Nina'}</span
											>
											<span class="text-muted/40 font-mono text-[10px]"
												>{message.at}</span
											>
										</span>
									{/if}
									<span class="text-ink/85 block text-sm wrap-anywhere"
										>{message.text}</span
									>
								</span>
							</li>
						{/each}
					</ul>
				</div>
			</div>
		</div>

		<div class="border-ink/5 shrink-0 border-t px-5 py-3">
			<form class="mx-auto flex max-w-2xl gap-2">
				<input placeholder="Message Nina…" class="input min-w-0 flex-1" />
				<button class="btn btn-primary">Send</button>
			</form>
		</div>
	</div>
{:else if screen === 'friends'}
	<!-- Was a section at the bottom of /home, under your week's stats — which
	     is where you look for numbers, not for people (ADR-0012). -->
	<div class="mx-auto w-full max-w-2xl px-5 py-6">
		<div class="mb-4 flex items-center gap-3">
			<h2 class="font-display text-2xl font-bold tracking-tight">Friends</h2>
			<button class="btn btn-secondary btn-xs ml-auto"
				><UserPlus size={13} /> Add by code</button
			>
		</div>

		<div class="border-ink/5 mb-4 flex border-b">
			{#each [{ id: 'online' as const, label: `Online — ${friends.filter((f) => f.online).length}` }, { id: 'all' as const, label: `All — ${friends.length}` }, { id: 'requests' as const, label: 'Requests' }] as entry (entry.id)}
				<button
					onclick={() => (tab = entry.id)}
					aria-current={tab === entry.id ? 'page' : undefined}
					class="-mb-px border-b-2 px-4 py-2.5 text-sm font-medium {tab ===
					entry.id
						? 'border-neon text-ink'
						: 'text-muted hover:text-ink border-transparent'}"
					>{entry.label}</button
				>
			{/each}
		</div>

		{#if tab === 'requests'}
			<p class="text-muted text-sm">
				Nothing waiting. Friends are made by trading codes — share yours, or
				enter theirs, to see when they're around.
			</p>
		{:else}
			<ul class="divide-ink/5 panel divide-y">
				{#each shown as friend (friend.name)}
					<li class="flex items-center gap-3 px-4 py-2.5">
						<span class="relative shrink-0">
							<Avatar name={friend.name} size={30} />
							<span
								class="ring-surface-raised absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 {friend.riding
									? 'bg-watt glow-stroke'
									: friend.online
										? 'bg-z4'
										: 'bg-muted/40'}"
								title={friend.riding
									? 'riding now'
									: friend.online
										? 'online'
										: 'offline'}
							></span>
						</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium"
								>{friend.name}</span
							>
							<span class="text-muted block truncate text-[11px]">
								{#if friend.riding}
									riding in {friend.room}
								{:else if friend.room}
									in {friend.room}
								{:else if friend.online}
									online
								{:else}
									offline
								{/if}
							</span>
						</span>
						<a
							href="#dm"
							class="text-muted hover:text-ink shrink-0"
							aria-label="message {friend.name}"><MessageCircle size={16} /></a
						>
						{#if friend.room}
							<a href="#room-lounge" class="btn btn-primary btn-xs shrink-0"
								>Join them</a
							>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<div class="panel mt-5 flex flex-wrap items-center gap-3 px-4 py-3">
			<span class="min-w-0">
				<span class="eyebrow">your friend code</span>
				<span class="font-display block text-lg font-bold tracking-widest"
					>K4M-9TZ</span
				>
			</span>
			<button class="btn btn-secondary btn-xs ml-auto">Copy</button>
		</div>
	</div>
{/if}
