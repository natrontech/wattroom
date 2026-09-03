<script lang="ts">
	const screens = [
		{
			href: '/dev/panel',
			label: 'The room panel',
			hint: 'Four ways to fit members, jukebox and chat in one column (#504)',
		},
		{
			href: '/dev/profile',
			label: 'Social profile',
			hint: "A rider's page: level, shelf, shared rides, what shows to whom (#449)",
		},
		{
			href: '/dev/trophies',
			label: 'Trophy case',
			hint: 'Achievements, XP sources, a room event (#450)',
		},
		{
			href: '/dev/chat',
			label: 'Chat as a place',
			hint: 'Rooms and DMs together, unread first, read a room from outside (#451)',
		},
		{
			href: '/dev/themes',
			label: 'Theme gallery',
			hint: 'Every theme against the surfaces that carry colour, cave and desk (#399)',
		},
		{
			href: '/dev/brand',
			label: 'Brand',
			hint: 'Mark, wordmark and type directions to choose from',
		},
		{
			href: '/dev/styleguide',
			label: 'Styleguide',
			hint: 'Tokens, glow scale, chrome vs data components',
		},
	];
</script>

<main class="mx-auto max-w-3xl px-6 py-16">
	<h1 class="font-display text-3xl font-bold tracking-tight">Design mocks</h1>
	<p class="text-muted mt-2 text-sm">
		Dev-only screens for iterating on the visual system before the
		implementation lands. Fake data, real tokens.
	</p>
	<ul class="mt-10 grid gap-3">
		{#each screens as screen (screen.href)}
			<li>
				<a
					href={screen.href}
					class="border-muted/15 bg-surface-raised hover:border-muted/40 block rounded-lg border px-5 py-4 transition-colors"
				>
					<span class="font-medium">{screen.label}</span>
					<span class="text-muted mt-0.5 block text-sm">{screen.hint}</span>
				</a>
			</li>
		{/each}
	</ul>
</main>
