package model

import (
	"math"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 佣金记录状态。生产库现存记录全部为 completed。
const (
	AffiliateCommissionStatusCompleted = "completed"
	AffiliateCommissionStatusPending   = "pending"
	AffiliateCommissionStatusFailed    = "failed"
)

// AffiliateCommission 推广佣金明细。
// 字段与生产库 affiliate_commissions 表严格一致，不改变既有列语义。
type AffiliateCommission struct {
	Id              int64   `json:"id" gorm:"primaryKey;autoIncrement"`
	InviterId       int64   `json:"inviter_id" gorm:"index:idx_affiliate_source,unique,priority:1;index:idx_affiliate_inviter_created,priority:1"`
	InviteeId       int64   `json:"invitee_id" gorm:"index"`
	SourceKey       string  `json:"source_key" gorm:"type:varchar(128);index:idx_affiliate_source,unique,priority:2"`
	BillingSource   string  `json:"billing_source" gorm:"type:varchar(32)"`
	ModelName       string  `json:"model_name" gorm:"type:varchar(191)"`
	ConsumedQuota   int64   `json:"consumed_quota"`
	EligibleQuota   int64   `json:"eligible_quota"`
	RatePercent     int64   `json:"rate_percent"`
	RewardAmount    float64 `json:"reward_amount" gorm:"type:decimal(20,6)"`
	CreditedQuota   int64   `json:"credited_quota"`
	RemainderBefore float64 `json:"remainder_before" gorm:"type:decimal(20,6)"`
	RemainderAfter  float64 `json:"remainder_after" gorm:"type:decimal(20,6)"`
	Status          string  `json:"status" gorm:"type:varchar(20);index"`
	Attempts        int64   `json:"attempts"`
	LastError       string  `json:"last_error" gorm:"type:text"`
	NextRetryAt     int64   `json:"next_retry_at" gorm:"index"`
	CreatedAt       int64   `json:"created_at" gorm:"index:idx_affiliate_inviter_created,priority:2;index"`
	UpdatedAt       int64   `json:"updated_at" gorm:"index"`
}

func (AffiliateCommission) TableName() string {
	return "affiliate_commissions"
}

// AffiliateSummary 推广总览，供用户端展示。
type AffiliateSummary struct {
	InviteeCount     int64   `json:"invitee_count"`
	CommissionCount  int64   `json:"commission_count"`
	AvailableQuota   int64   `json:"available_quota"`
	TotalQuota       int64   `json:"total_quota"`
	PendingRemainder float64 `json:"pending_remainder"`
	RatePercent      int     `json:"rate_percent"`
	Enabled          bool    `json:"enabled"`
	AffCode          string  `json:"aff_code"`
}

// AffiliateCommissionItem 佣金明细条目。
type AffiliateCommissionItem struct {
	Id            int64   `json:"id"`
	InviteeId     int64   `json:"invitee_id"`
	InviteeName   string  `json:"invitee_name"`
	ModelName     string  `json:"model_name"`
	BillingSource string  `json:"billing_source"`
	ConsumedQuota int64   `json:"consumed_quota"`
	RatePercent   int64   `json:"rate_percent"`
	RewardAmount  float64 `json:"reward_amount"`
	CreditedQuota int64   `json:"credited_quota"`
	Status        string  `json:"status"`
	CreatedAt     int64   `json:"created_at"`
}

// AffiliateInviteeItem 邀请用户条目。被邀请人身份做脱敏处理。
type AffiliateInviteeItem struct {
	UserId          int64  `json:"user_id"`
	DisplayName     string `json:"display_name"`
	MaskedEmail     string `json:"masked_email"`
	CommissionCount int64  `json:"commission_count"`
	CreditedQuota   int64  `json:"credited_quota"`
	ConsumedQuota   int64  `json:"consumed_quota"`
	LastRewardAt    int64  `json:"last_reward_at"`
	RegisteredAt    int64  `json:"registered_at"`
}

// AffiliateAdminUserCommissionItem 管理端按邀请人聚合的佣金视图。
type AffiliateAdminUserCommissionItem struct {
	InviterId       int64   `json:"inviter_id"`
	Username        string  `json:"username"`
	DisplayName     string  `json:"display_name"`
	InviteeCount    int64   `json:"invitee_count"`
	CommissionCount int64   `json:"commission_count"`
	CreditedQuota   int64   `json:"credited_quota"`
	AvailableQuota  int64   `json:"available_quota"`
	TotalQuota      int64   `json:"total_quota"`
	Remainder       float64 `json:"remainder"`
	LastRewardAt    int64   `json:"last_reward_at"`
}

// maskAffiliateEmail 对邮箱做保守脱敏，邀请人只需辨识而非获知完整联系方式。
func maskAffiliateEmail(email string) string {
	email = strings.TrimSpace(email)
	if email == "" {
		return ""
	}
	at := strings.LastIndex(email, "@")
	if at <= 0 {
		return "***"
	}
	local, domain := email[:at], email[at:]
	switch {
	case len(local) <= 1:
		return "*" + domain
	case len(local) <= 3:
		return local[:1] + "**" + domain
	default:
		return local[:2] + "****" + domain
	}
}

// GetUserInviterId 返回指定用户的邀请人 ID，无邀请人时返回 0。
func GetUserInviterId(userId int) (int, error) {
	if userId <= 0 {
		return 0, nil
	}
	var user User
	if err := DB.Select("inviter_id").First(&user, userId).Error; err != nil {
		return 0, err
	}
	return user.InviterId, nil
}

// CreditAffiliateCommission 在单个事务内完成一笔佣金结算：
// 读取邀请人尾数 -> 计算入账整数与新尾数 -> 更新邀请人余额 -> 写入明细。
// 依赖 (inviter_id, source_key) 唯一索引保证同一次消费不会重复结算。
func CreditAffiliateCommission(record *AffiliateCommission) (bool, error) {
	if record == nil {
		return false, nil
	}
	if record.InviterId <= 0 || record.SourceKey == "" {
		return false, nil
	}
	if record.EligibleQuota <= 0 || record.RatePercent <= 0 {
		return false, nil
	}

	credited := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		// 先占位插入，命中唯一索引即说明该消费已结算过，直接跳过。
		placeholder := *record
		placeholder.Status = AffiliateCommissionStatusPending
		placeholder.Attempts = 1
		now := time.Now().Unix()
		placeholder.CreatedAt = now
		placeholder.UpdatedAt = now

		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&placeholder)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}

		var inviter User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id", "invite_reward_remainder").
			First(&inviter, placeholder.InviterId).Error; err != nil {
			return err
		}

		remainderBefore := inviter.InviteRewardRemainder
		reward := float64(placeholder.EligibleQuota) * float64(placeholder.RatePercent) / 100
		// 保留 6 位小数，与数据库 decimal(20,6) 精度一致，避免浮点误差累积。
		reward = math.Round(reward*1e6) / 1e6
		total := math.Round((reward+remainderBefore)*1e6) / 1e6
		creditedQuota := int64(math.Floor(total))
		remainderAfter := math.Round((total-float64(creditedQuota))*1e6) / 1e6

		if creditedQuota > 0 {
			if err := tx.Model(&User{}).Where("id = ?", placeholder.InviterId).
				Updates(map[string]interface{}{
					"invite_quota":            gorm.Expr("invite_quota + ?", creditedQuota),
					"aff_history":             gorm.Expr("aff_history + ?", creditedQuota),
					"invite_reward_remainder": remainderAfter,
				}).Error; err != nil {
				return err
			}
		} else if err := tx.Model(&User{}).Where("id = ?", placeholder.InviterId).
			Update("invite_reward_remainder", remainderAfter).Error; err != nil {
			return err
		}

		if err := tx.Model(&AffiliateCommission{}).Where("id = ?", placeholder.Id).
			Updates(map[string]interface{}{
				"reward_amount":    reward,
				"credited_quota":   creditedQuota,
				"remainder_before": remainderBefore,
				"remainder_after":  remainderAfter,
				"status":           AffiliateCommissionStatusCompleted,
				"updated_at":       time.Now().Unix(),
			}).Error; err != nil {
			return err
		}

		credited = true
		return nil
	})
	if err != nil {
		return false, err
	}
	return credited, nil
}

// GetAffiliateSummary 汇总某邀请人的推广数据。
func GetAffiliateSummary(inviterId int) (*AffiliateSummary, error) {
	var user User
	if err := DB.Select("id", "aff_code", "invite_quota", "aff_history", "invite_reward_remainder").
		First(&user, inviterId).Error; err != nil {
		return nil, err
	}

	summary := &AffiliateSummary{
		AvailableQuota:   user.InviteQuota,
		TotalQuota:       int64(user.AffHistoryQuota),
		PendingRemainder: user.InviteRewardRemainder,
		AffCode:          user.AffCode,
	}

	if err := DB.Model(&User{}).Where("inviter_id = ?", inviterId).
		Count(&summary.InviteeCount).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&AffiliateCommission{}).Where("inviter_id = ?", inviterId).
		Count(&summary.CommissionCount).Error; err != nil {
		return nil, err
	}
	return summary, nil
}

// GetAffiliateCommissions 分页返回佣金明细。
func GetAffiliateCommissions(inviterId int, offset, limit int) ([]*AffiliateCommissionItem, int64, error) {
	var total int64
	if err := DB.Model(&AffiliateCommission{}).Where("inviter_id = ?", inviterId).
		Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []*AffiliateCommission
	if err := DB.Where("inviter_id = ?", inviterId).
		Order("id DESC").Offset(offset).Limit(limit).Find(&rows).Error; err != nil {
		return nil, 0, err
	}

	items := make([]*AffiliateCommissionItem, 0, len(rows))
	inviteeIds := make([]int64, 0, len(rows))
	for _, row := range rows {
		items = append(items, &AffiliateCommissionItem{
			Id:            row.Id,
			InviteeId:     row.InviteeId,
			ModelName:     row.ModelName,
			BillingSource: row.BillingSource,
			ConsumedQuota: row.ConsumedQuota,
			RatePercent:   row.RatePercent,
			RewardAmount:  row.RewardAmount,
			CreditedQuota: row.CreditedQuota,
			Status:        row.Status,
			CreatedAt:     row.CreatedAt,
		})
		inviteeIds = append(inviteeIds, row.InviteeId)
	}

	names := lookupInviteeDisplayNames(inviteeIds)
	for _, item := range items {
		item.InviteeName = names[item.InviteeId]
	}
	return items, total, nil
}

func lookupInviteeDisplayNames(ids []int64) map[int64]string {
	names := make(map[int64]string, len(ids))
	if len(ids) == 0 {
		return names
	}
	type row struct {
		Id       int64
		Username string
		Email    string
	}
	var rows []row
	if err := DB.Model(&User{}).Select("id", "username", "email").
		Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return names
	}
	for _, r := range rows {
		if r.Username != "" {
			names[r.Id] = r.Username
			continue
		}
		names[r.Id] = maskAffiliateEmail(r.Email)
	}
	return names
}

// GetAffiliateInvitees 返回邀请用户列表及其贡献的佣金。
func GetAffiliateInvitees(inviterId int, offset, limit int) ([]*AffiliateInviteeItem, int64, error) {
	var total int64
	if err := DB.Model(&User{}).Where("inviter_id = ?", inviterId).
		Count(&total).Error; err != nil {
		return nil, 0, err
	}

	type userRow struct {
		Id          int64
		Username    string
		DisplayName string
		Email       string
		CreatedAt   int64
	}
	var users []userRow
	if err := DB.Model(&User{}).
		Select("id", "username", "display_name", "email", "created_at").
		Where("inviter_id = ?", inviterId).
		Order("id DESC").Offset(offset).Limit(limit).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	if len(users) == 0 {
		return []*AffiliateInviteeItem{}, total, nil
	}

	ids := make([]int64, 0, len(users))
	for _, u := range users {
		ids = append(ids, u.Id)
	}

	type aggRow struct {
		InviteeId     int64
		Cnt           int64
		Credited      int64
		Consumed      int64
		LastCreatedAt int64
	}
	var aggs []aggRow
	if err := DB.Model(&AffiliateCommission{}).
		Select("invitee_id, COUNT(*) AS cnt, COALESCE(SUM(credited_quota),0) AS credited, COALESCE(SUM(consumed_quota),0) AS consumed, COALESCE(MAX(created_at),0) AS last_created_at").
		Where("inviter_id = ? AND invitee_id IN ?", inviterId, ids).
		Group("invitee_id").Find(&aggs).Error; err != nil {
		return nil, 0, err
	}
	aggMap := make(map[int64]aggRow, len(aggs))
	for _, a := range aggs {
		aggMap[a.InviteeId] = a
	}

	items := make([]*AffiliateInviteeItem, 0, len(users))
	for _, u := range users {
		name := u.DisplayName
		if name == "" {
			name = u.Username
		}
		agg := aggMap[u.Id]
		items = append(items, &AffiliateInviteeItem{
			UserId:          u.Id,
			DisplayName:     name,
			MaskedEmail:     maskAffiliateEmail(u.Email),
			CommissionCount: agg.Cnt,
			CreditedQuota:   agg.Credited,
			ConsumedQuota:   agg.Consumed,
			LastRewardAt:    agg.LastCreatedAt,
			RegisteredAt:    u.CreatedAt,
		})
	}
	return items, total, nil
}

// GetAffiliateAdminUserCommissions 管理端按邀请人聚合佣金数据。
func GetAffiliateAdminUserCommissions(keyword string, offset, limit int) ([]*AffiliateAdminUserCommissionItem, int64, error) {
	query := DB.Model(&User{}).Where("invite_quota > 0 OR aff_history > 0")
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("username LIKE ? OR display_name LIKE ? OR email LIKE ?", like, like, like)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	type userRow struct {
		Id                    int64
		Username              string
		DisplayName           string
		InviteQuota           int64
		AffHistory            int64
		InviteRewardRemainder float64
	}
	var users []userRow
	if err := query.
		Select("id", "username", "display_name", "invite_quota", "aff_history", "invite_reward_remainder").
		Order("aff_history DESC, id ASC").Offset(offset).Limit(limit).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	if len(users) == 0 {
		return []*AffiliateAdminUserCommissionItem{}, total, nil
	}

	ids := make([]int64, 0, len(users))
	for _, u := range users {
		ids = append(ids, u.Id)
	}

	type aggRow struct {
		InviterId     int64
		Cnt           int64
		Credited      int64
		LastCreatedAt int64
	}
	var aggs []aggRow
	if err := DB.Model(&AffiliateCommission{}).
		Select("inviter_id, COUNT(*) AS cnt, COALESCE(SUM(credited_quota),0) AS credited, COALESCE(MAX(created_at),0) AS last_created_at").
		Where("inviter_id IN ?", ids).Group("inviter_id").Find(&aggs).Error; err != nil {
		return nil, 0, err
	}
	aggMap := make(map[int64]aggRow, len(aggs))
	for _, a := range aggs {
		aggMap[a.InviterId] = a
	}

	type inviteeRow struct {
		InviterId int64
		Cnt       int64
	}
	var invitees []inviteeRow
	if err := DB.Model(&User{}).
		Select("inviter_id, COUNT(*) AS cnt").
		Where("inviter_id IN ?", ids).Group("inviter_id").Find(&invitees).Error; err != nil {
		return nil, 0, err
	}
	inviteeMap := make(map[int64]int64, len(invitees))
	for _, i := range invitees {
		inviteeMap[i.InviterId] = i.Cnt
	}

	items := make([]*AffiliateAdminUserCommissionItem, 0, len(users))
	for _, u := range users {
		agg := aggMap[u.Id]
		items = append(items, &AffiliateAdminUserCommissionItem{
			InviterId:       u.Id,
			Username:        u.Username,
			DisplayName:     u.DisplayName,
			InviteeCount:    inviteeMap[u.Id],
			CommissionCount: agg.Cnt,
			CreditedQuota:   agg.Credited,
			AvailableQuota:  u.InviteQuota,
			TotalQuota:      u.AffHistory,
			Remainder:       u.InviteRewardRemainder,
			LastRewardAt:    agg.LastCreatedAt,
		})
	}
	return items, total, nil
}

// AffiliateAdminAnalyticsOverview reports site-wide referral activity for a time range.
type AffiliateAdminAnalyticsOverview struct {
	ReferralCount      int64 `json:"referral_count"`
	ActiveInviterCount int64 `json:"active_inviter_count"`
	CommissionCount    int64 `json:"commission_count"`
	CreditedQuota      int64 `json:"credited_quota"`
}

// AffiliateAdminAnalyticsTrend is a UTC calendar-day bucket.
type AffiliateAdminAnalyticsTrend struct {
	Date            string `json:"date"`
	ReferralCount   int64  `json:"referral_count"`
	CommissionCount int64  `json:"commission_count"`
	CreditedQuota   int64  `json:"credited_quota"`
}

// AffiliateAdminAnalyticsRankItem reports period activity for one inviter.
type AffiliateAdminAnalyticsRankItem struct {
	InviterId       int64  `json:"inviter_id"`
	Username        string `json:"username"`
	DisplayName     string `json:"display_name"`
	ReferralCount   int64  `json:"referral_count"`
	CommissionCount int64  `json:"commission_count"`
	CreditedQuota   int64  `json:"credited_quota"`
}

// AffiliateAdminAnalyticsCommissionItem is a site-wide commission ledger row.
type AffiliateAdminAnalyticsCommissionItem struct {
	Id            int64   `json:"id"`
	InviterId     int64   `json:"inviter_id"`
	InviterName   string  `json:"inviter_name"`
	InviteeId     int64   `json:"invitee_id"`
	InviteeName   string  `json:"invitee_name"`
	ModelName     string  `json:"model_name"`
	BillingSource string  `json:"billing_source"`
	ConsumedQuota int64   `json:"consumed_quota"`
	RatePercent   int64   `json:"rate_percent"`
	RewardAmount  float64 `json:"reward_amount"`
	CreditedQuota int64   `json:"credited_quota"`
	Status        string  `json:"status"`
	CreatedAt     int64   `json:"created_at"`
}

type affiliateDayAggregate struct {
	DayBucket     int64 `gorm:"column:day_bucket"`
	InviterId     int64 `gorm:"column:inviter_id"`
	Count         int64 `gorm:"column:count"`
	CreditedQuota int64 `gorm:"column:credited_quota"`
}

// affiliateDayBucketExpression keeps epoch-day grouping portable across supported dialects.
func affiliateDayBucketExpression() string {
	if DB.Dialector.Name() == "mysql" {
		return "CAST(created_at / 86400 AS SIGNED)"
	}
	return "CAST(created_at / 86400 AS INTEGER)"
}

// GetAffiliateAdminAnalyticsOverview aggregates attributed registrations and completed commissions.
func GetAffiliateAdminAnalyticsOverview(start, end int64) (*AffiliateAdminAnalyticsOverview, []AffiliateAdminAnalyticsTrend, error) {
	overview := &AffiliateAdminAnalyticsOverview{}
	dayBucket := affiliateDayBucketExpression()
	var referralDays []affiliateDayAggregate
	if err := DB.Model(&User{}).
		Select(dayBucket+" AS day_bucket, inviter_id, COUNT(*) AS count").
		Where("inviter_id > 0 AND created_at >= ? AND created_at <= ?", start, end).
		Group(dayBucket + ", inviter_id").Find(&referralDays).Error; err != nil {
		return nil, nil, err
	}
	var commissionDays []affiliateDayAggregate
	if err := DB.Model(&AffiliateCommission{}).
		Select(dayBucket+" AS day_bucket, COUNT(*) AS count, COALESCE(SUM(credited_quota), 0) AS credited_quota").
		Where("status = ? AND created_at >= ? AND created_at <= ?", AffiliateCommissionStatusCompleted, start, end).
		Group(dayBucket).Find(&commissionDays).Error; err != nil {
		return nil, nil, err
	}

	activeInviters := make(map[int64]struct{})
	for _, item := range referralDays {
		overview.ReferralCount += item.Count
		activeInviters[item.InviterId] = struct{}{}
	}
	overview.ActiveInviterCount = int64(len(activeInviters))
	for _, item := range commissionDays {
		overview.CommissionCount += item.Count
		overview.CreditedQuota += item.CreditedQuota
	}

	startDay := time.Unix(start, 0).UTC().Truncate(24 * time.Hour)
	endDay := time.Unix(end, 0).UTC().Truncate(24 * time.Hour)
	byDay := make(map[int64]*AffiliateAdminAnalyticsTrend)
	for day := startDay; !day.After(endDay); day = day.Add(24 * time.Hour) {
		bucket := day.Unix() / 86400
		byDay[bucket] = &AffiliateAdminAnalyticsTrend{Date: day.Format("2006-01-02")}
	}
	for _, item := range referralDays {
		if point := byDay[item.DayBucket]; point != nil {
			point.ReferralCount += item.Count
		}
	}
	for _, item := range commissionDays {
		if point := byDay[item.DayBucket]; point != nil {
			point.CommissionCount = item.Count
			point.CreditedQuota = item.CreditedQuota
		}
	}
	trend := make([]AffiliateAdminAnalyticsTrend, 0, len(byDay))
	for day := startDay; !day.After(endDay); day = day.Add(24 * time.Hour) {
		trend = append(trend, *byDay[day.Unix()/86400])
	}
	return overview, trend, nil
}

// GetAffiliateAdminAnalyticsRankings lists inviters ranked by referral registrations in the period.
func GetAffiliateAdminAnalyticsRankings(keyword string, start, end int64, offset, limit int) ([]*AffiliateAdminAnalyticsRankItem, int64, error) {
	query := DB.Table("users AS invitees").
		Joins("JOIN users AS inviters ON inviters.id = invitees.inviter_id").
		Where("invitees.deleted_at IS NULL AND inviters.deleted_at IS NULL AND invitees.inviter_id > 0 AND invitees.created_at >= ? AND invitees.created_at <= ?", start, end)
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("inviters.username LIKE ? OR inviters.display_name LIKE ? OR inviters.email LIKE ?", like, like, like)
	}

	query = query.Session(&gorm.Session{})

	var total int64
	if err := query.Distinct("invitees.inviter_id").Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []*AffiliateAdminAnalyticsRankItem{}, 0, nil
	}
	type rankingRow struct {
		InviterId     int64  `gorm:"column:inviter_id"`
		Username      string `gorm:"column:username"`
		DisplayName   string `gorm:"column:display_name"`
		ReferralCount int64  `gorm:"column:referral_count"`
	}
	var rows []rankingRow
	if err := query.Select("invitees.inviter_id AS inviter_id, inviters.username AS username, inviters.display_name AS display_name, COUNT(*) AS referral_count").
		Group("invitees.inviter_id, inviters.username, inviters.display_name").
		Order("referral_count DESC, invitees.inviter_id ASC").Offset(offset).Limit(limit).Scan(&rows).Error; err != nil {
		return nil, 0, err
	}
	if len(rows) == 0 {
		return []*AffiliateAdminAnalyticsRankItem{}, total, nil
	}

	inviterIds := make([]int64, 0, len(rows))
	for _, row := range rows {
		inviterIds = append(inviterIds, row.InviterId)
	}
	type commissionAggregate struct {
		InviterId       int64 `gorm:"column:inviter_id"`
		CommissionCount int64 `gorm:"column:commission_count"`
		CreditedQuota   int64 `gorm:"column:credited_quota"`
	}
	var commissionRows []commissionAggregate
	if err := DB.Model(&AffiliateCommission{}).
		Select("inviter_id, COUNT(*) AS commission_count, COALESCE(SUM(credited_quota), 0) AS credited_quota").
		Where("status = ? AND created_at >= ? AND created_at <= ? AND inviter_id IN ?", AffiliateCommissionStatusCompleted, start, end, inviterIds).
		Group("inviter_id").Find(&commissionRows).Error; err != nil {
		return nil, 0, err
	}
	commissionByInviter := make(map[int64]commissionAggregate, len(commissionRows))
	for _, row := range commissionRows {
		commissionByInviter[row.InviterId] = row
	}

	items := make([]*AffiliateAdminAnalyticsRankItem, 0, len(rows))
	for _, row := range rows {
		commission := commissionByInviter[row.InviterId]
		items = append(items, &AffiliateAdminAnalyticsRankItem{
			InviterId:       row.InviterId,
			Username:        row.Username,
			DisplayName:     row.DisplayName,
			ReferralCount:   row.ReferralCount,
			CommissionCount: commission.CommissionCount,
			CreditedQuota:   commission.CreditedQuota,
		})
	}
	return items, total, nil
}

// GetAffiliateAdminAnalyticsCommissions returns filtered site-wide commission ledger rows.
func GetAffiliateAdminAnalyticsCommissions(keyword, status string, start, end int64, offset, limit int) ([]*AffiliateAdminAnalyticsCommissionItem, int64, error) {
	query := DB.Table("affiliate_commissions AS commissions").
		Joins("LEFT JOIN users AS inviters ON inviters.id = commissions.inviter_id").
		Joins("LEFT JOIN users AS invitees ON invitees.id = commissions.invitee_id").
		Where("commissions.created_at >= ? AND commissions.created_at <= ?", start, end)
	if status != "" {
		query = query.Where("commissions.status = ?", status)
	}
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		like := "%" + keyword + "%"
		search := "inviters.username LIKE ? OR inviters.display_name LIKE ? OR inviters.email LIKE ? OR invitees.username LIKE ? OR invitees.display_name LIKE ? OR invitees.email LIKE ?"
		args := []any{like, like, like, like, like, like}
		if id, err := strconv.ParseInt(keyword, 10, 64); err == nil && id > 0 {
			search += " OR commissions.inviter_id = ? OR commissions.invitee_id = ?"
			args = append(args, id, id)
		}
		query = query.Where(search, args...)
	}

	query = query.Session(&gorm.Session{})

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []*AffiliateAdminAnalyticsCommissionItem{}, 0, nil
	}
	var items []*AffiliateAdminAnalyticsCommissionItem
	if err := query.Select("commissions.id, commissions.inviter_id, COALESCE(NULLIF(inviters.display_name, ''), inviters.username) AS inviter_name, commissions.invitee_id, COALESCE(NULLIF(invitees.display_name, ''), invitees.username) AS invitee_name, commissions.model_name, commissions.billing_source, commissions.consumed_quota, commissions.rate_percent, commissions.reward_amount, commissions.credited_quota, commissions.status, commissions.created_at").
		Order("commissions.created_at DESC, commissions.id DESC").Offset(offset).Limit(limit).Scan(&items).Error; err != nil {
		return nil, 0, err
	}
	if items == nil {
		items = []*AffiliateAdminAnalyticsCommissionItem{}
	}
	return items, total, nil
}
