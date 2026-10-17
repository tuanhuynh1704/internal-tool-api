package ui

import (
	"encoding/json"
	"testing"
	"time"
)

func TestInterpolateVariables(t *testing.T) {
	vars := map[string]string{
		"base_url": "https://example.com",
		"username": "tester1",
		"password": "secretPassword",
	}

	tests := []struct {
		input    string
		expected string
	}{
		{"{{base_url}}/login", "https://example.com/login"},
		{"{{ username }}", "tester1"},
		{"#input-{{password}}", "#input-secretPassword"},
		{"Plain string with no vars", "Plain string with no vars"},
		{"{{unknown_var}}", "{{unknown_var}}"},
	}

	for _, tc := range tests {
		got := interpolateVariables(tc.input, vars)
		if got != tc.expected {
			t.Errorf("interpolateVariables(%q) = %q, expected %q", tc.input, got, tc.expected)
		}
	}
}

func TestInterpolateConfigJSONKeepsDocumentValid(t *testing.T) {
	got := interpolateConfigJSON(`{"operator":"contains","filePath":"{{file}}"}`, map[string]string{"file": `C:\data\"quoted".txt`})
	var cfg StepConfig
	if err := json.Unmarshal([]byte(got), &cfg); err != nil {
		t.Fatalf("config became invalid JSON: %v (%s)", err, got)
	}
	if cfg.FilePath != `C:\data\"quoted".txt` || cfg.Operator != "contains" {
		t.Fatalf("unexpected config %+v", cfg)
	}
}

func TestArtifactNamesAreUniqueWithinOneSecond(t *testing.T) {
	sm := &ScreenshotManager{baseDir: t.TempDir()}
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		path := sm.GenerateScreenshotPath("scenario", "step")
		if seen[path] {
			t.Fatalf("duplicate screenshot path %s", path)
		}
		seen[path] = true
		time.Sleep(time.Microsecond)
	}
}

func TestCheckMatchRejectsUnknownOperator(t *testing.T) {
	if checkMatch("abc", "b", "sounds_like") {
		t.Fatal("unknown operator must not silently fall back to contains")
	}
}

func TestCheckMatch(t *testing.T) {
	if !checkMatch("Welcome to Dashboard", "Welcome", "contains") {
		t.Errorf("checkMatch contains failed")
	}
	if !checkMatch("https://app.com/dashboard", "https://app.com/dashboard", "equals") {
		t.Errorf("checkMatch equals failed")
	}
	if !checkMatch("Hello world", "Hello", "starts_with") {
		t.Errorf("checkMatch starts_with failed")
	}
	if !checkMatch("Hello world", "world", "ends_with") {
		t.Errorf("checkMatch ends_with failed")
	}
	if !checkMatch("release-2026.10", `^release-\d{4}\.\d+$`, "regex") {
		t.Errorf("checkMatch regex failed")
	}
}
