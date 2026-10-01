package account

import (
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The rider's wardrobe and outfit (#3153, ADR-0069): every item they own, by
// the catalogue's id, how it came and when, and what their figure wears.
func (x *export) wardrobe() category {
	return x.bounded("wardrobe.json", []string{"wardrobe", "outfits"}, func() (any, int, error) {
		rows, err := x.q.ExportUserWardrobe(x.ctx, db.ExportUserWardrobeParams{
			UserID: x.user.ID, Lim: maxExportRows,
		})
		owned, err := mapRows(rows, err, func(row db.ExportUserWardrobeRow) any {
			return map[string]any{"item": row.ItemID, "how": row.Source,
				"since": row.AcquiredAt.Time, "firstWorn": timeOrNil(row.FirstWornAt)}
		})
		if err != nil {
			return nil, 0, err
		}
		var outfit any
		worn, err := x.q.GetUserOutfit(x.ctx, x.user.ID)
		switch {
		case err == nil:
			outfit = map[string]any{"loadout": json.RawMessage(worn.Loadout), "updatedAt": worn.UpdatedAt.Time}
		case !errors.Is(err, pgx.ErrNoRows):
			return nil, 0, err
		}
		return map[string]any{"owned": owned, "outfit": outfit}, len(rows), nil
	})
}
