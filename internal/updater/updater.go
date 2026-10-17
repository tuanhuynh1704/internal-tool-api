package updater

import (
	"crypto/ed25519"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const (
	// checkTimeout is the HTTP timeout for fetching the update manifest.
	checkTimeout = 15 * time.Second

	maxManifestBytes  = 1 << 20
	maxSignatureBytes = 4 << 10
)

// CheckForUpdate fetches manifestURL and its detached signature, verifies the
// signature against the embedded public keys, parses the JSON, and returns an
// UpdateInfo if a newer version is available for the current platform.
//
// Returns (nil, nil) when the app is already up-to-date.
// Returns (nil, err) on fetch/parse/signature errors — callers should log and continue.
func CheckForUpdate(manifestURL, currentVersion string) (*UpdateInfo, error) {
	keys, err := TrustedManifestKeys()
	if err != nil {
		return nil, err
	}
	return checkForUpdate(&http.Client{Timeout: checkTimeout}, manifestURL, currentVersion, keys)
}

func checkForUpdate(client *http.Client, manifestURL, currentVersion string, keys []ed25519.PublicKey) (*UpdateInfo, error) {
	body, err := fetchSmall(client, manifestURL, maxManifestBytes)
	if err != nil {
		return nil, fmt.Errorf("fetch manifest: %w", err)
	}
	sigURL, err := SignatureURL(manifestURL)
	if err != nil {
		return nil, err
	}
	sig, err := fetchSmall(client, sigURL, maxSignatureBytes)
	if err != nil {
		return nil, fmt.Errorf("%w: fetch signature: %v", ErrManifestSignature, err)
	}
	// Verify the exact bytes before parsing anything: an unsigned manifest
	// must not even influence the version comparison.
	if err = VerifyManifestSignature(body, sig, keys); err != nil {
		return nil, err
	}

	var manifest UpdateManifest
	if err = json.Unmarshal(body, &manifest); err != nil {
		return nil, fmt.Errorf("parse manifest JSON: %w", err)
	}

	newer, err := IsNewerVersionString(currentVersion, manifest.Version)
	if err != nil {
		return nil, fmt.Errorf("version compare: %w", err)
	}

	if !newer {
		log.Printf("[updater] already up-to-date (current=%s, latest=%s)", currentVersion, manifest.Version)
		return nil, nil
	}

	platform := CurrentPlatformKey()
	p, err := manifest.PlatformFor(platform)
	if err != nil {
		return nil, fmt.Errorf("platform check: %w", err)
	}

	return &UpdateInfo{
		Version: manifest.Version,
		URL:     p.URL,
		SHA256:  p.SHA256,
	}, nil
}

// fetchSmall GETs url and returns its body, refusing anything over limit bytes.
func fetchSmall(client *http.Client, url string, limit int64) ([]byte, error) {
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned %d for %s", resp.StatusCode, url)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	if int64(len(body)) > limit {
		return nil, fmt.Errorf("response exceeds %d bytes", limit)
	}
	return body, nil
}

// NewDownloadClient returns an http.Client suitable for downloading large
// binaries. Connection setup and the wait for response headers are bounded;
// the body transfer is bounded by DownloadUpdate's context and stall watchdog.
func NewDownloadClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			DialContext:           (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
			TLSHandshakeTimeout:   15 * time.Second,
			ResponseHeaderTimeout: 60 * time.Second,
			IdleConnTimeout:       30 * time.Second,
		},
	}
}

// LaunchUpdaterProcess extracts the embedded updater binary to a temp file and
// launches it as a detached process with the required arguments.
//
// Parameters:
//   - updaterData: the raw bytes of the updater binary (from go:embed)
//   - appPID:      PID of the running application process (to wait for exit)
//   - sourcePath:  path to the downloaded new binary
//   - targetPath:  path to the current application executable
//   - newTargetPath: path to the new renamed application executable
//   - expectedSHA256: checksum the updater re-verifies right before installing
func LaunchUpdaterProcess(updaterData []byte, appPID int, sourcePath, targetPath, newTargetPath, expectedSHA256 string) error {
	// Re-check the downloaded file now: it sat in a temp directory since the
	// download finished and could have been replaced in the meantime.
	if err := VerifyFileSHA256(sourcePath, expectedSHA256); err != nil {
		return fmt.Errorf("downloaded update failed verification: %w", err)
	}
	// Write updater binary to a temp file.
	updaterPath, err := extractUpdater(updaterData)
	if err != nil {
		return fmt.Errorf("extract updater: %w", err)
	}

	// Make it executable on Linux/macOS.
	if err = os.Chmod(updaterPath, 0o755); err != nil {
		return fmt.Errorf("chmod updater: %w", err)
	}

	args := []string{
		"--pid", fmt.Sprintf("%d", appPID),
		"--source", sourcePath,
		"--target", targetPath,
		"--sha256", expectedSHA256,
	}
	if newTargetPath != "" && newTargetPath != targetPath {
		args = append(args, "--new-target", newTargetPath)
	}

	cmd := exec.Command(updaterPath, args...)
	// Detach from the current process so it survives after the app exits.
	setSysProcAttr(cmd)

	if err = cmd.Start(); err != nil {
		return fmt.Errorf("start updater process: %w", err)
	}

	log.Printf("[updater] launched updater PID=%d → replacing %s (newTarget=%s)", cmd.Process.Pid, targetPath, newTargetPath)
	return nil
}

// extractUpdater writes the updater binary bytes to a temp file and returns its path.
func extractUpdater(data []byte) (string, error) {
	dir := TempDownloadDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("create temp dir: %w", err)
	}

	ext := ""
	if isWindows() {
		ext = ".exe"
	}
	name := fmt.Sprintf("internal-api-client-updater-%d%s", time.Now().UnixNano(), ext)
	path := filepath.Join(dir, name)

	if err := os.WriteFile(path, data, 0o755); err != nil {
		return "", fmt.Errorf("write updater binary: %w", err)
	}
	return path, nil
}

func isWindows() bool {
	return os.PathSeparator == '\\'
}
