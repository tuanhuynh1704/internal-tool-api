package security

import (
	"errors"
	"strings"
	"testing"
)

func TestEncryptDecryptString(t *testing.T) {
	cases := []string{
		"super-secret-api-key-12345!@#$",
		"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
		"",
		"Tiếng Việt có dấu: Xin chào Việt Nam 🚀",
		"{\"apiKey\": \"secret\", \"password\": \"p@ssw0rd\"}",
	}

	for _, original := range cases {
		encrypted, err := EncryptString(original)
		if err != nil {
			t.Fatalf("EncryptString(%q) failed: %v", original, err)
		}

		if original != "" && encrypted == original {
			t.Fatalf("Ciphertext is identical to plaintext for %q", original)
		}

		decrypted, err := DecryptString(encrypted)
		if err != nil {
			t.Fatalf("DecryptString(%q) failed: %v", encrypted, err)
		}

		if decrypted != original {
			t.Fatalf("Expected decrypted %q, got %q", original, decrypted)
		}
	}
}

func TestLegacyV1CiphertextIsStillReadable(t *testing.T) {
	legacy, err := encryptV1("old-secret")
	if err != nil {
		t.Fatal(err)
	}
	got, err := DecryptString(legacy)
	if err != nil || got != "old-secret" {
		t.Fatalf("v1 decrypt = %q, %v", got, err)
	}
}

func TestEncryptDoesNotWrapCiphertextTwice(t *testing.T) {
	once, err := EncryptString("token")
	if err != nil {
		t.Fatal(err)
	}
	twice, err := EncryptString(once)
	if err != nil || twice != once {
		t.Fatalf("ciphertext was re-encrypted: %q", twice)
	}
}

func TestCorruptedCiphertextReportsUndecryptable(t *testing.T) {
	for _, value := range []string{"enc:v1:AAAA", "enc:v2:AAAA", "enc:v3:AAAA", "enc:v9:xyz", "enc:v1:%%%"} {
		if _, err := DecryptString(value); !errors.Is(err, ErrUndecryptable) {
			t.Fatalf("%q: expected ErrUndecryptable, got %v", value, err)
		}
	}
}

func TestNewValuesUseThisPlatformsKeyStore(t *testing.T) {
	encrypted, err := EncryptString("token")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(encrypted, osProtectorPrefix) {
		t.Fatalf("expected %s value, got %q", osProtectorPrefix, encrypted)
	}
}

func TestValueFromOtherOSKeyStoreIsUndecryptable(t *testing.T) {
	other := encPrefixV3
	if osProtectorPrefix == encPrefixV3 {
		other = encPrefixV2
	}
	_, err := DecryptString(other + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
	if !errors.Is(err, ErrUndecryptable) || !strings.Contains(err.Error(), "another operating system") {
		t.Fatalf("expected cross-OS ErrUndecryptable, got %v", err)
	}
}

func TestLegacyPlaintextCompatibility(t *testing.T) {
	legacy := "plain-text-token-without-prefix"
	decrypted, err := DecryptString(legacy)
	if err != nil {
		t.Fatalf("Decrypt legacy failed: %v", err)
	}
	if decrypted != legacy {
		t.Fatalf("Expected %q, got %q", legacy, decrypted)
	}
}
