package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const dockerAPIVersion = "v1.41"

type dockerEngine interface {
	Inspect(ctx context.Context, name string) (dockerContainer, error)
	Create(ctx context.Context, name, image string, source dockerContainer) (string, error)
	Start(ctx context.Context, id string) error
	Remove(ctx context.Context, id string, force bool) error
}

type dockerHTTPClient struct {
	client  *http.Client
	baseURL string
}

type dockerContainer struct {
	ID              string `json:"Id"`
	Name            string `json:"Name"`
	Labels          map[string]string
	Config          map[string]any        `json:"-"`
	HostConfig      map[string]any        `json:"-"`
	State           dockerState           `json:"State"`
	NetworkSettings dockerNetworkSettings `json:"NetworkSettings"`
}

type dockerState struct {
	Running bool `json:"Running"`
}

type dockerNetworkSettings struct {
	Networks map[string]dockerNetworkEndpoint `json:"Networks"`
}

type dockerNetworkEndpoint struct {
	Aliases   []string `json:"Aliases"`
	Links     []string `json:"Links"`
	IPAddress string   `json:"IPAddress"`
}

type dockerInspectPayload struct {
	ID              string                `json:"Id"`
	Name            string                `json:"Name"`
	Config          map[string]any        `json:"Config"`
	HostConfig      map[string]any        `json:"HostConfig"`
	State           dockerState           `json:"State"`
	NetworkSettings dockerNetworkSettings `json:"NetworkSettings"`
}

func (d *dockerHTTPClient) request(ctx context.Context, method, endpoint string, body any, result any) error {
	var reader io.Reader
	if body != nil {
		data, err := common.Marshal(body)
		if err != nil {
			return err
		}
		reader = strings.NewReader(string(data))
	}
	request, err := http.NewRequestWithContext(ctx, method, d.baseURL+endpoint, reader)
	if err != nil {
		return err
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := d.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	data, readErr := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if readErr != nil {
		return readErr
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := strings.TrimSpace(string(data))
		if len(message) > 512 {
			message = message[:512]
		}
		return fmt.Errorf("docker engine returned HTTP %d: %s", response.StatusCode, message)
	}
	if result == nil || len(data) == 0 {
		return nil
	}
	return common.Unmarshal(data, result)
}

func (d *dockerHTTPClient) Inspect(ctx context.Context, name string) (dockerContainer, error) {
	var payload dockerInspectPayload
	endpoint := "/" + dockerAPIVersion + "/containers/" + url.PathEscape(name) + "/json"
	if err := d.request(ctx, http.MethodGet, endpoint, nil, &payload); err != nil {
		return dockerContainer{}, err
	}
	labels := map[string]string{}
	if value, ok := payload.Config["Labels"].(map[string]any); ok {
		for key, raw := range value {
			if label, ok := raw.(string); ok {
				labels[key] = label
			}
		}
	}
	return dockerContainer{
		ID:              payload.ID,
		Name:            strings.TrimPrefix(payload.Name, "/"),
		Labels:          labels,
		Config:          payload.Config,
		HostConfig:      payload.HostConfig,
		State:           payload.State,
		NetworkSettings: payload.NetworkSettings,
	}, nil
}

func (d *dockerHTTPClient) Create(ctx context.Context, name, image string, source dockerContainer) (string, error) {
	config := cloneMap(source.Config)
	config["Image"] = image
	labels := map[string]any{
		"com.ymeng.update.managed":   "true",
		"com.ymeng.update.active":    "true",
		"com.ymeng.update.candidate": "true",
	}
	if existing, ok := config["Labels"].(map[string]any); ok {
		for key, value := range existing {
			labels[key] = value
		}
		labels["com.ymeng.update.managed"] = "true"
		labels["com.ymeng.update.active"] = "true"
		labels["com.ymeng.update.candidate"] = "true"
	}
	config["Labels"] = labels

	hostConfig := cloneMap(source.HostConfig)
	// Published host ports would collide with the active instance. HAProxy
	// reaches the candidate through its Docker network address instead.
	delete(hostConfig, "PortBindings")
	delete(hostConfig, "PublishAllPorts")

	networking := map[string]any{}
	for network, endpoint := range source.NetworkSettings.Networks {
		networking[network] = map[string]any{
			"Aliases": endpoint.Aliases,
			"Links":   endpoint.Links,
		}
	}
	if len(networking) > 0 {
		// NetworkMode names the same network in inspect output, while
		// NetworkingConfig is the create API's multi-network form. Sending both
		// makes Docker reject the request as contradictory.
		delete(hostConfig, "NetworkMode")
	}
	payload := map[string]any{
		"Config":     config,
		"HostConfig": hostConfig,
	}
	if len(networking) > 0 {
		payload["NetworkingConfig"] = map[string]any{"EndpointsConfig": networking}
	}
	query := url.Values{}
	query.Set("name", name)
	var created struct {
		ID string `json:"Id"`
	}
	endpoint := "/" + dockerAPIVersion + "/containers/create?" + query.Encode()
	if err := d.request(ctx, http.MethodPost, endpoint, payload, &created); err != nil {
		return "", err
	}
	if created.ID == "" {
		return "", fmt.Errorf("docker engine returned an empty candidate id")
	}
	return created.ID, nil
}

func (d *dockerHTTPClient) Start(ctx context.Context, id string) error {
	endpoint := "/" + dockerAPIVersion + "/containers/" + url.PathEscape(id) + "/start"
	return d.request(ctx, http.MethodPost, endpoint, nil, nil)
}

func (d *dockerHTTPClient) Remove(ctx context.Context, id string, force bool) error {
	query := url.Values{}
	query.Set("force", fmt.Sprintf("%t", force))
	endpoint := "/" + dockerAPIVersion + "/containers/" + url.PathEscape(id) + "?" + query.Encode()
	return d.request(ctx, http.MethodDelete, endpoint, nil, nil)
}

func newDockerHTTPClient(socketPath string) (*dockerHTTPClient, error) {
	if socketPath == "" {
		return nil, fmt.Errorf("UPDATE_DOCKER_SOCKET is required")
	}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var dialer net.Dialer
			return dialer.DialContext(ctx, "unix", socketPath)
		},
	}
	return &dockerHTTPClient{
		client:  &http.Client{Transport: transport, Timeout: 30 * time.Second},
		baseURL: "http://docker",
	}, nil
}

func cloneMap(source map[string]any) map[string]any {
	copy := make(map[string]any, len(source))
	for key, value := range source {
		copy[key] = value
	}
	return copy
}
