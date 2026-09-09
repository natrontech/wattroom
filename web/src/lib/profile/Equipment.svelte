<script lang="ts">
	// The Equipment & measurement links on the profile page: what the cog
	// carries since ADR-0020 shrank the sidebar. Split out of the page for
	// size.
	import Gauge from '@lucide/svelte/icons/gauge';
	import Zap from '@lucide/svelte/icons/zap';
</script>

<!-- The rest of what the cog carries (ADR-0020): occasional things that
     were destinations of their own before the sidebar shrank to three. -->
<section class="panel mt-8 p-6">
	<h2 class="font-display font-bold">Equipment &amp; measurement</h2>
	<ul class="mt-4 grid gap-2 sm:grid-cols-2">
		<li>
			<a
				href="/pair"
				class="border-muted/15 hover:border-muted/40 flex items-center gap-3 rounded-lg border px-4 py-3"
			>
				<Zap size={16} class="text-muted shrink-0" />
				<span class="min-w-0">
					<span class="block text-sm font-medium">Sensors</span>
					<span class="text-muted block text-xs"
						>Pair a trainer, heart rate strap or cadence sensor</span
					>
				</span>
			</a>
		</li>
		<li>
			<a
				href="/ramp"
				class="border-muted/15 hover:border-muted/40 flex items-center gap-3 rounded-lg border px-4 py-3"
			>
				<Gauge size={16} class="text-muted shrink-0" />
				<span class="min-w-0">
					<span class="block text-sm font-medium">Ramp test</span>
					<span class="text-muted block text-xs"
						>Measure your FTP — about 20 minutes</span
					>
				</span>
			</a>
		</li>
	</ul>
</section>
