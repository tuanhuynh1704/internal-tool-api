package security

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"testing"
)

// Suspicious environment variables commonly injected by debuggers, profilers, or hook frameworks.
var suspiciousEnvVars = []string{
	"_NT_SYMBOL_PATH",
	"COR_ENABLE_PROFILING",
	"CORECLR_ENABLE_PROFILING",
	"FRIDA_SERVER",
	"CYDIA_",
}

// VerifyEnvironment checks for environment variables typically present during binary analysis.
func VerifyEnvironment() (bool, string) {
	for _, env := range suspiciousEnvVars {
		if os.Getenv(env) != "" {
			// Only the name is reported: values may hold paths or tokens.
			return true, fmt.Sprintf("Suspicious environment variable present: %s", env)
		}
	}
	return false, ""
}

// GetExecutableHash calculates the SHA-256 checksum of the running executable file.
// This is used for self-integrity verification and tamper detection.
func GetExecutableHash() (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("locate executable: %w", err)
	}

	file, err := os.Open(exePath)
	if err != nil {
		return "", fmt.Errorf("open executable: %w", err)
	}
	defer file.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", fmt.Errorf("hash executable: %w", err)
	}

	return hex.EncodeToString(hasher.Sum(nil)), nil
}

// ValidateBinaryState ensures the current process binary exists and has not been truncated or deleted.
func ValidateBinaryState() error {
	exePath, err := os.Executable()
	if err != nil {
		return err
	}

	info, err := os.Stat(exePath)
	if err != nil {
		return fmt.Errorf("executable not found or inaccessible: %w", err)
	}

	// Legitimate compiled binary is at least 1MB. Go test binaries are exempt by
	// detection of the test runtime, not by matching "test" anywhere in the path
	// (which would also exempt C:\Users\tester\...).
	if info.Size() < 1024*1024 && !testing.Testing() {
		return fmt.Errorf("binary size unexpectedly small: %d bytes", info.Size())
	}

	return nil
}
