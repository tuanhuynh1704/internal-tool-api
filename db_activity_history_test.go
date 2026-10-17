package main

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func newActivityHistoryTestDB(t *testing.T) *DBManager {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	for _, statement := range []string{
		`CREATE TABLE activity_history (
			id TEXT PRIMARY KEY,
			method TEXT NOT NULL,
			url TEXT NOT NULL,
			status INTEGER NOT NULL,
			duration INTEGER NOT NULL,
			timestamp TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE app_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	return &DBManager{db: db}
}

func TestActivityHistoryCRUD(t *testing.T) {
	manager := newActivityHistoryTestDB(t)

	// 1. Add history item
	item1 := DBActivityHistory{
		ID:        "hist_1",
		Method:    "GET",
		URL:       "https://api.example.com/posts/1",
		Status:    200,
		Duration:  120,
		Timestamp: "10:00:00 AM",
	}
	if err := manager.SaveActivityHistory(item1); err != nil {
		t.Fatalf("SaveActivityHistory failed: %v", err)
	}

	item2 := DBActivityHistory{
		ID:        "hist_2",
		Method:    "POST",
		URL:       "https://api.example.com/posts",
		Status:    201,
		Duration:  250,
		Timestamp: "10:05:00 AM",
	}
	if err := manager.SaveActivityHistory(item2); err != nil {
		t.Fatalf("SaveActivityHistory failed: %v", err)
	}

	// 2. Fetch history
	history, err := manager.GetActivityHistory(10)
	if err != nil {
		t.Fatalf("GetActivityHistory failed: %v", err)
	}
	if len(history) != 2 {
		t.Fatalf("expected 2 items, got %d", len(history))
	}

	// 3. Delete single item
	if err := manager.DeleteActivityHistory("hist_1"); err != nil {
		t.Fatalf("DeleteActivityHistory failed: %v", err)
	}
	historyAfterDel, err := manager.GetActivityHistory(10)
	if err != nil {
		t.Fatalf("GetActivityHistory failed: %v", err)
	}
	if len(historyAfterDel) != 1 || historyAfterDel[0].ID != "hist_2" {
		t.Fatalf("expected 1 item with id hist_2, got %+v", historyAfterDel)
	}

	// 4. Clear all history
	if err := manager.ClearActivityHistory(); err != nil {
		t.Fatalf("ClearActivityHistory failed: %v", err)
	}
	historyCleared, err := manager.GetActivityHistory(10)
	if err != nil {
		t.Fatalf("GetActivityHistory failed: %v", err)
	}
	if len(historyCleared) != 0 {
		t.Fatalf("expected 0 items after clear, got %d", len(historyCleared))
	}
}

func TestWorkspaceSessionPersistence(t *testing.T) {
	manager := newActivityHistoryTestDB(t)

	session := DBWorkspaceSession{
		ActiveTabID:      "req_login",
		OpenTabIDs:       []string{"req_login", "req_profile", "req_checkout"},
		ActiveEnvID:      "env_staging",
		ActiveProjectID:  "proj_mobile",
		ActiveSidebarTab: "history",
	}

	// Save session
	if err := manager.SaveWorkspaceSession(session); err != nil {
		t.Fatalf("SaveWorkspaceSession failed: %v", err)
	}

	// Load session
	loaded, err := manager.GetWorkspaceSession()
	if err != nil {
		t.Fatalf("GetWorkspaceSession failed: %v", err)
	}

	if loaded.ActiveTabID != "req_login" {
		t.Fatalf("expected activeTabId req_login, got %s", loaded.ActiveTabID)
	}
	if len(loaded.OpenTabIDs) != 3 || loaded.OpenTabIDs[1] != "req_profile" {
		t.Fatalf("expected 3 open tab ids with req_profile at index 1, got %+v", loaded.OpenTabIDs)
	}
	if loaded.ActiveEnvID != "env_staging" {
		t.Fatalf("expected activeEnvId env_staging, got %s", loaded.ActiveEnvID)
	}
	if loaded.ActiveProjectID != "proj_mobile" {
		t.Fatalf("expected activeProjectId proj_mobile, got %s", loaded.ActiveProjectID)
	}
	if loaded.ActiveSidebarTab != "history" {
		t.Fatalf("expected activeSidebarTab history, got %s", loaded.ActiveSidebarTab)
	}
}
