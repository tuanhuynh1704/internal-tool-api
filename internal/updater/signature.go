package updater

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// SignatureSuffix is appended to the manifest URL to fetch its detached
// signature (latest.json → latest.json.sig).
const SignatureSuffix = ".sig"

// trustedManifestKeys are the base64 Ed25519 public keys allowed to sign
// latest.json. The matching private key exists only as the CI secret
// UPDATE_SIGNING_KEY. To rotate: add the new key here, ship a release signed
// with the old key, then switch the secret and drop the old key later.
var trustedManifestKeys = []string{
	"GdWyYLmuhjNAxe4gArsASfPYAWu1/C2nf0OwQiyC4DI=", // generated 2026-10-16
}

// ErrManifestSignature is returned when latest.json is unsigned or its
// signature does not verify against any trusted key.
var ErrManifestSignature = errors.New("update manifest signature is invalid")

// TrustedManifestKeys decodes the embedded public keys.
func TrustedManifestKeys() ([]ed25519.PublicKey, error) {
	keys := make([]ed25519.PublicKey, 0, len(trustedManifestKeys))
	for i, encoded := range trustedManifestKeys {
		raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
		if err != nil || len(raw) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("trusted manifest key #%d is not a base64 Ed25519 public key", i+1)
		}
		keys = append(keys, ed25519.PublicKey(raw))
	}
	if len(keys) == 0 {
		return nil, errors.New("no trusted manifest keys configured")
	}
	return keys, nil
}

// SignatureURL returns where the detached signature of manifestURL lives.
func SignatureURL(manifestURL string) (string, error) {
	u, err := url.Parse(manifestURL)
	if err != nil {
		return "", fmt.Errorf("invalid manifest URL: %w", err)
	}
	u.Path += SignatureSuffix
	if u.RawPath != "" {
		u.RawPath += SignatureSuffix
	}
	return u.String(), nil
}

// SignManifest returns the detached signature file content for manifest:
// the base64 Ed25519 signature over the exact manifest bytes, plus newline.
func SignManifest(manifest []byte, key ed25519.PrivateKey) []byte {
	sig := ed25519.Sign(key, manifest)
	return []byte(base64.StdEncoding.EncodeToString(sig) + "\n")
}

// VerifyManifestSignature checks a detached signature (as written by
// SignManifest) over the exact manifest bytes. The signature covers the
// per-platform SHA-256 values, so verified manifests also authenticate the
// binaries they point to.
func VerifyManifestSignature(manifest, signatureFile []byte, keys []ed25519.PublicKey) error {
	sig, err := base64.StdEncoding.DecodeString(string(bytes.TrimSpace(signatureFile)))
	if err != nil || len(sig) != ed25519.SignatureSize {
		return fmt.Errorf("%w: malformed signature file", ErrManifestSignature)
	}
	for _, key := range keys {
		if ed25519.Verify(key, manifest, sig) {
			return nil
		}
	}
	return fmt.Errorf("%w: not signed by a trusted key", ErrManifestSignature)
}

// ParsePrivateKey accepts a base64 Ed25519 seed (32 bytes) or full private
// key (64 bytes), the format written by `go run ./cmd/signmanifest -genkey`.
func ParsePrivateKey(encoded string) (ed25519.PrivateKey, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return nil, fmt.Errorf("signing key is not base64: %w", err)
	}
	switch len(raw) {
	case ed25519.SeedSize:
		return ed25519.NewKeyFromSeed(raw), nil
	case ed25519.PrivateKeySize:
		key := ed25519.PrivateKey(raw)
		// Reject a 64-byte value whose public half does not match its seed.
		if !bytes.Equal(ed25519.NewKeyFromSeed(key.Seed()), key) {
			return nil, errors.New("signing key is inconsistent")
		}
		return key, nil
	default:
		return nil, fmt.Errorf("signing key has %d bytes, want 32 or 64", len(raw))
	}
}
