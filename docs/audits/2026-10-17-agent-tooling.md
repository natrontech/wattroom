# Audit: agent tooling, 2026-10-17

Slice: `.claude/skills`, `.claude/rules`, `CLAUDE.md` and `AGENTS.md` (root, web, server), the scripts agents run, the hook commands in `.claude/settings.json`, the canon agents load on demand, and session cost from local transcripts since 2026-10-07. Out: product code. Main at 6e4dfe2c3. Three read-only agents; one high-severity claim from each was re-checked by hand.

## Filed

| Issue | Finding |
|---|---|
| #4072 (merged in #4073) | Instruction lines the code contradicts: worktree-gc, server/AGENTS.md, go-review, verify, pickup-feedback |
| #4074 | Worktree ports collide (`crc % 200`) and Vite has no `strictPort` |
| #4075 | About 70 KB of table padding in canon; three WATTROOM.md rows past the 2,000-character read limit; whole-file pointers to TARGETS.md and the glossary |
| #4076 | Blocked issue runs cost more than merged ones (5.9M vs 4.5M median cache-read) |
| #4077 | Script faults: design-surfaces' `No` id, untracked files, the format hook's prettier, wait-checks hiding gh errors, runner retries, verify reruns, `make ci` in DESIGN-CHECK, `sleep` polling |
| #4078 | Riders see "text channels" on the site and "chat channels" in the app |

## Not filed

- ux.md "Live numbers snap" omits the watts numeral's 250 ms glide that `docs/spec/motion.md` and TARGETS G6 keep.
- errors.md says bounds come from docs/SPEC.md; they live in `server/internal/protocol/limits.go`, which cites SPEC.
- `make lint` starts with a cold golangci cache in each new worktree; unmeasured.
- verify and design-check have no "logs to `$S`, read the failing lines" rule; browser output and `sed`/`cat` dumps are the largest carried non-image results.
- Decisions left with the maintainer: whether pickup-feedback PRs merge; du or Sie on INTRANET pages (user-level config); whether the ponytail plugin's one-check rule applies here.

## Sound

- Issue runs are lean: median 50 turns, 130K peak context, 4.5M cache-read, about 5.8M per merge against 13M (unlooped) and 24M (looped) before 2026-10-14. No session since then loops or passes 545K.
- Output tokens are 0.2 % of cache-read; session length is the lever.
- Hooks are fast (worktree guard 0.03–0.07 s, format 0.6 s) and print nothing on success.
- wait-checks polls inside one call under the 10-minute limit; its exit codes match issue-run §4. design-before.sh matches design-check §2. Capture timeouts cover main's 17–27 min runs.
- docs/SPEC.md indexes all 42 sections; every spec number sampled matches the code (crew codes, scrollback, line timers, streak XP, FTP/weight/LTHR bounds, `--dur-live`, bike computer sizes, the YouTube tile).
- The always-loaded instructions are about 9K tokens with user rules and memory.

Sample: 300 desktop sessions and 185 subagents on the Mac. VM issue runs are not included; re-measure from `~/.wattroom-runs` on the VM.
