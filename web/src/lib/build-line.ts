/**
 * The settings footer's build line (#345): the release tag when the build is
 * one, the commit otherwise — `dev` is no release.
 */
export function buildLine(
	build: { commit?: string; version?: string } | null,
): {
	version: string | null;
	release: string | null;
} {
	const tag = build?.version;
	return {
		version: build?.commit ?? null,
		release: tag && tag !== 'dev' ? tag : null,
	};
}
