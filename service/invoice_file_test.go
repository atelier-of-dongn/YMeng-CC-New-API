package service

import (
	"bytes"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func invoiceFileHeaderForTest(t *testing.T, fileName string, content []byte) *multipart.FileHeader {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", fileName)
	require.NoError(t, err)
	_, err = part.Write(content)
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	request := httptest.NewRequest("POST", "/", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	require.NoError(t, request.ParseMultipartForm(MaxInvoicePDFSize))
	return request.MultipartForm.File["file"][0]
}

func TestSaveInvoicePDFValidatesContentAndResolvesPrivateFile(t *testing.T) {
	t.Setenv("INVOICE_STORAGE_DIR", t.TempDir())
	header := invoiceFileHeaderForTest(t, "invoice.pdf", []byte("%PDF-1.7\n%%EOF"))

	file, err := SaveInvoicePDF(42, header)
	require.NoError(t, err)
	t.Cleanup(func() { RemoveInvoiceFile(file.FullPath) })
	assert.Equal(t, "invoice.pdf", file.Name)
	assert.NotEmpty(t, file.Sha256)

	resolved, err := ResolveInvoiceFile(file.Key)
	require.NoError(t, err)
	assert.Equal(t, file.FullPath, resolved)
}

func TestSaveInvoicePDFRejectsInvalidFiles(t *testing.T) {
	t.Setenv("INVOICE_STORAGE_DIR", t.TempDir())

	_, err := SaveInvoicePDF(1, invoiceFileHeaderForTest(t, "invoice.txt", []byte("%PDF-1.7")))
	require.Error(t, err)
	_, err = SaveInvoicePDF(1, invoiceFileHeaderForTest(t, "invoice.pdf", []byte("not a pdf")))
	require.Error(t, err)
	_, err = SaveInvoicePDF(1, &multipart.FileHeader{Filename: "invoice.pdf", Size: MaxInvoicePDFSize + 1})
	require.Error(t, err)
	_, err = ResolveInvoiceFile("../invoice.pdf")
	require.Error(t, err)
}

func TestOpenInvoiceFileStaysInsideStorageDir(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("INVOICE_STORAGE_DIR", dir)
	file, err := SaveInvoicePDF(42, invoiceFileHeaderForTest(t, "invoice.pdf", []byte("%PDF-1.7\n%%EOF")))
	require.NoError(t, err)

	opened, info, err := OpenInvoiceFile(file.Key)
	require.NoError(t, err)
	require.NoError(t, opened.Close())
	assert.Equal(t, file.Size, info.Size())

	outside := filepath.Join(t.TempDir(), "secret.pdf")
	require.NoError(t, os.WriteFile(outside, []byte("%PDF-secret"), 0600))
	require.NoError(t, os.Symlink(outside, filepath.Join(dir, "invoice-link.pdf")))
	_, _, err = OpenInvoiceFile("invoice-link.pdf")
	require.Error(t, err)
	_, err = ResolveInvoiceFile("invoice-link.pdf")
	require.Error(t, err)
	_, _, err = OpenInvoiceFile("../secret.pdf")
	require.Error(t, err)
}

func TestOpenInvoiceFileDoesNotCreateStorageDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "missing")
	t.Setenv("INVOICE_STORAGE_DIR", dir)

	_, _, err := OpenInvoiceFile("invoice-1-abc.pdf")
	require.Error(t, err)
	_, statErr := os.Stat(dir)
	assert.True(t, os.IsNotExist(statErr))
}
