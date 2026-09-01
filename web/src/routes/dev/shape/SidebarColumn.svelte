<script lang="ts">
	// The alternative to ADR-0020's columns 1 + 2: ONE sidebar.
	//
	// Discord needs two strips because it has forty servers of thirty channels
	// each, so the server list can never also hold the channels. WattRoom has
	// five rooms of five places — the whole tree fits in one column, and the
	// room you are standing in is the one that expands.
	//
	// It keeps everything the two-column version was for: places are permanent
	// and beside the content (#181 gap 1), the you panel is pinned (gap 2),
	// every room still carries its signal (gap 4). It gives back 176 px and one
	// entire vertical border.
	import Avatar from '$lib/components/Avatar.svelte';
	import Logo from '$lib/brand/Logo.svelte';
	import { DM_HEADS, RAIL_ROOMS, ROOM_PLACES } from './shape';
	import {
		Activity,
		CalendarClock,
		ChartColumn,
		Headphones,
		History,
		House,
		MessagesSquare,
		Mic,
		Settings,
		TrendingUp,
		Users,
		VideoOff,
	} from '@lucide/svelte';

	let {
		place = '',
		context,
		connectedSlug = '',
		live = false,
	}: {
		place?: string;
		context: 'room' | 'you';
		connectedSlug?: string;
		live?: boolean;
	} = $props();

	// Four, not nine. Sensors, Ramp test and Profile are things you set up or
	// visit occasionally — they live behind the cog, where the mixer and the
	// voice gate went. A sidebar that lists everything lists nothing.
	const YOURS = [
		{ id: 'home', label: 'Home', icon: House },
		{ id: 'workouts', label: 'Workouts', icon: ChartColumn },
		{ id: 'history', label: 'Rides', icon: History },
		{ id: 'progression', label: 'Progression', icon: TrendingUp },
	];
	const PLACE_ICONS: Record<string, typeof House> = {
		lounge: MessagesSquare,
		training: Activity,
		sessions: CalendarClock,
		members: Users,
		settings: Settings,
	};
</script>

<nav
	class="bg-surface border-ink/5 flex h-full w-60 shrink-0 flex-col border-r"
>
	<div class="flex items-center gap-2 px-4 py-4">
		<Logo size={22} {live} />
		<span class="font-display text-sm font-bold">WattRoom</span>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto px-2">
		<ul class="space-y-0.5">
			{#each YOURS as entry (entry.id)}
				{@const on = context === 'you' && place === entry.id}
				<li>
					<a
						href="#{entry.id}"
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
			<a href="#rooms" class="hover:text-ink ml-auto normal-case">manage</a>
		</div>
		<ul class="space-y-0.5">
			{#each RAIL_ROOMS as room (room.slug)}
				{@const here = room.slug === connectedSlug}
				{@const open = here && context === 'room'}
				<li>
					<a
						href="#{room.slug}"
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
										: ''}">{room.icon} {room.name}</span
							>
							{#if room.mention}
								<span
									class="bg-watt text-paper ml-auto shrink-0 rounded-full px-1.5 text-[10px] font-bold tabular-nums"
									>{room.unread}</span
								>
							{:else if room.unread}
								<span
									class="bg-muted/30 text-ink ml-auto shrink-0 rounded-full px-1.5 text-[10px] font-medium tabular-nums"
									>{room.unread}</span
								>
							{:else if room.connected > 0}
								<span class="ml-auto flex shrink-0 items-center gap-1">
									<span class="bg-z4 h-1.5 w-1.5 rounded-full"></span>
									<span class="text-muted/70 font-mono text-[10px]"
										>{room.connected}</span
									>
								</span>
							{:else}
								<span
									class="text-muted/50 ml-auto shrink-0 font-mono text-[10px]"
									>{room.members}</span
								>
							{/if}
						</span>
						{#if !open && room.session}
							<span
								class="text-watt/90 mt-0.5 flex items-center gap-1 truncate text-[10px]"
							>
								<span class="bg-watt glow-stroke h-1 w-1 shrink-0 rounded-full"
								></span>
								{room.session.workoutName} · {Math.round(
									room.session.elapsedSec / 60,
								)} min in
							</span>
						{:else if !open && room.next}
							<span class="text-muted/70 mt-0.5 block truncate text-[10px]"
								>next: {room.next.workoutName} · {room.next.when}</span
							>
						{:else if !open && room.voice.length > 0}
							<span
								class="text-muted/70 mt-0.5 flex items-center gap-1 truncate text-[10px]"
							>
								<Headphones size={9} class="shrink-0" />
								{room.voice.join(', ')}
							</span>
						{/if}
					</a>

					{#if open}
						<!-- The room you are standing in opens. This is column 2, and it
						     costs one indent instead of one column. -->
						<ul
							class="border-ink/10 mt-0.5 mb-1 ml-3 space-y-0.5 border-l pl-2"
						>
							{#each ROOM_PLACES as entry (entry.id)}
								{@const Icon = PLACE_ICONS[entry.id]}
								{@const on = place === entry.id}
								<li>
									<a
										href="#{entry.id}"
										aria-current={on ? 'page' : undefined}
										class="flex items-center gap-2 rounded px-2 py-1.5 text-[13px] {on
											? 'bg-surface-raised text-ink'
											: 'text-muted hover:text-ink'}"
									>
										<Icon size={14} class="shrink-0" />
										<span class="truncate">{entry.label}</span>
										{#if entry.id === 'training' && live}
											<span
												class="bg-watt glow-stroke ml-auto h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
												title="a session is running"
											></span>
										{/if}
									</a>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>

		<div class="eyebrow px-2 pt-4 pb-1">messages</div>
		<ul class="pb-2">
			{#each DM_HEADS as head (head.name)}
				<li>
					<button
						class="text-muted hover:text-ink flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
					>
						<Avatar name={head.name} size={20} />
						<span class="truncate">{head.name}</span>
						{#if head.unread}
							<span class="bg-watt ml-auto h-2 w-2 shrink-0 rounded-full"
							></span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	</div>

	<div class="border-ink/5 border-t px-3 py-2.5">
		<div class="flex items-center gap-2">
			<Avatar name="You" size={26} />
			<span class="mr-auto min-w-0">
				<span class="block truncate text-xs font-medium">You</span>
				<span class="text-z4 block truncate text-[10px]">in voice</span>
			</span>
			<button class="text-z4 rounded p-1" aria-label="mute microphone"
				><Mic size={14} /></button
			>
			<button
				class="text-muted/50 hover:text-muted rounded p-1"
				aria-label="turn camera on"><VideoOff size={14} /></button
			>
			<!-- Profile, sensors, ramp test, devices, the mixer, the gate, the
			     theme — everything that is a setting rather than a destination. -->
			<button
				class="text-muted hover:text-ink rounded p-1"
				aria-label="settings"><Settings size={14} /></button
			>
		</div>
	</div>
</nav>
