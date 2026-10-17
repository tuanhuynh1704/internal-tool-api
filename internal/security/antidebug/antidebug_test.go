package antidebug

import (
	"testing"
	"time"
)

func TestCheckAll(t *testing.T) {
	// Execute CheckAll to ensure no panics or runtime faults occur
	threats := CheckAll()
	t.Logf("Detected %d threats during normal test run", len(threats))
	for _, threat := range threats {
		t.Logf("Threat: [%s] %s", threat.Source, threat.Details)
	}
}

func TestWatcherStartStop(t *testing.T) {
	var reportedThreats []SecurityThreat
	cfg := WatcherConfig{
		Interval:      50 * time.Millisecond,
		AutoTerminate: false, // Do not terminate during unit tests
		OnThreatDetected: func(threats []SecurityThreat) {
			reportedThreats = append(reportedThreats, threats...)
		},
	}

	w := StartWatcher(cfg)
	if w == nil {
		t.Fatal("Expected non-nil watcher")
	}

	time.Sleep(120 * time.Millisecond)
	w.Stop()

	// Stopping again should be safe and idempotent
	w.Stop()
}
