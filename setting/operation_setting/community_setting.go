package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

type CommunitySetting struct {
	QQGroupLink  string `json:"qq_group_link"`
	TelegramLink string `json:"telegram_link"`
}

var communitySetting = CommunitySetting{
	QQGroupLink:  "",
	TelegramLink: "",
}

func init() {
	config.GlobalConfig.Register("community_setting", &communitySetting)
}

func GetCommunitySetting() *CommunitySetting {
	return &communitySetting
}
