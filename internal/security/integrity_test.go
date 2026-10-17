package security

import (
	"os"
	"testing"
)

func TestVerifyEnvironment(t *testing.T) {
	detected, _ := VerifyEnvironment()
	if detected {
		t.Log("Suspicious environment detected in test run")
	}

	// Test injection
	_ = os.Setenv("_NT_SYMBOL_PATH", "srv*https://symbols")
	defer os.Unsetenv("_NT_SYMBOL_PATH")

	detected, desc := VerifyEnvironment()
	if !detected {
		t.Fatal("Expected detected=true when _NT_SYMBOL_PATH is set")
	}
	if desc == "" {
		t.Fatal("Expected non-empty description")
	}
}

func TestGetExecutableHash(t *testing.T) {
	hash, err := GetExecutableHash()
	if err != nil {
		t.Fatalf("GetExecutableHash failed: %v", err)
	}
	if len(hash) != 64 {
		t.Fatalf("Expected 64-char sha256 hex string, got %d (%s)", len(hash), hash)
	}
}

func TestValidateBinaryState(t *testing.T) {
	if err := ValidateBinaryState(); err != nil {
		t.Fatalf("ValidateBinaryState failed: %v", err)
	}
}
