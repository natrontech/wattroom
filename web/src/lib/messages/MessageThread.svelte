<script lang="ts">
	// The thread body shared by every chat surface (#672): the timeline, the four
	// states (errors.md), the composer. A text channel's own header (its name,
	// the way back to the crew) and a DM's (where they are) stay with the caller
	// — what differs surface to surface is what a line IS and what you can do to
	// it, not how the log scrolls or the box sends.
	import Copy from '@lucide/svelte/icons/copy';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Pencil from '@lucide/svelte/icons/pencil';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import SmilePlus from '@lucide/svelte/icons/smile-plus';
	import { type Snippet } from 'svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { people } from '$lib/people.svelte';
	import { friends } from '$lib/friends/friends.svelte';
	import { statusOf } from '$lib/status';
	import { crewLive } from '$lib/nav/crew-live.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import ChatImage from '$lib/chat/ChatImage.svelte';
	import MessageText from '$lib/chat/MessageText.svelte';
	import Composer from '$lib/messages/Composer.svelte';
	import LineActions from '$lib/messages/LineActions.svelte';
	import LineEditor from '$lib/messages/LineEditor.svelte';
	import Reactions from '$lib/chat/Reactions.svelte';
	import { stickToBottom } from '$lib/chat/stick-to-bottom';
	import { account } from '$lib/account.svelte';
	import { goto } from '$app/navigation';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import { personMenu } from '$lib/person-menu';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { formatDay, formatStamp, formatTime, sameDay } from '$lib/format';
	import { mentionsMe } from '$lib/messages/mention';
	import type { ThreadMessage, ThreadSource } from '$lib/messages/thread-types';
	import { confirm } from '$lib/confirm.svelte';
	import { copyText } from '$lib/copy';
	import { toasts } from '$lib/toast.svelte';

	let {
		source,
		imageSrc,
		composerPlaceholder,
		composerHint,
		composerLock = null,
		editHint = 'Escape cancels · the channel sees the change',
		lineGapMs = 1000,
		mentionNames = [],
		emptyState,
	}: {
		source: ThreadSource;
		/** Builds a message's image URL — the channel and DM endpoints differ. */
		imageSrc: (imageId: string) => string;
		composerPlaceholder: string;
		composerHint?: string;
		/** Why nothing can be sent here, when nothing can — the box says so. */
		composerLock?: string | null;
		/**
		 * Who sees an edit land — a channel, or the one person a DM has
		 * (#1819).
		 */
		editHint?: string;
		/** The composer's own gap between lines: the hub's second, or none. */
		lineGapMs?: number;
		/** People `@` can complete to beyond whoever has spoken (#1766). */
		mentionNames?: string[];
		emptyState: Snippet;
	} = $props();

	const timeline = $derived(source.timeline);
	// Who `@` completes to: the caller's people first (the crew's people),
	// then whoever has spoken here; never yourself.
	const names = $derived.by(() => {
		const seen = new Set<string>([account.me?.displayName ?? '']);
		const out: string[] = [];
		const spoke = timeline.map(
			(e) => people.face(e.message.fromId)?.name ?? e.message.from,
		);
		for (const name of [...mentionNames, ...spoke]) {
			if (!name || seen.has(name)) continue;
			seen.add(name);
			out.push(name);
		}
		return out;
	});
	const me = $derived(account.me?.id);

	// The "N new" line: above the first message from someone else since the
	// thread's readAt. A source with no readAt (never opened before, or the
	// notion doesn't apply) simply never draws one.
	const isNew = (m: { fromId?: string; at: number }) =>
		source.readAt !== null && m.fromId !== me && m.at > source.readAt;
	const messages = $derived(timeline.map((e) => e.message));
	const newCount = $derived(messages.filter(isNew).length);
	const firstNewId = $derived(messages.find(isNew)?.id);

	// Consecutive lines from one rider read as one turn — the header repeats
	// only after a gap, like every messenger.
	const GROUP_GAP_MS = 5 * 60_000;

	let reactingTo = $state<string | null>(null);

	// Editing a sent line (#865): the sender's own, text only, one at a time —
	// LineEditor keeps the draft and goes when this moves on.
	let editingId = $state<string | null>(null);

	const canEdit = (message: ThreadMessage) =>
		!!source.edit && !!message.id && message.fromId === me && !!message.text;

	const startEdit = (message: ThreadMessage) =>
		(editingId = message.id ?? null);

	const canDelete = (message: ThreadMessage) =>
		!!source.remove &&
		!!message.id &&
		!message.deletedAt &&
		!!source.canRemove?.(message);
	async function removeLine(id: string, mine: boolean, from: string) {
		const yes = await confirm({
			title: mine ? 'Delete your message?' : `Delete ${from}'s message?`,
			body: mine
				? 'It goes for everyone, and it cannot be brought back.'
				: `It goes for everyone, including ${from}, and it cannot be brought back.`,
			action: 'Delete',
			cancel: 'Keep it',
		});
		if (!yes) return;
		const refused = await source.remove?.(id);
		if (refused) toasts.push(refused, { tone: 'error' });
	}

	async function react(id: string, cheer: string) {
		reactingTo = null;
		const refused = await source.react?.(id, cheer);
		if (refused) toasts.push(refused, { tone: 'error' });
	}

	// The log's own scroll state, told by stickToBottom (#1765).
	let log = $state<HTMLElement | null>(null);
	let pinned = $state(true);
	let missed = $state(0);
	$effect(() => {
		const node = log;
		if (!node) return;
		const on = (event: Event) => {
			const detail = (event as CustomEvent<{ pinned: boolean; missed: number }>)
				.detail;
			pinned = detail.pinned;
			missed = detail.missed;
		};
		node.addEventListener('wattroom-follow', on);
		return () => node.removeEventListener('wattroom-follow', on);
	});

	function messageMenu(message: ThreadMessage): MenuEntry[] {
		const items: MenuEntry[] = [];
		// Nothing is left to do to a deleted line (#2418) — no edit, no copy,
		// no react, and no second delete. The person behind it still has a
		// menu, which is the one thing the row still is.
		if (message.deletedAt)
			return message.fromId
				? personMenu(message.fromId, goto, {
						you: message.fromId === account.me?.id,
					})
				: [];
		// The person first (#1765, #666): profile, message, friend — and the
		// crew's ban, on the surface where you actually meet the griefer.
		const fromId = message.fromId;
		if (fromId) {
			const you = fromId === account.me?.id;
			items.push(
				...personMenu(fromId, goto, {
					you,
					ban: source.banOf?.(fromId, message.from),
				}),
				'separator',
			);
		}
		if (canEdit(message))
			items.push({
				label: 'Edit',
				icon: Pencil,
				onSelect: () => startEdit(message),
			});
		if (message.text)
			items.push({
				label: 'Copy',
				icon: Copy,
				onSelect: () => void copyText(message.text, 'Message copied.'),
			});
		if (message.id && source.react) {
			const id = message.id;
			items.push({
				label: 'React',
				icon: SmilePlus,
				onSelect: () => (reactingTo = reactingTo === id ? null : id),
			});
		}
		// The coach's mark (#2408). Here rather than in a composer of its own:
		// the sentence is already written, and a second box to type it into
		// would duplicate the log, the read tracking and the retention.
		if (source.announce && message.id && message.text) {
			const id = message.id;
			items.push({
				label: 'Announce this',
				icon: Megaphone,
				onSelect: () => source.announce?.(id),
			});
		}
		// Destructive, so last and after a separator (ux.md). It asks before
		// it acts: a hard delete cannot be undone, which is errors.md's own
		// test for when a confirm beats an undo toast (#1493).
		if (canDelete(message) && message.id) {
			const id = message.id;
			const mine = message.fromId === account.me?.id;
			items.push('separator', {
				label: 'Delete',
				icon: Trash2,
				danger: true,
				onSelect: () => void removeLine(id, mine, message.from),
			});
		}
		return items;
	}
</script>

<!-- `mt-auto` on the list, not `justify-end` on the box (#291): spare space
     goes above the oldest line, so overflow spills off the END edge. -->
<div
	bind:this={log}
	{@attach stickToBottom}
	data-testid="thread-log"
	role="log"
	aria-label="messages"
	class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-4"
>
	<div class="flex h-full flex-col">
		<div class="mt-auto space-y-2">
			{#if source.loading}
				<Skeleton rows={4} class="mb-3 h-9" />
			{:else if source.error && timeline.length === 0}
				<Banner tone="error">
					{source.error}
					{#snippet action()}
						<button
							onclick={() => source.retry()}
							class="btn btn-secondary btn-xs"
							><RotateCw size={12} /> Retry</button
						>
					{/snippet}
				</Banner>
			{:else if timeline.length === 0}
				{@render emptyState()}
			{:else}
				{#each timeline as entry, i (entry.key)}
					{@const message = entry.message}
					{@const prev = timeline[i - 1]}
					{@const startsNew = !!message.id && message.id === firstNewId}
					{@const startsDay = !prev || !sameDay(prev.at, message.at)}
					{@const grouped =
						!startsNew &&
						!startsDay &&
						prev?.message.from === message.from &&
						message.at - prev.at < GROUP_GAP_MS}
					{@const mention = mentionsMe(message.text, account.me?.displayName)}
					{#if startsDay}
						<!-- Which day a line is from (#2642): the stamp says only the
						     clock, and a log reaches back days. -->
						<div class="flex items-center gap-3 py-1" role="separator">
							<span class="bg-ink/10 h-px flex-1"></span>
							<span class="text-muted-dim text-[11px] font-medium"
								>{formatDay(message.at)}</span
							>
							<span class="bg-ink/10 h-px flex-1"></span>
						</div>
					{/if}
					{#if startsNew}
						<div class="flex items-center gap-3 py-1" role="separator">
							<span class="bg-neon/60 h-px flex-1"></span>
							<span class="eyebrow">{newCount} new</span>
							<span class="bg-neon/60 h-px flex-1"></span>
						</div>
					{/if}
					<div
						data-testid="thread-message"
						class="group flex gap-2.5 {grouped ? '-mt-1' : ''}"
						title={MENU_HINT}
						{@attach contextMenu(() => messageMenu(message))}
					>
						<span class="w-7 shrink-0">
							{#if !grouped}
								<!-- The person, not their initial (#807): the face a voice
								     channel's column shows, the level ring the profile shows,
								     and where they are right now. -->
								{@const face = people.face(message.fromId)}
								<!-- The face is the way to the person (#1765). -->
								<svelte:element
									this={message.fromId ? 'a' : 'span'}
									href={message.fromId ? `/u/${message.fromId}` : undefined}
									class="block rounded-full"
								>
									<Avatar
										name={face?.name ?? message.from}
										avatarUrl={face?.avatarUrl}
										xp={face?.totalXp}
										status={statusOf(
											crewLive.crews,
											message.fromId ?? '',
											friends.list,
										)}
										size={28}
									/>
								</svelte:element>
							{/if}
						</span>
						<span class="min-w-0 flex-1">
							{#if !grouped}
								<span class="flex items-baseline gap-2">
									<span class="min-w-0 truncate text-sm font-medium"
										>{message.from}</span
									>
									<time
										datetime={new Date(message.at).toISOString()}
										title={formatStamp(message.at)}
										class="text-muted-dim num shrink-0 text-[10px]"
										>{formatTime(message.at)}</time
									>
								</span>
							{/if}
							{#if message.id && editingId === message.id}
								{@const id = message.id}
								<LineEditor
									original={message.text}
									hint={editHint}
									save={async (text) => (await source.edit?.(id, text)) ?? null}
									onDone={() => (editingId = null)}
								/>
							{:else}
								<!-- A line that names you gets the bar — there is no server
								     mention yet, this is "@" plus your first name. Pre-wrap
								     (#2642): a line break the rider typed is theirs to keep. -->
								<span
									class="text-ink/85 block text-sm wrap-anywhere whitespace-pre-wrap {mention
										? 'border-neon/60 bg-neon/5 -ml-2 rounded border-l-2 py-0.5 pl-2'
										: ''}"
								>
									{#if message.deletedAt}
										<!-- A tombstone, DMs only (#2418): the row stays so
										     the other side is told at all, and there is
										     nothing left of the message but the fact that
										     something was here. Italic and muted, so it does
										     not read as somebody's words. -->
										<span class="text-muted text-sm italic"
											>Message deleted</span
										>
									{:else if message.text}
										<MessageText
											text={message.text}
											menu={() => messageMenu(message)}
										/>
									{/if}
									{#if message.editedAt}
										<!-- Nobody is rewritten quietly (#865). Not a
										     timestamp: WHEN it was fixed is nobody's
										     business, THAT it was is everybody's. -->
										<span
											class="text-muted-dim ml-1 align-baseline text-[10px]"
											title="edited {formatTime(message.editedAt)}">edited</span
										>
									{/if}
									{#if message.imageId}
										<!-- The picture's own menu swallows the row's right-click
										     (#1817): hand the message's down, or a photo has no
										     react and no copy. -->
										<ChatImage
											src={imageSrc(message.imageId)}
											alt="Sent by {message.from}"
											menu={() => messageMenu(message)}
										/>
									{/if}
								</span>
							{/if}
							{#if message.id && source.reactions}
								{@const id = message.id}
								<Reactions
									{id}
									counts={source.reactions[id]}
									myReacts={source.myReacts}
									cheers={source.cheers ?? []}
									picking={reactingTo === id}
									onReact={(cheer) => void react(id, cheer)}
								/>
							{/if}
						</span>
						{#if !message.deletedAt}
							{@const id = message.id}
							<LineActions
								text={message.text}
								onEdit={canEdit(message) && editingId !== id
									? () => startEdit(message)
									: undefined}
								onReact={id && source.react
									? () => (reactingTo = reactingTo === id ? null : id)
									: undefined}
								onDelete={canDelete(message) && id
									? () =>
											void removeLine(id, message.fromId === me, message.from)
									: undefined}
								menu={() => messageMenu(message)}
							/>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>

{#if !pinned && missed > 0}
	<!-- Lines landed behind a reader who scrolled back (#1765): the way down. -->
	<div class="px-5 pb-1">
		<button
			onclick={() => log?.dispatchEvent(new Event('wattroom-pin'))}
			class="btn btn-secondary btn-xs"
			><ArrowDown size={12} />
			{missed} new {missed === 1 ? 'message' : 'messages'}</button
		>
	</div>
{/if}
<!-- Your own send does NOT pin the log: #291's rule (a reader scrolled back
     is never yanked, e2e/chat.spec.ts asserts it on the sender's own line)
     stands until the own-send case is decided (#1767). The "new messages"
     button above is the way down. -->
<Composer
	send={source.send}
	{lineGapMs}
	{names}
	placeholder={composerPlaceholder}
	hint={composerHint}
	lock={composerLock}
	error={timeline.length > 0 ? source.error : null}
/>
