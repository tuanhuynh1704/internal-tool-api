package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const manifest = "https://github.com/TuansHuynh/internal-tool-api/releases/latest/download/latest.json"

func TestValidateDownloadURL(t *testing.T) {
	ok := "https://github.com/TuansHuynh/internal-tool-api/releases/download/v2.6.0/app.exe"
	if err := ValidateDownloadURL(manifest, ok); err != nil {
		t.Fatalf("legitimate URL rejected: %v", err)
	}
	for _, bad := range []string{
		"http://github.com/TuansHuynh/internal-tool-api/releases/download/v2.6.0/app.exe",
		"https://attacker.example/TuansHuynh/internal-tool-api/releases/download/x.exe",
		"https://github.com/attacker/repo/releases/download/v1/x.exe",
	} {
		if err := ValidateDownloadURL(manifest, bad); err == nil {
			t.Fatalf("accepted %s", bad)
		}
	}
}

func TestDownloadDestinationRejectsPathTraversal(t *testing.T) {
	if _, err := DownloadDestination("../../evil"); err == nil {
		t.Fatal("path traversal accepted as version")
	}
	dest, err := DownloadDestination("v2.6.0")
	if err != nil || filepath.Dir(dest) != TempDownloadDir() || !strings.Contains(filepath.Base(dest), "2.6.0") {
		t.Fatalf("unexpected destination %q (%v)", dest, err)
	}
}

func TestDownloadVerifiesChecksumAndThrottlesProgress(t *testing.T) {
	payload := []byte(strings.Repeat("x", 1<<20))
	sum := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(payload) }))
	defer server.Close()
	dest := filepath.Join(t.TempDir(), "update.bin")

	calls := 0
	if err := DownloadUpdate(context.Background(), server.Client(), server.URL, hex.EncodeToString(sum[:]), dest, func(int64, int64) { calls++ }); err != nil {
		t.Fatal(err)
	}
	if calls > 101 {
		t.Fatalf("progress callback fired %d times", calls)
	}
	if err := VerifyFileSHA256(dest, hex.EncodeToString(sum[:])); err != nil {
		t.Fatal(err)
	}

	bad := filepath.Join(t.TempDir(), "bad.bin")
	if err := DownloadUpdate(context.Background(), server.Client(), server.URL, strings.Repeat("0", 64), bad, nil); err == nil {
		t.Fatal("checksum mismatch accepted")
	}
	if _, err := os.Stat(bad); !os.IsNotExist(err) {
		t.Fatal("rejected download left a file behind")
	}
}
