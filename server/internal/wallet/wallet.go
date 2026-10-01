// Package wallet is Batzen (#3152, ADR-0069): the one currency, for
// cosmetics only, earned by riding and never bought. Its own append-only
// ledger, never xp_events, minted in the ride's own transaction — never
// through the gamify queue, which drops jobs when it is full.
package wallet

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// docs/SPEC.md "Wardrobe" (defaults — tune in alpha).
const (
	// Per ride, at most 1.2 × the minutes ridden: 72 an hour.
	perMinuteCap = 1.2
	// × 1.2 in a group session.
	groupFactor = 1.2
	// At most 180 per UTC day of the save.
	dayCap = 180
	// 100 on welcome.
	welcome = 100
	// An opening grant for existing riders of min(their history, 1,500).
	openingCap = 1500
)

// Batzen is what a ride earns (ADR-0069): one per minute ridden at the
// rider's own FTP — kJ × 1000 / (FTP × 60), the FTP the ride was ridden at —
// × 1.2 in a group session, then held to 1.2 × the minutes pedalled, since
// zero-watt seconds earn nothing: 72 an hour at most, in a group too (#3513).
// Whole Batzen, rounded down.
func Batzen(watts []int, ftp int, group bool) int32 {
	if ftp <= 0 {
		return 0
	}
	sum, pedalled := 0, 0
	for _, w := range watts {
		if w > 0 {
			sum += w
			pedalled++
		}
	}
	earned := float64(sum) / float64(ftp*60)
	if group {
		earned *= groupFactor
	}
	earned = min(earned, perMinuteCap*float64(pedalled)/60)
	return int32(math.Floor(earned)) //nolint:gosec // a ride is at most hours of minutes
}

// MintRide pays a saved ride into the wallet. The caller holds the rider's
// row lock inside the ride's own transaction (store.LockUser), which is what
// lets the day's cap hold under two saves at once.
func MintRide(ctx context.Context, q *db.Queries, user, ride pgtype.UUID, amount int32) error {
	return mint(ctx, q, user, "ride", store.UUIDString(ride), amount)
}

// MintGrowth pays what an amended ride earns beyond what it already has
// (#1536's AmendRide): the whole record's Batzen less every row minted for
// this ride so far. `seconds` names the amendment, so each growth is its own
// row and a retry of the same one writes nothing.
func MintGrowth(ctx context.Context, q *db.Queries, user, ride pgtype.UUID, seconds int32, amount int32) error {
	id := store.UUIDString(ride)
	have, err := q.WalletMintedForRide(ctx, db.WalletMintedForRideParams{UserID: user, Ride: id})
	if err != nil {
		return err
	}
	return mint(ctx, q, user, "ride_grew", id+"@"+strconv.Itoa(int(seconds)), amount-have)
}

// mint writes one riding row, held to what is left of the UTC day's cap, and
// the welcome grant first if the rider has not had it. The synthetic account
// rides for real and earns nothing.
func mint(ctx context.Context, q *db.Queries, user pgtype.UUID, source, ref string, amount int32) error {
	synthetic, err := q.UserIsSynthetic(ctx, user)
	if err != nil || synthetic {
		return err
	}
	if err := ensureWelcome(ctx, q, user); err != nil {
		return err
	}
	today, err := q.WalletMintedToday(ctx, user)
	if err != nil {
		return err
	}
	amount = max(0, min(amount, dayCap-today))
	// A ride the cap took to nothing still writes its row of 0 (#3513): it
	// is paid, and the opening grant counts only rides nothing paid. A growth
	// of nothing writes no row — its ride has one.
	if amount == 0 && source != "ride" {
		return nil
	}
	_, err = q.CreateWalletEvent(ctx, db.CreateWalletEventParams{
		UserID: user, Source: source, Amount: amount, Ref: ref,
	})
	return err
}

// Balance is what the rider holds, the welcome grant included the first time
// they are asked about (the synthetic account holds nothing). The caller
// holds their row lock when a spend depends on it.
func Balance(ctx context.Context, q *db.Queries, user pgtype.UUID) (int64, error) {
	synthetic, err := q.UserIsSynthetic(ctx, user)
	if err == nil && !synthetic {
		err = ensureWelcome(ctx, q, user)
	}
	if err != nil {
		return 0, err
	}
	return q.WalletBalance(ctx, user)
}

// Spend writes a purchase of `price` Batzen (#3154). The caller has read the
// balance under the rider's row lock, which is what keeps it from going below
// zero. A ref already spent is an error, never a free item (#3513): the
// ledger's one-row-per-ref would otherwise drop the charge and the caller
// would hand the item over anyway.
func Spend(ctx context.Context, q *db.Queries, user pgtype.UUID, ref string, price int32) error {
	return writeOnce(ctx, q, db.CreateWalletEventParams{UserID: user, Source: "purchase", Amount: -price, Ref: ref})
}

// Refund gives an undone purchase back, under the purchase's own ref — once.
func Refund(ctx context.Context, q *db.Queries, user pgtype.UUID, ref string, price int32) error {
	return writeOnce(ctx, q, db.CreateWalletEventParams{UserID: user, Source: "undo", Amount: price, Ref: ref})
}

// writeOnce writes a row the caller's transaction depends on, and fails when
// the ledger already held one under that ref.
func writeOnce(ctx context.Context, q *db.Queries, row db.CreateWalletEventParams) error {
	n, err := q.CreateWalletEvent(ctx, row)
	if err == nil && n == 0 {
		err = fmt.Errorf("wallet: a %s under %q is already written", row.Source, row.Ref)
	}
	return err
}

func ensureWelcome(ctx context.Context, q *db.Queries, user pgtype.UUID) error {
	_, err := q.CreateWalletEvent(ctx, db.CreateWalletEventParams{
		UserID: user, Source: "welcome", Amount: welcome, Ref: "welcome",
	})
	return err
}

// Open grants every account its opening grant, once (ADR-0069): what its
// rides saved before the wallet would have minted, capped. Account by
// account, each under its own row lock: a ride minting at the same moment is
// never counted twice, and an account deleted mid-run costs that account its
// grant and nobody else theirs. Idempotent, so it runs at every start and
// does nothing once done.
func Open(ctx context.Context, st *store.Store, log *slog.Logger) {
	arrived, err := walletArrived(ctx, st)
	if err != nil {
		if ctx.Err() == nil {
			log.Error("wallet opening grants: when the wallet arrived is unknown", "err", err)
		}
		return
	}
	owed, err := st.Queries.ListAccountsWithoutOpening(ctx, arrived)
	if err != nil {
		if ctx.Err() == nil {
			log.Error("wallet opening grants: list failed", "err", err)
		}
		return
	}
	granted := 0
	for _, user := range owed {
		if err := openOne(ctx, st, user); err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Warn("wallet opening grant failed", "err", err, "user", store.UUIDString(user))
			continue
		}
		granted++
	}
	if granted > 0 {
		log.Info("wallet opening grants", "accounts", granted)
	}
}

// walletMigration is the migration that brought the wallet.
const walletMigration = 20260929183545

// walletArrived is when this database applied walletMigration, read off
// goose's own record: an account made before it is an existing rider's
// (ADR-0069). Per database, so a self-hoster's cutoff is their own upgrade.
func walletArrived(ctx context.Context, st *store.Store) (pgtype.Timestamptz, error) {
	var at pgtype.Timestamptz
	err := st.Pool.QueryRow(ctx,
		"select tstamp::timestamptz from goose_db_version where version_id = $1 and is_applied order by id limit 1",
		walletMigration).Scan(&at)
	return at, err
}

func openOne(ctx context.Context, st *store.Store, user pgtype.UUID) error {
	tx, err := st.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := st.Queries.WithTx(tx)
	if err := q.LockUser(ctx, user); err != nil {
		return err
	}
	if _, err := q.OpenWallet(ctx, db.OpenWalletParams{UserID: user, GrantCap: openingCap, PerMinute: perMinuteCap}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Users is who is asking: the session source only. A wallet is always
// private — a personal token never reads it.
type Users interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

type Service struct {
	store *store.Store
	users Users
	log   *slog.Logger
}

func New(st *store.Store, users Users, log *slog.Logger) *Service {
	return &Service{store: st, users: users, log: log}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/me/wallet", s.handleBalance)
}

func (s *Service) handleBalance(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to see your Batzen.")
	if !ok {
		return
	}
	balance, err := Balance(r.Context(), s.store.Queries, user.ID)
	if err != nil {
		httpx.Fail(w, s.log, "wallet balance failed", err, "Your Batzen could not be loaded.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]int64{"balance": balance})
}
