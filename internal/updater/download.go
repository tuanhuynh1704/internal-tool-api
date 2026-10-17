package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	// maxDownloadBytes bounds the size of an update binary.
	maxDownloadBytes = 512 << 20
	// stallTimeout aborts a download that receives no data for this long, so
	// a hung connection cannot keep the updater in "downloading" forever.
	stallTimeout = 60 * time.Second
	// maxDownloadDuration is the overall upper bound for one download.
	maxDownloadDuration = 30 * time.Minute
)

// TempDownloadDir returns the per-user temp directory for downloads.
// Windows: %TEMP%\internal-api-client\update\
// Linux/macOS: $TMPDIR/internal-api-client-<uid>/update/
func TempDownloadDir() string {
	if runtime.GOOS == "windows" {
		base := os.Getenv("TEMP")
		if base == "" {
			base = os.Getenv("TMP")
		}
		if base == "" {
			base = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Local", "Temp")
		}
		return filepath.Join(base, "internal-api-client", "update")
	}
	// A per-user directory avoids sharing /tmp paths that another local user
	// could pre-create or symlink.
	return filepath.Join(os.TempDir(), fmt.Sprintf("internal-api-client-%d", os.Getuid()), "update")
}

// DownloadDestination returns the full path for the downloaded update binary.
// The version must be a plain semantic version so it cannot inject path
// separators ("../") into the file name.
func DownloadDestination(version string) (string, error) {
	parsed, err := ParseSemVer(version)
	if err != nil {
		return "", err
	}
	ext := ""
	if runtime.GOOS == "windows" {
		ext = ".exe"
	}
	filename := fmt.Sprintf("internal-api-client-update-v%s%s", parsed.String(), ext)
	return filepath.Join(TempDownloadDir(), filename), nil
}

// ValidateDownloadURL accepts only HTTPS URLs that live under the same
// repository releases path as the manifest, so a tampered caller cannot point
// the updater at an arbitrary binary.
func ValidateDownloadURL(manifestURL, downloadURL string) error {
	manifest, err := url.Parse(manifestURL)
	if err != nil {
		return fmt.Errorf("invalid manifest URL: %w", err)
	}
	target, err := url.Parse(downloadURL)
	if err != nil {
		return fmt.Errorf("invalid download URL: %w", err)
	}
	if target.Scheme != "https" || manifest.Scheme != "https" {
		return fmt.Errorf("update downloads must use https")
	}
	if !strings.EqualFold(target.Host, manifest.Host) {
		return fmt.Errorf("update host %q does not match manifest host %q", target.Host, manifest.Host)
	}
	prefix := manifest.Path
	if index := strings.Index(prefix, "/releases/"); index >= 0 {
		prefix = prefix[:index+len("/releases/")]
	} else {
		prefix = filepath.ToSlash(filepath.Dir(prefix)) + "/"
	}
	if !strings.HasPrefix(target.Path, prefix) {
		return fmt.Errorf("update URL is outside %s", prefix)
	}
	return nil
}

// VerifyFileSHA256 hashes a file on disk and compares it with expected.
func VerifyFileSHA256(path, expected string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return err
	}
	actual := hex.EncodeToString(hasher.Sum(nil))
	if want := strings.ToLower(strings.TrimSpace(expected)); actual != want {
		return fmt.Errorf("SHA-256 mismatch: expected %s, got %s", want, actual)
	}
	return nil
}

// DownloadUpdate streams the binary from url to destination, computes its SHA-256
// checksum on-the-fly, and verifies it against expectedSHA256 after completion.
//
//   - progressCallback receives (bytesDownloaded, totalBytes) whenever the
//     integer percentage changes. totalBytes is -1 when Content-Length is unknown.
//   - Returns nil only if download AND checksum verification succeed.
//   - On any failure the partially/fully downloaded file is removed.
func DownloadUpdate(
	ctx context.Context,
	client *http.Client,
	downloadURL string,
	expectedSHA256 string,
	destination string,
	progressCallback func(downloaded, total int64),
) error {
	expected := strings.ToLower(strings.TrimSpace(expectedSHA256))
	if len(expected) != 64 || strings.Trim(expected, "0123456789abcdef") != "" {
		return fmt.Errorf("manifest has no valid SHA-256 for this platform")
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return fmt.Errorf("create temp dir: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, maxDownloadDuration)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("http get: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected http status %d for %s", resp.StatusCode, downloadURL)
	}
	totalBytes := resp.ContentLength // -1 if unknown
	if totalBytes > maxDownloadBytes {
		return fmt.Errorf("update is too large (%d bytes)", totalBytes)
	}

	// Write to a temp file in the same directory and rename only after the
	// hash is verified, so a half-written file never sits at the destination.
	partial := destination + ".part"
	out, err := os.OpenFile(partial, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o700)
	if err != nil {
		return fmt.Errorf("create destination file: %w", err)
	}
	removeOnErr := func(writeErr error) error {
		out.Close()
		_ = os.Remove(partial)
		return writeErr
	}

	// Stall watchdog: cancel the request if no bytes arrive for stallTimeout.
	var activityMu sync.Mutex
	lastActivity := time.Now()
	watchdogDone := make(chan struct{})
	defer close(watchdogDone)
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-watchdogDone:
				return
			case <-ticker.C:
				activityMu.Lock()
				idle := time.Since(lastActivity)
				activityMu.Unlock()
				if idle > stallTimeout {
					cancel()
					return
				}
			}
		}
	}()

	hasher := sha256.New()
	pr := &progressReader{
		reader:   io.LimitReader(resp.Body, maxDownloadBytes+1),
		hasher:   hasher,
		total:    totalBytes,
		callback: progressCallback,
		lastPct:  -1,
		onRead: func() {
			activityMu.Lock()
			lastActivity = time.Now()
			activityMu.Unlock()
		},
	}

	written, err := io.Copy(out, pr)
	if err != nil {
		if ctx.Err() == context.Canceled {
			return removeOnErr(fmt.Errorf("download stalled for more than %s", stallTimeout))
		}
		return removeOnErr(fmt.Errorf("stream download: %w", err))
	}
	if written > maxDownloadBytes {
		return removeOnErr(fmt.Errorf("update exceeds %d bytes", maxDownloadBytes))
	}
	if err = out.Close(); err != nil {
		_ = os.Remove(partial)
		return fmt.Errorf("close destination file: %w", err)
	}

	actualSHA256 := hex.EncodeToString(hasher.Sum(nil))
	if actualSHA256 != expected {
		_ = os.Remove(partial)
		return fmt.Errorf("SHA-256 mismatch: expected %s, got %s", expected, actualSHA256)
	}
	_ = os.Remove(destination)
	if err := os.Rename(partial, destination); err != nil {
		_ = os.Remove(partial)
		return fmt.Errorf("finalize download: %w", err)
	}
	return nil
}

// progressReader wraps an io.Reader and reports progress via a callback while
// simultaneously writing data to a hash.Writer.
type progressReader struct {
	reader     io.Reader
	hasher     io.Writer
	total      int64
	downloaded int64
	lastPct    int64
	callback   func(downloaded, total int64)
	onRead     func()
}

func (pr *progressReader) Read(p []byte) (int, error) {
	n, err := pr.reader.Read(p)
	if n > 0 {
		pr.downloaded += int64(n)
		_, _ = pr.hasher.Write(p[:n])
		if pr.onRead != nil {
			pr.onRead()
		}
		if pr.callback != nil {
			// Report only when the percentage moves (or every MiB when the size
			// is unknown) instead of flooding the UI with one event per read.
			var pct int64
			if pr.total > 0 {
				pct = pr.downloaded * 100 / pr.total
			} else {
				pct = pr.downloaded >> 20
			}
			if pct != pr.lastPct {
				pr.lastPct = pct
				pr.callback(pr.downloaded, pr.total)
			}
		}
	}
	return n, err
}
