//go:build windows

package antidebug

import (
	"fmt"
	"runtime"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modKernel32 = windows.NewLazySystemDLL("kernel32.dll")
	modNtdll    = windows.NewLazySystemDLL("ntdll.dll")

	procIsDebuggerPresent         = modKernel32.NewProc("IsDebuggerPresent")
	procCheckRemoteDebugger       = modKernel32.NewProc("CheckRemoteDebuggerPresent")
	procSetProcessMitigation      = modKernel32.NewProc("SetProcessMitigationPolicy")
	procGetThreadContext          = modKernel32.NewProc("GetThreadContext")
	procNtQueryInformationProcess = modNtdll.NewProc("NtQueryInformationProcess")
	procNtSetInformationThread    = modNtdll.NewProc("NtSetInformationThread")

	// Blacklisted debugger / disassembler executable names (lowercase).
	// Network and system monitors (Fiddler, Wireshark, HTTP Debugger, Process
	// Hacker, ...) are deliberately absent: they are everyday tools for the
	// developers who use an API client, not evidence of reverse engineering.
	blacklistedTools = map[string]struct{}{
		"x64dbg.exe":               {},
		"x32dbg.exe":               {},
		"ida.exe":                  {},
		"ida64.exe":                {},
		"idag.exe":                 {},
		"idag64.exe":               {},
		"idaw.exe":                 {},
		"idaw64.exe":               {},
		"ghidra.exe":               {},
		"cheatengine-x86_64.exe":   {},
		"cheatengine-i386.exe":     {},
		"cheatengine.exe":          {},
		"dnspy.exe":                {},
		"scylla.exe":               {},
		"scylla_x64.exe":           {},
		"scylla_x86.exe":           {},
		"ollydbg.exe":              {},
		"immunitydebugger.exe":     {},
		"windbg.exe":               {},
	}
)

// CheckDebuggerAPIs checks standard Win32 debug detection APIs.
func CheckDebuggerAPIs() (bool, string) {
	// 1. IsDebuggerPresent
	if procIsDebuggerPresent.Find() == nil {
		r, _, _ := procIsDebuggerPresent.Call()
		if r != 0 {
			return true, "IsDebuggerPresent returned true (PEB BeingDebugged flag set)"
		}
	}

	// 2. CheckRemoteDebuggerPresent
	if procCheckRemoteDebugger.Find() == nil {
		var isRemoteDebugger int32
		currProc, _ := windows.GetCurrentProcess()
		r, _, _ := procCheckRemoteDebugger.Call(
			uintptr(currProc),
			uintptr(unsafe.Pointer(&isRemoteDebugger)),
		)
		if r != 0 && isRemoteDebugger != 0 {
			return true, "CheckRemoteDebuggerPresent returned true (external debugger attached)"
		}
	}

	return false, ""
}

// CheckNtDebugInfo queries native NT kernel debug flags and ports.
func CheckNtDebugInfo() (bool, string) {
	if procNtQueryInformationProcess.Find() != nil {
		return false, ""
	}

	currProc, _ := windows.GetCurrentProcess()

	// 1. ProcessDebugPort (Class 7)
	var debugPort uintptr
	var returnLength uint32
	status, _, _ := procNtQueryInformationProcess.Call(
		uintptr(currProc),
		7, // ProcessDebugPort
		uintptr(unsafe.Pointer(&debugPort)),
		unsafe.Sizeof(debugPort),
		uintptr(unsafe.Pointer(&returnLength)),
	)
	if status == 0 && debugPort != 0 {
		return true, fmt.Sprintf("NtQueryInformationProcess: ProcessDebugPort is non-zero (0x%x)", debugPort)
	}

	// 2. ProcessDebugFlags (Class 0x1f)
	var debugFlags uint32
	status, _, _ = procNtQueryInformationProcess.Call(
		uintptr(currProc),
		0x1f, // ProcessDebugFlags
		uintptr(unsafe.Pointer(&debugFlags)),
		unsafe.Sizeof(debugFlags),
		uintptr(unsafe.Pointer(&returnLength)),
	)
	// When being debugged, ProcessDebugFlags returns 0
	if status == 0 && debugFlags == 0 {
		return true, "NtQueryInformationProcess: ProcessDebugFlags indicates active debugging"
	}

	// 3. ProcessDebugObjectHandle (Class 0x1e)
	var debugObjectHandle uintptr
	status, _, _ = procNtQueryInformationProcess.Call(
		uintptr(currProc),
		0x1e, // ProcessDebugObjectHandle
		uintptr(unsafe.Pointer(&debugObjectHandle)),
		unsafe.Sizeof(debugObjectHandle),
		uintptr(unsafe.Pointer(&returnLength)),
	)
	if status == 0 && debugObjectHandle != 0 {
		return true, fmt.Sprintf("NtQueryInformationProcess: ProcessDebugObjectHandle is present (0x%x)", debugObjectHandle)
	}

	return false, ""
}

// CheckBlacklistedProcesses enumerates system processes to detect running reversing/debugging tools.
func CheckBlacklistedProcesses() (bool, string) {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return false, ""
	}
	defer windows.CloseHandle(snapshot)

	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))

	if err := windows.Process32First(snapshot, &entry); err != nil {
		return false, ""
	}

	for {
		name := strings.ToLower(windows.UTF16ToString(entry.ExeFile[:]))
		if _, found := blacklistedTools[name]; found {
			return true, name
		}

		if err := windows.Process32Next(snapshot, &entry); err != nil {
			break
		}
	}

	return false, ""
}

// CheckHardwareBreakpoints inspects CPU debug registers (Dr0 - Dr3) on the current thread.
func CheckHardwareBreakpoints() (bool, string) {
	if procGetThreadContext.Find() != nil {
		return false, ""
	}

	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	currThread, err := windows.GetCurrentThread()
	if err != nil {
		return false, ""
	}

	// Context structure covering debug registers on x86_64
	type contextX64 struct {
		P1Home, P2Home, P3Home, P4Home, P5Home, P6Home uint64
		ContextFlags                                   uint32
		MxCsr                                          uint32
		SegCs, SegDs, SegEs, SegFs, SegGs, SegSs       uint16
		EFlags                                         uint32
		Dr0, Dr1, Dr2, Dr3, Dr6, Dr7                   uint64
		// Remainder omitted; buffer padded to standard size
		Padding [512]byte
	}

	var ctx contextX64
	// CONTEXT_DEBUG_REGISTERS = 0x00010010
	ctx.ContextFlags = 0x00010010

	r, _, _ := procGetThreadContext.Call(
		uintptr(currThread),
		uintptr(unsafe.Pointer(&ctx)),
	)
	if r != 0 {
		if ctx.Dr0 != 0 || ctx.Dr1 != 0 || ctx.Dr2 != 0 || ctx.Dr3 != 0 {
			return true, fmt.Sprintf("Hardware breakpoint detected: Dr0=0x%x Dr1=0x%x Dr2=0x%x Dr3=0x%x",
				ctx.Dr0, ctx.Dr1, ctx.Dr2, ctx.Dr3)
		}
	}

	return false, ""
}

// HideCurrentThread informs the kernel to detach and hide the current thread from any debugger.
func HideCurrentThread() {
	if procNtSetInformationThread.Find() != nil {
		return
	}

	currThread, err := windows.GetCurrentThread()
	if err != nil {
		return
	}

	// ThreadHideFromDebugger = 0x11
	_, _, _ = procNtSetInformationThread.Call(
		uintptr(currThread),
		0x11,
		0,
		0,
	)
}

// EnableProcessMitigations activates Windows Exploit Guard mitigation policies.
func EnableProcessMitigations() {
	if procSetProcessMitigation.Find() != nil {
		return
	}

	// ProcessStrictHandleCheckPolicy = 3
	// Flags: RaiseExceptionOnInvalidHandleBit = 1
	var strictHandlePolicy uint32 = 1
	_, _, _ = procSetProcessMitigation.Call(
		3,
		uintptr(unsafe.Pointer(&strictHandlePolicy)),
		unsafe.Sizeof(strictHandlePolicy),
	)
}
