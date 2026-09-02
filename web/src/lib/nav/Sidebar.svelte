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
	import { account } from '$lib/account.svelte';
	import { dm } from '$lib/dm/dm.svelte';
	import { dmHeads } from '$lib/dm/heads.svelte';
	import { formatWhen } from '$lib/format';
	import { activeHref, activePlace, pages, roomPlaces } from './pages';
	import type { RailRoom } from '$lib/room/mockcompat';
	import {
		Headphones,
		LogOut,
		Mic,
		MicOff,
		Plus,
		Settings,
		Video,
		VideoOff,
	} from '@lucide/svelte';

	let {
		pathname,
		rooms = [],
		activeSlug = '',
		connectedSlug = '',
		live = false,
		onLeave,
		showAv = false,
		voiceStatus = 'off',
		micOn = false,
		camOn = false,
		onMic,
		onCam,
		handedOff = false,
		onTakeOver,
	}: {
		pathname: string;
		rooms?: RailRoom[];
		activeSlug?: string;
		connectedSlug?: string;
		live?: boolean;
		onLeave?: () => void;
		showAv?: boolean;
		voiceStatus?: 'off' | 'connecting' | 'live' | 'reconnecting' | 'failed';
		micOn?: boolean;
		camOn?: boolean;
		onMic?: () => void;
		onCam?: () => void;
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
				{@const here = room.slug === connectedSlug}
				<!-- Opened: the room whose pages you are on, AND the one you are
				     standing in — reading a DM or Home while connected must not
				     fold Training two clicks away (rider report, #416). -->
				{@const open = room.slug === activeSlug || here}
				<li>
					<a
						href="/r/{room.slug}"
						class="block rounded px-2 py-1.5 {open
							? 'text-ink'
							: 'text-muted hover:text-ink'}"
					>
						<span class="flex items-center gap-2">
							{#if here}
								<span
									class="bg-z4 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
									title="you are in this room"
								></span>
							{/if}
							<span
								class="truncate text-sm {open
									? 'font-semibold'
									: room.unread
										? 'text-ink font-semibold'
										: ''}">{room.icon ? `${room.icon} ` : ''}{room.name}</span
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
								     background window. Quiet by design: the count is
								     chrome, so it takes the muted surface — the live hue
								     is for live data (ADR-0005). -->
								<span
									class="bg-muted/25 text-ink ml-auto shrink-0 rounded-full px-1.5 text-[10px] font-bold tabular-nums"
									title="{room.unread} new since you were last here"
									>{room.unread > 99 ? '99+' : room.unread}</span
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
						{#if !open && room.session}
							<!-- The late-join radar: what is on, and how far in. -->
							<span
								class="text-watt/90 mt-0.5 flex items-center gap-1.5 truncate text-[10px]"
							>
								<RidingBars size={9} />
								{room.session.workoutName} · {room.session.elapsedSec < 60
									? 'starting'
									: `${Math.round(room.session.elapsedSec / 60)} min in`}
							</span>
						{:else if !open && room.riders?.length}
							<!-- Who is in there, without going in (#438): Discord lists
							     the people under a voice channel; the row does the same. -->
							<span
								class="text-muted/80 mt-0.5 flex items-center gap-1 truncate text-[10px]"
							>
								{#if room.voice?.length}<Headphones
										size={9}
										class="shrink-0"
									/>{/if}
								{room.riders.slice(0, 3).join(', ')}{room.riders.length > 3
									? ` +${room.riders.length - 3}`
									: ''}
							</span>
						{:else if !open && room.next}
							<span class="text-muted/70 mt-0.5 block truncate text-[10px]"
								>next: {room.next.workoutName} · {formatWhen(
									room.next.startsAt,
								)}</span
							>
						{/if}
					</a>

					{#if open}
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
											? 'bg-surface-raised text-ink'
											: 'text-muted hover:text-ink'}"
									>
										<entry.icon size={14} class="shrink-0" />
										<span class="truncate">{entry.label}</span>
										{#if entry.path === '/training' && live}
											<span class="ml-auto"><RidingBars size={10} /></span>
										{/if}
									</a>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>

		{#if dmHeads.heads.length > 0}
			<div class="eyebrow flex items-center px-2 pt-4 pb-1">
				messages
				<a href="/friends" class="hover:text-ink ml-auto normal-case">friends</a
				>
			</div>
			<ul class="pb-2">
				{#each dmHeads.heads as head (head.peerId)}
					{@const on = pathname === `/dm/${head.peerId}`}
					<li>
						<a
							href="/dm/{head.peerId}"
							onclick={() => dm.show(head.peerId, head.peerName)}
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
								<span class="bg-watt ml-auto h-2 w-2 shrink-0 rounded-full"
								></span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!-- You, pinned. ONE row whatever the connection state — the nav above
	     never jumps (rider report: the height flicker read as broken). -->
	<div class="border-ink/5 border-t px-3 py-2.5">
		<div class="flex items-center gap-2">
			<Avatar
				name={account.me?.displayName ?? ''}
				avatarUrl={account.me?.avatarUrl}
				preset={account.me?.avatarPreset}
				xp={account.me?.totalXp}
				size={26}
			/>
			<span class="mr-auto min-w-0">
				<span class="block truncate text-xs font-medium"
					>{account.me?.displayName ?? ''}</span
				>
				{#if showAv}
					<span class="block truncate text-[10px]">
						{#if voiceStatus === 'live'}
							<span class="text-z4">in voice</span>{camOn ? ' · camera on' : ''}
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
			{#if showAv}
				<button
					onclick={() => onMic?.()}
					class="rounded p-1 {inVoice
						? micOn
							? 'text-z4'
							: 'text-danger'
						: 'text-muted/50 hover:text-muted'}"
					title={inVoice ? (micOn ? 'mute' : 'unmute') : 'join voice'}
					aria-label={inVoice
						? micOn
							? 'mute microphone'
							: 'unmute microphone'
						: 'join voice'}
				>
					{#if inVoice && micOn}<Mic size={14} />{:else}<MicOff
							size={14}
						/>{/if}
				</button>
				<button
					onclick={() => onCam?.()}
					class="rounded p-1 {inVoice && camOn
						? 'text-z4'
						: 'text-muted/50 hover:text-muted'}"
					title={inVoice && camOn ? 'turn camera off' : 'turn camera on'}
					aria-label={inVoice && camOn ? 'turn camera off' : 'turn camera on'}
				>
					{#if inVoice && camOn}<Video size={14} />{:else}<VideoOff
							size={14}
						/>{/if}
				</button>
			{/if}
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
