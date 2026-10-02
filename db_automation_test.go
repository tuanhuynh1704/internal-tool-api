package main

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func newAutomationHistoryTestDB(t *testing.T) *DBManager {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	for _, statement := range []string{
		`CREATE TABLE ui_test_runs (id TEXT PRIMARY KEY, scenario_id TEXT, status TEXT, started_at TEXT, finished_at TEXT, duration INTEGER)`,
		`CREATE TABLE ui_test_results (id TEXT PRIMARY KEY, run_id TEXT, step_id TEXT, step_order INTEGER, status TEXT, error TEXT, duration INTEGER, screenshot_path TEXT, details TEXT)`,
		`CREATE TABLE scenario_test_runs (id TEXT PRIMARY KEY, scenario_id TEXT, status TEXT, started_at TEXT, finished_at TEXT, duration INTEGER)`,
		`CREATE TABLE scenario_test_results (id TEXT PRIMARY KEY, run_id TEXT, step_id TEXT, step_order INTEGER, status TEXT, duration INTEGER, method TEXT, url TEXT, http_status INTEGER, response_body TEXT, response_headers TEXT, assertion_details TEXT, extracted_vars TEXT, error TEXT)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	return &DBManager{db: db}
}

func TestUITestHistoryPreservesStepOrderAndDiagnostics(t *testing.T) {
	manager := newAutomationHistoryTestDB(t)
	err := manager.SaveUITestRun(DBUITestRun{ID: "run", ScenarioID: "scenario", Status: "FAILED", StartedAt: "start", FinishedAt: "end"}, []DBUITestResult{
		{ID: "result-10", RunID: "run", StepID: "ten", StepOrder: 10, Status: "FAILED", Details: "Trace artifact: trace.zip"},
		{ID: "result-2", RunID: "run", StepID: "two", StepOrder: 2, Status: "PASSED"},
	})
	if err != nil {
		t.Fatal(err)
	}
	results, err := manager.GetUITestResults("run")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 || results[0].StepID != "two" || results[1].Details != "Trace artifact: trace.zip" {
		t.Fatalf("unexpected persisted UI history: %+v", results)
	}
}

func TestScenarioHistoryPersistsAPIResults(t *testing.T) {
	manager := newAutomationHistoryTestDB(t)
	err := manager.SaveScenarioTestRun(DBScenarioTestRun{ID: "api-run", ScenarioID: "scenario", Status: "PASSED", StartedAt: "start", FinishedAt: "end", Duration: 25}, []DBScenarioTestResult{{ID: "api-result", RunID: "api-run", StepID: "step", StepOrder: 1, Status: "PASSED", Method: "GET", URL: "https://example.test", HTTPStatus: 200, AssertionDetails: "[]", ExtractedVars: "{}", ResponseHeaders: "{}"}})
	if err != nil {
		t.Fatal(err)
	}
	runs, err := manager.GetScenarioTestRuns("scenario")
	if err != nil || len(runs) != 1 || runs[0].Duration != 25 {
		t.Fatalf("unexpected runs: %+v, %v", runs, err)
	}
	results, err := manager.GetScenarioTestResults("api-run")
	if err != nil || len(results) != 1 || results[0].HTTPStatus != 200 {
		t.Fatalf("unexpected results: %+v, %v", results, err)
	}
}
