//go:build !windows

package security

import (
	"errors"
	"log"
	"sync"
	"testing"

	"github.com/zalando/go-keyring"
)

var errNoOSProtector = errors.New("no OS key store available")

// osProtectorPrefix marks values sealed by protectWithOS on this platform:
// AES-256-GCM under a master key kept in the macOS Keychain or the Linux
// Secret Service (GNOME Keyring, KWallet via libsecret).
const osProtectorPrefix = encPrefixV3

var (
	osKeyringOnce sync.Once
	osKeyring     *keyringCipher
	warnOnce      sync.Once
)

// systemKeyStore adapts go-keyring, which talks to /usr/bin/security on
// macOS (password passed on stdin) and to Secret Service over D-Bus on Linux.
type systemKeyStore struct{}

func (systemKeyStore) Get(service, account string) (string, error) {
	value, err := keyring.Get(service, account)
	if errors.Is(err, keyring.ErrNotFound) {
		return "", errKeyNotFound
	}
	return value, err
}

func (systemKeyStore) Set(service, account, secret string) error {
	return keyring.Set(service, account, secret)
}

func platformKeyring() *keyringCipher {
	osKeyringOnce.Do(func() {
		var store keyStore = systemKeyStore{}
		if testing.Testing() {
			store = &memoryKeyStore{}
		}
		osKeyring = newKeyringCipher(store)
	})
	return osKeyring
}

func protectWithOS(plaintext []byte) ([]byte, error) {
	blob, err := platformKeyring().seal(plaintext)
	if errors.Is(err, errNoOSProtector) {
		// Headless Linux without a Secret Service, denied Keychain access...:
		// EncryptString falls back to v1 so saving still works.
		warnOnce.Do(func() {
			log.Printf("[security] OS key store unavailable, using legacy encryption: %v", err)
		})
	}
	return blob, err
}

func unprotectWithOS(blob []byte) ([]byte, error) {
	return platformKeyring().open(blob)
}
