package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTokenGroupSequenceRoundTrip(t *testing.T) {
	token := &Token{Group: "legacy"}

	require.NoError(t, token.SetGroups([]string{"primary", "fallback", "last"}))
	assert.Equal(t, "primary", token.Group)
	assert.JSONEq(t, `["primary","fallback","last"]`, token.GroupSequence)
	assert.Equal(t, []string{"primary", "fallback", "last"}, token.GetGroups())

	loaded := &Token{GroupSequence: token.GroupSequence}
	assert.Equal(t, []string{"primary", "fallback", "last"}, loaded.GetGroups())
}

func TestTokenGroupSequenceClearAndOmittedSemantics(t *testing.T) {
	token := &Token{Group: "primary", GroupSequence: `["primary","fallback"]`}

	require.NoError(t, token.SetGroups(nil))
	assert.Equal(t, `["primary","fallback"]`, token.GroupSequence)

	require.NoError(t, token.SetGroups([]string{}))
	assert.Empty(t, token.GroupSequence)
	assert.Empty(t, token.GetGroups())
	assert.Equal(t, "primary", token.Group)
}
