package service

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/model"
)

type catFKPollHandler struct{}

func (catFKPollHandler) Type() string { return "catfk_order_poll" }

// Disabling new purchases never stops recovery of previously created orders.
// Protocol readiness and the encryption key still guard all background queries.
func (catFKPollHandler) Enabled() bool           { return CatFKProtocolReady() }
func (catFKPollHandler) Interval() time.Duration { return 15 * time.Second }
func (catFKPollHandler) NewPayload() any         { return nil }
func (catFKPollHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	err := catFKProductionService().poll(ctx)
	if err != nil {
		failSystemTask(task, runnerID, catFKPublicError(err))
		return
	}
	if err = model.FinishSystemTask(task.TaskID, runnerID, model.SystemTaskStatusSucceeded, nil, ""); err != nil {
		logSystemTaskLockError(ctx, task, err)
	}
}
func init() { RegisterSystemTaskHandler(catFKPollHandler{}) }

func (s *catFKService) poll(ctx context.Context) error {
	if !s.adapter.Ready() {
		return ErrCatFKProtocolUnverified
	}
	key, err := s.key()
	if err != nil {
		return err
	}
	orders, err := s.store.Due(s.now().Unix(), 50)
	if err != nil {
		return err
	}
	for _, candidate := range orders {
		if err = ctx.Err(); err != nil {
			return err
		}
		order, claimed, claimErr := s.store.Claim(candidate.ID, s.now().Unix(), 120)
		if claimErr != nil {
			return claimErr
		}
		if !claimed {
			continue
		}
		// Polling may claim a never-submitted row after the creating worker died.
		// It deliberately never submits: no replay can cause a second purchase.
		if candidate.Status == model.CatFKOrderStatusNew || order.Status == model.CatFKOrderStatusSubmitting {
			_, err = s.store.Update(order.ID, order.Version, model.CatFKOrderUpdate{Status: model.CatFKOrderStatusCreationUnknown, FailureCode: "creation_unknown", NextQueryAt: s.now().Add(time.Minute).Unix()})
			if err != nil {
				return err
			}
			continue
		}
		var credentials CatFKCredentials
		if err = catFKOpen(key, fmt.Sprintf("catfk/order/v1/%d/%s", order.UserID, order.TradeNo), order.CredentialCiphertext, &credentials); err != nil {
			_, err = s.store.Update(order.ID, order.Version, model.CatFKOrderUpdate{Status: model.CatFKOrderStatusNeedsAttention, FailureCode: "credential_unavailable"})
			if err != nil {
				return err
			}
			continue
		}
		queryCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		evidence, queryErr := s.adapter.Query(queryCtx, order, credentials)
		cancel()
		if errors.Is(queryErr, ErrCatFKVerification) {
			_, err = s.store.Update(order.ID, order.Version, model.CatFKOrderUpdate{Status: model.CatFKOrderStatusNeedsAttention, FailureCode: "verification_mismatch"})
			if err != nil {
				return err
			}
			continue
		}
		if queryErr != nil || evidence == nil {
			// Version grows on each claim/retry; capped exponential backoff survives
			// restarts without relying on process-local counters.
			delay := min(int64(900), int64(15)<<min(max(order.Version/2, 0), 6))
			_, err = s.store.Retry(order.ID, order.Version, s.now().Unix()+delay)
			if err != nil {
				return err
			}
			continue
		}
		err = s.applyEvidence(order, evidence)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *catFKService) applyEvidence(order *model.CatFKOrder, e *CatFKOrderEvidence) error {
	valid := catFKMatchesPurchase(order, e)
	if !valid {
		_, err := s.store.Update(order.ID, order.Version, model.CatFKOrderUpdate{Status: model.CatFKOrderStatusNeedsAttention, FailureCode: "verification_mismatch"})
		return err
	}
	// Recover an ambiguous creation only after validating the complete purchase
	// identity; merely receiving an order identifier does not establish payment.
	if order.UpstreamOrderID == nil {
		ok, err := s.store.Update(order.ID, order.Version, model.CatFKOrderUpdate{Status: model.CatFKOrderStatusPending, UpstreamOrderID: &e.UpstreamOrderID, NextQueryAt: s.now().Add(30 * time.Second).Unix()})
		if err != nil || !ok {
			return err
		}
		order.Version++
		order.Status = model.CatFKOrderStatusPending
		order.UpstreamOrderID = &e.UpstreamOrderID
	}
	if e.Expired && !e.Paid && order.Status != model.CatFKOrderStatusPaid {
		_, err := s.store.Update(order.ID, order.Version, model.CatFKOrderUpdate{Status: model.CatFKOrderStatusExpired})
		return err
	}
	if !e.Paid {
		if order.Status == model.CatFKOrderStatusPaid {
			_, err := s.store.Update(order.ID, order.Version, model.CatFKOrderUpdate{Status: model.CatFKOrderStatusNeedsAttention, FailureCode: "payment_regressed"})
			return err
		}
		_, err := s.store.Retry(order.ID, order.Version, s.now().Add(30*time.Second).Unix())
		return err
	}
	if order.Status != model.CatFKOrderStatusPaid {
		ok, err := s.store.Update(order.ID, order.Version, model.CatFKOrderUpdate{Status: model.CatFKOrderStatusPaid, NextQueryAt: s.now().Add(30 * time.Second).Unix()})
		if err != nil || !ok {
			return err
		}
		order.Version++
		order.Status = model.CatFKOrderStatusPaid
	}
	if !e.Delivered {
		_, err := s.store.Retry(order.ID, order.Version, s.now().Add(30*time.Second).Unix())
		return err
	}
	// A delivery must be one exact non-empty code. It is never persisted or
	// included in logs/DTOs; settlement independently checks denomination.
	_, codeErr := hex.DecodeString(e.RedemptionKey)
	if len(e.RedemptionKey) != 32 || codeErr != nil {
		_, err := s.store.Update(order.ID, order.Version, model.CatFKOrderUpdate{Status: model.CatFKOrderStatusNeedsAttention, FailureCode: "delivery_invalid"})
		return err
	}
	_, err := s.store.Complete(order.ID, order.Version, e.RedemptionKey, "")
	if err != nil {
		// Only definite redemption/business failures require human attention.
		// Unknown driver failures remain paid and retry without consuming twice.
		if errors.Is(err, model.ErrRedemptionInvalid) || errors.Is(err, model.ErrRedemptionUsed) || errors.Is(err, model.ErrRedemptionExpired) || errors.Is(err, model.ErrRedemptionQuotaMismatch) || errors.Is(err, model.ErrTopUpQuotaLimitExceeded) || errors.Is(err, model.ErrWalletQuotaLimitExceeded) {
			_, updateErr := s.store.Update(order.ID, order.Version, model.CatFKOrderUpdate{Status: model.CatFKOrderStatusNeedsAttention, FailureCode: "settlement_failed"})
			return updateErr
		}
		_, retryErr := s.store.Retry(order.ID, order.Version, s.now().Add(time.Minute).Unix())
		return retryErr
	}
	return nil
}
