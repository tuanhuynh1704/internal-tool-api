package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"
)

const (
	keyringService = "internal-api-client"
	keyringAccount = "secrets-master-key-v3"
	// keyringTimeout bounds a key store call. Unlocking a Secret Service
	// collection can show a password prompt, so this is generous; a store
	// that never answers must still not hang the app forever.
	keyringTimeout = 2 * time.Minute
)

// keyringAAD binds v3 ciphertexts to this application and format version.
var keyringAAD = []byte("internal-api-client/secrets/v3")

// errKeyNotFound is what a keyStore returns when no key has been stored yet.
// Any other error means the store is unavailable or refused access, and the
// key must not be regenerated (that would orphan every existing secret).
var errKeyNotFound = errors.New("key not found in key store")

// keyStore is the subset of an OS credential store (macOS Keychain, Linux
// Secret Service/libsecret) needed to keep one master key.
type keyStore interface {
	Get(service, account string) (string, error)
	Set(service, account, secret string) error
}

// keyringCipher encrypts secrets with AES-256-GCM under a random master key
// that lives in the OS credential store, so the database alone (or the
// machine's public identifiers) is not enough to decrypt them.
type keyringCipher struct {
	store   keyStore
	timeout time.Duration

	once sync.Once
	aead cipher.AEAD
	err  error
}

func newKeyringCipher(store keyStore) *keyringCipher {
	return &keyringCipher{store: store, timeout: keyringTimeout}
}

// cipher loads (or on first use creates) the master key. The outcome is
// cached for the process lifetime so a locked or missing store is asked once,
// not once per secret.
func (k *keyringCipher) cipher() (cipher.AEAD, error) {
	k.once.Do(func() {
		key, err := k.loadOrCreateKey()
		if err != nil {
			k.err = fmt.Errorf("%w: %v", errNoOSProtector, err)
			return
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			k.err = fmt.Errorf("create cipher: %w", err)
			return
		}
		k.aead, k.err = cipher.NewGCM(block)
	})
	return k.aead, k.err
}

func (k *keyringCipher) loadOrCreateKey() ([]byte, error) {
	stored, err := k.get()
	if err == nil {
		return decodeMasterKey(stored)
	}
	if !errors.Is(err, errKeyNotFound) {
		return nil, err
	}

	key := make([]byte, 32)
	if _, err = io.ReadFull(rand.Reader, key); err != nil {
		return nil, fmt.Errorf("generate master key: %w", err)
	}
	if err = k.call(func() error {
		return k.store.Set(keyringService, keyringAccount, base64.StdEncoding.EncodeToString(key))
	}); err != nil {
		return nil, fmt.Errorf("store master key: %w", err)
	}
	// Read back instead of trusting the local copy: if another instance
	// created a key at the same moment, every process must use the stored one.
	stored, err = k.get()
	if err != nil {
		return nil, fmt.Errorf("read back master key: %w", err)
	}
	return decodeMasterKey(stored)
}

func (k *keyringCipher) get() (string, error) {
	var value string
	err := k.call(func() error {
		var err error
		value, err = k.store.Get(keyringService, keyringAccount)
		return err
	})
	return value, err
}

// call runs one key store operation with a timeout.
func (k *keyringCipher) call(op func() error) error {
	done := make(chan error, 1)
	go func() { done <- op() }()
	select {
	case err := <-done:
		return err
	case <-time.After(k.timeout):
		return fmt.Errorf("key store did not respond within %s", k.timeout)
	}
}

func decodeMasterKey(stored string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(stored)
	if err != nil {
		return nil, fmt.Errorf("stored master key is not base64: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("stored master key has %d bytes, want 32", len(key))
	}
	return key, nil
}

func (k *keyringCipher) seal(plaintext []byte) ([]byte, error) {
	aead, err := k.cipher()
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generate nonce: %w", err)
	}
	return aead.Seal(nonce, nonce, plaintext, keyringAAD), nil
}

func (k *keyringCipher) open(blob []byte) ([]byte, error) {
	aead, err := k.cipher()
	if err != nil {
		return nil, err
	}
	if len(blob) < aead.NonceSize() {
		return nil, errors.New("ciphertext too short")
	}
	nonce, ciphertext := blob[:aead.NonceSize()], blob[aead.NonceSize():]
	return aead.Open(nil, nonce, ciphertext, keyringAAD)
}

// memoryKeyStore keeps the master key in process memory. Tests use it so
// `go test` never writes into the developer's real Keychain/keyring.
type memoryKeyStore struct {
	mu     sync.Mutex
	values map[string]string
}

func (m *memoryKeyStore) Get(service, account string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	value, ok := m.values[service+"\x00"+account]
	if !ok {
		return "", errKeyNotFound
	}
	return value, nil
}

func (m *memoryKeyStore) Set(service, account, secret string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.values == nil {
		m.values = map[string]string{}
	}
	m.values[service+"\x00"+account] = secret
	return nil
}
