<script lang="ts">
	/**
	 * Third-party notices (#1670). MIT, ISC, BSD, Apache and the OFL all require
	 * their notice to travel with the thing they are in, and the SPA is one.
	 *
	 * The two files are static assets fetched on demand, not imports: together
	 * they are ~600 KB of licence text, and a page almost nobody opens should
	 * not sit in the bundle every rider downloads. `make licenses` regenerates
	 * them and CI fails if they drift from what actually ships.
	 */
	type Entry = {
		name: string;
		version: string;
		license?: string;
		homepage?: string;
		text: string;
		textMissing?: boolean;
	};

	let web = $state<Entry[] | null>(null);
	let go = $state<Entry[] | null>(null);
	let failed = $state(false);

	async function load() {
		failed = false;
		web = null;
		go = null;
		try {
			const [w, g] = await Promise.all([
				fetch('/legal/web.json').then((r) => {
					if (!r.ok) throw new Error(String(r.status));
					return r.json();
				}),
				fetch('/legal/go.json').then((r) => {
					if (!r.ok) throw new Error(String(r.status));
					return r.json();
				}),
			]);
			web = w.packages;
			go = g.modules;
		} catch {
			failed = true;
		}
	}

	$effect(() => {
		void load();
	});
</script>

<svelte:head>
	<title>Third-party notices · WattRoom</title>
</svelte:head>

<h1 class="page-title">Third-party notices</h1>
<p class="text-muted mt-1 text-sm">Open-source software in WattRoom</p>

<p class="text-muted mt-6 text-sm leading-relaxed">
	WattRoom itself is
	<a
		href="https://www.gnu.org/licenses/agpl-3.0.html"
		class="hover:text-ink underline">AGPL-3.0</a
	>
	— see the <a href="/legal" class="hover:text-ink underline">legal notice</a>.
	It is built on the work below, each under its own licence, reproduced here
	because that is what those licences ask for.
</p>

<p class="text-muted mt-3 text-sm leading-relaxed">
	The list errs on the side of including too much: a bundler pulls assets out of
	build-time dependencies as readily as runtime ones, so everything in the tree
	is listed rather than only what is strictly linked.
</p>

{#if failed}
	<div class="border-danger/40 bg-danger/5 mt-8 rounded-lg border p-4">
		<p class="text-ink text-sm">The notices could not be loaded.</p>
		<p class="text-muted mt-1 text-sm">
			They are two static files served alongside the app; a network error or a
			half-finished deploy is the usual reason.
		</p>
		<button class="btn btn-lg mt-3" onclick={() => load()}>Try again</button>
	</div>
{:else if web === null || go === null}
	<p class="text-muted mt-8 text-sm">Loading the notices…</p>
{:else}
	{#each [{ title: 'Web application', entries: web }, { title: 'Server', entries: go }] as group (group.title)}
		<section>
			<h2
				class="font-display text-ink mt-8 text-sm font-semibold tracking-wide uppercase"
			>
				{group.title}
				<span class="text-muted font-normal normal-case"
					>· {group.entries.length}</span
				>
			</h2>
			{#if group.entries.length === 0}
				<p class="text-muted mt-2 text-sm">Nothing is bundled here.</p>
			{:else}
				<ul class="mt-2 space-y-1">
					{#each group.entries as entry (entry.name + entry.version)}
						<li>
							<details class="group">
								<summary
									class="text-muted hover:text-ink flex cursor-pointer flex-wrap items-baseline gap-x-2 py-1 text-sm"
								>
									<span class="text-ink">{entry.name}</span>
									<span class="text-[11px]">{entry.version}</span>
									{#if entry.license}<span class="text-[11px]"
											>· {entry.license}</span
										>{/if}
								</summary>
								{#if entry.textMissing}
									<p class="text-muted mt-1 mb-2 text-[11px] leading-relaxed">
										This package ships no licence file of its own; the licence
										it declares is named above.
									</p>
								{:else}
									<pre
										class="text-muted mt-1 mb-2 overflow-x-auto text-[11px] leading-relaxed whitespace-pre-wrap">{entry.text}</pre>
								{/if}
								{#if entry.homepage}
									<a
										href={entry.homepage}
										rel="noreferrer"
										class="hover:text-ink text-muted mb-2 inline-block text-[11px] underline"
										>project home</a
									>
								{/if}
							</details>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/each}
{/if}
