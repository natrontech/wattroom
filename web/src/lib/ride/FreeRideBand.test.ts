import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import FreeRideBand from './FreeRideBand.svelte';

const snip = (html: string) => createRawSnippet(() => ({ render: () => html }));

function band(controls?: string): string {
	return render(FreeRideBand, {
		props: {
			label: 'Free ride · Test loop',
			roadLine: 'km 0.0 of 2.0 · 0.0 %',
			chip: 'SIM · you feel 0.0 %',
			seconds: 0,
			climbed: 0,
			actions: snip('<button>End ride</button>'),
			controls: controls ? snip(controls) : undefined,
		},
	}).body;
}

describe("a free ride's slot 1 (#4283)", () => {
	it('puts the ride’s controls on the label’s row, above the road line', () => {
		expect(band()).toMatch(
			/data-testid="ride-context"[\s\S]*>End ride<\/button>[\s\S]*data-testid="block-road"[\s\S]*data-testid="ride-clock"/,
		);
	});

	// A voice channel's own controls and the ride's are ten: beside a name
	// they wrapped into two lines with the label floating between them.
	it('keeps a caller’s own controls beside the label and the ride’s after the chip row', () => {
		expect(band('<button>Ride a workout</button>')).toMatch(
			/data-testid="ride-context"[\s\S]*>Ride a workout<\/button>[\s\S]*data-testid="block-road"[\s\S]*data-testid="ride-clock"[\s\S]*>End ride<\/button>/,
		);
	});
});
