package ui

import (
	"testing"
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
