package ui

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ScreenshotManager handles screenshot file creation, storage, and retrieval
type ScreenshotManager struct {
	baseDir string
}

// NewScreenshotManager creates a new ScreenshotManager with path inside user's app data directory
func NewScreenshotManager() *ScreenshotManager {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	screenshotsDir := filepath.Join(dir, "internal-api-client", "screenshots")
	_ = os.MkdirAll(screenshotsDir, 0755)
	return &ScreenshotManager{
		baseDir: screenshotsDir,
	}
}

// GenerateScreenshotPath generates a unique file path for a failed step screenshot
func (sm *ScreenshotManager) GenerateScreenshotPath(scenarioID, stepID string) string {
	timestamp := time.Now().Format("20060102_150405_000")
	safeScenarioID := sanitizeFileName(scenarioID)
	safeStepID := sanitizeFileName(stepID)
	fileName := fmt.Sprintf("fail_%s_%s_%s.png", safeScenarioID, safeStepID, timestamp)
	return filepath.Join(sm.baseDir, fileName)
}

func (sm *ScreenshotManager) GenerateTracePath(scenarioID, runID string) string {
	timestamp := time.Now().Format("20060102_150405_000")
	return filepath.Join(sm.baseDir, fmt.Sprintf("trace_%s_%s_%s.zip", sanitizeFileName(scenarioID), sanitizeFileName(runID), timestamp))
}

// ReadScreenshotAsBase64 reads a screenshot image and encodes it to base64 data URI
func (sm *ScreenshotManager) ReadScreenshotAsBase64(filePath string) (string, error) {
	if !sm.IsManagedPath(filePath) {
		return "", fmt.Errorf("screenshot path is outside the managed artifact directory")
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}
	encoded := base64.StdEncoding.EncodeToString(data)
	return "data:image/png;base64," + encoded, nil
}

// IsManagedPath prevents a Wails caller from using the screenshot helper as a
// generic local-file reader. Only artifacts created under baseDir are accepted.
func (sm *ScreenshotManager) IsManagedPath(filePath string) bool {
	base, err := filepath.Abs(sm.baseDir)
	if err != nil {
		return false
	}
	candidate, err := filepath.Abs(filePath)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(base, candidate)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}

func sanitizeFileName(name string) string {
	var out []rune
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			out = append(out, r)
		} else {
			out = append(out, '_')
		}
	}
	return string(out)
}
