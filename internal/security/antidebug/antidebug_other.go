//go:build !windows

package antidebug

// CheckDebuggerAPIs stub for non-Windows systems.
func CheckDebuggerAPIs() (bool, string) {
	return false, ""
}

// CheckNtDebugInfo stub for non-Windows systems.
func CheckNtDebugInfo() (bool, string) {
	return false, ""
}

// CheckBlacklistedProcesses stub for non-Windows systems.
func CheckBlacklistedProcesses() (bool, string) {
	return false, ""
}

// CheckHardwareBreakpoints stub for non-Windows systems.
func CheckHardwareBreakpoints() (bool, string) {
	return false, ""
}

// HideCurrentThread stub for non-Windows systems.
func HideCurrentThread() {}

// EnableProcessMitigations stub for non-Windows systems.
func EnableProcessMitigations() {}
