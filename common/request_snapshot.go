package common

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

const requestParametersKey = "sanitized_request_parameters"
const requestSnapshotInputLimit = 8 << 20
const requestSnapshotOutputLimit = 32 << 10

// RequestParametersSnapshot contains only sanitized client business parameters.
// Omitted marks redactions/unavailable input; Truncated marks size/depth limits.
type RequestParametersSnapshot struct {
	Parameters any  `json:"parameters"`
	Truncated  bool `json:"truncated,omitempty"`
	Omitted    bool `json:"omitted,omitempty"`
}

func GetRequestParameters(c *gin.Context) *RequestParametersSnapshot {
	if c == nil {
		return nil
	}
	value, _ := c.Get(requestParametersKey)
	snapshot, _ := value.(*RequestParametersSnapshot)
	return snapshot
}

// CaptureRequestParameters runs before adaptor mutations. It never closes the
// shared storage and restores its cursor, including for disk-backed requests.
// force is used for image, video and Midjourney endpoints; other formats must
// contain an image input or image-generation declaration to be logged.
func CaptureRequestParameters(c *gin.Context, force bool) {
	if c == nil || c.Request == nil || GetRequestParameters(c) != nil {
		return
	}
	snapshot := &RequestParametersSnapshot{Parameters: nil}
	stored, exists := c.Get(KeyBodyStorage)
	storage, ok := stored.(BodyStorage)
	if !exists || !ok {
		var err error
		storage, err = GetBodyStorage(c)
		if err != nil {
			if force {
				snapshot.Omitted = true
				c.Set(requestParametersKey, snapshot)
			}
			return
		}
		c.Request.Body = io.NopCloser(storage)
	}
	position, err := storage.Seek(0, io.SeekCurrent)
	if err != nil {
		return
	}
	defer storage.Seek(position, io.SeekStart)
	if _, err = storage.Seek(0, io.SeekStart); err != nil {
		return
	}
	contentType, params, _ := mime.ParseMediaType(c.Request.Header.Get("Content-Type"))
	var raw any
	if contentType == "multipart/form-data" {
		values := map[string]any{}
		reader := multipart.NewReader(storage, params["boundary"])
		for count := 0; ; count++ {
			if count >= 256 {
				snapshot.Truncated = true
				break
			}
			part, partErr := reader.NextPart()
			if partErr == io.EOF {
				break
			}
			if partErr != nil {
				snapshot.Omitted = true
				break
			}
			name := part.FormName()
			var value any
			if part.FileName() != "" {
				size, copyErr := io.Copy(io.Discard, part)
				if copyErr != nil {
					snapshot.Omitted = true
					break
				}
				value = map[string]any{"filename": part.FileName(), "size": size, "content_type": part.Header.Get("Content-Type")}
			} else {
				data, readErr := io.ReadAll(io.LimitReader(part, requestSnapshotOutputLimit+1))
				if readErr != nil {
					snapshot.Omitted = true
					break
				}
				if len(data) > requestSnapshotOutputLimit {
					snapshot.Truncated = true
					value = nil
				} else {
					value = string(data)
				}
			}
			previous, _ := values[name].([]any)
			values[name] = append(previous, value)
		}
		raw = values
	} else {
		if storage.Size() > requestSnapshotInputLimit {
			snapshot.Truncated = true
			snapshot.Omitted = true
		} else {
			data, readErr := io.ReadAll(io.LimitReader(storage, requestSnapshotInputLimit+1))
			if readErr != nil || DecodeJsonNumber(bytes.NewReader(data), &raw) != nil {
				snapshot.Omitted = true
			}
		}
	}
	if !force && !hasImageParameters(raw) {
		return
	}
	budget := requestSnapshotOutputLimit / 6 // JSON escaping can expand each byte sixfold.
	snapshot.Parameters = snapshot.sanitize(raw, 0, &budget)
	c.Set(requestParametersKey, snapshot)
}

func hasImageParameters(value any) bool {
	switch v := value.(type) {
	case map[string]any:
		for key, child := range v {
			normalized := strings.ToLower(strings.ReplaceAll(key, "_", ""))
			switch normalized {
			case "image", "images", "imageurl", "imageconfig":
				return true
			case "mimetype":
				if s, ok := child.(string); ok && strings.HasPrefix(s, "image/") {
					return true
				}
			case "model":
				if s, ok := child.(string); ok {
					s = strings.ToLower(s)
					for _, marker := range []string{"image", "imagen", "dall-e", "flux", "stable-diffusion", "midjourney"} {
						if strings.Contains(s, marker) {
							return true
						}
					}
				}
			case "type", "responsemodalities", "modalities":
				if s, ok := child.(string); ok && strings.Contains(strings.ToLower(s), "image") {
					return true
				}
				if a, ok := child.([]any); ok {
					for _, item := range a {
						if s, ok := item.(string); ok && strings.EqualFold(s, "image") {
							return true
						}
					}
				}
			}
			if hasImageParameters(child) {
				return true
			}
		}
	case []any:
		for _, child := range v {
			if hasImageParameters(child) {
				return true
			}
		}
	}
	return false
}

func sensitiveParameter(key string) bool {
	key = strings.ToLower(strings.NewReplacer("_", "", "-", "", ".", "").Replace(key))
	switch key {
	case "key", "token", "auth", "authorization", "proxyauthorization", "cookie", "cookies", "headers", "header", "requestheaders", "password", "passwd", "secret", "credentials", "credential", "signature", "data", "bytes", "filecontent", "filecontents", "contentbytes", "binary", "b64json":
		return true
	}
	return strings.Contains(key, "apikey") || strings.Contains(key, "accesstoken") || strings.Contains(key, "refreshtoken") || strings.Contains(key, "authtoken") || strings.Contains(key, "secret") || strings.Contains(key, "base64")
}

func sensitiveValueMetadata(value any) map[string]any {
	metadata := map[string]any{"omitted": true}
	switch value := value.(type) {
	case string:
		metadata["type"] = "string"
		metadata["length"] = len(value)
	case []any:
		metadata["type"] = "array"
		metadata["length"] = len(value)
	case map[string]any:
		metadata["type"] = "object"
		metadata["length"] = len(value)
	default:
		metadata["type"] = "value"
	}
	return metadata
}

func binaryParameter(key string, value any) bool {
	normalized := strings.ToLower(strings.NewReplacer("_", "", "-", "").Replace(key))
	if strings.Contains(normalized, "base64") {
		return true
	}
	switch normalized {
	case "b64json", "bytes", "filecontent", "filecontents", "contentbytes", "binary":
		return true
	case "data":
		_, text := value.(string)
		_, array := value.([]any)
		return text || array
	}
	return false
}

func sanitizeURL(text string, snapshot *RequestParametersSnapshot) string {
	u, err := url.Parse(text)
	if err != nil {
		snapshot.Omitted = true
		return "[omitted]"
	}
	u.User = nil
	query := u.Query()
	for key := range query {
		if sensitiveParameter(key) {
			query.Del(key)
			snapshot.Omitted = true
		}
	}
	u.RawQuery = query.Encode()
	u.ForceQuery = false
	u.Fragment = ""
	u.RawFragment = ""
	return u.String()
}

var snapshotURLPattern = regexp.MustCompile(`(?i)(?:https?://|data:)[^\s<>"']+`)

func (s *RequestParametersSnapshot) sanitize(value any, depth int, budget *int) any {
	if depth > 16 || *budget <= 0 {
		s.Truncated = true
		return nil
	}
	*budget -= 8
	switch v := value.(type) {
	case map[string]any:
		out := map[string]any{}
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if len(key) > 256 || *budget < len(key)+16 {
				s.Truncated = true
				continue
			}
			*budget -= len(key) + 8
			if binaryParameter(key, v[key]) {
				s.Omitted = true
				out[key] = s.sanitize(sensitiveValueMetadata(v[key]), depth+1, budget)
				continue
			}
			if sensitiveParameter(key) {
				s.Omitted = true
				continue
			}
			out[key] = s.sanitize(v[key], depth+1, budget)
		}
		return out
	case []any:
		out := make([]any, 0)
		for _, child := range v {
			if *budget <= 16 || len(out) >= 256 {
				s.Truncated = true
				break
			}
			out = append(out, s.sanitize(child, depth+1, budget))
		}
		return out
	case string:
		v = snapshotURLPattern.ReplaceAllStringFunc(v, func(text string) string {
			if strings.HasPrefix(strings.ToLower(text), "data:") {
				s.Omitted = true
				return "[omitted]"
			}
			return sanitizeURL(text, s)
		})
		// Unlabelled binary payloads also occur in provider extensions.
		if len(v) >= 256 && !strings.ContainsAny(v, " \n\t") {
			if _, err := base64.StdEncoding.DecodeString(v); err == nil {
				s.Omitted = true
				return "[omitted]"
			}
			if _, err := base64.RawStdEncoding.DecodeString(v); err == nil {
				s.Omitted = true
				return "[omitted]"
			}
		}
		limit := *budget
		if limit < 0 {
			limit = 0
		}
		if limit > 4096 {
			limit = 4096
		}
		if len(v) > limit {
			v = v[:limit]
			for !utf8.ValidString(v) {
				v = v[:len(v)-1]
			}
			s.Truncated = true
		}
		*budget -= len(v)
		return v
	case json.Number:
		*budget -= len(v)
		return v
	default:
		return value
	}
}
