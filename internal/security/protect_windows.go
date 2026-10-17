//go:build windows

package security

import (
	"errors"
	"unsafe"

	"golang.org/x/sys/windows"
)

var errNoOSProtector = errors.New("no OS key store available")

// osProtectorPrefix marks values sealed by protectWithOS (DPAPI) on Windows.
const osProtectorPrefix = encPrefixV2

// dpapiEntropy separates this application's blobs from other DPAPI users of
// the same Windows account.
var dpapiEntropy = []byte("internal-api-client/secrets/v2")

func blobOf(data []byte) *windows.DataBlob {
	if len(data) == 0 {
		return &windows.DataBlob{}
	}
	return &windows.DataBlob{Size: uint32(len(data)), Data: &data[0]}
}

func takeBlob(blob windows.DataBlob) []byte {
	if blob.Data == nil {
		return nil
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(blob.Data)))
	return append([]byte(nil), unsafe.Slice(blob.Data, blob.Size)...)
}

// protectWithOS encrypts data with Windows DPAPI under the current user.
func protectWithOS(data []byte) ([]byte, error) {
	var out windows.DataBlob
	if err := windows.CryptProtectData(blobOf(data), nil, blobOf(dpapiEntropy), 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, err
	}
	return takeBlob(out), nil
}

func unprotectWithOS(data []byte) ([]byte, error) {
	var out windows.DataBlob
	if err := windows.CryptUnprotectData(blobOf(data), nil, blobOf(dpapiEntropy), 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, err
	}
	return takeBlob(out), nil
}
