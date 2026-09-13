package service

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const MaxInvoicePDFSize int64 = 20 * 1024 * 1024

type InvoiceFile struct {
	Key      string
	Name     string
	Size     int64
	Sha256   string
	FullPath string
}

func invoiceStorageDir() (string, error) {
	dir := strings.TrimSpace(os.Getenv("INVOICE_STORAGE_DIR"))
	if dir == "" {
		dir = "./invoices"
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(abs, 0750); err != nil {
		return "", err
	}
	return abs, nil
}

func SaveInvoicePDF(applicationId int, header *multipart.FileHeader) (*InvoiceFile, error) {
	if applicationId <= 0 || header == nil {
		return nil, errors.New("invalid invoice file")
	}
	if !strings.EqualFold(filepath.Ext(header.Filename), ".pdf") {
		return nil, errors.New("invoice file must be a PDF")
	}
	if header.Size <= 0 || header.Size > MaxInvoicePDFSize {
		return nil, errors.New("invoice PDF exceeds the 20 MB limit")
	}

	source, err := header.Open()
	if err != nil {
		return nil, err
	}
	defer source.Close()

	dir, err := invoiceStorageDir()
	if err != nil {
		return nil, err
	}
	temporary, err := os.CreateTemp(dir, ".invoice-upload-*.pdf")
	if err != nil {
		return nil, err
	}
	temporaryPath := temporary.Name()
	keepTemporary := false
	defer func() {
		_ = temporary.Close()
		if !keepTemporary {
			_ = os.Remove(temporaryPath)
		}
	}()

	hash := sha256.New()
	written, err := io.Copy(io.MultiWriter(temporary, hash), io.LimitReader(source, MaxInvoicePDFSize+1))
	if err != nil {
		return nil, err
	}
	if written <= 0 || written > MaxInvoicePDFSize {
		return nil, errors.New("invoice PDF exceeds the 20 MB limit")
	}
	if err := temporary.Sync(); err != nil {
		return nil, err
	}
	if _, err := temporary.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	headerBytes := make([]byte, 512)
	read, err := temporary.Read(headerBytes)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	if read < 5 || string(headerBytes[:5]) != "%PDF-" || http.DetectContentType(headerBytes[:read]) != "application/pdf" {
		return nil, errors.New("invoice file content is not a valid PDF")
	}
	if err := temporary.Close(); err != nil {
		return nil, err
	}

	key := fmt.Sprintf("invoice-%d-%s.pdf", applicationId, common.GetRandomString(16))
	finalPath := filepath.Join(dir, key)
	if err := os.Rename(temporaryPath, finalPath); err != nil {
		return nil, err
	}
	if err := os.Chmod(finalPath, 0640); err != nil {
		_ = os.Remove(finalPath)
		return nil, err
	}
	keepTemporary = true
	return &InvoiceFile{
		Key:      key,
		Name:     filepath.Base(header.Filename),
		Size:     written,
		Sha256:   hex.EncodeToString(hash.Sum(nil)),
		FullPath: finalPath,
	}, nil
}

func ResolveInvoiceFile(key string) (string, error) {
	if key == "" || filepath.Base(key) != key {
		return "", errors.New("invalid invoice file key")
	}
	dir, err := invoiceStorageDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, key)
	if _, err := os.Stat(path); err != nil {
		return "", err
	}
	return path, nil
}

func RemoveInvoiceFile(path string) {
	if path != "" {
		_ = os.Remove(path)
	}
}
