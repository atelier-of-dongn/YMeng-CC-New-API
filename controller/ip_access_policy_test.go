package controller

import (
	"reflect"
	"testing"

	"github.com/QuantumNous/new-api/model"
)

func TestFilterPricingByUsableGroupsRemovesHiddenGroups(t *testing.T) {
	pricing := []model.Pricing{
		{ModelName: "shared", EnableGroup: []string{"default", "vip"}},
		{ModelName: "vip-only", EnableGroup: []string{"vip"}},
		{ModelName: "global", EnableGroup: []string{"all"}},
	}

	filtered := filterPricingByUsableGroups(pricing, map[string]string{"default": "默认分组"})
	if len(filtered) != 2 {
		t.Fatalf("len(filtered) = %d, want 2", len(filtered))
	}
	if filtered[0].ModelName != "shared" || !reflect.DeepEqual(filtered[0].EnableGroup, []string{"default"}) {
		t.Fatalf("unexpected shared model groups: %#v", filtered[0])
	}
	if filtered[1].ModelName != "global" {
		t.Fatalf("global model should remain visible: %#v", filtered[1])
	}
}