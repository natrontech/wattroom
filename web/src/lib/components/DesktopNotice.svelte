<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import {
		detectOS,
		formatBytes,
		latestRelease,
		shellVersion,
		type DesktopRelease,
		type Installer,
	} from '$lib/desktop';

	// The desktop app's offer, on home (#296, #1235): in a browser on a Mac,
	// Windows or Linux machine, what the app buys, the installer for THIS
	// machine, one Not-now that is remembered for good. A phone gets nothing:
	// the app is for a desk. Updating an installed app is the sidebar's update
	// row (#2588), which a rider sees wherever WattRoom opens.
	//
	// Home only: never mid-ride (ux.md). Nothing renders until a release
	// exists, so the button can never fail.
	const OFFERED = 'wattroom.desktop-offer.v1';

	const os = detectOS(navigator.userAgent);
	const desk = os === 'mac' || os === 'windows' || os === 'linux';

	let latest = $state<DesktopRelease | null>(null);
	// Read once at mount: whether to ask the feed at all is decided here, and
	// a decline during this visit only has to hide the panel, not stop a
	// request that already went out.
	const declinedBefore = read(OFFERED) === 'no';
	let declined = $state(declinedBefore);
	if (!shellVersion() && desk && !declinedBefore)
		void latestRelease().then((r) => (latest = r));

	const installer = $derived<Installer | null>(
		!declined && latest
			? (latest.installers.find((i) => i.os === os) ?? null)
			: null,
	);
	const NAMES = { mac: 'macOS', windows: 'Windows', linux: 'Linux' } as const;

	function read(key: string): string | null {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	}
	function decline() {
		try {
			localStorage.setItem(OFFERED, 'no');
		} catch {
			/* no storage: the panel returns next load, the safe direction */
		}
		declined = true;
	}
</script>

{#if installer && desk}
	<section class="panel panel-lg mt-6">
		<div class="flex flex-wrap items-start gap-x-6 gap-y-3">
			<div class="min-w-56 flex-1">
				<p class="eyebrow">desktop app</p>
				<p class="font-display mt-1 text-base font-bold">
					WattRoom on your desk
				</p>
				<!-- What a tab cannot do (ADR-0037), and the machine's sound only
				     where Chromium has a loopback — macOS 15+ and Windows. -->
				<p class="text-muted mt-1 text-sm leading-relaxed">
					The same crews in a window of their own: a heads-up display over
					whatever else is open, notifications that reach you behind another
					window{installer.os === 'linux'
						? ''
						: ", and your crew can hear your computer's own sound"}.
				</p>
			</div>
			<div class="flex flex-col items-start gap-2">
				<a href={installer.url} class="btn btn-primary btn-lg">
					<Download size={18} />
					Download for {NAMES[os]}
					{#if installer.bytes}
						<span class="text-xs opacity-70"
							>{formatBytes(installer.bytes)}</span
						>
					{/if}
				</a>
				<div class="flex items-center gap-4 text-xs">
					<a href="/download" class="btn-link">Other systems and first launch</a
					>
					<button class="btn-link" onclick={decline}>Not now</button>
				</div>
			</div>
		</div>
	</section>
{/if}
