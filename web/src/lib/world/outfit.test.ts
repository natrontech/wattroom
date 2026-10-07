import { describe, expect, it } from 'vitest';
import { catalogue } from '$lib/wardrobe/catalogue';
import { DEFAULT_DARK_ID, themeById } from '$lib/themes';
import { STYLES } from '../../routes/(app)/dev/world/styles';
import { PATTERNS, patternIndex } from './figure/jersey';
import { resolveKit, WHEELS } from './figure/kit';
import { seededLoadout, type Loadout } from './loadout';
import { kitOf, outfitOf } from './outfit';

const look = (STYLES.find((s) => s.id === 'bluehour') ?? STYLES[0]).kit;
const t = themeById(DEFAULT_DARK_ID)!.tokens;
const viewer = {
	watt: t.watt,
	zones: [t.z1, t.z2, t.z3, t.z4, t.z5, t.z6, t.z7],
};
const hexOf = (id: string) => catalogue.palette.find((p) => p.id === id)!.hex;

describe('a loadout on the figure (#3156)', () => {
	it('dresses the starter loadout as the figure’s starter kit', () => {
		const kit = kitOf(catalogue.starterLoadout as Loadout);
		const starter = resolveKit();
		expect(kit.frame).toBe(starter.frame);
		expect(kit.wheels).toEqual(starter.wheels);
		expect(kit.bars).toBe('drop');
		expect(kit.helmet).toBe('road');
		expect(kit.glasses).toBe('wrap');
	});

	it('rides the nearest shape the figure draws where the catalogue names one it does not', () => {
		const kit = kitOf({
			frame: 'frame.endurance',
			helmet: 'helmet.tt',
			wheels: 'wheels.blade3',
			glasses: 'glasses.gletscher',
			params: { sleeves: 'long', shortsLen: 'tights', bottles: 2 },
		});
		expect(kit.frame).toBe('race');
		expect(kit.helmet).toBe('aero');
		expect(kit.wheels).toEqual(WHEELS.trispoke);
		expect(kit.glasses).toBe('round');
		expect(kit.jersey.sleeves).toBe('long');
		expect(kit.shorts).toBe('knicker');
		expect(kit.bottles).toBe('two');
	});

	it('paints the jersey’s pattern and colours, and never puts Gipfelpunkte’s dots on a white ground', () => {
		const hoops = outfitOf(
			{ jersey: 'jp.hoops', colours: { jerseyA: 'enzian', jerseyB: 'sun' } },
			look,
			viewer,
		);
		expect(hoops.jersey.pattern).toBe(patternIndex('hoops'));
		expect(`#${hoops.palette.jersey.getHexString()}`).toBe(hexOf('enzian'));

		const dots = outfitOf(
			{
				jersey: 'jp.gipfelpunkte',
				colours: { jerseyA: 'snow', jerseyB: 'rust' },
			},
			look,
			viewer,
		);
		expect(`#${dots.jersey.b.getHexString()}`).toBe(hexOf('snow'));
		expect(`#${dots.palette.jersey.getHexString()}`).not.toBe(hexOf('snow'));
	});

	it('wears the neutral figure until the rider chooses a skin', () => {
		expect(`#${outfitOf({}, look, viewer).palette.skin.getHexString()}`).toBe(
			look.skin,
		);
		expect(
			`#${outfitOf({ skin: 'skin.5' }, look, viewer).palette.skin.getHexString()}`,
		).toBe(catalogue.skinTones.find((s) => s.id === 'skin.5')!.hex);
	});

	it('seeds a look from a rider’s id: theirs on every screen, a pattern the figure draws, and no skin of its own', () => {
		expect(seededLoadout('mia')).toEqual(seededLoadout('mia'));
		const looks = ['mia', 'sven', 'tom', 'you', 'r0', 'r1'].map(seededLoadout);
		expect(new Set(looks.map((l) => JSON.stringify(l))).size).toBe(6);
		for (const l of looks) {
			const pattern = catalogue.items.find((i) => i.id === l.jersey)?.pattern;
			expect(PATTERNS).toContain(pattern);
			expect(l.skin).toBeUndefined();
		}
	});
});
