package antidebug

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"
	"time"
)

// SecurityThreat represents a detected debugging, tampering, or analysis attempt.
type SecurityThreat struct {
	Source    string    `json:"source"`
	Details   string    `json:"details"`
	Timestamp time.Time `json:"timestamp"`
}

// WatcherConfig defines behavior for background anti-debug monitoring.
type WatcherConfig struct {
	// Interval specifies how frequently checks are run (e.g. 3s - 5s).
	Interval time.Duration

	// AutoTerminate if true will immediately terminate the process upon detecting a debugger.
	AutoTerminate bool

	// OnThreatDetected callback triggered when a threat is identified.
	OnThreatDetected func(threats []SecurityThreat)
}

// DefaultConfig returns recommended production watcher configuration.
func DefaultConfig() WatcherConfig {
	return WatcherConfig{
		Interval: 3 * time.Second,
		// Killing the process loses unsaved work and punishes legitimate users
		// for running ordinary tooling; detections are reported, not enforced.
		AutoTerminate: false,
		OnThreatDetected: func(threats []SecurityThreat) {
			for _, t := range threats {
				log.Printf("[SECURITY ALERT] Anti-Reverse Engineering: %s (%s)", t.Source, t.Details)
			}
		},
	}
}

// Watcher continuously monitors process integrity and debugger presence.
type Watcher struct {
	config WatcherConfig
	ctx    context.Context
	cancel context.CancelFunc
	mu     sync.Mutex
	active bool
}

var (
	globalWatcher *Watcher
	globalOnce    sync.Once
)

// StartWatcher starts background anti-reverse engineering monitoring.
func StartWatcher(config WatcherConfig) *Watcher {
	globalOnce.Do(func() {
		ctx, cancel := context.WithCancel(context.Background())
		w := &Watcher{
			config: config,
			ctx:    ctx,
			cancel: cancel,
			active: true,
		}

		if w.config.Interval <= 0 {
			w.config.Interval = 3 * time.Second
		}

		// Apply process mitigation policies if on Windows
		EnableProcessMitigations()

		// Hide initial thread from debuggers
		HideCurrentThread()

		go w.runLoop()
		globalWatcher = w
	})
	return globalWatcher
}

// Stop stops the background watcher.
func (w *Watcher) Stop() {
	if w == nil {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.active && w.cancel != nil {
		w.cancel()
		w.active = false
	}
}

func (w *Watcher) runLoop() {
	ticker := time.NewTicker(w.config.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-w.ctx.Done():
			return
		case <-ticker.C:
			threats := CheckAll()
			if len(threats) > 0 {
				if w.config.OnThreatDetected != nil {
					w.config.OnThreatDetected(threats)
				}

				if w.config.AutoTerminate {
					// Self-defense termination: exit quietly to prevent debugger attachment
					log.Printf("[SECURITY] Critical anti-debug violation detected. Terminating process.")
					os.Exit(0)
				}
			}
		}
	}
}

// CheckAll executes all available anti-debugging and anti-analysis checks.
func CheckAll() []SecurityThreat {
	var threats []SecurityThreat

	// 1. Check Win32 Debugger APIs
	if detected, desc := CheckDebuggerAPIs(); detected {
		threats = append(threats, SecurityThreat{
			Source:    "DebuggerAPI",
			Details:   desc,
			Timestamp: time.Now(),
		})
	}

	// 2. Check Native NT Internal Ports & Flags (PEB / NtQueryInformationProcess)
	if detected, desc := CheckNtDebugInfo(); detected {
		threats = append(threats, SecurityThreat{
			Source:    "NtDebugInfo",
			Details:   desc,
			Timestamp: time.Now(),
		})
	}

	// 3. Check Blacklisted Debugging & Reversing Tools
	if detected, procName := CheckBlacklistedProcesses(); detected {
		threats = append(threats, SecurityThreat{
			Source:    "BlacklistedTool",
			Details:   fmt.Sprintf("Known reverse engineering tool active: %s", procName),
			Timestamp: time.Now(),
		})
	}

	// Hardware breakpoints are not part of the periodic sweep: Windows does not
	// return a reliable CONTEXT for the calling (running) thread, so the result
	// would be noise. CheckHardwareBreakpoints remains available for callers
	// that inspect another, suspended thread.

	return threats
}
