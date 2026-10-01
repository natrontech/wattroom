/**
 * The wardrobe's catalogue, v3 (#3153, ADR-0069): every slot and item a rider
 * can own and wear, with the names and the looks. The server holds only the
 * ids, slots, prices and unlocks (server/internal/wardrobe/catalogue.go), and
 * a Go test keeps the two in step. Looks only: no item carries a stat.
 *
 * The makers are ids here; their names wait for their trademark clearance
 * (#3253) and reach riders with #3345.
 */
import data from './catalogue.json';

export type Tier = keyof typeof data.currency.tiers;

/** One catalogue entry: what every item has, and the look it carries beside. */
export interface Item {
	id: string;
	slot: string;
	name: string;
	/** A maker's id; WattRoom's own items have none. */
	brand?: string;
	/** A price tier (docs/SPEC.md "Wardrobe"), on an item sold for Batzen. */
	tier?: Tier;
	/** "earned:<rule>" or "with:<frame>|<frame>", on an item never sold. */
	unlock?: string;
	starter?: boolean;
	free?: boolean;
	crewOnly?: boolean;
	[look: string]: unknown;
}

export const catalogue = data as unknown as Omit<typeof data, 'items'> & {
	items: Item[];
};

/** How an item is had: sold, earned, with a frame, a crew's, or free. */
export type Kind = 'buy' | 'earn' | 'with' | 'crew' | 'free';

export const kindOf = (item: Item): Kind =>
	item.tier
		? 'buy'
		: item.unlock?.startsWith('earned:')
			? 'earn'
			: item.unlock?.startsWith('with:')
				? 'with'
				: item.crewOnly
					? 'crew'
					: 'free';

/** What an item costs in Batzen, or null for one never sold. */
export const tierPrice = (item: Item): number | null =>
	item.tier ? catalogue.currency.tiers[item.tier] : null;
