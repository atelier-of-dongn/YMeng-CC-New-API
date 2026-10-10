package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/siteupdate"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testConfig(t *testing.T) updateConfig {
	t.Helper()
	key, _, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	return updateConfig{
		token:           "test-token-with-at-least-32-characters-long",
		key:             key,
		currentVersion:  "v1.0.0",
		platform:        "linux/amd64",
		database:        "postgres",
		stateFile:       filepath.Join(t.TempDir(), "state.json"),
		activeContainer: "new-api",
		internalPort:    3001,
	}
}

func TestControllerRequiresExactBearerToken(t *testing.T) {
	config := testConfig(t)
	controller := &controller{config: config, status: siteupdate.Status{Supported: true, State: "ready"}}
	server := httptest.NewServer(http.HandlerFunc(controller.serve))
	defer server.Close()

	request, err := http.NewRequest(http.MethodGet, server.URL+"/v1/status", nil)
	require.NoError(t, err)
	request.Header.Set("Authorization", "Bearer wrong-token")
	response, err := http.DefaultClient.Do(request)
	require.NoError(t, err)
	assert.Equal(t, http.StatusUnauthorized, response.StatusCode)
	require.NoError(t, response.Body.Close())

	request, err = http.NewRequest(http.MethodGet, server.URL+"/v1/status", nil)
	require.NoError(t, err)
	request.Header.Set("Authorization", "Bearer "+config.token)
	response, err = http.DefaultClient.Do(request)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, response.StatusCode)
	require.NoError(t, response.Body.Close())
}

func TestSignedCompatibilityManifestRequiresMatchingDigestAndTag(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	manifest := siteupdate.Compatibility{
		Version:               "v1.1.0",
		Image:                 siteupdate.ImageRepository + "@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		FromVersions:          []string{"v1.0.0"},
		SchemaUnchanged:       true,
		SharedStateCompatible: true,
		Platforms:             []string{"linux/amd64"},
		Databases:             []string{"postgres"},
	}
	data, err := common.Marshal(manifest)
	require.NoError(t, err)
	signature := ed25519.Sign(privateKey, data)
	verified, err := verifyCompatibilityManifest(publicKey, "v1.1.0", data, signature)
	require.NoError(t, err)
	assert.Equal(t, manifest.Image, verified.Image)

	_, err = verifyCompatibilityManifest(publicKey, "v1.2.0", data, signature)
	assert.Error(t, err)
	_, err = verifyCompatibilityManifest(publicKey, "v1.1.0", data, []byte(base64.StdEncoding.EncodeToString(signature)))
	assert.Error(t, err)
}

func TestCompatibilityRequiresAllSignedDeploymentDimensions(t *testing.T) {
	config := testConfig(t)
	controller := &controller{config: config}
	manifest := siteupdate.Compatibility{
		Version:               "v1.1.0",
		Image:                 siteupdate.ImageRepository + "@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		FromVersions:          []string{"v1.0.0"},
		SchemaUnchanged:       true,
		SharedStateCompatible: true,
		Platforms:             []string{"linux/amd64"},
		Databases:             []string{"postgres"},
	}
	compatible, reason := controller.compatibility(manifest, "v1.0.0")
	require.True(t, compatible)
	assert.Empty(t, reason)

	manifest.Databases = []string{"mysql"}
	compatible, reason = controller.compatibility(manifest, "v1.0.0")
	assert.False(t, compatible)
	assert.NotEmpty(t, reason)
}

func TestHAProxyMapEntryReplacementPreservesOtherBackends(t *testing.T) {
	content := "# managed map\napi old:3000\nother other:3000\n"
	updated, err := replaceHAProxyMapEntry(content, "api", "new:3000")
	require.NoError(t, err)
	assert.Equal(t, "# managed map\napi new:3000\nother other:3000\n", updated)

	updated, err = replaceHAProxyMapEntry(content, "new", "new:3000")
	require.NoError(t, err)
	assert.Contains(t, updated, "new new:3000\n")
	_, err = replaceHAProxyMapEntry("api old:3000\napi old:3001\n", "api", "new:3000")
	assert.Error(t, err)
}

func TestStateStoreSaveIsReadableAfterAtomicReplace(t *testing.T) {
	store := stateStore{path: filepath.Join(t.TempDir(), "nested", "state.json")}
	want := persistedState{
		Status: siteupdate.Status{
			Supported:      true,
			State:          "draining",
			CurrentVersion: "v1.0.0",
			OperationID:    "operation-1",
			Draining:       true,
		},
		ActiveContainer:   "new-api-update-1",
		DrainingContainer: "new-api",
	}
	require.NoError(t, store.save(want))
	got, err := store.load()
	require.NoError(t, err)
	assert.Equal(t, want, got)
}
