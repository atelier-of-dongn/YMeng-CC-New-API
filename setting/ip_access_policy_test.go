package setting

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestParseIpAccessPolicyAllowedGroups(t *testing.T) {
	groups, err := ParseIpAccessPolicyAllowedGroups(`["Grok","国模遥遥领先","Grok",""]`)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Grok", "国模遥遥领先"}
	if !reflect.DeepEqual(groups, want) {
		t.Fatalf("groups = %#v, want %#v", groups, want)
	}
}

func TestParseIpAccessPolicyAllowedGroupsRejectsInvalidJSON(t *testing.T) {
	if _, err := ParseIpAccessPolicyAllowedGroups(`{"Grok":true}`); err == nil {
		t.Fatal("expected invalid JSON shape to be rejected")
	}
}

func TestUpdateIpAccessPolicyOption(t *testing.T) {
	original := GetIpAccessPolicy()
	t.Cleanup(func() {
		_, _ = UpdateIpAccessPolicyOption("IpAccessPolicyEnabled", boolString(original.Enabled))
		encoded, _ := json.Marshal(original.AllowedGroups)
		_, _ = UpdateIpAccessPolicyOption("IpAccessPolicyAllowedGroups", string(encoded))
	})

	if handled, err := UpdateIpAccessPolicyOption("IpAccessPolicyAllowedGroups", `["国模遥遥领先"]`); !handled || err != nil {
		t.Fatalf("handled = %v, err = %v", handled, err)
	}
	if !IsIpAccessGroupAllowed("国模遥遥领先") || IsIpAccessGroupAllowed("Grok") {
		t.Fatal("allowed group lookup does not match updated policy")
	}
}

func TestIpAccessPolicyOnlyFiltersMainlandVisibility(t *testing.T) {
	original := GetIpAccessPolicy()
	t.Cleanup(func() {
		_, _ = UpdateIpAccessPolicyOption("IpAccessPolicyEnabled", boolString(original.Enabled))
		encoded, _ := json.Marshal(original.AllowedGroups)
		_, _ = UpdateIpAccessPolicyOption("IpAccessPolicyAllowedGroups", string(encoded))
	})

	_, _ = UpdateIpAccessPolicyOption("IpAccessPolicyEnabled", "true")
	_, _ = UpdateIpAccessPolicyOption("IpAccessPolicyAllowedGroups", `["default"]`)

	if !IsIpAccessGroupVisible("CN", "default") {
		t.Fatal("allowed Mainland group should remain visible")
	}
	if IsIpAccessGroupVisible("CN", "vip") {
		t.Fatal("blocked Mainland group should be hidden")
	}
	if !IsIpAccessGroupVisible("US", "vip") {
		t.Fatal("overseas group visibility should remain unrestricted")
	}
}

func boolString(value bool) string {
	if value {
		return "true"
	}
	return "false"
}
