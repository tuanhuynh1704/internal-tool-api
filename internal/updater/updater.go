package updater

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"time"
)

const (
	// checkTimeout is the HTTP timeout for fetching the update manifest.
	checkTimeout = 15 * time.Second

	// downloadTimeout is the HTTP timeout for downloading the binary.
	// Set to 0 to disable timeout (handled at the streaming layer instead).
	downloadTimeout  = 0
	maxManifestBytes = 1 << 20
)

// CheckForUpdate fetches manifestURL, parses the JSON, and returns an UpdateInfo
// if a newer version is available for the current platform.
//
// Returns (nil, nil) when the app is already up-to-date.
// Returns (nil, err) on fetch/parse errors — callers should log and continue.
func CheckForUpdate(manifestURL, currentVersion string) (*UpdateInfo, error) {
	client := &http.Client{Timeout: checkTimeout}

	resp, err := client.Get(manifestURL)
	if err != nil {
		return nil, fmt.Errorf("fetch manifest: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("manifest server returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxManifestBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read manifest body: %w", err)
	}
	if len(body) > maxManifestBytes {
		return nil, fmt.Errorf("manifest exceeds %d bytes", maxManifestBytes)
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

// NewDownloadClient returns an http.Client suitable for downloading large binaries.
// No global timeout — the caller controls progress via context / cancellation.
func NewDownloadClient() *http.Client {
	return &http.Client{Timeout: downloadTimeout}
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
func LaunchUpdaterProcess(updaterData []byte, appPID int, sourcePath, targetPath, newTargetPath string) error {
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
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create temp dir: %w", err)
	}

	ext := ""
	if isWindows() {
		ext = ".exe"
	}
	name := fmt.Sprintf("internal-api-client-updater-%d%s", time.Now().UnixNano(), ext)
	path := fmt.Sprintf("%s/%s", dir, name)

	if err := os.WriteFile(path, data, 0o755); err != nil {
		return "", fmt.Errorf("write updater binary: %w", err)
	}
	return path, nil
}

func isWindows() bool {
	return os.PathSeparator == '\\'
}
