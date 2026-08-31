# web/ — Svelte rules (all agents)

Rules an agent would otherwise get wrong; cross-cutting rules live in the root AGENTS.md.

- **Svelte 5 runes only**: `$state`, `$derived`, `$effect`, `$props`. Never legacy stores, `$:` reactive statements, or `export let` — runes mode is forced in vite.config.ts.
- `src/lib/protocol.ts` is **generated** (tygo). Edit `server/internal/protocol/` and run `make protocol`.
- **All Web Bluetooth behind the `Trainer` interface**. Never call `navigator.bluetooth` outside the BLE layer — that boundary is what makes the simulator, tests, and the WCPS/FTMS split work.
- Tailwind v4 utilities, theme tokens in `src/app.css` (`@theme`). No external component library — the in-house kit is: `@utility` chrome in app.css (`btn`+variants/sizes, `input`, `panel`, `eyebrow`, `page` — NEVER retype those class strings at a call site) and `src/lib/components/` (Modal, Banner, EmptyState, ProgressBar, Skeleton, Select; toasts via `$lib/toast.svelte` — errors.md: undo over confirm). Icons are `@lucide/svelte`, never unicode glyphs. Gallery: `/dev/components`. `--color-watt` (magenta) marks live data only — never buttons, borders, or chrome; `--color-neon` (violet) is the structural accent and never glows. Display type and every numeral use `font-display`.
- SPA constraints: `ssr = false` everywhere; no server-only SvelteKit features (form actions, +page.server.ts) — the Go server is the only backend.
- YouTube player tile: ≥200×200, always visible while media plays, nothing overlaid on it — TOS requirement (WATTROOM.md), not a style choice.
- **Restart `pnpm dev` after adding a new route directory** — Tailwind v4 does not rescan for directories created after the server started, so your classes silently resolve to nothing (the class lands on the element, the CSS rule never exists). Symptom: layout looks unstyled while everything type-checks.
- Formatting: prettier (svelte + tailwind plugins) — hook runs it on edit; `pnpm run format` for bulk.
