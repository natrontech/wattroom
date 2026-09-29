// Package wallet is Batzen (#3152, ADR-0069): the one currency, for
// cosmetics only, earned by riding and never bought. Its own append-only
// ledger, never xp_events, minted in the ride's own transaction — never
// through the gamify queue, which drops jobs when it is full.
package wallet

import (
	"context"
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
// held to 1.2 × the minutes pedalled, since zero-watt seconds earn nothing,
// and × 1.2 in a group session. Whole Batzen, rounded down.
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
	earned := min(float64(sum)/float64(ftp*60), perMinuteCap*float64(pedalled)/60)
	if group {
		earned *= groupFactor
	}
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
	amount = min(amount, max(0, dayCap-today))
	if amount <= 0 {
		return nil
	}
	_, err = q.CreateWalletEvent(ctx, db.CreateWalletEventParams{
		UserID: user, Source: source, Amount: amount, Ref: ref,
	})
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
	owed, err := st.Queries.ListAccountsWithoutOpening(ctx)
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
	synthetic, err := s.store.Queries.UserIsSynthetic(r.Context(), user.ID)
	if err == nil && !synthetic {
		err = ensureWelcome(r.Context(), s.store.Queries, user.ID)
	}
	if err != nil {
		httpx.Fail(w, s.log, "wallet welcome failed", err, "Your Batzen could not be loaded.")
		return
	}
	balance, err := s.store.Queries.WalletBalance(r.Context(), user.ID)
	if err != nil {
		httpx.Fail(w, s.log, "wallet balance failed", err, "Your Batzen could not be loaded.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]int64{"balance": balance})
}
