package main

import (
	"crypto/subtle"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

func startUpdateControlServer() *http.Server {
	if os.Getenv("UPDATE_MANAGED") != "true" {
		return nil
	}
	token := os.Getenv("UPDATE_CONTROL_TOKEN")
	if len(token) < 32 {
		common.SysError("UPDATE_MANAGED requires UPDATE_CONTROL_TOKEN with at least 32 characters")
		return nil
	}
	address := os.Getenv("UPDATE_INTERNAL_ADDR")
	if address == "" {
		address = ":3001"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/internal/update/status", func(writer http.ResponseWriter, request *http.Request) {
		if !authorizeUpdateControl(request, token) {
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		if request.Method != http.MethodGet {
			writer.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		writeUpdateLifecycle(writer, common.UpdateLifecycle())
	})
	mux.HandleFunc("/internal/update/drain", func(writer http.ResponseWriter, request *http.Request) {
		if !authorizeUpdateControl(request, token) {
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		if request.Method != http.MethodPost {
			writer.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		common.BeginUpdateDrain()
		writeUpdateLifecycle(writer, common.UpdateLifecycle())
	})
	server := &http.Server{
		Addr:              address,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			common.SysError("update control server stopped: " + err.Error())
		}
	}()
	return server
}

func authorizeUpdateControl(request *http.Request, token string) bool {
	value := request.Header.Get("Authorization")
	if !strings.HasPrefix(value, "Bearer ") {
		return false
	}
	provided := strings.TrimPrefix(value, "Bearer ")
	return subtle.ConstantTimeCompare([]byte(provided), []byte(token)) == 1
}

func writeUpdateLifecycle(writer http.ResponseWriter, value common.UpdateLifecycleSnapshot) {
	data, err := common.Marshal(value)
	if err != nil {
		writer.WriteHeader(http.StatusInternalServerError)
		return
	}
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	_, _ = writer.Write(data)
}
