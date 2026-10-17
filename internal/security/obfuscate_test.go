package security

import (
	"testing"
)

func TestObfuscateDeobfuscate(t *testing.T) {
	key := []byte{0x7B, 0x3F, 0x91, 0x4A, 0xC8, 0x12, 0x6E, 0x5D}
	original := "internal-api-client-sec-salt-8f92a4e1d3c5b706"

	masked := Obfuscate(original, key)
	if len(masked) != len(original) {
		t.Fatalf("Masked length mismatch: got %d, expected %d", len(masked), len(original))
	}

	// Verify that masked contains no readable plaintext
	if string(masked) == original {
		t.Fatalf("Masked text should not match original plaintext")
	}

	recovered := Deobfuscate(masked, key)
	if recovered != original {
		t.Fatalf("Deobfuscated text mismatch: got %q, expected %q", recovered, original)
	}

	urlKey := []byte{0x4D, 0x92, 0x1B, 0x7E, 0x83, 0x5C, 0xA1, 0x3F}
	urlOriginal := "https://github.com/TuansHuynh/internal-tool-api/releases/latest/download/latest.json"
	urlMasked := Obfuscate(urlOriginal, urlKey)
	if Deobfuscate(urlMasked, urlKey) != urlOriginal {
		t.Fatalf("Recovered URL mismatch")
	}
}

func TestWipeBytes(t *testing.T) {
	data := []byte{1, 2, 3, 4, 5}
	WipeBytes(data)
	for i, b := range data {
		if b != 0 {
			t.Fatalf("Byte at %d not wiped, got %d", i, b)
		}
	}
}
