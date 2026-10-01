package account

import "github.com/natrontech/wattroom/server/internal/store/db"

// The rider's Batzen (#3152, ADR-0069): the ledger row by row — what each
// ride paid, the grants and, once the garage opens, what they bought.
func (x *export) wallet() category {
	return x.bounded("wallet.json", []string{"wallet_events"}, func() (any, int, error) {
		rows, err := x.q.ExportUserWallet(x.ctx, db.ExportUserWalletParams{
			UserID: x.user.ID, Lim: maxExportRows,
		})
		out, err := mapRows(rows, err, func(row db.ExportUserWalletRow) any {
			return map[string]any{"source": row.Source, "batzen": row.Amount,
				"about": row.Ref, "at": row.CreatedAt.Time}
		})
		return out, len(rows), err
	})
}
