import { describe, expect, it } from 'vitest';
import { loadSessionPage } from './session-page';

/** A fetch answering the crew's live list and its recaps. */
function server(recaps: { sessionId?: string; channelId?: string }[] | null) {
	return (async (input: RequestInfo | URL) => {
		const url = String(input);
		const body = url.endsWith('/live')
			? { sessions: [] }
			: url.endsWith('/recaps')
				? recaps === null
					? null
					: { recaps }
				: null;
		return body === null
			? new Response(
					JSON.stringify({ error: 'internal_error', message: 'x' }),
					{
						status: 500,
					},
				)
			: new Response(JSON.stringify(body), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
	}) as typeof fetch;
}

describe('an ended session’s page (#2600)', () => {
	it('finds the voice channel it ran in, by its recap', async () => {
		const got = await loadSessionPage(
			'c1',
			's1',
			server([
				{ sessionId: 's0', channelId: 'v0' },
				{ sessionId: 's1', channelId: 'v1' },
			]),
		);
		expect(got.session).toBeNull();
		expect(got.endedIn).toBe('v1');
	});

	it('finds nothing for a session with no recap it may read', async () => {
		expect(
			(await loadSessionPage('c1', 's1', server([]))).endedIn,
		).toBeUndefined();
		expect(
			(await loadSessionPage('c1', 's1', server(null))).endedIn,
		).toBeUndefined();
	});
});
