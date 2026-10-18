package model

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

var (
	ErrRedemptionInvalid       = errors.New("invalid redemption code")
	ErrRedemptionUsed          = errors.New("redemption code already used")
	ErrRedemptionExpired       = errors.New("redemption code expired")
	ErrRedemptionQuotaMismatch = errors.New("redemption quota mismatch")
	ErrRedemptionDatabase      = errors.New("redemption database operation failed")
)

type Redemption struct {
	Id           int            `json:"id"`
	UserId       int            `json:"user_id"`
	Key          string         `json:"key" gorm:"type:char(32);uniqueIndex"`
	Status       int            `json:"status" gorm:"default:1"`
	Name         string         `json:"name" gorm:"index"`
	Quota        int            `json:"quota" gorm:"default:100"`
	CreatedTime  int64          `json:"created_time" gorm:"bigint"`
	RedeemedTime int64          `json:"redeemed_time" gorm:"bigint"`
	Count        int            `json:"count" gorm:"-:all"` // only for api request
	UsedUserId   int            `json:"used_user_id"`
	DeletedAt    gorm.DeletedAt `gorm:"index"`
	ExpiredTime  int64          `json:"expired_time" gorm:"bigint"` // 过期时间，0 表示不过期
}

func GetAllRedemptions(startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	// 开始事务
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 获取总数
	err = tx.Model(&Redemption{}).Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 获取分页数据
	err = tx.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 提交事务
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return redemptions, total, nil
}

func SearchRedemptions(keyword string, status string, startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&Redemption{})

	if keyword != "" {
		if id, err := strconv.Atoi(keyword); err == nil {
			query = query.Where("id = ? OR name LIKE ?", id, keyword+"%")
		} else {
			query = query.Where("name LIKE ?", keyword+"%")
		}
	}

	if status != "" {
		now := common.GetTimestamp()
		switch status {
		case "expired":
			query = query.Where(
				"status = ? AND expired_time != 0 AND expired_time < ?",
				common.RedemptionCodeStatusEnabled,
				now,
			)
		case strconv.Itoa(common.RedemptionCodeStatusEnabled):
			query = query.Where(
				"status = ? AND (expired_time = 0 OR expired_time >= ?)",
				common.RedemptionCodeStatusEnabled,
				now,
			)
		case strconv.Itoa(common.RedemptionCodeStatusDisabled):
			query = query.Where("status = ?", common.RedemptionCodeStatusDisabled)
		case strconv.Itoa(common.RedemptionCodeStatusUsed):
			query = query.Where("status = ?", common.RedemptionCodeStatusUsed)
		}
	}

	// Get total count
	err = query.Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Get paginated data
	err = query.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return redemptions, total, nil
}

func GetRedemptionById(id int) (*Redemption, error) {
	if id == 0 {
		return nil, common.NewMessage("ID is empty")
	}
	redemption := Redemption{Id: id}
	var err error = nil
	err = DB.First(&redemption, "id = ?", id).Error
	return &redemption, err
}

func Redeem(key string, userId int) (quota int, err error) {
	if key == "" {
		return 0, errors.New("redemption code not provided")
	}
	if userId == 0 {
		return 0, errors.New("invalid user id")
	}
	redemption := &Redemption{}

	common.RandomSleep()
	err = DB.Transaction(func(tx *gorm.DB) error {
		var redeemErr error
		redemption, redeemErr = redeemInTransaction(tx, key, userId, 0)
		if redeemErr != nil {
			return redeemErr
		}
		// Ordinary redemption creates its own invoice snapshot. CatFK uses the
		// shared transaction helper and completes its existing TopUp instead.
		invoiceAmount, err := InvoiceAmountFromQuota(redemption.Quota)
		if err != nil {
			common.SysError(fmt.Sprintf("failed to create redemption invoice snapshot: redemption_id=%d: %v", redemption.Id, err))
			return nil
		}
		return tx.Create(&TopUp{
			UserId: userId, Amount: int64(redemption.Quota),
			TradeNo:       fmt.Sprintf("redemption:%d", redemption.Id),
			PaymentMethod: PaymentProviderRedemption, PaymentProvider: PaymentProviderRedemption,
			CreateTime: redemption.CreatedTime, CompleteTime: redemption.RedeemedTime,
			Status: common.TopUpStatusSuccess, CreditedQuota: int64(redemption.Quota),
			InvoiceAmount: invoiceAmount,
		}).Error
	})
	if err != nil {
		common.SysError(common.LogText("redemption failed: %s", err.Error()))
		return 0, ErrRedeemFailed
	}
	syncCreditUserQuotaCache(userId, redemption.Quota, common.LogText("redemption"))
	RecordLog(userId, LogTypeTopup, common.NewMessage("Topped up {{quota}} with a redemption code, code ID {{id}}", map[string]any{"quota": logger.FormatQuota(redemption.Quota), "id": redemption.Id}))
	return redemption.Quota, nil
}

// redeemInTransaction consumes one local code and credits its bound account in
// the caller's transaction. expectedQuota=0 preserves ordinary Redeem behavior;
// payment integrations must supply their immutable expected quota.
func redeemInTransaction(tx *gorm.DB, key string, userID int, expectedQuota int) (*Redemption, error) {
	if key == "" || userID <= 0 {
		return nil, errors.New("invalid redemption input")
	}
	redemption := &Redemption{}
	if err := lockForUpdate(tx.Session(&gorm.Session{Logger: tx.Logger.LogMode(gormlogger.Silent)})).Where(commonKeyCol+" = ?", key).First(redemption).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRedemptionInvalid
		}
		// Driver errors may embed interpolated SQL containing the raw code.
		return nil, ErrRedemptionDatabase
	}
	if redemption.Status != common.RedemptionCodeStatusEnabled {
		return nil, ErrRedemptionUsed
	}
	if redemption.ExpiredTime != 0 && redemption.ExpiredTime < common.GetTimestamp() {
		return nil, ErrRedemptionExpired
	}
	if expectedQuota != 0 && redemption.Quota != expectedQuota {
		return nil, ErrRedemptionQuotaMismatch
	}
	redemption.RedeemedTime = common.GetTimestamp()
	result := tx.Model(&Redemption{}).
		Where("id = ? AND status = ?", redemption.Id, common.RedemptionCodeStatusEnabled).
		Updates(map[string]any{"redeemed_time": redemption.RedeemedTime, "status": common.RedemptionCodeStatusUsed, "used_user_id": userID})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, ErrRedemptionUsed
	}
	if err := creditTopUpQuota(tx, userID, redemption.Quota, nil); err != nil {
		return nil, err
	}
	return redemption, nil
}

func (redemption *Redemption) Insert() error {
	if redemption.Quota <= 0 {
		return errors.New("redemption quota must be positive")
	}
	if err := common.ValidateWalletQuota(redemption.Quota); err != nil {
		return err
	}
	var err error
	err = DB.Create(redemption).Error
	return err
}

func (redemption *Redemption) SelectUpdate() error {
	// This can update zero values
	return DB.Model(redemption).Select("redeemed_time", "status").Updates(redemption).Error
}

// Update Make sure your token's fields is completed, because this will update non-zero values
func (redemption *Redemption) Update() error {
	if redemption.Quota <= 0 {
		return errors.New("redemption quota must be positive")
	}
	if err := common.ValidateWalletQuota(redemption.Quota); err != nil {
		return err
	}
	var err error
	err = DB.Model(redemption).Select("name", "status", "quota", "redeemed_time", "expired_time").Updates(redemption).Error
	return err
}

func (redemption *Redemption) Delete() error {
	var err error
	err = DB.Delete(redemption).Error
	return err
}

func DeleteRedemptionById(id int) (err error) {
	if id == 0 {
		return common.NewMessage("ID is empty")
	}
	redemption := Redemption{Id: id}
	err = DB.Where(redemption).First(&redemption).Error
	if err != nil {
		return err
	}
	return redemption.Delete()
}

func DeleteInvalidRedemptions() (int64, error) {
	now := common.GetTimestamp()
	result := DB.Where("status IN ? OR (status = ? AND expired_time != 0 AND expired_time < ?)", []int{common.RedemptionCodeStatusUsed, common.RedemptionCodeStatusDisabled}, common.RedemptionCodeStatusEnabled, now).Delete(&Redemption{})
	return result.RowsAffected, result.Error
}

// BatchDeleteRedemptions soft-deletes the selected codes in one statement.
func BatchDeleteRedemptions(ids []int) (int64, error) {
	if len(ids) == 0 || len(ids) > 1000 {
		return 0, errors.New("select between 1 and 1000 redemption codes")
	}
	for _, id := range ids {
		if id <= 0 {
			return 0, errors.New("redemption IDs must be positive")
		}
	}
	result := DB.Where("id IN ?", ids).Delete(&Redemption{})
	return result.RowsAffected, result.Error
}
