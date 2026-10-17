package security

import (
	"bytes"
	"encoding/base64"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// scriptedStore is a keyStore whose behaviour each test controls.
type scriptedStore struct {
	memoryKeyStore
	getErr error
	setErr error
	delay  time.Duration
	gets   atomic.Int32
	sets   atomic.Int32
}

func (s *scriptedStore) Get(service, account string) (string, error) {
	s.gets.Add(1)
	time.Sleep(s.delay)
	if s.getErr != nil {
		return "", s.getErr
	}
	return s.memoryKeyStore.Get(service, account)
}

func (s *scriptedStore) Set(service, account, secret string) error {
	s.sets.Add(1)
	if s.setErr != nil {
		return s.setErr
	}
	return s.memoryKeyStore.Set(service, account, secret)
}

func TestKeyringCipherCreatesKeyOnceAndRoundTrips(t *testing.T) {
	store := &scriptedStore{}
	c := newKeyringCipher(store)

	first, err := c.seal([]byte("token-1"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := c.seal([]byte("token-2"))
	if err != nil {
		t.Fatal(err)
	}
	if store.sets.Load() != 1 {
		t.Fatalf("master key stored %d times, want 1", store.sets.Load())
	}

	// A new process (fresh cipher) reuses the stored key instead of creating one.
	reopened := newKeyringCipher(store)
	for blob, want := range map[string]string{string(first): "token-1", string(second): "token-2"} {
		got, err := reopened.open([]byte(blob))
		if err != nil || string(got) != want {
			t.Fatalf("open = %q, %v; want %q", got, err, want)
		}
	}
	if store.sets.Load() != 1 {
		t.Fatalf("reopening created a new key")
	}
}

func TestKeyringCipherNeverOverwritesKeyWhenStoreFails(t *testing.T) {
	store := &scriptedStore{getErr: errors.New("keyring is locked")}
	c := newKeyringCipher(store)

	if _, err := c.seal([]byte("x")); !errors.Is(err, errNoOSProtector) {
		t.Fatalf("expected errNoOSProtector so the caller falls back, got %v", err)
	}
	if store.sets.Load() != 0 {
		t.Fatal("a locked store must not get a freshly generated key (existing secrets would be lost)")
	}
	// The failure is cached: the store is not asked again for every secret.
	_, _ = c.seal([]byte("y"))
	if store.gets.Load() != 1 {
		t.Fatalf("store queried %d times, want 1", store.gets.Load())
	}
}

func TestKeyringCipherRejectsMalformedStoredKey(t *testing.T) {
	store := &scriptedStore{}
	_ = store.memoryKeyStore.Set(keyringService, keyringAccount, base64.StdEncoding.EncodeToString([]byte("short")))
	c := newKeyringCipher(store)

	if _, err := c.seal([]byte("x")); !errors.Is(err, errNoOSProtector) {
		t.Fatalf("expected errNoOSProtector, got %v", err)
	}
	if store.sets.Load() != 0 {
		t.Fatal("a malformed key must be reported, not replaced")
	}
}

func TestKeyringCipherFailedSetFallsBack(t *testing.T) {
	store := &scriptedStore{setErr: errors.New("user denied access")}
	if _, err := newKeyringCipher(store).seal([]byte("x")); !errors.Is(err, errNoOSProtector) {
		t.Fatalf("expected errNoOSProtector, got %v", err)
	}
}

func TestKeyringCipherTimesOut(t *testing.T) {
	store := &scriptedStore{delay: time.Second}
	c := newKeyringCipher(store)
	c.timeout = 20 * time.Millisecond

	start := time.Now()
	_, err := c.seal([]byte("x"))
	if !errors.Is(err, errNoOSProtector) || !strings.Contains(err.Error(), "did not respond") {
		t.Fatalf("expected timeout error, got %v", err)
	}
	if time.Since(start) > 500*time.Millisecond {
		t.Fatal("seal waited for the unresponsive store")
	}
}

func TestKeyringCipherDetectsTampering(t *testing.T) {
	c := newKeyringCipher(&scriptedStore{})
	blob, err := c.seal([]byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	tampered := bytes.Clone(blob)
	tampered[len(tampered)-1] ^= 1
	if _, err := c.open(tampered); err == nil {
		t.Fatal("tampered ciphertext was accepted")
	}
	if _, err := c.open(blob[:4]); err == nil {
		t.Fatal("truncated ciphertext was accepted")
	}
	// Ciphertext from another key (another user/machine) does not open.
	if _, err := newKeyringCipher(&scriptedStore{}).open(blob); err == nil {
		t.Fatal("ciphertext opened under a different master key")
	}
}
