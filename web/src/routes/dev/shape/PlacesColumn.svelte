<script lang="ts">
	// ADR-0020 column 2. Discord's second column is always visible, which is
	// what makes a server feel like somewhere you are rather than a page you
	// are on (#181 gap 1). It resolves against context: the room's places when
	// you stand in one, yours when you don't — so TopNav and MobileNav's
	// destination list have nowhere left to be.
	import { ROOM_PLACES, YOUR_PLACES } from './shape';
	import {
		ChartColumn,
		Gauge,
		History,
		House,
		MessagesSquare,
		Settings,
		TrendingUp,
		UserRound,
		Users,
		Zap,
		CalendarClock,
		Activity,
	} from '@lucide/svelte';

	let {
		context,
		place = '',
		roomName = '',
		roomIcon = '',
		live = false,
		collapsed = false,
	}: {
		context: 'room' | 'you';
		place?: string;
		roomName?: string;
		roomIcon?: string;
		live?: boolean;
		collapsed?: boolean;
	} = $props();

	const ICONS: Record<string, typeof House> = {
		lounge: MessagesSquare,
		training: Activity,
		sessions: CalendarClock,
		members: Users,
		settings: Settings,
		home: House,
		rooms: Users,
		workouts: ChartColumn,
		history: History,
		progression: TrendingUp,
		ramp: Gauge,
		pair: Zap,
		profile: UserRound,
	};

	const places = $derived(context === 'room' ? ROOM_PLACES : YOUR_PLACES);
</script>

<nav
	class="bg-surface border-ink/5 flex h-full shrink-0 flex-col border-r {collapsed
		? 'w-14'
		: 'w-44'}"
>
	{#if context === 'room'}
		<!-- The room's name belongs to its column, not to the content header:
		     the header then costs nothing and column 3 starts with the work. -->
		<div class="border-ink/5 flex h-[3.25rem] items-center gap-2 border-b px-3">
			{#if collapsed}
				<span class="mx-auto text-base" title={roomName}>{roomIcon}</span>
			{:else}
				<span class="font-display truncate text-sm font-bold"
					>{roomIcon} {roomName}</span
				>
			{/if}
		</div>
	{:else}
		<div class="border-ink/5 flex h-[3.25rem] items-center border-b px-3">
			{#if !collapsed}<span class="eyebrow">your places</span>{/if}
		</div>
	{/if}

	<ul class="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
		{#each places as entry (entry.id)}
			{@const Icon = ICONS[entry.id]}
			{@const on = entry.id === place}
			<li>
				<a
					href="#{entry.id}"
					aria-current={on ? 'page' : undefined}
					title={collapsed ? entry.label : undefined}
					class="flex items-center gap-2 rounded px-2 py-2 {on
						? 'bg-surface-raised text-ink'
						: 'text-muted hover:text-ink'} {collapsed ? 'justify-center' : ''}"
				>
					<Icon size={16} class="shrink-0" />
					{#if !collapsed}
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm">{entry.label}</span>
							{#if entry.hint}
								<span class="text-muted/60 block truncate text-[10px]"
									>{entry.hint}</span
								>
							{/if}
						</span>
					{/if}
					{#if entry.id === 'training' && live}
						<!-- Live data is the only thing carrying the accent (ADR-0005). -->
						<span
							class="bg-watt glow-stroke h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
							title="a session is running"
						></span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
</nav>
