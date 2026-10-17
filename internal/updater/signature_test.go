package updater

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newTestKey(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return pub, priv
}

func testManifest(version string) []byte {
	return []byte(fmt.Sprintf(`{"version":%q,"platforms":{%q:{"url":"https://github.com/o/r/releases/download/v%s/app","sha256":"%s"}}}`,
		version, CurrentPlatformKey(), version, bytes.Repeat([]byte("a"), 64)))
}

// serveManifest serves latest.json and, when sig is non-nil, latest.json.sig.
func serveManifest(t *testing.T, manifest, sig []byte) string {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/releases/latest/download/latest.json", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(manifest)
	})
	if sig != nil {
		mux.HandleFunc("/releases/latest/download/latest.json.sig", func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write(sig)
		})
	}
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv.URL + "/releases/latest/download/latest.json"
}

func TestTrustedManifestKeysAreValid(t *testing.T) {
	keys, err := TrustedManifestKeys()
	if err != nil {
		t.Fatalf("embedded keys: %v", err)
	}
	if len(keys) == 0 {
		t.Fatal("no trusted keys")
	}
}

func TestCheckForUpdateAcceptsSignedManifest(t *testing.T) {
	pub, priv := newTestKey(t)
	manifest := testManifest("9.0.0")
	url := serveManifest(t, manifest, SignManifest(manifest, priv))

	info, err := checkForUpdate(http.DefaultClient, url, "1.0.0", []ed25519.PublicKey{pub})
	if err != nil {
		t.Fatalf("signed manifest rejected: %v", err)
	}
	if info == nil || info.Version != "9.0.0" {
		t.Fatalf("unexpected update info: %+v", info)
	}
}

func TestCheckForUpdateRejectsUnsignedOrForgedManifests(t *testing.T) {
	pub, priv := newTestKey(t)
	_, otherPriv := newTestKey(t)
	manifest := testManifest("9.0.0")
	signature := SignManifest(manifest, priv)

	tampered := bytes.Replace(manifest, []byte("aaaa"), []byte("bbbb"), 1)

	cases := map[string]string{
		"missing signature": serveManifest(t, manifest, nil),
		"tampered manifest": serveManifest(t, tampered, signature),
		"untrusted key":     serveManifest(t, manifest, SignManifest(manifest, otherPriv)),
		"garbage signature": serveManifest(t, manifest, []byte("not-a-signature")),
		"empty signature":   serveManifest(t, manifest, []byte("")),
	}
	for name, url := range cases {
		info, err := checkForUpdate(http.DefaultClient, url, "1.0.0", []ed25519.PublicKey{pub})
		if !errors.Is(err, ErrManifestSignature) || info != nil {
			t.Errorf("%s: expected ErrManifestSignature, got info=%+v err=%v", name, info, err)
		}
	}
}

func TestVerifyManifestSignatureSupportsKeyRotation(t *testing.T) {
	oldPub, _ := newTestKey(t)
	newPub, newPriv := newTestKey(t)
	manifest := testManifest("2.0.0")
	sig := SignManifest(manifest, newPriv)
	if err := VerifyManifestSignature(manifest, sig, []ed25519.PublicKey{oldPub, newPub}); err != nil {
		t.Fatalf("signature by second trusted key rejected: %v", err)
	}
	// Signature files are tolerant of trailing whitespace/CRLF from editors.
	if err := VerifyManifestSignature(manifest, append(bytes.TrimSpace(sig), '\r', '\n'), []ed25519.PublicKey{newPub}); err != nil {
		t.Fatalf("CRLF-terminated signature rejected: %v", err)
	}
}

func TestParsePrivateKeyFormats(t *testing.T) {
	_, priv := newTestKey(t)
	for name, encoded := range map[string]string{
		"seed":     base64.StdEncoding.EncodeToString(priv.Seed()),
		"full key": base64.StdEncoding.EncodeToString(priv),
		"newline":  base64.StdEncoding.EncodeToString(priv.Seed()) + "\n",
	} {
		got, err := ParsePrivateKey(encoded)
		if err != nil || !bytes.Equal(got, priv) {
			t.Errorf("%s: ParsePrivateKey = %v", name, err)
		}
	}

	inconsistent := bytes.Clone(priv)
	inconsistent[40] ^= 1 // corrupt the public half
	for name, encoded := range map[string]string{
		"not base64":   "%%%",
		"wrong length": base64.StdEncoding.EncodeToString([]byte("short")),
		"inconsistent": base64.StdEncoding.EncodeToString(inconsistent),
	} {
		if _, err := ParsePrivateKey(encoded); err == nil {
			t.Errorf("%s: invalid key accepted", name)
		}
	}
}

func TestSignatureURL(t *testing.T) {
	got, err := SignatureURL("https://github.com/o/r/releases/latest/download/latest.json")
	if err != nil || got != "https://github.com/o/r/releases/latest/download/latest.json.sig" {
		t.Fatalf("SignatureURL = %q, %v", got, err)
	}
}
