// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { importWorkout, importWorkoutFile, MAX_IMPORT_BYTES } from './index';
import type { RepeatStep, SteadyStep } from '../types';

/**
 * Every fixture here is hand-written (#2327): an intervals.icu account often
 * syncs from Strava, and AGENTS.md bars Strava Data from any prompt, fixture
 * or comment. Nothing in this file came out of anybody's account.
 */

function ok(fileName: string, source: string, ftp: number | null = 250) {
	const outcome = importWorkout(fileName, source, ftp);
	if (!outcome.ok) throw new Error(`expected an import, got: ${outcome.error}`);
	return outcome.imported;
}

function refusal(fileName: string, source: string, ftp: number | null = 250) {
	const outcome = importWorkout(fileName, source, ftp);
	if (outcome.ok) throw new Error('expected a refusal, got a workout');
	return outcome.error;
}

const zwo = (body: string, head = '<name>Tuesday Threshold</name>') =>
	`<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  ${head}
  <workout>${body}</workout>
</workout_file>`;

describe('.zwo', () => {
	it('converts a plain Zwift workout into SPEC steps, in the file order', () => {
		const { workout, notes } = ok(
			'threshold.zwo',
			zwo(`
        <Warmup Duration="600" PowerLow="0.4" PowerHigh="0.7"/>
        <SteadyState Duration="1200" Power="0.9" CadenceLow="85" CadenceHigh="95"/>
        <IntervalsT Repeat="4" OnDuration="30" OffDuration="90" OnPower="1.2" OffPower="0.55"/>
        <Cooldown Duration="300" PowerLow="0.6" PowerHigh="0.35"/>`),
		);

		expect(workout.name).toBe('Tuesday Threshold');
		expect(workout.steps.map((s) => s.type)).toEqual([
			'warmup',
			'steady',
			'repeat',
			'cooldown',
		]);
		expect(workout.steps[0]).toEqual({
			type: 'warmup',
			seconds: 600,
			from: 0.4,
			to: 0.7,
		});
		expect(workout.steps[1]).toEqual({
			type: 'steady',
			seconds: 1200,
			target: 0.9,
			cadenceLow: 85,
			cadenceHigh: 95,
		});
		expect(workout.steps[2]).toEqual({
			type: 'repeat',
			times: 4,
			steps: [
				{ type: 'steady', seconds: 30, target: 1.2 },
				{ type: 'steady', seconds: 90, target: 0.55 },
			],
		});
		// Nothing was lost, so the rider is told nothing.
		expect(notes).toEqual([]);
	});

	it('takes attribute names however the exporter cased them', () => {
		const { workout } = ok(
			'lower.zwo',
			zwo('<steadystate duration="600" power="0.75"/>'),
		);
		expect(workout.steps[0]).toEqual({
			type: 'steady',
			seconds: 600,
			target: 0.75,
		});
	});

	it('names a free ride it had to leave out, and how much shorter that made it', () => {
		const { workout, notes } = ok(
			'free.zwo',
			zwo(`
        <SteadyState Duration="600" Power="0.7"/>
        <FreeRide Duration="900"/>`),
		);
		expect(workout.steps).toHaveLength(1);
		expect(notes).toHaveLength(1);
		expect(notes[0]).toContain('free-ride');
		expect(notes[0]).toContain('15:00');
	});

	// The `<TextEvent>` spelling is covered in e2e/workout-import.spec.ts and
	// not here: happy-dom's getElementsByTagName is case-insensitive where a
	// real XML document's is not, so a unit test cannot tell the two apart and
	// would pass against the bug.
	it('counts the ride instructions it cannot show', () => {
		const { notes } = ok(
			'text.zwo',
			zwo(`
        <SteadyState Duration="600" Power="0.7">
          <textevent timeoffset="10" message="Settle in"/>
          <textevent timeoffset="300" message="Halfway"/>
        </SteadyState>`),
		);
		expect(notes).toEqual([expect.stringContaining('2 ride instructions')]);
	});

	it('says a single cadence was dropped rather than inventing a range around it', () => {
		const { workout, notes } = ok(
			'cadence.zwo',
			zwo('<SteadyState Duration="600" Power="0.7" Cadence="95"/>'),
		);
		expect(workout.steps[0]).not.toHaveProperty('cadenceLow');
		expect(workout.steps[0]).not.toHaveProperty('cadenceHigh');
		expect(notes).toEqual([expect.stringContaining('one exact cadence')]);
	});

	it('drops a cadence floor that would fight the spiral guard, and says why', () => {
		const { workout, notes } = ok(
			'grind.zwo',
			zwo(
				'<SteadyState Duration="600" Power="0.7" CadenceLow="45" CadenceHigh="55"/>',
			),
		);
		expect(workout.steps[0]).not.toHaveProperty('cadenceLow');
		expect(notes).toEqual([expect.stringContaining('spiral guard')]);
	});

	it('keeps a cadence CEILING under the guard trip — only a floor fights it', () => {
		const { workout, notes } = ok(
			'grinder.zwo',
			zwo('<SteadyState Duration="600" Power="0.7" CadenceHigh="45"/>'),
		);
		expect(workout.steps[0]).toMatchObject({ cadenceHigh: 45 });
		expect(notes).toEqual([]);
	});

	it('turns a max effort into a sprint moment and warns about the mode change', () => {
		const { workout, notes } = ok(
			'max.zwo',
			zwo(`
        <SteadyState Duration="600" Power="0.5"/>
        <MaxEffort Duration="30"/>`),
		);
		expect(workout.steps[1]).toEqual({ type: 'sprint', seconds: 30 });
		expect(notes).toEqual([expect.stringContaining('out of ERG')]);
	});

	it('names a block type it does not ride instead of swallowing it', () => {
		const { notes } = ok(
			'odd.zwo',
			zwo(`
        <SteadyState Duration="600" Power="0.7"/>
        <Ramptest Duration="60"/>`),
		);
		expect(notes).toEqual([expect.stringContaining('Ramptest')]);
	});

	it('keeps a ramp-named block that carries one power, ramping to itself', () => {
		const { workout, notes } = ok(
			'flatwarm.zwo',
			zwo('<Warmup Duration="600" Power="0.5"/>'),
		);
		expect(workout.steps[0]).toEqual({
			type: 'warmup',
			seconds: 600,
			from: 0.5,
			to: 0.5,
		});
		expect(notes).toEqual([]);
	});

	it('falls back to the file name, and says when it had to cut it', () => {
		const long = 'x'.repeat(120);
		const { workout, notes } = ok(
			`${long}.zwo`,
			zwo('<SteadyState Duration="600" Power="0.7"/>', ''),
		);
		expect(workout.name).toHaveLength(80);
		expect(notes).toEqual([expect.stringContaining('cut to fit')]);
	});

	it('carries the author across', () => {
		const { workout } = ok(
			'authored.zwo',
			zwo(
				'<SteadyState Duration="600" Power="0.7"/>',
				'<name>Coached</name><author>A Coach</author>',
			),
		);
		expect(workout.author).toBe('A Coach');
	});

	it('refuses broken XML by saying it is not XML', () => {
		expect(
			refusal('broken.zwo', '<workout_file><workout</workout_file>'),
		).toContain('not valid XML');
	});

	it('refuses XML that is not a Zwift workout', () => {
		expect(refusal('rss.zwo', '<rss><channel/></rss>')).toContain(
			'<workout_file>',
		);
	});

	it('refuses a DTD entity bomb without expanding it', () => {
		const bomb = `<!DOCTYPE lol [
      <!ENTITY a "aaaaaaaaaa">
      <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
      <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">
    ]><workout_file><name>&c;</name><workout><SteadyState Duration="600" Power="0.7"/></workout></workout_file>`;
		const outcome = importWorkout('bomb.zwo', bomb, 250);
		expect(outcome.ok).toBe(false);
	});

	it('names the block whose duration is missing', () => {
		expect(refusal('nodur.zwo', zwo('<SteadyState Power="0.7"/>'))).toBe(
			'Block 1 (SteadyState): the file does not say how long this block lasts.',
		);
	});

	it('names the block whose power is missing', () => {
		expect(refusal('nopow.zwo', zwo('<SteadyState Duration="600"/>'))).toBe(
			'Block 1 (SteadyState): the file does not say what power to hold here.',
		);
	});

	it('names the interval block that never says how many times', () => {
		expect(
			refusal(
				'norep.zwo',
				zwo(
					'<IntervalsT OnDuration="30" OffDuration="30" OnPower="1.1" OffPower="0.5"/>',
				),
			),
		).toContain('how many times');
	});

	it('refuses a block outside the SPEC bounds with the reason', () => {
		const error = refusal(
			'hot.zwo',
			zwo('<SteadyState Duration="600" Power="5"/>'),
		);
		expect(error).toContain('500% of FTP');
		expect(error).toContain('not a workout WattRoom can ride');
	});

	it('refuses a workout of nothing but blocks it cannot ride', () => {
		expect(refusal('empty.zwo', zwo('<FreeRide Duration="600"/>'))).toContain(
			'Nothing in that .zwo',
		);
	});
});

const erg = (data: string, header = 'FTP = 200\nMINUTES WATTS') =>
	`[COURSE HEADER]
VERSION = 2
UNITS = ENGLISH
${header}
[END COURSE HEADER]
[COURSE DATA]
${data}
[END COURSE DATA]`;

describe('.erg', () => {
	it('keeps steady watts exactly, and collapses the step-change rows', () => {
		const { workout, notes } = ok(
			'over-unders.erg',
			erg(`0.00\t150
10.00\t150
10.00\t250
15.00\t250`),
		);
		expect(workout.name).toBe('over-unders');
		expect(workout.steps).toEqual([
			{ type: 'steady', seconds: 600, watts: 150 },
			{ type: 'steady', seconds: 300, watts: 250 },
		]);
		expect(notes).toEqual([]);
	});

	it('reads percent when the header says percent', () => {
		const { workout } = ok(
			'pct.erg',
			erg(
				`0.00\t75
20.00\t75`,
				'MINUTES PERCENT',
			),
		);
		expect(workout.steps[0]).toEqual({
			type: 'steady',
			seconds: 1200,
			target: 0.75,
		});
	});

	it('converts a watt ramp at the FTP the file states, and says so', () => {
		const { workout, notes } = ok(
			'ramp.erg',
			erg(`0.00\t100
10.00\t200`),
		);
		expect(workout.steps[0]).toEqual({
			type: 'ramp',
			seconds: 600,
			from: 0.5,
			to: 1,
		});
		expect(notes).toEqual([
			expect.stringContaining('200 W FTP the file states'),
		]);
	});

	it("falls back to the rider's FTP for a ramp, and says the ramps will move with it", () => {
		const { workout, notes } = ok(
			'ramp.erg',
			erg(
				`0.00\t125
10.00\t250`,
				'MINUTES WATTS',
			),
			250,
		);
		expect(workout.steps[0]).toEqual({
			type: 'ramp',
			seconds: 600,
			from: 0.5,
			to: 1,
		});
		expect(notes).toEqual([expect.stringContaining('your 250 W FTP')]);
	});

	it('refuses a watt ramp when nobody has an FTP to convert it at', () => {
		expect(
			refusal(
				'ramp.erg',
				erg(
					`0.00\t125
10.00\t250`,
					'MINUTES WATTS',
				),
				null,
			),
		).toContain('set your FTP in Settings');
	});

	it('says it assumed watts when the header names no unit', () => {
		const { notes } = ok(
			'nounit.erg',
			erg(
				`0.00\t150
10.00\t150`,
				'FTP = 200',
			),
		);
		expect(notes).toEqual([expect.stringContaining('does not name its units')]);
	});

	it('refuses a file with no course data', () => {
		expect(
			refusal('nodata.erg', '[COURSE HEADER]\nFTP = 200\n[END COURSE HEADER]'),
		).toContain('[COURSE DATA]');
	});

	it('refuses a single data point, naming why', () => {
		expect(refusal('one.erg', erg('0.00\t150'))).toContain('start and an end');
	});

	it('quotes the course-data line it could not read', () => {
		expect(refusal('junk.erg', erg('0.00\tabout two hundred'))).toContain(
			'about two hundred',
		);
	});
});

describe('picking a file', () => {
	it('refuses an extension it does not read, by name', () => {
		expect(refusal('plan.fit', 'anything')).toContain('.zwo and .erg');
	});

	it('refuses an empty file', () => {
		expect(refusal('blank.zwo', '   \n ')).toBe('That file is empty.');
	});

	it('refuses a file past the read ceiling before reading it', async () => {
		const big = {
			name: 'huge.zwo',
			size: MAX_IMPORT_BYTES + 1,
			text: () => Promise.reject(new Error('should not be read')),
		} as unknown as File;
		const outcome = await importWorkoutFile(big, 250);
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) expect(outcome.error).toContain('1024 KB');
	});

	it('reads a file that fits', async () => {
		const source = zwo('<SteadyState Duration="600" Power="0.7"/>');
		const file = {
			name: 'fits.zwo',
			size: source.length,
			text: () => Promise.resolve(source),
		} as unknown as File;
		const outcome = await importWorkoutFile(file, 250);
		expect(outcome.ok).toBe(true);
		if (outcome.ok) {
			const step = outcome.imported.workout.steps[0] as SteadyStep;
			expect(step.target).toBe(0.7);
		}
	});

	it('says so when the file cannot be read at all', async () => {
		const file = {
			name: 'gone.zwo',
			size: 10,
			text: () => Promise.reject(new Error('NotReadableError')),
		} as unknown as File;
		const outcome = await importWorkoutFile(file, 250);
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) expect(outcome.error).toContain('could not be read');
	});
});

describe('the converted workout stays inside the engine', () => {
	it('refuses a file that expands past the block ceiling', () => {
		const blocks = Array.from(
			{ length: 30 },
			() =>
				'<IntervalsT Repeat="10" OnDuration="30" OffDuration="30" OnPower="1.1" OffPower="0.5"/>',
		).join('');
		expect(refusal('huge.zwo', zwo(blocks))).toContain('above the 200 limit');
	});

	it('keeps repeats as repeats rather than writing every rep out', () => {
		const { workout } = ok(
			'reps.zwo',
			zwo(
				'<IntervalsT Repeat="8" OnDuration="60" OffDuration="60" OnPower="1.1" OffPower="0.5"/>',
			),
		);
		expect(workout.steps).toHaveLength(1);
		expect((workout.steps[0] as RepeatStep).times).toBe(8);
	});
});
