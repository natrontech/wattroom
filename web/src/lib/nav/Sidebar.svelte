<script lang="ts">
	// ADR-0020's one sidebar: your places, your rooms with the one you are
	// standing in opened into ITS places, your messages, and you pinned at the
	// bottom. It replaces RoomRail, TopNav and MobileNav's destination list —
	// a destination now has exactly one home.
	//
	// Names, not Discord's icon rail: icons exist because Discord has forty
	// servers, and ADR-0010 makes this strip the crew's radar — what is live,
	// who is in voice, what is planned. 48 px cannot say "Sweet Spot, 12 min in".
	import Avatar from '$lib/components/Avatar.svelte';
	import Logo from '$lib/brand/Logo.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import RoomIcon from '$lib/components/RoomIcon.svelte';
	import RoomStrip from './RoomStrip.svelte';
	import JukeboxRail from '$lib/room/JukeboxRail.svelte';
	import { account } from '$lib/account.svelte';
	import { dmHeads } from '$lib/dm/heads.svelte';
	import { formatWhen } from '$lib/format';
	import {
		UNREAD_COUNT,
		UNREAD_DOT,
		unreadCount,
	} from '$lib/messages/unread-marks';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { activeHref, activePlace, pages, roomPlaces } from './pages';
	import { railPeople, railPeopleMenu, railSubline } from './rail-people';
	import { roomNavState } from './room-state';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { personMenu } from '$lib/person-menu';
	import { goto } from '$app/navigation';
	import type { RailRoom } from '$lib/room/mockcompat';
	import {
		MessageSquare,
		Headphones,
		LogOut,
		Mic,
		MicOff,
		Plus,
		ScreenShare,
		ScreenShareOff,
		Settings,
		Video,
		VideoOff,
	} from '@lucide/svelte';
	import QuickAudio from '$lib/room/QuickAudio.svelte';

	let {
		pathname,
		rooms = [],
		activeSlug = '',
		connectedSlug = '',
		live = false,
		onLeave,
		onMember,
		showAv = false,
		voiceStatus = 'off',
		micOn = false,
		camOn = false,
		sharing = false,
		onJoin,
		onMic,
		onCam,
		onShare,
		onLeaveVoice,
		handedOff = false,
		onTakeOver,
	}: {
		pathname: string;
		rooms?: RailRoom[];
		activeSlug?: string;
		connectedSlug?: string;
		live?: boolean;
		onLeave?: () => void;
		/** A rider named in a room's people line — the layout resolves them. */
		onMember?: (slug: string, name: string) => void;
		showAv?: boolean;
		voiceStatus?: 'off' | 'connecting' | 'live' | 'reconnecting' | 'failed';
		micOn?: boolean;
		camOn?: boolean;
		sharing?: boolean;
		/** The way into voice; mic and camera only appear once you are in. */
		onJoin?: () => void;
		onMic?: () => void;
		onCam?: () => void;
		onShare?: () => void;
		onLeaveVoice?: () => void;
		handedOff?: boolean;
		onTakeOver?: () => void;
	} = $props();

	const destination = $derived(activeHref(pathname));
	const place = $derived(activeSlug ? activePlace(pathname, activeSlug) : '');
	const inVoice = $derived(voiceStatus === 'live');
</script>

<nav
	class="bg-surface border-ink/5 flex h-full w-60 shrink-0 flex-col border-r"
>
	<a href="/home" class="flex items-center gap-2 px-4 py-4">
		<Logo size={22} {live} />
		<span class="font-display text-sm font-bold">WattRoom</span>
	</a>

	<div class="min-h-0 flex-1 overflow-y-auto px-2">
		<ul class="space-y-0.5">
			{#each pages as entry (entry.href)}
				{@const on = destination === entry.href}
				<li>
					<a
						href={entry.href}
						aria-current={on ? 'page' : undefined}
						class="flex items-center gap-2 rounded px-2 py-1.5 text-sm {on
							? 'bg-surface-raised text-ink'
							: 'text-muted hover:text-ink'}"
					>
						<entry.icon size={15} class="shrink-0" />
						{entry.label}
					</a>
				</li>
			{/each}
		</ul>

		<div class="eyebrow flex items-center px-2 pt-4 pb-1">
			your rooms
			<!-- Everything /rooms carried beyond the list: open one, or join with
			     a code (ADR-0020). -->
			<a
				href="/home#rooms"
				class="hover:text-ink ml-auto"
				title="open a room or join with a code"
				aria-label="open a room or join with a code"><Plus size={13} /></a
			>
		</div>
		<ul class="space-y-0.5">
			{#each rooms as room (room.slug)}
				<!-- Connected and browsing-only are separate visual states. An active
				     room still opens into its places in either state. -->
				{@const reading = pathname === `/messages/r/${room.slug}`}
				{@const state = roomNavState(
					room.slug,
					activeSlug,
					connectedSlug,
					reading,
				)}
				{@const here = state === 'connected'}
				{@const browsing = state === 'browsing'}
				<!-- Opened: the room whose pages you are on, AND the one you are
					     standing in — reading a DM or Home while connected must not
					     fold Training two clicks away (rider report, #416). -->
				{@const open = room.slug === activeSlug || here}
				{@const subline = railSubline(room, open)}
				<li
					class="rounded-md border-l-2 {here
						? 'border-neon/70 bg-neon/10'
						: browsing
							? 'border-neon/35 bg-neon/5'
							: 'border-transparent'}"
					{@attach contextMenu(() => {
						const entries: MenuEntry[] = roomPlaces.map((place) => ({
							label: place.label,
							icon: place.icon,
							onSelect: () => void goto(`/r/${room.slug}${place.path}`),
						}));
						// The way in without going in (#484): the list lives here now,
						// so the way to a room's chat from outside lives here too.
						entries.push('separator', {
							label: 'Read the chat',
							icon: MessageSquare,
							hint: room.unread ? `${room.unread} new` : undefined,
							onSelect: () => void goto(`/messages/r/${room.slug}`),
						});
						if (here && onLeave)
							entries.push('separator', {
								label: 'Leave the room',
								icon: LogOut,
								onSelect: onLeave,
								danger: true,
							});
						return entries;
					})}
				>
					<a
						href="/r/{room.slug}"
						class="block rounded px-2 pt-1.5 {subline === 'people'
							? 'pb-0'
							: 'pb-1.5'} {here
							? 'text-ink'
							: browsing
								? 'text-ink/90'
								: 'text-muted/70 hover:text-ink'}"
					>
						<span class="flex items-center gap-2">
							{#if here}
								<span
									class="bg-z4 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
									title="you are in this room"
								></span>
							{/if}
							<RoomIcon icon={room.icon} size={14} />
							<span
								class="truncate {here
									? 'font-display text-ink text-base font-semibold'
									: browsing
										? 'font-display text-ink/90 text-[15px] font-medium'
										: room.unread
											? 'text-ink/80 text-sm font-medium'
											: 'text-muted/70 text-sm'}">{room.name}</span
							>
							{#if here && onLeave}
								<button
									onclick={(e) => {
										e.preventDefault();
										onLeave();
									}}
									class="text-muted hover:text-ink ml-auto shrink-0"
									title="leave the room"
									aria-label="leave the room"><LogOut size={12} /></button
								>
							{:else if room.unread}
								<!-- The strongest reason a chat app stays open in a
								     background window. -->
								<span
									class="{UNREAD_COUNT} ml-auto"
									title="{room.unread} new since you were last here"
									>{unreadCount(room.unread)}</span
								>
							{:else if (room.connected ?? 0) > 0}
								<span class="ml-auto flex shrink-0 items-center gap-1">
									<span class="bg-z4 h-1.5 w-1.5 rounded-full"></span>
									<span class="text-muted/70 font-mono text-[10px]"
										>{room.connected}</span
									>
								</span>
							{:else if room.members > 0}
								<span
									class="text-muted/50 ml-auto shrink-0 font-mono text-[10px]"
									>{room.members}</span
								>
							{/if}
						</span>
						{#if subline === 'session' && room.session}
							<!-- The late-join radar: what is on, and how far in. -->
							<span
								class="text-watt/90 mt-0.5 flex items-center gap-1.5 truncate text-[10px]"
							>
								<RidingBars size={9} />
								{room.session.workoutName} · {room.session.elapsedSec < 60
									? 'starting'
									: `${Math.round(room.session.elapsedSec / 60)} min in`}
							</span>
						{:else if subline === 'next' && room.next}
							<span class="text-muted/70 mt-0.5 block truncate text-[10px]"
								>next: {room.next.workoutName} · {formatWhen(
									room.next.startsAt,
								)}</span
							>
						{/if}
					</a>

					{#if subline === 'people'}
						{@const people = railPeople(room.riders)}
						<!-- Who is in there, without going in (#438): Discord lists the
						     people under a voice channel. It sits OUTSIDE the room's
						     link — a target of its own, the rail's full width, opening
						     the roster where each of them has a row (#540). The names
						     it printed are one right-click away, individually; three
						     buttons inside a 10 px line would be precision targets on
						     a bike (ux.md). -->
						<a
							href="/r/{room.slug}/members"
							title="who is here · {MENU_HINT}"
							class="text-muted/80 hover:bg-ink/5 hover:text-ink flex items-center gap-1 rounded px-2 pt-1 pb-1.5 text-[10px]"
							{@attach contextMenu(() =>
								railPeopleMenu(
									room.riders,
									onMember && ((name) => onMember(room.slug, name)),
									() => void goto(`/r/${room.slug}/members`),
								),
							)}
						>
							{#if room.voice?.length}<Headphones
									size={9}
									class="shrink-0"
								/>{/if}
							<span class="truncate">{people.label}</span>
						</a>
					{/if}

					{#if open}
						<!-- What was said while you were in another place (#568): the
						     room's own unread cannot say it — standing in the room
						     reads it — so this is the connection's answer, the same one
						     the people column's bar shows. -->
						{@const missed =
							roomConnection.current?.slug === room.slug
								? roomConnection.current.missed()
								: null}
						<!-- The room you are standing in opens. This is Discord's
						     second column, and it costs one indent instead of one
						     column (ADR-0020). -->
						<ul
							class="border-ink/10 mt-0.5 mb-1 ml-3 space-y-0.5 border-l pl-2"
						>
							{#each roomPlaces as entry (entry.path)}
								{@const on = room.slug === activeSlug && place === entry.path}
								<li>
									<a
										href="/r/{room.slug}{entry.path}"
										aria-current={on ? 'page' : undefined}
										class="flex items-center gap-2 rounded px-2 py-1.5 text-[13px] {on
											? 'bg-ink/5 text-ink'
											: 'text-muted hover:text-ink'}"
									>
										<entry.icon size={14} class="shrink-0" />
										<span class="truncate">{entry.label}</span>
										{#if entry.path === '/training' && live}
											<span class="ml-auto"><RidingBars size={10} /></span>
										{:else if entry.path === '/chat' && missed}
											<span
												class="{UNREAD_COUNT} ml-auto"
												title="{missed.count} said while you were elsewhere"
												>{unreadCount(missed.count)}</span
											>
										{/if}
									</a>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>

		<!-- Messages is a place (#468): every room's chat and every DM, one
		     list. The heading is the way in; the DMs below open straight into
		     their thread. Rooms are already listed above, so they are not
		     repeated here — their unread count is the way in for them. -->
		<div class="eyebrow flex items-center px-2 pt-4 pb-1">
			<a
				href="/messages"
				aria-current={pathname.startsWith('/messages') ? 'page' : undefined}
				class="hover:text-ink {pathname.startsWith('/messages')
					? 'text-ink'
					: ''}"
				title="every room's chat and your DMs, in one place">messages</a
			>
			<a href="/friends" class="hover:text-ink ml-auto normal-case">friends</a>
		</div>
		{#if dmHeads.heads.length > 0}
			<ul class="pb-2">
				{#each dmHeads.heads as head (head.peerId)}
					{@const on = pathname === `/messages/dm/${head.peerId}`}
					<li
						title={MENU_HINT}
						{@attach contextMenu(() =>
							personMenu(head.peerId, goto, { conversation: true }),
						)}
					>
						<a
							href="/messages/dm/{head.peerId}"
							aria-current={on ? 'page' : undefined}
							class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm {on
								? 'bg-surface-raised text-ink'
								: dmHeads.unread(head.peerId)
									? 'text-ink font-semibold'
									: 'text-muted hover:text-ink'}"
						>
							<Avatar
								name={head.peerName}
								avatarUrl={head.peerAvatarUrl}
								preset={head.peerAvatarPreset}
								xp={head.peerTotalXp}
								size={20}
							/>
							<span class="truncate">{head.peerName}</span>
							{#if dmHeads.unread(head.peerId)}
								<span class="{UNREAD_DOT} ml-auto"></span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!-- The video, wherever the people column is not (#427): below xl the room
	     has no column, and off the room pages there is none at all. -->
	{#if connectedSlug}
		<JukeboxRail />
	{/if}

	<!-- Who is in the room with you, while you are looking elsewhere (#446).
	     Above you, like Discord's voice panel; off the Lounge, which already
	     shows everyone in tiles. -->
	{#if connectedSlug}
		<RoomStrip {pathname} />
	{/if}

	<!-- You, pinned. The same shape whatever the CONNECTION state — the nav
	     above never jumps (rider report: the height flicker read as broken).
	     In a room the AV controls get a row of their own: six icons crowded in
	     beside a name left a 240 px column nothing to put the name in, and
	     these are tapped from a bike (ux.md). -->
	<div class="border-ink/5 border-t px-3 py-2.5">
		<div class="flex items-center gap-2">
			<!-- Your own rider page (#575). Everywhere else in the app an avatar
			     opens /u/<id>; yours was the one that did not, and the gear
			     beside it goes to settings — which are titled "Profile". -->
			<a
				href={account.me ? `/u/${account.me.id}` : undefined}
				class="mr-auto flex min-w-0 items-center gap-2"
				title="your rider page"
			>
				<Avatar
					name={account.me?.displayName ?? ''}
					avatarUrl={account.me?.avatarUrl}
					preset={account.me?.avatarPreset}
					xp={account.me?.totalXp}
					size={26}
				/>
				<span class="min-w-0">
					<span class="block truncate text-xs font-medium"
						>{account.me?.displayName ?? ''}</span
					>
					{#if showAv}
						<span class="block truncate text-[10px]">
							{#if voiceStatus === 'live'}
								<span class="text-z4">in voice</span>{camOn
									? ' · camera on'
									: ''}
							{:else if voiceStatus === 'connecting'}
								<span class="text-muted">joining voice…</span>
							{:else if voiceStatus === 'reconnecting'}
								<span class="text-z5">voice reconnecting…</span>
							{:else if voiceStatus === 'failed'}
								<span class="text-danger">voice failed</span>
							{:else}
								<span class="text-muted">not in voice</span>
							{/if}
						</span>
					{/if}
				</span>
			</a>
			<!-- Everything that is a setting rather than a destination: profile,
			     sensors, ramp test, devices, the mixer, the gate, the theme. -->
			<a
				href="/profile"
				class="rounded p-1 {destination === undefined &&
				pathname.startsWith('/profile')
					? 'text-ink'
					: 'text-muted hover:text-ink'}"
				title="settings"
				aria-label="settings"><Settings size={14} /></a
			>
		</div>
		{#if showAv && !inVoice}
			<!-- The way in is a labelled button, not two greyed icons that only
			     LOOK like a mic and a camera: a control that does something else
			     than it draws is not a control (#437, ux.md). Mic, camera and
			     screen appear once you are in, because that is when they work. -->
			<div class="mt-2 flex items-center gap-1">
				{#if voiceStatus === 'connecting' || voiceStatus === 'reconnecting'}
					<span class="text-muted flex-1 px-1 text-[11px]"
						>{voiceStatus === 'connecting'
							? 'joining voice…'
							: 'reconnecting…'}</span
					>
				{:else}
					<button
						onclick={() => onJoin?.()}
						class="btn btn-primary btn-xs flex-1"
						><Headphones size={13} />
						{voiceStatus === 'failed'
							? 'Try voice again'
							: 'Join voice'}</button
					>
				{/if}
				<QuickAudio compact />
			</div>
		{:else if showAv}
			<!-- Voice, camera, screen, sound and the way out — here and nowhere
			     else. The people column and the lounge header each drew their own
			     copy of a row the rider already has pinned in front of them. -->
			<div class="mt-2 flex items-center gap-1">
				<button
					onclick={() => onMic?.()}
					class="flex flex-1 justify-center rounded py-1.5 {micOn
						? 'text-z4'
						: 'text-danger'}"
					title={micOn ? 'mute' : 'unmute'}
					aria-label={micOn ? 'mute microphone' : 'unmute microphone'}
				>
					{#if micOn}<Mic size={16} />{:else}<MicOff size={16} />{/if}
				</button>
				<button
					onclick={() => onCam?.()}
					class="flex flex-1 justify-center rounded py-1.5 {camOn
						? 'text-z4'
						: 'text-muted/50 hover:text-muted'}"
					title={camOn ? 'turn camera off' : 'turn camera on'}
					aria-label={camOn ? 'turn camera off' : 'turn camera on'}
				>
					{#if camOn}<Video size={16} />{:else}<VideoOff size={16} />{/if}
				</button>
				<!-- Sharing takes the danger token, like the mic does when it is
				     muted (#563): a state you might not have noticed, and the one
				     that can put a private tab on the stage. Chrome, so the token
				     and not a glow — ADR-0005 keeps those for live data. -->
				<button
					onclick={() => onShare?.()}
					class="flex flex-1 justify-center rounded py-1.5 {sharing
						? 'bg-danger/15 text-danger'
						: 'text-muted/50 hover:text-muted'}"
					title={sharing ? 'stop sharing your screen' : 'share your screen'}
					aria-label={sharing
						? 'stop sharing your screen'
						: 'share your screen'}
				>
					{#if sharing}<ScreenShareOff size={16} />{:else}<ScreenShare
							size={16}
						/>{/if}
				</button>
				<QuickAudio compact />
				<button
					onclick={() => onLeaveVoice?.()}
					class="text-muted/50 hover:text-danger flex flex-1 justify-center rounded py-1.5"
					title="leave voice"
					aria-label="leave voice"><LogOut size={16} /></button
				>
			</div>
		{/if}
		{#if showAv && handedOff}
			<!-- Not a toast: the rider went quiet and needs to still be able to
			     read why a minute later, mid-interval (errors.md). -->
			<div class="border-z5/40 mt-2 rounded border px-2 py-1.5">
				<p class="text-muted text-[10px] leading-snug">
					Your mic and camera moved to the room open in another tab.
				</p>
				<button
					onclick={onTakeOver}
					class="border-muted/25 text-muted hover:text-ink mt-1.5 w-full rounded border px-2 py-1.5 text-[11px]"
					>use this tab instead</button
				>
			</div>
		{/if}
	</div>
</nav>
