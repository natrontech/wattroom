# web/ — Svelte rules

Rules an agent would otherwise get wrong; cross-cutting rules live in the root CLAUDE.md.

- **Svelte 5 runes only**: `$state`, `$derived`, `$effect`, `$props`. Never legacy stores, `$:` reactive statements, or `export let` — runes mode is forced in vite.config.ts.
- `src/lib/protocol.ts` is **generated** (tygo). Edit `server/internal/protocol/` and run `make protocol`.
- **All Web Bluetooth behind the `Trainer` interface**. Never call `navigator.bluetooth` outside the BLE layer — that boundary is what makes the simulator, tests, and the WCPS/FTMS split work.
- Tailwind v4 utilities, theme tokens in `src/app.css` (`@theme`). No component library. `--color-watt` (watt-yellow) marks live data only — never buttons, borders, or chrome.
- SPA constraints: `ssr = false` everywhere; no server-only SvelteKit features (form actions, +page.server.ts) — the Go server is the only backend.
- YouTube player tile: ≥200×200, always visible while media plays, nothing overlaid on it — TOS requirement (WATTROOM.md), not a style choice.
- Formatting: prettier (svelte + tailwind plugins) — hook runs it on edit; `pnpm run format` for bulk.
