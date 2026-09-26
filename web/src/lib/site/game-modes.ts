/**
 * The seven game modes as the public pages tell them. Every number is
 * docs/SPEC.md's "Game mode parameters" — tune there, then here, never
 * only here.
 */
export type GameMode = {
	slug: string;
	name: string;
	/** The one line a card has room for. */
	line: string;
	/** How it plays, for /game-modes. */
	rules: string;
	/** Who it is for. */
	best: string;
};

export const GAME_MODE_LIST: readonly GameMode[] = [
	{
		slug: 'sprint-roulette',
		name: 'Sprint Roulette',
		line: 'A klaxon, three seconds, then everything you have.',
		rules:
			'Five sprints of 10–15 seconds land at random, 3–8 minutes apart. A klaxon gives you three seconds’ warning, the trainer lets go of ERG, and the podium goes to the best five seconds in w/kg.',
		best: 'Crews who like to be surprised.',
	},
	{
		slug: 'points-race',
		name: 'Points Race',
		line: 'Intervals with sprints hidden in them. Every one scores.',
		rules:
			'Fixed two-minute intervals, with four sprints arriving roulette-style for 5, 3, 2 and 1 points. The best-executed interval earns three more, and staying in the zone earns one per interval.',
		best: 'Riders who want the workout and the fight.',
	},
	{
		slug: 'watt-golf',
		name: 'Watt Golf',
		line: 'Hit the number with the meter turned off.',
		rules:
			'Nine holes. Each one says “hit this many watts for 10 seconds, starting in 20” — and the meter goes dark before you get there. Your strokes are how far off you were, in watts. Lowest round wins.',
		best: 'Pacing nerds, and anyone who thinks they know their legs.',
	},
	{
		slug: 'backyard-ramp',
		name: 'Backyard Ramp',
		line: 'Three-minute rounds that keep getting harder. Last one pedalling wins.',
		rules:
			'Rounds of three minutes, starting at 80 % of FTP and adding 5 % each round. Ten seconds below the band and you are out — then you spin on at 50 % with everyone else and cheer.',
		best: 'An elimination on everyone’s own FTP, so the smallest engine can win.',
	},
	{
		slug: 'collective-ramp',
		name: 'Collective Ramp',
		line: 'Backyard rules on the crew’s average. Nobody gets dropped alone.',
		rules:
			'The line starts at 75 % and rises 4 % a round, and it is measured against the whole session’s average %FTP. A strong rider can carry a tired one. The score is how many rounds you survive, together.',
		best: 'Mixed crews, and the night nobody wants to lose.',
	},
	{
		slug: 'floor-is-lava',
		name: 'Floor is Lava',
		line: 'A zone is called. Stay in it.',
		rules:
			'A power zone is called every two minutes. Leave it for more than five seconds and you burn a life; three lives each.',
		best: 'Learning what your zones actually feel like.',
	},
	{
		slug: 'team-relay',
		name: 'Team Relay',
		line: 'One rider on the front, everyone else recovering.',
		rules:
			'One rider holds 110 % of FTP on the front while the others spin at 55 %, rotating every 60–90 seconds or on the call. The crew’s distance is everyone’s front work added up.',
		best: 'Crews who ride outside together and miss the paceline.',
	},
];
