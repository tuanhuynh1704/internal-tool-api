package main

import (
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// waitForProcessExitFn can be swapped by OS-specific init() functions.
// Default is a cross-platform polling implementation.
var waitForProcessExitFn = waitForProcessExitPolling

// healthWindow is how long the freshly installed app must keep running before
// the backup of the previous version is discarded.
const healthWindow = 8 * time.Second

func main() {
	pid := flag.Int("pid", 0, "PID of the application to wait for")
	source := flag.String("source", "", "Path to the downloaded new binary")
	target := flag.String("target", "", "Path to the current application executable")
	newTarget := flag.String("new-target", "", "Path to the new renamed executable file (optional, defaults to target)")
	expectedSHA := flag.String("sha256", "", "Expected SHA-256 of the downloaded binary")
	flag.Parse()

	if *pid == 0 || *source == "" || *target == "" || *expectedSHA == "" {
		log.Fatal("[updater] missing required flags: --pid, --source, --target, --sha256")
	}

	finalTarget := *target
	if *newTarget != "" {
		finalTarget = *newTarget
	}

	logf("[updater] starting — waiting for app PID=%d to exit (target=%s, newTarget=%s)", *pid, *target, finalTarget)

	// ── Step 1: Wait for the application to exit ────────────────────────────
	if err := waitForProcessExitFn(*pid, 60*time.Second); err != nil {
		// The executable is still locked; replacing it now would fail half-way.
		logf("[updater] ERROR: %v — aborting update", err)
		os.Exit(1)
	}
	logf("[updater] app process has exited")

	// Small extra pause on Windows to ensure all file handles are released.
	if runtime.GOOS == "windows" {
		time.Sleep(500 * time.Millisecond)
	}

	// ── Step 2: Verify the downloaded binary right before installing ────────
	if err := verifySHA256(*source, *expectedSHA); err != nil {
		logf("[updater] ERROR: %v — refusing to install", err)
		_ = os.Remove(*source)
		os.Exit(1)
	}

	// ── Step 3: Stage the new binary next to the target ──────────────────────
	staged := finalTarget + ".new"
	if err := copyFile(*source, staged); err != nil {
		logf("[updater] ERROR: could not stage new binary: %v", err)
		_ = os.Remove(staged)
		os.Exit(1)
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(staged, 0o755); err != nil {
			logf("[updater] WARNING: chmod %s: %v", staged, err)
		}
	}

	// ── Step 4: Swap by rename (atomic per file) ─────────────────────────────
	backup := *target + ".bak"
	_ = os.Remove(backup)
	if err := renameWithRetry(*target, backup); err != nil {
		logf("[updater] ERROR: could not move old binary aside: %v", err)
		_ = os.Remove(staged)
		os.Exit(1)
	}
	if err := renameWithRetry(staged, finalTarget); err != nil {
		logf("[updater] ERROR: install failed: %v — rolling back", err)
		_ = os.Remove(staged)
		rollback(backup, *target, finalTarget)
		os.Exit(1)
	}

	// ── Step 5: Restart and confirm the new version stays up ─────────────────
	logf("[updater] launching updated app: %s", finalTarget)
	cmd := exec.Command(finalTarget)
	if err := cmd.Start(); err != nil {
		logf("[updater] ERROR: could not start new app: %v — rolling back", err)
		rollback(backup, *target, finalTarget)
		restartOld(*target)
		os.Exit(1)
	}
	logf("[updater] new app started (PID=%d)", cmd.Process.Pid)

	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	select {
	case err := <-exited:
		logf("[updater] ERROR: new app exited within %s (%v) — rolling back", healthWindow, err)
		rollback(backup, *target, finalTarget)
		restartOld(*target)
		os.Exit(1)
	case <-time.After(healthWindow):
	}

	// ── Step 6: Cleanup ──────────────────────────────────────────────────────
	_ = removeFileWithRetry(backup)
	_ = removeFileWithRetry(*source)
	logf("[updater] cleanup done — exiting")
}

func verifySHA256(path, expected string) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open downloaded binary: %w", err)
	}
	defer file.Close()
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return fmt.Errorf("hash downloaded binary: %w", err)
	}
	actual := hex.EncodeToString(hasher.Sum(nil))
	if want := strings.ToLower(strings.TrimSpace(expected)); actual != want {
		return fmt.Errorf("SHA-256 mismatch: expected %s, got %s", want, actual)
	}
	return nil
}

// waitForProcessExitPolling is the default cross-platform implementation.
// It polls at 200ms intervals until the process is gone or timeout elapses.
func waitForProcessExitPolling(pid int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		proc, err := os.FindProcess(pid)
		if err != nil {
			return nil // Process not found — already gone.
		}
		// On Unix, Signal(nil) checks liveness without disturbing the process.
		// On Windows, FindProcess always succeeds even for dead processes,
		// so the Windows init() overrides this function with a proper Wait.
		if runtime.GOOS != "windows" {
			if signalErr := proc.Signal(syscallSignal(0)); signalErr != nil {
				return nil
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("timed out waiting for PID %d to exit after %s", pid, timeout)
}

// copyFile copies src to dst using streaming I/O with retries for temporary file locks.
func copyFile(src, dst string) error {
	var lastErr error
	for attempt := 1; attempt <= 10; attempt++ {
		err := func() error {
			in, err := os.Open(src)
			if err != nil {
				return fmt.Errorf("open source: %w", err)
			}
			defer in.Close()

			out, err := os.Create(dst)
			if err != nil {
				return fmt.Errorf("create destination: %w", err)
			}
			defer out.Close()

			if _, err = io.Copy(out, in); err != nil {
				return fmt.Errorf("copy: %w", err)
			}
			return out.Sync()
		}()

		if err == nil {
			return nil
		}
		lastErr = err
		time.Sleep(300 * time.Millisecond)
	}
	return fmt.Errorf("failed after 10 attempts: %w", lastErr)
}

func renameWithRetry(src, dst string) error {
	var lastErr error
	for attempt := 1; attempt <= 15; attempt++ {
		if err := os.Rename(src, dst); err == nil {
			return nil
		} else {
			lastErr = err
		}
		time.Sleep(300 * time.Millisecond)
	}
	return lastErr
}

// rollback restores the previous binary from its backup. Best-effort.
func rollback(backup, target, finalTarget string) {
	logf("[updater] rolling back: %s → %s", backup, target)
	if finalTarget != target {
		_ = os.Remove(finalTarget)
	} else {
		_ = os.Remove(target)
	}
	if err := renameWithRetry(backup, target); err != nil {
		logf("[updater] CRITICAL: rollback failed: %v — app may be broken!", err)
		return
	}
	logf("[updater] rollback successful")
}

func restartOld(target string) {
	if err := exec.Command(target).Start(); err != nil {
		logf("[updater] could not restart previous version: %v", err)
	}
}

func logf(format string, args ...any) {
	log.Printf(format, args...)
}

func removeFileWithRetry(path string) error {
	var lastErr error
	for attempt := 1; attempt <= 15; attempt++ {
		err := os.Remove(path)
		if err == nil || os.IsNotExist(err) {
			return nil
		}
		lastErr = err
		time.Sleep(300 * time.Millisecond)
	}
	return lastErr
}
