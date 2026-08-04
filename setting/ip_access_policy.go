package setting

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
)

type IpAccessPolicy struct {
	Enabled       bool
	AllowedGroups []string
}

var ipAccessPolicy = struct {
	sync.RWMutex
	value IpAccessPolicy
}{
	value: IpAccessPolicy{
		AllowedGroups: []string{},
	},
}

func GetIpAccessPolicy() IpAccessPolicy {
	ipAccessPolicy.RLock()
	defer ipAccessPolicy.RUnlock()
	return IpAccessPolicy{
		Enabled:       ipAccessPolicy.value.Enabled,
		AllowedGroups: append([]string(nil), ipAccessPolicy.value.AllowedGroups...),
	}
}

func UpdateIpAccessPolicyOption(key, value string) (bool, error) {
	ipAccessPolicy.Lock()
	defer ipAccessPolicy.Unlock()

	switch key {
	case "IpAccessPolicyEnabled":
		ipAccessPolicy.value.Enabled = value == "true"
	case "IpAccessPolicyAllowedGroups":
		groups, err := ParseIpAccessPolicyAllowedGroups(value)
		if err != nil {
			return true, err
		}
		ipAccessPolicy.value.AllowedGroups = groups
	default:
		return false, nil
	}
	return true, nil
}

func ParseIpAccessPolicyAllowedGroups(value string) ([]string, error) {
	var groups []string
	if err := json.Unmarshal([]byte(value), &groups); err != nil {
		return nil, fmt.Errorf("大陆 IP 允许分组必须是 JSON 字符串数组")
	}
	seen := make(map[string]struct{}, len(groups))
	result := make([]string, 0, len(groups))
	for _, group := range groups {
		group = strings.TrimSpace(group)
		if group == "" {
			continue
		}
		if _, exists := seen[group]; exists {
			continue
		}
		seen[group] = struct{}{}
		result = append(result, group)
	}
	sort.Strings(result)
	return result, nil
}

func IpAccessPolicyAllowedGroupsJSON() string {
	policy := GetIpAccessPolicy()
	encoded, _ := json.Marshal(policy.AllowedGroups)
	return string(encoded)
}

func IsIpAccessPolicyRestricted(country string) bool {
	policy := GetIpAccessPolicy()
	return policy.Enabled && strings.EqualFold(strings.TrimSpace(country), "CN")
}

func IsIpAccessGroupVisible(country, group string) bool {
	if !IsIpAccessPolicyRestricted(country) {
		return true
	}
	return IsIpAccessGroupAllowed(group)
}

func FilterIpAccessVisibleGroups(country string, groups map[string]string) map[string]string {
	if !IsIpAccessPolicyRestricted(country) {
		return groups
	}
	visible := make(map[string]string, len(groups))
	for group, description := range groups {
		if IsIpAccessGroupAllowed(group) {
			visible[group] = description
		}
	}
	return visible
}

func IsIpAccessGroupAllowed(group string) bool {
	policy := GetIpAccessPolicy()
	for _, allowed := range policy.AllowedGroups {
		if allowed == group {
			return true
		}
	}
	return false
}
