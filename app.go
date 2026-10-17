package main

import (
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"internal-api-client/core"
	coreui "internal-api-client/core/ui"
	"internal-api-client/internal/security"
	"internal-api-client/internal/security/antidebug"
	"internal-api-client/internal/updater"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Obfuscated manifest URL to prevent plaintext search in compiled binary (.rdata)
var (
	manifestURLMaskKey = []byte{0x4D, 0x92, 0x1B, 0x7E, 0x83, 0x5C, 0xA1, 0x3F}
	manifestURLMasked  = []byte{
		0x25, 0xe6, 0x6f, 0xe, 0xf0, 0x66, 0x8e, 0x10,
		0x2a, 0xfb, 0x6f, 0x16, 0xf6, 0x3e, 0x8f, 0x5c,
		0x22, 0xff, 0x34, 0x2a, 0xf6, 0x3d, 0xcf, 0x4c,
		0x5, 0xe7, 0x62, 0x10, 0xeb, 0x73, 0xc8, 0x51,
		0x39, 0xf7, 0x69, 0x10, 0xe2, 0x30, 0x8c, 0x4b,
		0x22, 0xfd, 0x77, 0x53, 0xe2, 0x2c, 0xc8, 0x10,
		0x3f, 0xf7, 0x77, 0x1b, 0xe2, 0x2f, 0xc4, 0x4c,
		0x62, 0xfe, 0x7a, 0xa, 0xe6, 0x2f, 0xd5, 0x10,
		0x29, 0xfd, 0x6c, 0x10, 0xef, 0x33, 0xc0, 0x5b,
		0x62, 0xfe, 0x7a, 0xa, 0xe6, 0x2f, 0xd5, 0x11,
		0x27, 0xe1, 0x74, 0x10,
	}
)

func getUpdateManifestURL() string {
	return security.Deobfuscate(manifestURLMasked, manifestURLMaskKey)
}

//go:embed version.json
var versionJsonData []byte

// updaterBinary chứa binary của updater process được embed sẵn vào app.
// Nằm ở internal/updater/bin/ để KHÔNG bị gitignore (build/bin bị ignore).
// CI sẽ build lại file này trước khi chạy `wails build`.
// Trên dev: file stub ~2KB → ApplyUpdate() sẽ báo lỗi rõ ràng thay vì crash.
//
//go:embed internal/updater/bin/updater.exe
var updaterBinaryWindows []byte

//go:embed internal/updater/bin/updater
var updaterBinaryUnix []byte

// getUpdaterBinary returns the embedded updater bytes for the running OS.
func getUpdaterBinary() []byte {
	if runtime.GOOS == "windows" {
		return updaterBinaryWindows
	}
	return updaterBinaryUnix
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AppInfo struct {
	Name           string `json:"name"`
	Version        string `json:"version"`
	OutputFileName string `json:"outputFileName"`
	BuildTime      string `json:"buildTime"`
	OS             string `json:"os"`
}

// UpdateStatus mirrors the download state emitted to the frontend via EventsEmit.
type UpdateStatus struct {
	// Phase: "idle" | "downloading" | "done" | "error"
	Phase    string `json:"phase"`
	Percent  int64  `json:"percent"`
	ErrorMsg string `json:"errorMsg,omitempty"`
}

// ─── App struct ───────────────────────────────────────────────────────────────

type App struct {
	ctx       context.Context
	engine    *core.HttpClientEngine
	dbManager *DBManager

	// update download state
	downloadMu        sync.Mutex
	downloadPercent   int64  // atomic, 0–100
	downloadedPath    string // path of the fully downloaded & verified binary
	downloadedVersion string              // version string of the downloaded binary
	downloadedSHA256  string              // checksum the updater re-verifies before installing
	downloadPhase     string              // "idle" | "downloading" | "done" | "error"
	pendingUpdate     *updater.UpdateInfo // last manifest entry from CheckForUpdate

	streamMu       sync.Mutex
	streamCancels  map[string]context.CancelFunc
	streamVersions map[string]int

	automationMu       sync.Mutex
	automationCancels  map[string]context.CancelFunc
	automationVersions map[string]int

	mockServer *core.MockServerEngine

	uiEngine      *coreui.BrowserEngine
	screenshotMgr *coreui.ScreenshotManager
	uiRunner      *coreui.Runner
}

func NewApp() *App {
	dbm, err := InitDB()
	if err != nil {
		println("Error initializing SQLite database:", err.Error())
	}
	uiEngine := coreui.NewBrowserEngine()
	screenshotMgr := coreui.NewScreenshotManager()
	uiRunner := coreui.NewRunner(uiEngine, screenshotMgr)

	return &App{
		engine:             core.NewHttpClientEngine(false, 30),
		dbManager:          dbm,
		downloadPhase:      "idle",
		streamCancels:      make(map[string]context.CancelFunc),
		streamVersions:     make(map[string]int),
		automationCancels:  make(map[string]context.CancelFunc),
		automationVersions: make(map[string]int),
		mockServer:         core.NewMockServerEngine(),
		uiEngine:           uiEngine,
		screenshotMgr:      screenshotMgr,
		uiRunner:           uiRunner,
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Anti-reverse engineering & runtime anti-debugging defense (active in production builds)
	env := wailsRuntime.Environment(ctx)
	if env.BuildType != "dev" && os.Getenv("WAILS_ENV") != "dev" {
		antidebug.StartWatcher(antidebug.DefaultConfig())
	}

	// Remove the backup left by a previous update — only our own "<exe>.bak",
	// never other .bak files that happen to share the folder (e.g. Desktop).
	// The delay leaves the updater's post-start health check time to roll back.
	go func() {
		time.Sleep(30 * time.Second)
		exePath, err := os.Executable()
		if err != nil {
			return
		}
		_ = os.Remove(exePath + ".bak")
		_ = os.Remove(exePath + ".new")
	}()
}

// ─── App Info & Security Status ───────────────────────────────────────────────

func (a *App) GetAppInfo() AppInfo {
	var info AppInfo
	if len(versionJsonData) > 0 {
		_ = json.Unmarshal(versionJsonData, &info)
	}
	if info.Version == "" {
		info.Version = "1.3.3"
	}
	if info.Name == "" {
		info.Name = "internal-api-client"
	}
	info.OS = runtime.GOOS
	return info
}

// CheckSecurityStatus returns current runtime anti-reverse engineering and binary integrity state.
func (a *App) CheckSecurityStatus() map[string]interface{} {
	threats := antidebug.CheckAll()
	envThreat, envDesc := security.VerifyEnvironment()
	binaryErr := security.ValidateBinaryState()

	res := map[string]interface{}{
		"isSecure":    len(threats) == 0 && !envThreat && binaryErr == nil,
		"threatCount": len(threats),
	}
	if envThreat {
		res["environmentWarning"] = envDesc
	}
	if binaryErr != nil {
		res["binaryWarning"] = binaryErr.Error()
	}
	return res
}

// ─── Update API (Wails-bound methods callable from frontend) ──────────────────

// CheckForUpdate fetches the manifest and returns UpdateInfo if a newer version
// exists for the current platform. Returns nil (and no error) when up-to-date.
// On network failure: logs the error and returns it — the frontend handles it gracefully.
func (a *App) CheckForUpdate() (*updater.UpdateInfo, error) {
	info := a.GetAppInfo()
	manifestURL := getUpdateManifestURL()
	result, err := updater.CheckForUpdate(manifestURL, info.Version)
	if err != nil {
		log.Printf("[app] update check failed (non-fatal): %v", err)
		return nil, fmt.Errorf("update check: %w", err)
	}
	if result != nil {
		if err := updater.ValidateDownloadURL(manifestURL, result.URL); err != nil {
			return nil, fmt.Errorf("update manifest rejected: %w", err)
		}
	}
	a.downloadMu.Lock()
	a.pendingUpdate = result
	a.downloadMu.Unlock()
	return result, nil
}

// StartDownloadUpdate downloads the update found by the last CheckForUpdate.
// The URL and checksum come from the manifest held by the backend, never from
// the frontend, so script running in the WebView cannot choose what is installed.
// Progress events ("updater:status") are emitted via Wails EventsEmit.
func (a *App) StartDownloadUpdate() error {
	a.downloadMu.Lock()
	if a.downloadPhase == "downloading" {
		a.downloadMu.Unlock()
		return fmt.Errorf("download already in progress")
	}
	pending := a.pendingUpdate
	if pending == nil {
		a.downloadMu.Unlock()
		return fmt.Errorf("no update available — check for updates first")
	}
	dest, err := updater.DownloadDestination(pending.Version)
	if err != nil {
		a.downloadMu.Unlock()
		return fmt.Errorf("invalid update version: %w", err)
	}
	version, url, sha256 := pending.Version, pending.URL, pending.SHA256
	a.downloadPhase = "downloading"
	a.downloadedPath = ""
	a.downloadedVersion = version
	a.downloadedSHA256 = sha256
	atomic.StoreInt64(&a.downloadPercent, 0)
	a.downloadMu.Unlock()

	a.emitUpdateStatus(UpdateStatus{Phase: "downloading", Percent: 0})

	go func() {
		client := updater.NewDownloadClient()
		downloadErr := updater.DownloadUpdate(context.Background(), client, url, sha256, dest, func(downloaded, total int64) {
			var pct int64
			if total > 0 {
				pct = downloaded * 100 / total
			}
			atomic.StoreInt64(&a.downloadPercent, pct)
			a.emitUpdateStatus(UpdateStatus{Phase: "downloading", Percent: pct})
		})

		a.downloadMu.Lock()
		defer a.downloadMu.Unlock()

		if downloadErr != nil {
			log.Printf("[app] download failed: %v", downloadErr)
			a.downloadPhase = "error"
			a.emitUpdateStatus(UpdateStatus{Phase: "error", ErrorMsg: downloadErr.Error()})
			return
		}

		a.downloadPhase = "done"
		a.downloadedPath = dest
		a.downloadedVersion = version
		a.emitUpdateStatus(UpdateStatus{Phase: "done", Percent: 100})
		log.Printf("[app] download complete → %s", dest)
	}()

	return nil
}

// GetUpdateStatus returns the current download phase and percent for polling fallback.
func (a *App) GetUpdateStatus() UpdateStatus {
	a.downloadMu.Lock()
	phase := a.downloadPhase
	a.downloadMu.Unlock()
	return UpdateStatus{
		Phase:   phase,
		Percent: atomic.LoadInt64(&a.downloadPercent),
	}
}

// ApplyUpdate extracts the embedded updater binary, launches it as a detached
// process, then quits the application. The updater waits for this process to
// exit before replacing the binary and restarting the app.
func (a *App) ApplyUpdate() error {
	a.downloadMu.Lock()
	phase := a.downloadPhase
	src := a.downloadedPath
	expectedSHA := a.downloadedSHA256
	a.downloadMu.Unlock()

	if phase != "done" || src == "" {
		return fmt.Errorf("no completed download ready (phase=%s)", phase)
	}

	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve current executable: %w", err)
	}

	// Cài đè trực tiếp vào đúng file exe hiện tại (In-place overwrite)
	binary := getUpdaterBinary()
	// In dev builds the stub is just a text placeholder (<100 bytes).
	if len(binary) < 1024 {
		return fmt.Errorf("updater binary not available — run `go build ./cmd/updater/` first")
	}

	pid := os.Getpid()
	if err = updater.LaunchUpdaterProcess(binary, pid, src, exePath, exePath, expectedSHA); err != nil {
		return fmt.Errorf("launch updater: %w", err)
	}

	log.Printf("[app] updater launched (in-place overwrite: %s) — quitting (PID=%d)", exePath, pid)
	wailsRuntime.Quit(a.ctx)
	return nil
}

// emitUpdateStatus pushes a status event to the frontend.
func (a *App) emitUpdateStatus(status UpdateStatus) {
	if a.ctx == nil {
		return
	}
	wailsRuntime.EventsEmit(a.ctx, "updater:status", status)
}

// ─── HTTP Engine ──────────────────────────────────────────────────────────────

func (a *App) ExecuteRequest(payload core.RequestPayload) (core.ResponsePayload, error) {
	return a.engine.Execute(payload)
}

func (a *App) ExecuteLoadTest(payload core.RequestPayload, concurrency int, total int, durationSec int, rampUpSec int, targetRPS int) core.StressTestResult {
	return a.engine.ExecuteStressTestWithProgress(payload, concurrency, total, durationSec, rampUpSec, targetRPS, func(tick core.StressTestTick) {
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "stresstest:tick", tick)
		}
	})
}

func (a *App) CancelLoadTest() {
	a.engine.CancelStressTest()
}

func (a *App) ExecuteStreamRequest(reqID string, payload core.RequestPayload) error {
	ctx, cancel := context.WithCancel(context.Background())
	a.streamMu.Lock()
	if a.streamCancels == nil {
		a.streamCancels = make(map[string]context.CancelFunc)
	}
	if previous, exists := a.streamCancels[reqID]; exists {
		previous()
	}
	a.streamVersions[reqID]++
	version := a.streamVersions[reqID]
	a.streamCancels[reqID] = cancel
	a.streamMu.Unlock()

	go func() {
		defer func() {
			cancel()
			a.streamMu.Lock()
			if a.streamVersions[reqID] == version {
				delete(a.streamCancels, reqID)
				delete(a.streamVersions, reqID)
			}
			a.streamMu.Unlock()
		}()

		// ExecuteStream always emits a final IsEnd chunk (with the error, if
		// any), so the frontend can leave its loading state on every path.
		_ = a.engine.ExecuteStream(ctx, payload, reqID, func(chunk core.StreamChunk) {
			if a.ctx != nil {
				wailsRuntime.EventsEmit(a.ctx, "stream:chunk:"+reqID, chunk)
			}
		})
	}()

	return nil
}

func (a *App) CancelStreamRequest(reqID string) {
	a.streamMu.Lock()
	defer a.streamMu.Unlock()
	if cancel, exists := a.streamCancels[reqID]; exists {
		cancel()
		delete(a.streamCancels, reqID)
	}
}

// ─── Mock Server Engine ───────────────────────────────────────────────────────

func (a *App) StartMockServer(port int, routes []core.MockRoute) error {
	if a.mockServer == nil {
		a.mockServer = core.NewMockServerEngine()
	}
	return a.mockServer.Start(port, routes)
}

func (a *App) StopMockServer() error {
	if a.mockServer == nil {
		return nil
	}
	return a.mockServer.Stop()
}

func (a *App) GetMockServerStatus() core.MockServerStatus {
	if a.mockServer == nil {
		return core.MockServerStatus{}
	}
	return a.mockServer.GetStatus()
}

func (a *App) UpdateMockRoutes(routes []core.MockRoute) {
	if a.mockServer != nil {
		a.mockServer.UpdateRoutes(routes)
	}
}

func (a *App) ClearMockServerLogs() {
	if a.mockServer != nil {
		a.mockServer.ClearLogs()
	}
}

// ─── Database – Projects ──────────────────────────────────────────────────────

func (a *App) GetAllProjectsData() (ProjectDataPayload, error) {
	var payload ProjectDataPayload
	if a.dbManager == nil {
		return payload, nil
	}
	projects, err := a.dbManager.GetProjects()
	if err != nil {
		return payload, err
	}
	folders, err := a.dbManager.GetFolders()
	if err != nil {
		return payload, err
	}
	requests, err := a.dbManager.GetRequests()
	if err != nil {
		return payload, err
	}
	payload.Projects = projects
	payload.Folders = folders
	payload.Requests = requests
	return payload, nil
}

func (a *App) CreateProjectInDB(id, name string) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.CreateProject(id, name)
}

func (a *App) UpdateProjectInDB(id, name string) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.UpdateProject(id, name)
}

func (a *App) DeleteProjectInDB(id string) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.DeleteProject(id)
}

func (a *App) CreateFolderInDB(id, projectID, parentID, name string) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.CreateFolder(id, projectID, parentID, name)
}

func (a *App) UpdateFolderInDB(id, name string) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.UpdateFolder(id, name)
}

func (a *App) DeleteFolderInDB(id string) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.DeleteFolder(id)
}

func (a *App) CreateRequestInDB(id, projectID, folderID, name, method string) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.CreateRequest(id, projectID, folderID, name, method)
}

func (a *App) UpdateRequestInDB(req DBRequest) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.UpdateRequest(req)
}

func (a *App) RenameRequestInDB(id, name string) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.RenameRequest(id, name)
}

func (a *App) DeleteRequestInDB(id string) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.DeleteRequest(id)
}

// ─── Database – Environments ──────────────────────────────────────────────────

func (a *App) GetEnvironmentsFromDB() ([]DBEnvironment, error) {
	if a.dbManager == nil {
		return nil, nil
	}
	return a.dbManager.GetEnvironments()
}

func (a *App) SaveEnvironmentToDB(env DBEnvironment) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.SaveEnvironment(env)
}

func (a *App) DeleteEnvironmentFromDB(id string) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.DeleteEnvironment(id)
}

func (a *App) SaveAllEnvironmentsToDB(envs []DBEnvironment) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.SaveAllEnvironments(envs)
}

// ─── Database – Scenarios (Automation Test) ───────────────────────────────────

func (a *App) GetScenariosFromDB() ([]DBScenario, error) {
	if a.dbManager == nil {
		return nil, nil
	}
	return a.dbManager.GetScenarios()
}

func (a *App) SaveScenarioToDB(scenario DBScenario) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.SaveScenario(scenario)
}

func (a *App) DeleteScenarioFromDB(id string) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.DeleteScenario(id)
}

// RunScenario executes API automation in Go so it is reusable outside the UI,
// cancellable while HTTP I/O is in progress, and persisted for later review.
func (a *App) RunScenario(scenarioID, envID string) (AutomationRunSummary, error) {
	if a.dbManager == nil {
		return AutomationRunSummary{}, fmt.Errorf("database not initialized")
	}
	scenarios, err := a.dbManager.GetScenarios()
	if err != nil {
		return AutomationRunSummary{}, err
	}
	var scenario *DBScenario
	for index := range scenarios {
		if scenarios[index].ID == scenarioID {
			scenario = &scenarios[index]
			break
		}
	}
	if scenario == nil {
		return AutomationRunSummary{}, fmt.Errorf("scenario %s not found", scenarioID)
	}
	values := map[string]string{}
	if envID != "" {
		envs, err := a.dbManager.GetEnvironments()
		if err != nil {
			return AutomationRunSummary{}, err
		}
		for _, env := range envs {
			if env.ID == envID {
				for _, variable := range env.Variables {
					if variable.Enabled && strings.TrimSpace(variable.Key) != "" {
						values[strings.TrimSpace(variable.Key)] = variable.Value
					}
				}
				break
			}
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.automationMu.Lock()
	if previous := a.automationCancels[scenarioID]; previous != nil {
		previous()
	}
	a.automationVersions[scenarioID]++
	version := a.automationVersions[scenarioID]
	a.automationCancels[scenarioID] = cancel
	a.automationMu.Unlock()
	defer func() {
		cancel()
		a.automationMu.Lock()
		if a.automationVersions[scenarioID] == version {
			delete(a.automationCancels, scenarioID)
		}
		a.automationMu.Unlock()
	}()
	summary := runAutomationScenario(ctx, a.engine, *scenario, values, func(event AutomationProgressEvent) {
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "automation:progress:"+scenarioID, event)
			wailsRuntime.EventsEmit(a.ctx, "automation:progress", event)
		}
	})
	records := make([]DBScenarioTestResult, 0, len(summary.StepResults))
	for _, result := range summary.StepResults {
		assertions, _ := json.Marshal(result.AssertionDetails)
		extracted, _ := json.Marshal(result.Extracted)
		headers, _ := json.Marshal(result.ResponseHeaders)
		id, idErr := newImportID("api_res")
		if idErr != nil {
			id = fmt.Sprintf("api_res_%s_%d", summary.RunID, result.StepOrder)
		}
		records = append(records, DBScenarioTestResult{ID: id, RunID: summary.RunID, StepID: result.StepID, StepOrder: result.StepOrder, Status: map[bool]string{true: "PASSED", false: "FAILED"}[result.Passed], Duration: result.DurationMs, Method: result.Method, URL: result.URL, HTTPStatus: result.Status, ResponseBody: result.ResponseBody, ResponseHeaders: string(headers), AssertionDetails: string(assertions), ExtractedVars: string(extracted), Error: result.Error})
	}
	if err := a.dbManager.SaveScenarioTestRun(DBScenarioTestRun{ID: summary.RunID, ScenarioID: summary.ScenarioID, Status: summary.Status, StartedAt: time.Now().Add(-time.Duration(summary.TotalDurationMs) * time.Millisecond).Format("2006-01-02 15:04:05"), FinishedAt: time.Now().Format("2006-01-02 15:04:05"), Duration: summary.TotalDurationMs}, records); err != nil {
		return summary, fmt.Errorf("persist automation run: %w", err)
	}
	return summary, nil
}

func (a *App) StopScenario(scenarioID string) {
	a.automationMu.Lock()
	defer a.automationMu.Unlock()
	if cancel := a.automationCancels[scenarioID]; cancel != nil {
		cancel()
	}
}
func (a *App) GetScenarioTestRuns(scenarioID string) ([]DBScenarioTestRun, error) {
	if a.dbManager == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	return a.dbManager.GetScenarioTestRuns(scenarioID)
}
func (a *App) GetScenarioTestResults(runID string) ([]DBScenarioTestResult, error) {
	if a.dbManager == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	return a.dbManager.GetScenarioTestResults(runID)
}

// ImportPostmanCollection imports a complete Postman v2 collection atomically.
// The backend owns ID allocation so parent references remain valid throughout the import.
func (a *App) ImportPostmanCollection(collectionJSON string) (PostmanImportResult, error) {
	if a.dbManager == nil {
		return PostmanImportResult{}, fmt.Errorf("database not initialized")
	}
	return a.dbManager.ImportPostmanCollection(collectionJSON)
}

// ─── Workspace Export / Import ────────────────────────────────────────────────

// ExportFullWorkspace serialises the workspace. Unless includeSecrets is true,
// tokens, passwords and secret-looking variables are blanked so the backup can
// be shared safely; importing it back keeps the secrets already stored.
func (a *App) ExportFullWorkspace(includeSecrets bool) (string, error) {
	data, err := a.GetAllProjectsData()
	if err != nil {
		return "", err
	}
	envs, err := a.GetEnvironmentsFromDB()
	if err != nil {
		return "", err
	}
	scenarios, _ := a.GetScenariosFromDB()
	export := FullWorkspaceExport{
		Projects:     data.Projects,
		Folders:      data.Folders,
		Requests:     data.Requests,
		Environments: envs,
		Scenarios:    scenarios,
		Version:      "2.2",
	}
	if !includeSecrets {
		redactWorkspaceSecrets(&export)
	}
	b, err := json.MarshalIndent(export, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ImportFullWorkspace restores a backup produced by ExportFullWorkspace.
func (a *App) ImportFullWorkspace(workspaceJSON string) (WorkspaceImportResult, error) {
	if a.dbManager == nil {
		return WorkspaceImportResult{}, fmt.Errorf("database not initialized")
	}
	var data FullWorkspaceExport
	if err := json.Unmarshal([]byte(workspaceJSON), &data); err != nil {
		return WorkspaceImportResult{}, fmt.Errorf("parse workspace backup: %w", err)
	}
	if data.Version == "" || data.Projects == nil {
		return WorkspaceImportResult{}, fmt.Errorf("not a workspace backup file")
	}
	return a.dbManager.ImportWorkspace(data)
}

// SaveFileDialog prompts the user with a native system dialog to pick a save location on disk.
func (a *App) SaveFileDialog(defaultFilename string, title string, filterDisplayName string, filterPattern string) (string, error) {
	opts := wailsRuntime.SaveDialogOptions{
		DefaultFilename: defaultFilename,
		Title:           title,
	}
	if filterPattern != "" {
		opts.Filters = []wailsRuntime.FileFilter{
			{
				DisplayName: filterDisplayName,
				Pattern:     filterPattern,
			},
			{
				DisplayName: "Tất cả các tệp (*.*)",
				Pattern:     "*.*",
			},
		}
	}
	return wailsRuntime.SaveFileDialog(a.ctx, opts)
}

// SaveFileContent writes base64-encoded file data to the specified destination path.
func (a *App) SaveFileContent(filePath string, base64Content string) error {
	data, err := base64.StdEncoding.DecodeString(base64Content)
	if err != nil {
		return fmt.Errorf("failed to decode base64 file data: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}
	return os.WriteFile(filePath, data, 0644)
}

// SaveFileWithDialog opens a native save dialog and saves base64 content to the chosen path.
// Returns the saved file path, or empty string if user cancelled.
func (a *App) SaveFileWithDialog(defaultFilename string, title string, filterDisplayName string, filterPattern string, base64Content string) (string, error) {
	filePath, err := a.SaveFileDialog(defaultFilename, title, filterDisplayName, filterPattern)
	if err != nil {
		return "", err
	}
	if filePath == "" {
		// User cancelled the file selection
		return "", nil
	}
	if err := a.SaveFileContent(filePath, base64Content); err != nil {
		return "", err
	}
	return filePath, nil
}

// ─── UI Automation Testing API (Wails-bound methods) ──────────────────────────

func (a *App) GetUIScenarios() ([]DBUIScenario, error) {
	if a.dbManager == nil {
		return nil, nil
	}
	return a.dbManager.GetUIScenarios()
}

func (a *App) GetUIScenario(id string) (*DBUIScenario, error) {
	if a.dbManager == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	return a.dbManager.GetUIScenario(id)
}

func (a *App) SaveUIScenario(scenario DBUIScenario) error {
	if a.dbManager == nil {
		return fmt.Errorf("database not initialized")
	}
	return a.dbManager.SaveUIScenario(scenario)
}

func (a *App) DeleteUIScenario(id string) error {
	if a.dbManager == nil {
		return fmt.Errorf("database not initialized")
	}
	return a.dbManager.DeleteUIScenario(id)
}

func (a *App) RunUIScenario(scenarioID string, envID string, headless bool, ignoreHTTPSErrors bool) (coreui.TestRunSummary, error) {
	if a.dbManager == nil {
		return coreui.TestRunSummary{}, fmt.Errorf("database not initialized")
	}
	if a.uiRunner == nil {
		return coreui.TestRunSummary{}, fmt.Errorf("UI test runner not initialized")
	}

	dbScenario, err := a.dbManager.GetUIScenario(scenarioID)
	if err != nil {
		return coreui.TestRunSummary{}, fmt.Errorf("failed to load scenario %s: %w", scenarioID, err)
	}

	// Map DB model to coreui.UIScenario
	uiSteps := make([]coreui.UIStep, len(dbScenario.Steps))
	for i, st := range dbScenario.Steps {
		uiSteps[i] = coreui.UIStep{
			ID:         st.ID,
			ScenarioID: st.ScenarioID,
			SortOrder:  st.SortOrder,
			Type:       coreui.StepType(st.Type),
			Selector:   st.Selector,
			Value:      st.Value,
			Timeout:    st.Timeout,
			ConfigJSON: st.ConfigJSON,
		}
	}

	scenario := coreui.UIScenario{
		ID:        dbScenario.ID,
		ProjectID: dbScenario.ProjectID,
		FolderID:  dbScenario.FolderID,
		Name:      dbScenario.Name,
		Browser:   coreui.BrowserType(dbScenario.Browser),
		BaseURL:   dbScenario.BaseURL,
		Steps:     uiSteps,
	}

	// Collect active environment variables
	envVars := make(map[string]string)
	if envID != "" {
		envs, err := a.dbManager.GetEnvironments()
		if err == nil {
			for _, env := range envs {
				if env.ID == envID {
					for _, v := range env.Variables {
						if v.Enabled && strings.TrimSpace(v.Key) != "" {
							envVars[strings.TrimSpace(v.Key)] = v.Value
						}
					}
					break
				}
			}
		}
	}

	// Run with progress callback emitting Wails events
	summary := a.uiRunner.RunScenario(context.Background(), scenario, envVars, headless, ignoreHTTPSErrors, func(event coreui.StepProgressEvent) {
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "uitest:progress:"+scenarioID, event)
			wailsRuntime.EventsEmit(a.ctx, "uitest:progress", event)
		}
	})

	// Persist test run and results in SQLite
	runRecord := DBUITestRun{
		ID:         summary.RunID,
		ScenarioID: summary.ScenarioID,
		Status:     string(summary.Status),
		StartedAt:  summary.StartedAt.Format("2006-01-02 15:04:05"),
		FinishedAt: summary.FinishedAt.Format("2006-01-02 15:04:05"),
		Duration:   summary.DurationMs,
	}
	resultsRecords := make([]DBUITestResult, len(summary.StepResults))
	for i, res := range summary.StepResults {
		resultsRecords[i] = DBUITestResult{
			ID:             fmt.Sprintf("res_%s_%d", summary.RunID, i+1),
			RunID:          summary.RunID,
			StepID:         res.StepID,
			StepOrder:      res.StepOrder,
			Status:         string(res.Status),
			Error:          res.Error,
			Duration:       res.DurationMs,
			ScreenshotPath: res.ScreenshotPath,
			Details:        res.Details,
		}
	}
	if err := a.dbManager.SaveUITestRun(runRecord, resultsRecords); err != nil {
		return summary, fmt.Errorf("persist UI test run: %w", err)
	}

	return summary, nil
}

func (a *App) StopUIScenario(scenarioID string) {
	if a.uiRunner != nil {
		a.uiRunner.CancelRun(scenarioID)
	}
}

func (a *App) GetUITestRuns(scenarioID string) ([]DBUITestRun, error) {
	if a.dbManager == nil {
		return nil, nil
	}
	return a.dbManager.GetUITestRuns(scenarioID)
}

func (a *App) GetUITestResults(runID string) ([]DBUITestResult, error) {
	if a.dbManager == nil {
		return nil, nil
	}
	return a.dbManager.GetUITestResults(runID)
}

func (a *App) GetUIScreenshot(runID, resultID string) (string, error) {
	if a.dbManager == nil {
		return "", fmt.Errorf("database not initialized")
	}
	path, err := a.dbManager.GetUITestScreenshotPath(runID, resultID)
	if err != nil {
		return "", err
	}
	if a.screenshotMgr == nil {
		a.screenshotMgr = coreui.NewScreenshotManager()
	}
	if !a.screenshotMgr.IsManagedPath(path) {
		return "", fmt.Errorf("invalid screenshot artifact")
	}
	return a.screenshotMgr.ReadScreenshotAsBase64(path)
}

func (a *App) InstallPlaywrightBrowsers(browser string) error {
	if a.uiEngine == nil {
		a.uiEngine = coreui.NewBrowserEngine()
	}
	return a.uiEngine.InstallBrowsers(coreui.BrowserType(browser))
}

// ─── Database – Activity History ──────────────────────────────────────────────

func (a *App) GetActivityHistoryFromDB() ([]DBActivityHistory, error) {
	if a.dbManager == nil {
		return nil, nil
	}
	return a.dbManager.GetActivityHistory(100)
}

func (a *App) SaveActivityHistoryToDB(item DBActivityHistory) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.SaveActivityHistory(item)
}

func (a *App) DeleteActivityHistoryFromDB(id string) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.DeleteActivityHistory(id)
}

func (a *App) ClearActivityHistoryInDB() error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.ClearActivityHistory()
}

// ─── Database – App Settings & Workspace Session ─────────────────────────────

func (a *App) GetWorkspaceSessionFromDB() (DBWorkspaceSession, error) {
	if a.dbManager == nil {
		return DBWorkspaceSession{}, nil
	}
	return a.dbManager.GetWorkspaceSession()
}

func (a *App) SaveWorkspaceSessionToDB(session DBWorkspaceSession) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.SaveWorkspaceSession(session)
}

func (a *App) GetAppSetting(key string) (string, error) {
	if a.dbManager == nil {
		return "", nil
	}
	return a.dbManager.GetAppSetting(key)
}

func (a *App) SetAppSetting(key, value string) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.SetAppSetting(key, value)
}
