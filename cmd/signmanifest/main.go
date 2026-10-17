// Command signmanifest creates and checks the detached Ed25519 signature of
// the update manifest (latest.json → latest.json.sig).
//
//	go run ./cmd/signmanifest -genkey -private-out <file>   # new key pair
//	go run ./cmd/signmanifest -in dist/latest.json            # sign (CI)
//	go run ./cmd/signmanifest -verify -in dist/latest.json    # check
//
// Signing reads the private key from the UPDATE_SIGNING_KEY environment
// variable and refuses to write a signature the app would not accept, so a
// wrong CI secret fails the release instead of shipping a dead update.
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"os"

	"internal-api-client/internal/updater"
)

func main() {
	genkey := flag.Bool("genkey", false, "generate a new key pair")
	privateOut := flag.String("private-out", "", "with -genkey: file to write the private key to (must not exist)")
	verify := flag.Bool("verify", false, "verify -in against -sig with the app's trusted keys")
	in := flag.String("in", "", "manifest file (latest.json)")
	sigPath := flag.String("sig", "", "signature file (default: <in>.sig)")
	keyEnv := flag.String("key-env", "UPDATE_SIGNING_KEY", "environment variable holding the base64 private key")
	flag.Parse()

	var err error
	switch {
	case *genkey:
		err = generate(*privateOut)
	case *in == "":
		err = errors.New("-in is required")
	default:
		if *sigPath == "" {
			*sigPath = *in + updater.SignatureSuffix
		}
		if *verify {
			err = verifyFile(*in, *sigPath)
		} else {
			err = sign(*in, *sigPath, os.Getenv(*keyEnv), *keyEnv)
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "signmanifest:", err)
		os.Exit(1)
	}
}

func generate(privateOut string) error {
	if privateOut == "" {
		return errors.New("-genkey needs -private-out <file>; the private key is never printed")
	}
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(privateOut, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("write private key: %w", err)
	}
	if _, err = fmt.Fprintln(f, base64.StdEncoding.EncodeToString(priv.Seed())); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	fmt.Println("Private key written to", privateOut)
	fmt.Println("Store its content as the GitHub Actions secret UPDATE_SIGNING_KEY, keep an offline backup, then delete the file.")
	fmt.Println("Public key (add to trustedManifestKeys in internal/updater/signature.go):")
	fmt.Println(base64.StdEncoding.EncodeToString(pub))
	return nil
}

func sign(in, out, encodedKey, keyEnv string) error {
	if encodedKey == "" {
		return fmt.Errorf("environment variable %s is empty; refusing to publish an unsigned manifest", keyEnv)
	}
	key, err := updater.ParsePrivateKey(encodedKey)
	if err != nil {
		return err
	}
	manifest, err := os.ReadFile(in)
	if err != nil {
		return err
	}
	signature := updater.SignManifest(manifest, key)

	trusted, err := updater.TrustedManifestKeys()
	if err != nil {
		return err
	}
	if err = updater.VerifyManifestSignature(manifest, signature, trusted); err != nil {
		return fmt.Errorf("%s does not match any public key embedded in the app (%v); update trustedManifestKeys or the secret", keyEnv, err)
	}
	if err = os.WriteFile(out, signature, 0o644); err != nil {
		return err
	}
	fmt.Println("Signed", in, "→", out)
	return nil
}

func verifyFile(in, sigPath string) error {
	manifest, err := os.ReadFile(in)
	if err != nil {
		return err
	}
	signature, err := os.ReadFile(sigPath)
	if err != nil {
		return err
	}
	trusted, err := updater.TrustedManifestKeys()
	if err != nil {
		return err
	}
	if err = updater.VerifyManifestSignature(manifest, signature, trusted); err != nil {
		return err
	}
	fmt.Println("Signature OK:", in)
	return nil
}
