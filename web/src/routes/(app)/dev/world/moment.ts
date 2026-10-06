import type { Moment } from '$lib/world/compose';

/**
 * A still moment of /dev/world, read from its URL (#3672):
 * `?m=<metre>&p=<0–1>&cam=chase|heli|side&look=<style id>&chrome=0`. A design
 * capture loads the same URL twice and gets one frame: world-start is
 * `p=0`, world-end `p=1`, both with `chrome=0` for a frame with nothing of
 * the gallery over it. Null without `m`: the gallery rides as it always has.
 */
export type WorldMoment = Moment & {
	cam: 'chase' | 'heli' | 'side';
	look: string | null;
	chrome: boolean;
};

export function momentOf(params: URLSearchParams): WorldMoment | null {
	const m = Number(params.get('m'));
	if (!params.has('m') || !Number.isFinite(m) || m < 0) return null;
	const p = Number(params.get('p') ?? 0);
	return {
		m,
		p: Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0,
		cam:
			(['heli', 'side'] as const).find((c) => c === params.get('cam')) ??
			'chase',
		look: params.get('look'),
		chrome: params.get('chrome') !== '0',
	};
}
