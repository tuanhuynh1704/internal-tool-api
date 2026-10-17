package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"internal-api-client/internal/security"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

type DBProject struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type DBFolder struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	ParentID  string `json:"parentId,omitempty"`
	Name      string `json:"name"`
}

type DBRequest struct {
	ID             string `json:"id"`
	ProjectID      string `json:"projectId"`
	FolderID       string `json:"folderId,omitempty"`
	Name           string `json:"name"`
	Method         string `json:"method"`
	BaseURL        string `json:"baseUrl"`
	Port           string `json:"port"`
	UsePort        bool   `json:"usePort"`
	ApiPath        string `json:"apiPath"`
	ReqBody        string `json:"reqBody"`
	HeadersJson    string `json:"headersJson"`
	ParamsJson     string `json:"paramsJson"`
	BodyType       string `json:"bodyType"`
	AuthType       string `json:"authType"`
	AuthToken      string `json:"authToken"`
	AuthConfigJson string `json:"authConfigJson"`
	AssertionsJson string `json:"assertionsJson"`
}

type DBScenarioStep struct {
	ID              string `json:"id"`
	ScenarioID      string `json:"scenarioId"`
	StepOrder       int    `json:"stepOrder"`
	Name            string `json:"name"`
	Method          string `json:"method"`
	ApiPath         string `json:"apiPath"`
	HeadersJson     string `json:"headersJson"`
	ParamsJson      string `json:"paramsJson"`
	Body            string `json:"body"`
	BodyType        string `json:"bodyType"`
	AuthType        string `json:"authType"`
	AuthToken       string `json:"authToken"`
	AuthConfigJson  string `json:"authConfigJson"`
	AssertionsJson  string `json:"assertionsJson"`
	ExtractVarsJson string `json:"extractVarsJson"`
}

type DBScenario struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Description string           `json:"description"`
	BaseURL     string           `json:"baseUrl"`
	StopOnError bool             `json:"stopOnError"`
	DelayMs     int              `json:"delayMs"`
	Steps       []DBScenarioStep `json:"steps"`
}

type DBUIStep struct {
	ID         string `json:"id"`
	ScenarioID string `json:"scenarioId"`
	SortOrder  int    `json:"sortOrder"`
	Type       string `json:"type"`
	Selector   string `json:"selector"`
	Value      string `json:"value"`
	Timeout    int    `json:"timeout"`
	ConfigJSON string `json:"configJson"`
	CreatedAt  string `json:"createdAt,omitempty"`
}

type DBUIScenario struct {
	ID        string     `json:"id"`
	ProjectID string     `json:"projectId,omitempty"`
	FolderID  string     `json:"folderId,omitempty"`
	Name      string     `json:"name"`
	Browser   string     `json:"browser"`
	BaseURL   string     `json:"baseUrl"`
	CreatedAt string     `json:"createdAt,omitempty"`
	UpdatedAt string     `json:"updatedAt,omitempty"`
	Steps     []DBUIStep `json:"steps"`
}

type DBUITestRun struct {
	ID         string `json:"id"`
	ScenarioID string `json:"scenarioId"`
	Status     string `json:"status"`
	StartedAt  string `json:"startedAt"`
	FinishedAt string `json:"finishedAt"`
	Duration   int64  `json:"duration"`
}

type DBUITestResult struct {
	ID             string `json:"id"`
	RunID          string `json:"runId"`
	StepID         string `json:"stepId"`
	StepOrder      int    `json:"stepOrder"`
	Status         string `json:"status"`
	Error          string `json:"error"`
	Duration       int64  `json:"duration"`
	ScreenshotPath string `json:"screenshotPath"`
	Details        string `json:"details"`
}

// DBScenarioTestRun and DBScenarioTestResult keep API automation results
// independently from the UI test history so they can be viewed or exported
// after the desktop session ends.
type DBScenarioTestRun struct {
	ID         string `json:"id"`
	ScenarioID string `json:"scenarioId"`
	Status     string `json:"status"`
	StartedAt  string `json:"startedAt"`
	FinishedAt string `json:"finishedAt"`
	Duration   int64  `json:"duration"`
}

type DBScenarioTestResult struct {
	ID               string `json:"id"`
	RunID            string `json:"runId"`
	StepID           string `json:"stepId"`
	StepOrder        int    `json:"stepOrder"`
	Status           string `json:"status"`
	Duration         int64  `json:"duration"`
	Method           string `json:"method"`
	URL              string `json:"url"`
	HTTPStatus       int    `json:"httpStatus"`
	ResponseBody     string `json:"responseBody"`
	ResponseHeaders  string `json:"responseHeaders"`
	AssertionDetails string `json:"assertionDetails"`
	ExtractedVars    string `json:"extractedVars"`
	Error            string `json:"error"`
}

type DBEnvVariable struct {
	ID      string `json:"id"`
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

type DBEnvironment struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Variables []DBEnvVariable `json:"variables"`
}

type DBActivityHistory struct {
	ID        string `json:"id"`
	Method    string `json:"method"`
	URL       string `json:"url"`
	Status    int    `json:"status"`
	Duration  int64  `json:"duration"`
	Timestamp string `json:"timestamp"`
	CreatedAt string `json:"createdAt,omitempty"`
}

type DBWorkspaceSession struct {
	ActiveTabID      string   `json:"activeTabId"`
	OpenTabIDs       []string `json:"openTabIds"`
	ActiveEnvID      string   `json:"activeEnvId"`
	ActiveProjectID  string   `json:"activeProjectId"`
	ActiveSidebarTab string   `json:"activeSidebarTab"`
}

type ProjectDataPayload struct {
	Projects []DBProject `json:"projects"`
	Folders  []DBFolder  `json:"folders"`
	Requests []DBRequest `json:"requests"`
}

// PostmanImportResult is returned only after all imported rows are committed.
type PostmanImportResult struct {
	ProjectID        string `json:"projectId"`
	ProjectName      string `json:"projectName"`
	ImportedFolders  int    `json:"importedFolders"`
	ImportedRequests int    `json:"importedRequests"`
}

type postmanCollection struct {
	Info struct {
		Name string `json:"name"`
	} `json:"info"`
	Item []postmanItem `json:"item"`
	Auth *postmanAuth  `json:"auth"`
}

type postmanItem struct {
	Name string `json:"name"`
	// Item is nil for a request and non-nil (possibly empty) for a folder, so
	// an empty folder ("item": []) is still recognised as a folder.
	Item    []postmanItem   `json:"item"`
	Request json.RawMessage `json:"request"`
	Auth    *postmanAuth    `json:"auth"`
}

type postmanKeyValue struct {
	Key      string          `json:"key"`
	Value    json.RawMessage `json:"value"`
	Disabled bool            `json:"disabled"`
	Type     string          `json:"type"`
	Src      json.RawMessage `json:"src"`
}

// text returns the value as a string whatever JSON type Postman used.
func (kv postmanKeyValue) text() string {
	return postmanRawText(kv.Value)
}

func postmanRawText(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		return asString
	}
	return string(raw)
}

type postmanAuth struct {
	Type   string            `json:"type"`
	Bearer []postmanKeyValue `json:"bearer"`
	Basic  []postmanKeyValue `json:"basic"`
	APIKey []postmanKeyValue `json:"apikey"`
}

type postmanRequest struct {
	Method string            `json:"method"`
	Header []postmanKeyValue `json:"header"`
	URL    json.RawMessage   `json:"url"`
	Body   *struct {
		Mode       string            `json:"mode"`
		Raw        string            `json:"raw"`
		URLEncoded []postmanKeyValue `json:"urlencoded"`
		FormData   []postmanKeyValue `json:"formdata"`
		GraphQL    *struct {
			Query     string          `json:"query"`
			Variables json.RawMessage `json:"variables"`
		} `json:"graphql"`
		Options struct {
			Raw struct {
				Language string `json:"language"`
			} `json:"raw"`
		} `json:"options"`
	} `json:"body"`
	Auth *postmanAuth `json:"auth"`
}

type DBManager struct {
	db *sql.DB
}

func getDBPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "api_client.db"
	}
	appDir := filepath.Join(dir, "internal-api-client")
	if err := os.MkdirAll(appDir, 0755); err != nil {
		return "api_client.db"
	}
	return filepath.Join(appDir, "api_client.db")
}

// sqliteDSN carries the pragmas in the DSN so the driver applies them to every
// pooled connection: a one-off "PRAGMA foreign_keys = ON" only affects the
// single connection that happened to run it.
func sqliteDSN(path string) string {
	return path + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)"
}

func InitDB() (*DBManager, error) {
	db, err := sql.Open("sqlite", sqliteDSN(getDBPath()))
	if err != nil {
		return nil, err
	}
	if err := migrateSchema(db); err != nil {
		db.Close()
		return nil, err
	}
	return &DBManager{db: db}, nil
}

// migrateSchema creates the tables and applies the additive migrations.
func migrateSchema(db *sql.DB) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS projects (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS folders (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			parent_id TEXT,
			name TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS requests (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			folder_id TEXT,
			name TEXT NOT NULL,
			method TEXT NOT NULL,
			base_url TEXT NOT NULL,
			port TEXT NOT NULL,
			use_port INTEGER NOT NULL,
			api_path TEXT NOT NULL,
			req_body TEXT NOT NULL,
			headers_json TEXT NOT NULL,
			params_json TEXT DEFAULT '[]',
			body_type TEXT DEFAULT 'json',
			auth_type TEXT DEFAULT 'none',
			auth_token TEXT DEFAULT '',
			auth_config_json TEXT DEFAULT '{}',
			assertions_json TEXT DEFAULT '[]'
		);`,
		`CREATE TABLE IF NOT EXISTS environments (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS env_variables (
			id TEXT PRIMARY KEY,
			env_id TEXT NOT NULL,
			var_key TEXT NOT NULL,
			var_val TEXT NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 1,
			FOREIGN KEY(env_id) REFERENCES environments(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS scenarios (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			base_url TEXT DEFAULT '',
			stop_on_error INTEGER DEFAULT 1,
			delay_ms INTEGER DEFAULT 0
		);`,
		`CREATE TABLE IF NOT EXISTS scenario_steps (
			id TEXT PRIMARY KEY,
			scenario_id TEXT NOT NULL,
			step_order INTEGER NOT NULL,
			name TEXT NOT NULL,
			method TEXT NOT NULL,
			api_path TEXT NOT NULL,
			headers_json TEXT DEFAULT '[]',
			params_json TEXT DEFAULT '[]',
			body TEXT DEFAULT '',
			body_type TEXT DEFAULT 'json',
			auth_type TEXT DEFAULT 'none',
			auth_token TEXT DEFAULT '',
			auth_config_json TEXT DEFAULT '{}',
			assertions_json TEXT DEFAULT '[]',
			extract_vars_json TEXT DEFAULT '[]',
			FOREIGN KEY(scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS ui_scenarios (
			id TEXT PRIMARY KEY,
			project_id TEXT DEFAULT '',
			folder_id TEXT DEFAULT '',
			name TEXT NOT NULL,
			browser TEXT DEFAULT 'chromium',
			base_url TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE IF NOT EXISTS ui_steps (
			id TEXT PRIMARY KEY,
			scenario_id TEXT NOT NULL,
			sort_order INTEGER NOT NULL,
			type TEXT NOT NULL,
			selector TEXT DEFAULT '',
			value TEXT DEFAULT '',
			timeout INTEGER DEFAULT 5000,
			config_json TEXT DEFAULT '{}',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(scenario_id) REFERENCES ui_scenarios(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS ui_test_runs (
			id TEXT PRIMARY KEY,
			scenario_id TEXT NOT NULL,
			status TEXT NOT NULL,
			started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			finished_at DATETIME,
			duration INTEGER DEFAULT 0,
			FOREIGN KEY(scenario_id) REFERENCES ui_scenarios(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS ui_test_results (
			id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			step_id TEXT NOT NULL,
			step_order INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL,
			error TEXT DEFAULT '',
			duration INTEGER DEFAULT 0,
			screenshot_path TEXT DEFAULT '',
			details TEXT DEFAULT '',
			FOREIGN KEY(run_id) REFERENCES ui_test_runs(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS scenario_test_runs (
			id TEXT PRIMARY KEY,
			scenario_id TEXT NOT NULL,
			status TEXT NOT NULL,
			started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			finished_at DATETIME,
			duration INTEGER DEFAULT 0,
			FOREIGN KEY(scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS scenario_test_results (
			id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			step_id TEXT NOT NULL,
			step_order INTEGER NOT NULL,
			status TEXT NOT NULL,
			duration INTEGER DEFAULT 0,
			method TEXT DEFAULT '',
			url TEXT DEFAULT '',
			http_status INTEGER DEFAULT 0,
			response_body TEXT DEFAULT '',
			response_headers TEXT DEFAULT '{}',
			assertion_details TEXT DEFAULT '[]',
			extracted_vars TEXT DEFAULT '{}',
			error TEXT DEFAULT '',
			FOREIGN KEY(run_id) REFERENCES scenario_test_runs(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS activity_history (
			id TEXT PRIMARY KEY,
			method TEXT NOT NULL,
			url TEXT NOT NULL,
			status INTEGER NOT NULL,
			duration INTEGER NOT NULL,
			timestamp TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE IF NOT EXISTS app_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);`,
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return err
		}
	}

	// Auto-migrations for existing databases ("duplicate column" errors are expected)
	_, _ = db.Exec("ALTER TABLE requests ADD COLUMN auth_type TEXT DEFAULT 'none';")
	_, _ = db.Exec("ALTER TABLE requests ADD COLUMN auth_token TEXT DEFAULT '';")
	_, _ = db.Exec("ALTER TABLE requests ADD COLUMN params_json TEXT DEFAULT '[]';")
	_, _ = db.Exec("ALTER TABLE requests ADD COLUMN body_type TEXT DEFAULT 'json';")
	_, _ = db.Exec("ALTER TABLE requests ADD COLUMN auth_config_json TEXT DEFAULT '{}';")
	_, _ = db.Exec("ALTER TABLE requests ADD COLUMN assertions_json TEXT DEFAULT '[]';")
	_, _ = db.Exec("ALTER TABLE ui_test_results ADD COLUMN step_order INTEGER NOT NULL DEFAULT 0;")
	_, _ = db.Exec("ALTER TABLE ui_test_results ADD COLUMN details TEXT DEFAULT '';")
	_, _ = db.Exec("CREATE INDEX IF NOT EXISTS idx_ui_test_results_run_order ON ui_test_results(run_id, step_order);")
	_, _ = db.Exec("CREATE INDEX IF NOT EXISTS idx_scenario_test_results_run_order ON scenario_test_results(run_id, step_order);")
	_, _ = db.Exec("CREATE INDEX IF NOT EXISTS idx_activity_history_created ON activity_history(created_at DESC);")

	// Remove rows orphaned while foreign keys were not enforced on every connection.
	_, _ = db.Exec("DELETE FROM env_variables WHERE env_id NOT IN (SELECT id FROM environments)")
	_, _ = db.Exec("DELETE FROM scenario_steps WHERE scenario_id NOT IN (SELECT id FROM scenarios)")
	_, _ = db.Exec("DELETE FROM ui_steps WHERE scenario_id NOT IN (SELECT id FROM ui_scenarios)")
	_, _ = db.Exec("DELETE FROM ui_test_runs WHERE scenario_id NOT IN (SELECT id FROM ui_scenarios)")
	_, _ = db.Exec("DELETE FROM ui_test_results WHERE run_id NOT IN (SELECT id FROM ui_test_runs)")
	_, _ = db.Exec("DELETE FROM scenario_test_runs WHERE scenario_id NOT IN (SELECT id FROM scenarios)")
	_, _ = db.Exec("DELETE FROM scenario_test_results WHERE run_id NOT IN (SELECT id FROM scenario_test_runs)")

	return nil
}

// decryptSecret returns the plaintext of a stored secret. A value that cannot
// be decrypted on this machine is returned empty (the user has to re-enter it)
// instead of leaking the "enc:..." ciphertext into requests, where it would be
// sent to servers and later encrypted a second time.
func decryptSecret(value string) string {
	plain, err := security.DecryptString(value)
	if err != nil {
		log.Printf("[db] stored secret could not be decrypted and was cleared: %v", err)
		return ""
	}
	return plain
}

// ==========================================
// PROJECTS CRUD
// ==========================================

func (m *DBManager) GetProjects() ([]DBProject, error) {
	rows, err := m.db.Query("SELECT id, name FROM projects")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []DBProject
	for rows.Next() {
		var p DBProject
		if err := rows.Scan(&p.ID, &p.Name); err != nil {
			return nil, err
		}
		list = append(list, p)
	}
	return list, nil
}

func (m *DBManager) CreateProject(id, name string) error {
	_, err := m.db.Exec("INSERT INTO projects (id, name) VALUES (?, ?)", id, name)
	return err
}

func (m *DBManager) UpdateProject(id, name string) error {
	_, err := m.db.Exec("UPDATE projects SET name = ? WHERE id = ?", name, id)
	return err
}

func (m *DBManager) DeleteProject(id string) error {
	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM requests WHERE project_id = ?", id); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM folders WHERE project_id = ?", id); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM projects WHERE id = ?", id); err != nil {
		return err
	}
	return tx.Commit()
}

// ==========================================
// FOLDERS CRUD
// ==========================================

func (m *DBManager) GetFolders() ([]DBFolder, error) {
	rows, err := m.db.Query("SELECT id, project_id, COALESCE(parent_id, ''), name FROM folders")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []DBFolder
	for rows.Next() {
		var f DBFolder
		var parentID string
		if err := rows.Scan(&f.ID, &f.ProjectID, &parentID, &f.Name); err != nil {
			return nil, err
		}
		f.ParentID = parentID
		list = append(list, f)
	}
	return list, nil
}

func (m *DBManager) CreateFolder(id, projectID, parentID, name string) error {
	var pID interface{}
	if parentID != "" {
		pID = parentID
	} else {
		pID = nil
	}
	_, err := m.db.Exec("INSERT INTO folders (id, project_id, parent_id, name) VALUES (?, ?, ?, ?)", id, projectID, pID, name)
	return err
}

func (m *DBManager) UpdateFolder(id, name string) error {
	_, err := m.db.Exec("UPDATE folders SET name = ? WHERE id = ?", name, id)
	return err
}

func (m *DBManager) DeleteFolder(id string) error {
	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	folderIDs := []string{id}
	visited := map[string]bool{id: true}
	for i := 0; i < len(folderIDs); i++ {
		currentID := folderIDs[i]
		rows, err := tx.Query("SELECT id FROM folders WHERE parent_id = ?", currentID)
		if err == nil {
			for rows.Next() {
				var subID string
				if err := rows.Scan(&subID); err == nil {
					if !visited[subID] {
						visited[subID] = true
						folderIDs = append(folderIDs, subID)
					}
				}
			}
			rows.Close()
		}
	}

	for _, fID := range folderIDs {
		if _, err := tx.Exec("DELETE FROM requests WHERE folder_id = ?", fID); err != nil {
			return err
		}
		if _, err := tx.Exec("DELETE FROM folders WHERE id = ?", fID); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// ==========================================
// REQUESTS CRUD
// ==========================================

func (m *DBManager) GetRequests() ([]DBRequest, error) {
	rows, err := m.db.Query(`SELECT 
		id, project_id, COALESCE(folder_id, ''), name, method, base_url, port, use_port, api_path, req_body, 
		headers_json, COALESCE(params_json, '[]'), COALESCE(body_type, 'json'), 
		COALESCE(auth_type, 'none'), COALESCE(auth_token, ''), COALESCE(auth_config_json, '{}'),
		COALESCE(assertions_json, '[]')
		FROM requests`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []DBRequest
	for rows.Next() {
		var r DBRequest
		var folderID string
		var usePortInt int
		if err := rows.Scan(
			&r.ID, &r.ProjectID, &folderID, &r.Name, &r.Method, &r.BaseURL, &r.Port, &usePortInt, &r.ApiPath, &r.ReqBody,
			&r.HeadersJson, &r.ParamsJson, &r.BodyType,
			&r.AuthType, &r.AuthToken, &r.AuthConfigJson, &r.AssertionsJson,
		); err != nil {
			return nil, err
		}
		r.FolderID = folderID
		r.UsePort = usePortInt == 1

		// Decrypt sensitive credentials transparently
		r.AuthToken = decryptSecret(r.AuthToken)
		r.AuthConfigJson = decryptSecret(r.AuthConfigJson)
		if r.AuthConfigJson == "" {
			r.AuthConfigJson = "{}"
		}

		list = append(list, r)
	}
	return list, rows.Err()
}

func (m *DBManager) CreateRequest(id, projectID, folderID, name, method string) error {
	var fID interface{}
	if folderID != "" {
		fID = folderID
	} else {
		fID = nil
	}
	_, err := m.db.Exec(`INSERT INTO requests 
		(id, project_id, folder_id, name, method, base_url, port, use_port, api_path, req_body, headers_json, params_json, body_type, auth_type, auth_token, auth_config_json, assertions_json) 
		VALUES (?, ?, ?, ?, ?, '', '8080', 0, '', '', '[]', '[]', 'json', 'none', '', '{}', '[]')`,
		id, projectID, fID, name, method)
	return err
}

func (m *DBManager) UpdateRequest(req DBRequest) error {
	usePortInt := 0
	if req.UsePort {
		usePortInt = 1
	}
	var fID interface{}
	if req.FolderID != "" {
		fID = req.FolderID
	} else {
		fID = nil
	}
	if req.AuthType == "" {
		req.AuthType = "none"
	}
	if req.BodyType == "" {
		req.BodyType = "json"
	}
	if req.ParamsJson == "" {
		req.ParamsJson = "[]"
	}
	if req.AuthConfigJson == "" {
		req.AuthConfigJson = "{}"
	}
	if req.AssertionsJson == "" {
		req.AssertionsJson = "[]"
	}

	// Encrypt sensitive authentication fields before saving; never fall back
	// to storing the secret in plaintext.
	encToken, err := security.EncryptString(req.AuthToken)
	if err != nil {
		return fmt.Errorf("encrypt auth token: %w", err)
	}
	encAuthConfig, err := security.EncryptString(req.AuthConfigJson)
	if err != nil {
		return fmt.Errorf("encrypt auth config: %w", err)
	}

	_, err = m.db.Exec(`UPDATE requests SET 
		name = ?, 
		method = ?, 
		base_url = ?, 
		port = ?, 
		use_port = ?, 
		api_path = ?, 
		req_body = ?, 
		headers_json = ?,
		params_json = ?,
		body_type = ?,
		auth_type = ?,
		auth_token = ?,
		auth_config_json = ?,
		assertions_json = ?,
		folder_id = ?
		WHERE id = ?`,
		req.Name, req.Method, req.BaseURL, req.Port, usePortInt, req.ApiPath, req.ReqBody, req.HeadersJson,
		req.ParamsJson, req.BodyType, req.AuthType, encToken, encAuthConfig, req.AssertionsJson, fID, req.ID)
	return err
}

// RenameRequest only touches the name so a rename can never overwrite the
// body, headers or auth of the request with a stale in-memory copy.
func (m *DBManager) RenameRequest(id, name string) error {
	_, err := m.db.Exec("UPDATE requests SET name = ? WHERE id = ?", name, id)
	return err
}

func (m *DBManager) DeleteRequest(id string) error {
	_, err := m.db.Exec("DELETE FROM requests WHERE id = ?", id)
	return err
}

// ImportPostmanCollection validates and imports a Postman v2 collection in a
// single transaction. Invalid input therefore cannot leave orphaned folders or
// requests behind.
func (m *DBManager) ImportPostmanCollection(collectionJSON string) (PostmanImportResult, error) {
	var collection postmanCollection
	if err := json.Unmarshal([]byte(collectionJSON), &collection); err != nil {
		return PostmanImportResult{}, fmt.Errorf("parse Postman collection: %w", err)
	}
	if strings.TrimSpace(collection.Info.Name) == "" || collection.Item == nil {
		return PostmanImportResult{}, fmt.Errorf("invalid Postman collection: missing info.name or item")
	}

	tx, err := m.db.Begin()
	if err != nil {
		return PostmanImportResult{}, err
	}
	defer tx.Rollback()

	projectID, err := newImportID("proj")
	if err != nil {
		return PostmanImportResult{}, err
	}
	if _, err := tx.Exec("INSERT INTO projects (id, name) VALUES (?, ?)", projectID, collection.Info.Name); err != nil {
		return PostmanImportResult{}, fmt.Errorf("create imported project: %w", err)
	}

	result := PostmanImportResult{ProjectID: projectID, ProjectName: collection.Info.Name}
	var importItems func(items []postmanItem, parentID string, inherited *postmanAuth) error
	importItems = func(items []postmanItem, parentID string, inherited *postmanAuth) error {
		for _, item := range items {
			if item.Item != nil {
				folderID, err := newImportID("fold")
				if err != nil {
					return err
				}
				name := strings.TrimSpace(item.Name)
				if name == "" {
					name = "Untitled Folder"
				}
				var parentIDValue any
				if parentID != "" {
					parentIDValue = parentID
				}
				if _, err := tx.Exec("INSERT INTO folders (id, project_id, parent_id, name) VALUES (?, ?, ?, ?)", folderID, projectID, parentIDValue, name); err != nil {
					return fmt.Errorf("create folder %q: %w", name, err)
				}
				result.ImportedFolders++
				// Requests inherit the nearest folder/collection auth, as in Postman.
				folderAuth := inherited
				if item.Auth != nil && item.Auth.Type != "inherit" {
					folderAuth = item.Auth
				}
				if err := importItems(item.Item, folderID, folderAuth); err != nil {
					return err
				}
				continue
			}

			if len(item.Request) == 0 || string(item.Request) == "null" {
				return fmt.Errorf("item %q has neither nested items nor a request", item.Name)
			}
			normalized, err := parsePostmanRequest(item.Request, inherited)
			if err != nil {
				return fmt.Errorf("parse request %q: %w", item.Name, err)
			}
			reqID, err := newImportID("req")
			if err != nil {
				return err
			}
			name := strings.TrimSpace(item.Name)
			if name == "" {
				name = "Untitled Request"
			}
			var folderIDValue any
			if parentID != "" {
				folderIDValue = parentID
			}
			encryptedToken, err := security.EncryptString(normalized.AuthToken)
			if err != nil {
				return fmt.Errorf("encrypt auth token: %w", err)
			}
			encryptedConfig, err := security.EncryptString(normalized.AuthConfigJSON)
			if err != nil {
				return fmt.Errorf("encrypt auth config: %w", err)
			}
			if _, err := tx.Exec(`INSERT INTO requests
				(id, project_id, folder_id, name, method, base_url, port, use_port, api_path, req_body, headers_json, params_json, body_type, auth_type, auth_token, auth_config_json)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				reqID, projectID, folderIDValue, name, normalized.Method, normalized.BaseURL, normalized.Port, normalized.UsePort, normalized.APIPath, normalized.Body, normalized.HeadersJSON, normalized.ParamsJSON, normalized.BodyType, normalized.AuthType, encryptedToken, encryptedConfig,
			); err != nil {
				return fmt.Errorf("create request %q: %w", name, err)
			}
			result.ImportedRequests++
		}
		return nil
	}

	if err := importItems(collection.Item, "", collection.Auth); err != nil {
		return PostmanImportResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return PostmanImportResult{}, fmt.Errorf("commit Postman import: %w", err)
	}
	return result, nil
}

type normalizedPostmanRequest struct {
	Method         string
	BaseURL        string
	Port           string
	UsePort        int
	APIPath        string
	Body           string
	HeadersJSON    string
	ParamsJSON     string
	BodyType       string
	AuthType       string
	AuthToken      string
	AuthConfigJSON string
}

func parsePostmanRequest(raw json.RawMessage, inherited *postmanAuth) (normalizedPostmanRequest, error) {
	var request postmanRequest
	var shorthandURL string
	if err := json.Unmarshal(raw, &shorthandURL); err == nil {
		request.Method = "GET"
		request.URL, _ = json.Marshal(shorthandURL)
	} else if err := json.Unmarshal(raw, &request); err != nil {
		return normalizedPostmanRequest{}, err
	}
	if strings.TrimSpace(request.Method) == "" {
		request.Method = "GET"
	}
	fullURL, err := parsePostmanURL(request.URL)
	if err != nil {
		return normalizedPostmanRequest{}, err
	}
	parts, err := splitTemplateURL(fullURL)
	if err != nil {
		return normalizedPostmanRequest{}, err
	}

	headers := make([]map[string]any, 0, len(request.Header))
	for index, header := range request.Header {
		if !header.Disabled && strings.TrimSpace(header.Key) != "" {
			headers = append(headers, map[string]any{"id": fmt.Sprintf("import_header_%d", index), "key": header.Key, "value": header.text(), "enabled": true})
		}
	}
	headersJSON, err := json.Marshal(headers)
	if err != nil {
		return normalizedPostmanRequest{}, fmt.Errorf("encode headers: %w", err)
	}

	// The query stays in api_path (the UI keeps path and params in sync) and
	// is mirrored into params_json so the Params table shows it.
	params := make([]map[string]any, 0)
	if queryIndex := strings.Index(parts.Path, "?"); queryIndex >= 0 {
		for index, pair := range strings.Split(parts.Path[queryIndex+1:], "&") {
			if pair == "" {
				continue
			}
			key, value, _ := strings.Cut(pair, "=")
			if decoded, err := url.QueryUnescape(key); err == nil {
				key = decoded
			}
			if decoded, err := url.QueryUnescape(value); err == nil {
				value = decoded
			}
			params = append(params, map[string]any{"id": fmt.Sprintf("import_param_%d", index), "key": key, "value": value, "enabled": true})
		}
	}
	paramsJSON, _ := json.Marshal(params)

	body, bodyType := "", "none"
	if request.Body != nil {
		switch request.Body.Mode {
		case "raw":
			body = request.Body.Raw
			switch strings.ToLower(request.Body.Options.Raw.Language) {
			case "", "json":
				bodyType = "json"
			default:
				bodyType = "raw"
			}
		case "urlencoded":
			rows := make([]map[string]any, 0, len(request.Body.URLEncoded))
			for index, field := range request.Body.URLEncoded {
				if strings.TrimSpace(field.Key) == "" {
					continue
				}
				rows = append(rows, map[string]any{"id": fmt.Sprintf("import_url_%d", index), "key": field.Key, "value": field.text(), "enabled": !field.Disabled})
			}
			encoded, _ := json.Marshal(rows)
			body, bodyType = string(encoded), "urlencoded"
		case "formdata":
			rows := make([]map[string]any, 0, len(request.Body.FormData))
			for index, field := range request.Body.FormData {
				if strings.TrimSpace(field.Key) == "" {
					continue
				}
				row := map[string]any{"id": fmt.Sprintf("import_form_%d", index), "key": field.Key, "value": field.text(), "enabled": !field.Disabled, "type": "text"}
				if field.Type == "file" {
					src := postmanRawText(field.Src)
					var srcList []string
					if json.Unmarshal(field.Src, &srcList) == nil && len(srcList) > 0 {
						src = srcList[0]
					}
					row["type"], row["value"], row["filePath"] = "file", "", src
				}
				rows = append(rows, row)
			}
			encoded, _ := json.Marshal(rows)
			body, bodyType = string(encoded), "formdata"
		case "graphql":
			if request.Body.GraphQL != nil {
				payload := map[string]any{"query": request.Body.GraphQL.Query}
				if vars := strings.TrimSpace(postmanRawText(request.Body.GraphQL.Variables)); vars != "" {
					var decoded any
					if json.Unmarshal([]byte(vars), &decoded) == nil {
						payload["variables"] = decoded
					} else {
						payload["variables"] = vars
					}
				}
				encoded, _ := json.MarshalIndent(payload, "", "  ")
				body, bodyType = string(encoded), "json"
			}
		}
	}

	auth := request.Auth
	if auth == nil || auth.Type == "inherit" {
		auth = inherited
	}
	authType, authToken, authConfigJSON := parsePostmanAuth(auth)
	return normalizedPostmanRequest{
		Method: strings.ToUpper(request.Method), BaseURL: parts.Base, Port: parts.Port,
		UsePort: boolToInt(parts.Port != ""), APIPath: parts.Path, Body: body, HeadersJSON: string(headersJSON),
		ParamsJSON: string(paramsJSON), BodyType: bodyType, AuthType: authType, AuthToken: authToken, AuthConfigJSON: authConfigJSON,
	}, nil
}

type templateURLParts struct {
	Base string // "scheme://host", "{{baseUrl}}" or a bare host
	Port string
	Path string // path plus query, always starting with "/"
}

// splitTemplateURL splits a URL that may contain {{variables}} anywhere
// (including as the whole base) without first requiring a valid absolute URL.
// IPv6 literals keep their brackets.
func splitTemplateURL(raw string) (templateURLParts, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return templateURLParts{}, fmt.Errorf("missing URL")
	}
	var parts templateURLParts
	rest := raw
	scheme := ""
	if index := strings.Index(rest, "://"); index > 0 && !strings.ContainsAny(rest[:index], "/{}") {
		scheme = rest[:index+3]
		rest = rest[index+3:]
	}
	authorityEnd := len(rest)
	depth := 0
scan:
	for i := 0; i < len(rest); i++ {
		switch rest[i] {
		case '{':
			depth++
		case '}':
			if depth > 0 {
				depth--
			}
		case '/', '?', '#':
			if depth == 0 {
				authorityEnd = i
				break scan
			}
		}
	}
	authority, path := rest[:authorityEnd], rest[authorityEnd:]
	if authority == "" {
		return templateURLParts{}, fmt.Errorf("invalid URL %q: missing host", raw)
	}
	// Separate a numeric port; IPv6 literals ("[::1]") and variables are kept.
	if colon := strings.LastIndex(authority, ":"); colon > 0 && colon > strings.LastIndex(authority, "]") {
		if port := authority[colon+1:]; port != "" && strings.Trim(port, "0123456789") == "" {
			parts.Port = port
			authority = authority[:colon]
		}
	}
	parts.Base = scheme + authority
	if fragment := strings.Index(path, "#"); fragment >= 0 {
		path = path[:fragment]
	}
	if path == "" || path[0] != '/' {
		path = "/" + path
	}
	parts.Path = path
	return parts, nil
}

func parsePostmanURL(raw json.RawMessage) (string, error) {
	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil && strings.TrimSpace(asString) != "" {
		return asString, nil
	}
	var asObject struct {
		Raw      string            `json:"raw"`
		Protocol string            `json:"protocol"`
		Host     json.RawMessage   `json:"host"`
		Port     string            `json:"port"`
		Path     json.RawMessage   `json:"path"`
		Query    []postmanKeyValue `json:"query"`
	}
	if err := json.Unmarshal(raw, &asObject); err != nil {
		return "", err
	}
	if strings.TrimSpace(asObject.Raw) != "" {
		return asObject.Raw, nil
	}
	joinParts := func(rawParts json.RawMessage, sep string) string {
		var list []string
		if json.Unmarshal(rawParts, &list) == nil {
			return strings.Join(list, sep)
		}
		return postmanRawText(rawParts)
	}
	host := joinParts(asObject.Host, ".")
	if host == "" {
		return "", fmt.Errorf("missing URL")
	}
	result := host
	if asObject.Protocol != "" {
		result = asObject.Protocol + "://" + host
	}
	if asObject.Port != "" {
		result += ":" + asObject.Port
	}
	result += "/" + strings.TrimLeft(joinParts(asObject.Path, "/"), "/")
	query := make([]string, 0, len(asObject.Query))
	for _, item := range asObject.Query {
		if !item.Disabled && item.Key != "" {
			query = append(query, url.QueryEscape(item.Key)+"="+url.QueryEscape(item.text()))
		}
	}
	if len(query) > 0 {
		result += "?" + strings.Join(query, "&")
	}
	return result, nil
}

func parsePostmanAuth(auth *postmanAuth) (string, string, string) {
	if auth == nil {
		return "none", "", "{}"
	}
	values := func(items []postmanKeyValue) map[string]string {
		result := make(map[string]string, len(items))
		for _, item := range items {
			result[item.Key] = item.text()
		}
		return result
	}
	switch auth.Type {
	case "bearer":
		return "bearer", values(auth.Bearer)["token"], "{}"
	case "basic":
		basic := values(auth.Basic)
		config, _ := json.Marshal(map[string]string{"username": basic["username"], "password": basic["password"]})
		return "basic", "", string(config)
	case "apikey":
		apiKey := values(auth.APIKey)
		placement := apiKey["in"]
		if placement == "" {
			placement = "header"
		}
		config, _ := json.Marshal(map[string]string{"apiKeyName": apiKey["key"], "apiKeyValue": apiKey["value"], "apiKeyAddTo": placement})
		return "apikey", "", string(config)
	default:
		return "none", "", "{}"
	}
}

func newImportID(prefix string) (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate %s ID: %w", prefix, err)
	}
	return prefix + "_" + hex.EncodeToString(bytes), nil
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

// ==========================================
// ENVIRONMENTS CRUD
// ==========================================

func (m *DBManager) GetEnvironments() ([]DBEnvironment, error) {
	rows, err := m.db.Query("SELECT id, name FROM environments")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var envs []DBEnvironment
	for rows.Next() {
		var env DBEnvironment
		if err := rows.Scan(&env.ID, &env.Name); err != nil {
			return nil, err
		}
		envs = append(envs, env)
	}

	for i := range envs {
		varRows, err := m.db.Query("SELECT id, var_key, var_val, enabled FROM env_variables WHERE env_id = ?", envs[i].ID)
		if err != nil {
			continue
		}
		var vars []DBEnvVariable
		for varRows.Next() {
			var v DBEnvVariable
			var enabledInt int
			if err := varRows.Scan(&v.ID, &v.Key, &v.Value, &enabledInt); err == nil {
				v.Enabled = enabledInt == 1
				// Decrypt value transparently
				v.Value = decryptSecret(v.Value)
				vars = append(vars, v)
			}
		}
		varRows.Close()
		envs[i].Variables = vars
	}

	return envs, nil
}

func (m *DBManager) SaveEnvironment(env DBEnvironment) error {
	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec("INSERT INTO environments (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name", env.ID, env.Name)
	if err != nil {
		return err
	}

	if _, err := tx.Exec("DELETE FROM env_variables WHERE env_id = ?", env.ID); err != nil {
		return err
	}

	for _, v := range env.Variables {
		enabledInt := 0
		if v.Enabled {
			enabledInt = 1
		}
		// Encrypt environment variable value before storing
		encVal, err := security.EncryptString(v.Value)
		if err != nil {
			return fmt.Errorf("encrypt variable %q: %w", v.Key, err)
		}
		_, err = tx.Exec("INSERT INTO env_variables (id, env_id, var_key, var_val, enabled) VALUES (?, ?, ?, ?, ?)",
			v.ID, env.ID, v.Key, encVal, enabledInt)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (m *DBManager) DeleteEnvironment(id string) error {
	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM env_variables WHERE env_id = ?", id); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM environments WHERE id = ?", id); err != nil {
		return err
	}
	return tx.Commit()
}

func (m *DBManager) SaveAllEnvironments(envs []DBEnvironment) error {
	for _, env := range envs {
		if err := m.SaveEnvironment(env); err != nil {
			return err
		}
	}
	return nil
}

// ==========================================
// SCENARIOS CRUD
// ==========================================

func (m *DBManager) GetScenarios() ([]DBScenario, error) {
	rows, err := m.db.Query("SELECT id, name, description, base_url, stop_on_error, delay_ms FROM scenarios")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var scenarios []DBScenario
	for rows.Next() {
		var s DBScenario
		var stopOnErrorInt int
		if err := rows.Scan(&s.ID, &s.Name, &s.Description, &s.BaseURL, &stopOnErrorInt, &s.DelayMs); err != nil {
			return nil, err
		}
		s.StopOnError = stopOnErrorInt == 1
		scenarios = append(scenarios, s)
	}

	for i := range scenarios {
		stepRows, err := m.db.Query(`
			SELECT id, scenario_id, step_order, name, method, api_path,
			       headers_json, params_json, body, body_type, auth_type,
			       auth_token, auth_config_json, assertions_json, extract_vars_json
			FROM scenario_steps
			WHERE scenario_id = ?
			ORDER BY step_order ASC
		`, scenarios[i].ID)
		if err != nil {
			continue
		}

		var steps []DBScenarioStep
		for stepRows.Next() {
			var st DBScenarioStep
			if err := stepRows.Scan(
				&st.ID, &st.ScenarioID, &st.StepOrder, &st.Name, &st.Method, &st.ApiPath,
				&st.HeadersJson, &st.ParamsJson, &st.Body, &st.BodyType, &st.AuthType,
				&st.AuthToken, &st.AuthConfigJson, &st.AssertionsJson, &st.ExtractVarsJson,
			); err == nil {
				// Decrypt sensitive fields
				st.AuthToken = decryptSecret(st.AuthToken)
				st.AuthConfigJson = decryptSecret(st.AuthConfigJson)
				if st.AuthConfigJson == "" {
					st.AuthConfigJson = "{}"
				}
				steps = append(steps, st)
			}
		}
		stepRows.Close()
		scenarios[i].Steps = steps
	}

	return scenarios, nil
}

func (m *DBManager) SaveScenario(s DBScenario) error {
	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stopOnErrorInt := 0
	if s.StopOnError {
		stopOnErrorInt = 1
	}

	_, err = tx.Exec(`
		INSERT INTO scenarios (id, name, description, base_url, stop_on_error, delay_ms)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			description = excluded.description,
			base_url = excluded.base_url,
			stop_on_error = excluded.stop_on_error,
			delay_ms = excluded.delay_ms
	`, s.ID, s.Name, s.Description, s.BaseURL, stopOnErrorInt, s.DelayMs)
	if err != nil {
		return err
	}

	if _, err := tx.Exec("DELETE FROM scenario_steps WHERE scenario_id = ?", s.ID); err != nil {
		return err
	}

	for idx, st := range s.Steps {
		encToken, err := security.EncryptString(st.AuthToken)
		if err != nil {
			return fmt.Errorf("encrypt step auth token: %w", err)
		}
		encConfig, err := security.EncryptString(st.AuthConfigJson)
		if err != nil {
			return fmt.Errorf("encrypt step auth config: %w", err)
		}

		stepOrder := st.StepOrder
		if stepOrder <= 0 {
			stepOrder = idx + 1
		}

		_, err = tx.Exec(`
			INSERT INTO scenario_steps (
				id, scenario_id, step_order, name, method, api_path,
				headers_json, params_json, body, body_type, auth_type,
				auth_token, auth_config_json, assertions_json, extract_vars_json
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, st.ID, s.ID, stepOrder, st.Name, st.Method, st.ApiPath,
			st.HeadersJson, st.ParamsJson, st.Body, st.BodyType, st.AuthType,
			encToken, encConfig, st.AssertionsJson, st.ExtractVarsJson)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (m *DBManager) DeleteScenario(id string) error {
	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM scenario_steps WHERE scenario_id = ?", id); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM scenarios WHERE id = ?", id); err != nil {
		return err
	}
	return tx.Commit()
}

// ==========================================
// UI AUTOMATION SCENARIOS & RUNS CRUD
// ==========================================

func (m *DBManager) GetUIScenarios() ([]DBUIScenario, error) {
	rows, err := m.db.Query("SELECT id, project_id, folder_id, name, browser, base_url, created_at, updated_at FROM ui_scenarios ORDER BY created_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var scenarios []DBUIScenario
	for rows.Next() {
		var s DBUIScenario
		var createdAt, updatedAt sql.NullString
		if err := rows.Scan(&s.ID, &s.ProjectID, &s.FolderID, &s.Name, &s.Browser, &s.BaseURL, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		s.CreatedAt = createdAt.String
		s.UpdatedAt = updatedAt.String
		scenarios = append(scenarios, s)
	}

	for i := range scenarios {
		stepRows, err := m.db.Query(`
			SELECT id, scenario_id, sort_order, type, selector, value, timeout, config_json, created_at
			FROM ui_steps
			WHERE scenario_id = ?
			ORDER BY sort_order ASC
		`, scenarios[i].ID)
		if err != nil {
			continue
		}

		var steps []DBUIStep
		for stepRows.Next() {
			var st DBUIStep
			var createdAt sql.NullString
			if err := stepRows.Scan(&st.ID, &st.ScenarioID, &st.SortOrder, &st.Type, &st.Selector, &st.Value, &st.Timeout, &st.ConfigJSON, &createdAt); err == nil {
				st.CreatedAt = createdAt.String
				steps = append(steps, st)
			}
		}
		stepRows.Close()
		scenarios[i].Steps = steps
	}

	return scenarios, nil
}

func (m *DBManager) GetUIScenario(id string) (*DBUIScenario, error) {
	row := m.db.QueryRow("SELECT id, project_id, folder_id, name, browser, base_url, created_at, updated_at FROM ui_scenarios WHERE id = ?", id)
	var s DBUIScenario
	var createdAt, updatedAt sql.NullString
	if err := row.Scan(&s.ID, &s.ProjectID, &s.FolderID, &s.Name, &s.Browser, &s.BaseURL, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	s.CreatedAt = createdAt.String
	s.UpdatedAt = updatedAt.String

	stepRows, err := m.db.Query(`
		SELECT id, scenario_id, sort_order, type, selector, value, timeout, config_json, created_at
		FROM ui_steps
		WHERE scenario_id = ?
		ORDER BY sort_order ASC
	`, s.ID)
	if err == nil {
		var steps []DBUIStep
		for stepRows.Next() {
			var st DBUIStep
			var cAt sql.NullString
			if err := stepRows.Scan(&st.ID, &st.ScenarioID, &st.SortOrder, &st.Type, &st.Selector, &st.Value, &st.Timeout, &st.ConfigJSON, &cAt); err == nil {
				st.CreatedAt = cAt.String
				steps = append(steps, st)
			}
		}
		stepRows.Close()
		s.Steps = steps
	}

	return &s, nil
}

func (m *DBManager) SaveUIScenario(s DBUIScenario) error {
	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if s.Browser == "" {
		s.Browser = "chromium"
	}

	_, err = tx.Exec(`
		INSERT INTO ui_scenarios (id, project_id, folder_id, name, browser, base_url, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET
			project_id = excluded.project_id,
			folder_id = excluded.folder_id,
			name = excluded.name,
			browser = excluded.browser,
			base_url = excluded.base_url,
			updated_at = CURRENT_TIMESTAMP
	`, s.ID, s.ProjectID, s.FolderID, s.Name, s.Browser, s.BaseURL)
	if err != nil {
		return err
	}

	if _, err := tx.Exec("DELETE FROM ui_steps WHERE scenario_id = ?", s.ID); err != nil {
		return err
	}

	for idx, st := range s.Steps {
		sortOrder := st.SortOrder
		if sortOrder <= 0 {
			sortOrder = idx + 1
		}
		timeout := st.Timeout
		if timeout <= 0 {
			timeout = 5000
		}
		cfg := st.ConfigJSON
		if cfg == "" {
			cfg = "{}"
		}

		_, err = tx.Exec(`
			INSERT INTO ui_steps (id, scenario_id, sort_order, type, selector, value, timeout, config_json)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, st.ID, s.ID, sortOrder, st.Type, st.Selector, st.Value, timeout, cfg)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (m *DBManager) DeleteUIScenario(id string) error {
	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM ui_steps WHERE scenario_id = ?", id); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM ui_scenarios WHERE id = ?", id); err != nil {
		return err
	}
	return tx.Commit()
}

func (m *DBManager) SaveUITestRun(run DBUITestRun, results []DBUITestResult) error {
	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		INSERT INTO ui_test_runs (id, scenario_id, status, started_at, finished_at, duration)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			status = excluded.status,
			finished_at = excluded.finished_at,
			duration = excluded.duration
	`, run.ID, run.ScenarioID, run.Status, run.StartedAt, run.FinishedAt, run.Duration)
	if err != nil {
		return err
	}

	for _, res := range results {
		_, err = tx.Exec(`
			INSERT INTO ui_test_results (id, run_id, step_id, step_order, status, error, duration, screenshot_path, details)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, res.ID, run.ID, res.StepID, res.StepOrder, res.Status, res.Error, res.Duration, res.ScreenshotPath, res.Details)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (m *DBManager) GetUITestRuns(scenarioID string) ([]DBUITestRun, error) {
	rows, err := m.db.Query(`
		SELECT id, scenario_id, status, started_at, COALESCE(finished_at, ''), duration
		FROM ui_test_runs
		WHERE scenario_id = ?
		ORDER BY started_at DESC
		LIMIT 20
	`, scenarioID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var runs []DBUITestRun
	for rows.Next() {
		var r DBUITestRun
		if err := rows.Scan(&r.ID, &r.ScenarioID, &r.Status, &r.StartedAt, &r.FinishedAt, &r.Duration); err == nil {
			runs = append(runs, r)
		}
	}
	return runs, nil
}

func (m *DBManager) GetUITestResults(runID string) ([]DBUITestResult, error) {
	rows, err := m.db.Query(`
		SELECT id, run_id, step_id, step_order, status, error, duration, screenshot_path, details
		FROM ui_test_results
		WHERE run_id = ?
		ORDER BY step_order ASC, id ASC
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []DBUITestResult
	for rows.Next() {
		var res DBUITestResult
		if err := rows.Scan(&res.ID, &res.RunID, &res.StepID, &res.StepOrder, &res.Status, &res.Error, &res.Duration, &res.ScreenshotPath, &res.Details); err == nil {
			results = append(results, res)
		}
	}
	return results, nil
}

func (m *DBManager) GetUITestScreenshotPath(runID, resultID string) (string, error) {
	var path string
	err := m.db.QueryRow(`SELECT screenshot_path FROM ui_test_results WHERE run_id = ? AND id = ?`, runID, resultID).Scan(&path)
	return path, err
}

func (m *DBManager) SaveScenarioTestRun(run DBScenarioTestRun, results []DBScenarioTestResult) error {
	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`INSERT INTO scenario_test_runs (id, scenario_id, status, started_at, finished_at, duration) VALUES (?, ?, ?, ?, ?, ?)`, run.ID, run.ScenarioID, run.Status, run.StartedAt, run.FinishedAt, run.Duration); err != nil {
		return err
	}
	for _, result := range results {
		if _, err = tx.Exec(`INSERT INTO scenario_test_results (id, run_id, step_id, step_order, status, duration, method, url, http_status, response_body, response_headers, assertion_details, extracted_vars, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, result.ID, result.RunID, result.StepID, result.StepOrder, result.Status, result.Duration, result.Method, result.URL, result.HTTPStatus, result.ResponseBody, result.ResponseHeaders, result.AssertionDetails, result.ExtractedVars, result.Error); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (m *DBManager) GetScenarioTestRuns(scenarioID string) ([]DBScenarioTestRun, error) {
	rows, err := m.db.Query(`SELECT id, scenario_id, status, started_at, COALESCE(finished_at, ''), duration FROM scenario_test_runs WHERE scenario_id = ? ORDER BY started_at DESC LIMIT 50`, scenarioID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var runs []DBScenarioTestRun
	for rows.Next() {
		var run DBScenarioTestRun
		if err := rows.Scan(&run.ID, &run.ScenarioID, &run.Status, &run.StartedAt, &run.FinishedAt, &run.Duration); err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

func (m *DBManager) GetScenarioTestResults(runID string) ([]DBScenarioTestResult, error) {
	rows, err := m.db.Query(`SELECT id, run_id, step_id, step_order, status, duration, method, url, http_status, response_body, response_headers, assertion_details, extracted_vars, error FROM scenario_test_results WHERE run_id = ? ORDER BY step_order ASC, id ASC`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []DBScenarioTestResult
	for rows.Next() {
		var result DBScenarioTestResult
		if err := rows.Scan(&result.ID, &result.RunID, &result.StepID, &result.StepOrder, &result.Status, &result.Duration, &result.Method, &result.URL, &result.HTTPStatus, &result.ResponseBody, &result.ResponseHeaders, &result.AssertionDetails, &result.ExtractedVars, &result.Error); err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	return results, rows.Err()
}

// ==========================================
// ACTIVITY HISTORY CRUD
// ==========================================

func (m *DBManager) GetActivityHistory(limit int) ([]DBActivityHistory, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := m.db.Query(`SELECT id, method, url, status, duration, timestamp, COALESCE(created_at, '') 
		FROM activity_history 
		ORDER BY datetime(created_at) DESC, rowid DESC 
		LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []DBActivityHistory
	for rows.Next() {
		var item DBActivityHistory
		if err := rows.Scan(&item.ID, &item.Method, &item.URL, &item.Status, &item.Duration, &item.Timestamp, &item.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, nil
}

func (m *DBManager) SaveActivityHistory(item DBActivityHistory) error {
	_, err := m.db.Exec(`INSERT INTO activity_history (id, method, url, status, duration, timestamp) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET method = excluded.method, url = excluded.url, status = excluded.status, duration = excluded.duration, timestamp = excluded.timestamp`,
		item.ID, item.Method, item.URL, item.Status, item.Duration, item.Timestamp)
	if err != nil {
		return err
	}

	// Keep history table bounded (most recent 200 items)
	_, _ = m.db.Exec(`DELETE FROM activity_history WHERE id NOT IN (
		SELECT id FROM activity_history ORDER BY datetime(created_at) DESC, rowid DESC LIMIT 200
	)`)
	return nil
}

func (m *DBManager) DeleteActivityHistory(id string) error {
	_, err := m.db.Exec("DELETE FROM activity_history WHERE id = ?", id)
	return err
}

func (m *DBManager) ClearActivityHistory() error {
	_, err := m.db.Exec("DELETE FROM activity_history")
	return err
}

// ==========================================
// APP SETTINGS & WORKSPACE SESSION
// ==========================================

func (m *DBManager) GetAppSetting(key string) (string, error) {
	var val string
	err := m.db.QueryRow("SELECT value FROM app_settings WHERE key = ?", key).Scan(&val)
	if err != nil {
		return "", err
	}
	return val, nil
}

func (m *DBManager) SetAppSetting(key, value string) error {
	_, err := m.db.Exec(`INSERT INTO app_settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

func (m *DBManager) GetWorkspaceSession() (DBWorkspaceSession, error) {
	var session DBWorkspaceSession
	val, err := m.GetAppSetting("workspace_session")
	if err != nil {
		return session, err
	}
	if err := json.Unmarshal([]byte(val), &session); err != nil {
		return session, err
	}
	return session, nil
}

func (m *DBManager) SaveWorkspaceSession(session DBWorkspaceSession) error {
	data, err := json.Marshal(session)
	if err != nil {
		return err
	}
	return m.SetAppSetting("workspace_session", string(data))
}
