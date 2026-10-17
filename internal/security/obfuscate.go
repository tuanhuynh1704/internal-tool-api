package security

// Deobfuscate takes an XOR-masked byte slice and a key to reconstruct the original string.
// This prevents sensitive literals (salts, endpoints, keys) from appearing as plaintext
// in the compiled binary (e.g. visible via IDA Pro, Ghidra, strings utility).
func Deobfuscate(masked []byte, key []byte) string {
	if len(masked) == 0 || len(key) == 0 {
		return ""
	}
	res := make([]byte, len(masked))
	for i, b := range masked {
		res[i] = b ^ key[i%len(key)]
	}
	return string(res)
}

// Obfuscate masks a plaintext string using an XOR key.
func Obfuscate(plaintext string, key []byte) []byte {
	if len(plaintext) == 0 || len(key) == 0 {
		return nil
	}
	res := make([]byte, len(plaintext))
	for i := 0; i < len(plaintext); i++ {
		res[i] = plaintext[i] ^ key[i%len(key)]
	}
	return res
}

// WipeBytes securely overwrites a byte slice in memory with zeroes to mitigate RAM dumps.
func WipeBytes(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
