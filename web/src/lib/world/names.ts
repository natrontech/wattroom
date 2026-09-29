// Invented place names: villages from cycling puns in Swiss-German dress,
// peaks and passes from real-sounding roots with one pun in six. Invented on
// purpose — a generated world never borrows a real place's name.

export type Names = { peak: string; second: string; pass: string };

export const VILLAGES = [
	'Oberwatt',
	'Kadenzach',
	'Ergwil',
	'Spinnbach',
	'Laktatberg',
	'Rampenried',
	'Sprintigen',
	'Tretwil',
	'Pedalfingen',
	'Schwellwald',
	'Kurbelbach',
	'Ritzelstein',
];

const ROOTS = [
	'Gurn',
	'Gant',
	'Nünen',
	'Selib',
	'Honegg',
	'Schwarz',
	'Tann',
	'Sulz',
	'Bürg',
	'Riedt',
	'Hasl',
	'Lueg',
	'Chrüz',
	'Farn',
	'Schwend',
	'Moos',
	'Wyss',
	'Stock',
	'Rüeg',
	'Blum',
	'Fall',
	'Hohgant',
	'Birch',
	'Chal',
];
const PUNS = [
	'Watt',
	'Kadenz',
	'Laktat',
	'Ritzel',
	'Pedal',
	'Kurbel',
	'Rampen',
	'Sprint',
	'Tritt',
];
export function namesFor(rand: () => number): Names {
	const pick = (a: string[]) => a[Math.floor(rand() * a.length)];
	const root = () => (rand() < 1 / 6 ? pick(PUNS) : pick(ROOTS)); // one pun in six
	const peakRoot = root();
	return {
		peak: peakRoot + pick(['horn', 'stock', 'flue', 'grat', 'spitz']),
		second: root() + pick(['horn', 'egg', 'berg', 'stock']),
		pass: peakRoot + 'pass',
	};
}
