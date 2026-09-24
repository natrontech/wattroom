import { describe, expect, it } from 'vitest';
import { INTENT_TTL_MS, askVoice, takeVoice } from './voice-intent';

const live = { status: 'live', micOn: false, camOn: true };

describe('voice intent', () => {
	it('an arrival nobody clicked for joins nothing', () => {
		expect(takeVoice('v:a', 0)).toBeNull();
	});

	it('a click from outside voice joins with the default mic and no camera', () => {
		askVoice('v:a', undefined, 0);
		expect(takeVoice('v:a', 1)).toEqual({
			key: 'v:a',
			mic: undefined,
			cam: false,
			at: 0,
		});
	});

	it('a switch carries the mic and a live camera', () => {
		askVoice('v:b', live, 0);
		expect(takeVoice('v:b', 1)).toMatchObject({ mic: false, cam: true });
	});

	it('a camera that was off stays off', () => {
		askVoice('v:b', { ...live, micOn: true, camOn: false }, 0);
		expect(takeVoice('v:b', 1)).toMatchObject({ mic: true, cam: false });
	});

	it('a call that is not live carries nothing', () => {
		askVoice('v:b', { status: 'connecting', micOn: true, camOn: true }, 0);
		expect(takeVoice('v:b', 1)).toMatchObject({ mic: undefined, cam: false });
	});

	it('is taken once', () => {
		askVoice('v:a', undefined, 0);
		expect(takeVoice('v:a', 1)).not.toBeNull();
		expect(takeVoice('v:a', 2)).toBeNull();
	});

	it('another channel arriving drops it', () => {
		askVoice('v:a', undefined, 0);
		expect(takeVoice('v:other', 1)).toBeNull();
		expect(takeVoice('v:a', 2)).toBeNull();
	});

	it('goes stale', () => {
		askVoice('v:a', undefined, 0);
		expect(takeVoice('v:a', INTENT_TTL_MS + 1)).toBeNull();
	});
});
