package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"runtime"
	"strings"
	"sync"
)

const (
	// encPrefix marks every encrypted value; anything without it is treated as
	// legacy plaintext for backwards compatibility.
	encPrefix = "enc:"
	// encPrefixV1 values are AES-256-GCM with a key derived from machine
	// identifiers. They are still readable, but new values are written as
	// v2/v3 wherever the operating system offers a user-bound key store.
	encPrefixV1 = "enc:v1:"
	// encPrefixV2 values are protected by Windows DPAPI, i.e. bound to the
	// logged-in user's credentials instead of public data.
	encPrefixV2 = "enc:v2:"
	// encPrefixV3 values are AES-256-GCM under a random master key kept in
	// the macOS Keychain or the Linux Secret Service (libsecret).
	encPrefixV3 = "enc:v3:"
)

// ErrUndecryptable is returned when a stored secret cannot be decrypted on
// this machine/account (moved database, renamed host, other Windows user...).
var ErrUndecryptable = errors.New("encrypted value cannot be decrypted on this machine")

var (
	// XOR mask key and masked bytes for salt to prevent plaintext extraction from compiled binary (.rdata section)
	saltMaskKey = []byte{0x7B, 0x3F, 0x91, 0x4A, 0xC8, 0x12, 0x6E, 0x5D}
	maskedSalt  = []byte{
		0x12, 0x51, 0xe5, 0x2f, 0xba, 0x7c, 0xf, 0x31,
		0x56, 0x5e, 0xe1, 0x23, 0xe5, 0x71, 0x2, 0x34,
		0x1e, 0x51, 0xe5, 0x67, 0xbb, 0x77, 0xd, 0x70,
		0x8, 0x5e, 0xfd, 0x3e, 0xe5, 0x2a, 0x8, 0x64,
		0x49, 0x5e, 0xa5, 0x2f, 0xf9, 0x76, 0x5d, 0x3e,
		0x4e, 0x5d, 0xa6, 0x7a, 0xfe,
	}

	masterKeyOnce sync.Once
	masterKey     []byte
)

func getFixedSalt() string {
	return Deobfuscate(maskedSalt, saltMaskKey)
}

// getMasterKey derives the legacy v1 key. It is only as secret as the host
// name and profile paths, which is why v1 is kept for reading and as a
// fallback on platforms without an OS key store.
func getMasterKey() []byte {
	masterKeyOnce.Do(func() {
		hostname, _ := os.Hostname()
		userHome, _ := os.UserHomeDir()
		userConfig, _ := os.UserConfigDir()

		salt := getFixedSalt()
		seed := fmt.Sprintf("%s|%s|%s|%s|%s", hostname, userHome, userConfig, runtime.GOOS, salt)
		hash := sha256.Sum256([]byte(seed))
		masterKey = make([]byte, 32)
		copy(masterKey, hash[:])
	})
	return masterKey
}

// IsEncrypted reports whether a stored value carries an encryption prefix.
func IsEncrypted(data string) bool {
	return strings.HasPrefix(data, encPrefix)
}

// EncryptString encrypts a plaintext string and returns a prefixed Base64
// string. Values that are already encrypted are returned unchanged so a
// ciphertext that could not be decrypted is never wrapped a second time.
func EncryptString(plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	if IsEncrypted(plaintext) {
		return plaintext, nil
	}

	if protected, err := protectWithOS([]byte(plaintext)); err == nil {
		return osProtectorPrefix + base64.StdEncoding.EncodeToString(protected), nil
	} else if !errors.Is(err, errNoOSProtector) {
		return "", fmt.Errorf("protect secret: %w", err)
	}
	return encryptV1(plaintext)
}

func encryptV1(plaintext string) (string, error) {
	gcm, err := newLegacyGCM()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return encPrefixV1 + base64.StdEncoding.EncodeToString(ciphertext), nil
}

func newLegacyGCM() (cipher.AEAD, error) {
	block, err := aes.NewCipher(getMasterKey())
	if err != nil {
		return nil, fmt.Errorf("create cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create GCM: %w", err)
	}
	return gcm, nil
}

// DecryptString decrypts a value produced by EncryptString. Legacy plaintext
// (no prefix) is returned as-is. Failures wrap ErrUndecryptable; callers must
// not treat the ciphertext itself as the secret.
func DecryptString(data string) (string, error) {
	if data == "" {
		return "", nil
	}
	switch {
	case strings.HasPrefix(data, osProtectorPrefix):
		raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(data, osProtectorPrefix))
		if err != nil {
			return "", fmt.Errorf("%w: decode base64: %v", ErrUndecryptable, err)
		}
		plain, err := unprotectWithOS(raw)
		if err != nil {
			return "", fmt.Errorf("%w: %v", ErrUndecryptable, err)
		}
		return string(plain), nil
	case strings.HasPrefix(data, encPrefixV2), strings.HasPrefix(data, encPrefixV3):
		// Sealed by the other OS family's key store (database copied between
		// Windows and macOS/Linux); only that store can open it.
		return "", fmt.Errorf("%w: value was protected by another operating system's key store", ErrUndecryptable)
	case strings.HasPrefix(data, encPrefixV1):
		raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(data, encPrefixV1))
		if err != nil {
			return "", fmt.Errorf("%w: decode base64: %v", ErrUndecryptable, err)
		}
		gcm, err := newLegacyGCM()
		if err != nil {
			return "", err
		}
		nonceSize := gcm.NonceSize()
		if len(raw) < nonceSize {
			return "", fmt.Errorf("%w: ciphertext too short", ErrUndecryptable)
		}
		nonce, ciphertext := raw[:nonceSize], raw[nonceSize:]
		plaintextBytes, err := gcm.Open(nil, nonce, ciphertext, nil)
		if err != nil {
			return "", fmt.Errorf("%w: %v", ErrUndecryptable, err)
		}
		return string(plaintextBytes), nil
	case IsEncrypted(data):
		return "", fmt.Errorf("%w: unknown format", ErrUndecryptable)
	default:
		// Backwards-compatibility: unencrypted legacy string
		return data, nil
	}
}
