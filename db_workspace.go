package main

import (
	"encoding/json"
	"fmt"
	"internal-api-client/internal/security"
	"strings"
)

// FullWorkspaceExport is the backup format written by ExportFullWorkspace and
// read back by ImportFullWorkspace.
type FullWorkspaceExport struct {
	Projects       []DBProject     `json:"projects"`
	Folders        []DBFolder      `json:"folders"`
	Requests       []DBRequest     `json:"requests"`
	Environments   []DBEnvironment `json:"environments"`
	Scenarios      []DBScenario    `json:"scenarios,omitempty"`
	Version        string          `json:"version"`
	SecretsOmitted bool            `json:"secretsOmitted,omitempty"`
}

type WorkspaceImportResult struct {
	Projects     int `json:"projects"`
	Folders      int `json:"folders"`
	Requests     int `json:"requests"`
	Environments int `json:"environments"`
	Scenarios    int `json:"scenarios"`
}

// secretConfigKeys are the auth-config fields that hold credentials.
var secretConfigKeys = []string{"password", "apiKeyValue", "value", "token", "clientSecret"}

// stripAuthConfigSecrets blanks credential fields inside an auth config JSON.
func stripAuthConfigSecrets(configJSON string) string {
	var cfg map[string]any
	if json.Unmarshal([]byte(configJSON), &cfg) != nil {
		return "{}"
	}
	for _, key := range secretConfigKeys {
		if _, ok := cfg[key]; ok {
			cfg[key] = ""
		}
	}
	encoded, err := json.Marshal(cfg)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

// redactWorkspaceSecrets removes tokens, passwords and secret-looking
// environment values so a backup can be shared without leaking credentials.
func redactWorkspaceSecrets(export *FullWorkspaceExport) {
	export.SecretsOmitted = true
	for i := range export.Requests {
		export.Requests[i].AuthToken = ""
		export.Requests[i].AuthConfigJson = stripAuthConfigSecrets(export.Requests[i].AuthConfigJson)
	}
	for i := range export.Environments {
		for j := range export.Environments[i].Variables {
			if automationSecretName.MatchString(export.Environments[i].Variables[j].Key) {
				export.Environments[i].Variables[j].Value = ""
			}
		}
	}
	for i := range export.Scenarios {
		for j := range export.Scenarios[i].Steps {
			export.Scenarios[i].Steps[j].AuthToken = ""
			export.Scenarios[i].Steps[j].AuthConfigJson = stripAuthConfigSecrets(export.Scenarios[i].Steps[j].AuthConfigJson)
		}
	}
}

// mergeAuthConfig keeps the stored credentials for fields that an imported
// (secret-less) backup left empty.
func mergeAuthConfig(imported, existing string) string {
	var in, old map[string]any
	if json.Unmarshal([]byte(imported), &in) != nil {
		return imported
	}
	if json.Unmarshal([]byte(existing), &old) != nil {
		return imported
	}
	for _, key := range secretConfigKeys {
		if value, ok := in[key]; ok && automationValueString(value) == "" {
			if previous, ok := old[key]; ok {
				in[key] = previous
			}
		}
	}
	encoded, err := json.Marshal(in)
	if err != nil {
		return imported
	}
	return string(encoded)
}

// ImportWorkspace restores a FullWorkspaceExport in one transaction. Rows are
// upserted by ID; when the backup was exported without secrets, the secrets
// already stored locally for the same rows are preserved.
func (m *DBManager) ImportWorkspace(data FullWorkspaceExport) (WorkspaceImportResult, error) {
	var result WorkspaceImportResult
	tx, err := m.db.Begin()
	if err != nil {
		return result, err
	}
	defer tx.Rollback()

	nullable := func(value string) any {
		if value == "" {
			return nil
		}
		return value
	}
	storedSecret := func(query, id string) string {
		var value string
		if err := tx.QueryRow(query, id).Scan(&value); err != nil {
			return ""
		}
		return decryptSecret(value)
	}

	for _, project := range data.Projects {
		if strings.TrimSpace(project.ID) == "" {
			return result, fmt.Errorf("project without id")
		}
		if _, err := tx.Exec(`INSERT INTO projects (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name`, project.ID, project.Name); err != nil {
			return result, fmt.Errorf("import project %q: %w", project.Name, err)
		}
		result.Projects++
	}
	for _, folder := range data.Folders {
		if _, err := tx.Exec(`INSERT INTO folders (id, project_id, parent_id, name) VALUES (?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, parent_id = excluded.parent_id, name = excluded.name`,
			folder.ID, folder.ProjectID, nullable(folder.ParentID), folder.Name); err != nil {
			return result, fmt.Errorf("import folder %q: %w", folder.Name, err)
		}
		result.Folders++
	}
	for _, req := range data.Requests {
		token, config := req.AuthToken, req.AuthConfigJson
		if config == "" {
			config = "{}"
		}
		if token == "" {
			token = storedSecret("SELECT COALESCE(auth_token, '') FROM requests WHERE id = ?", req.ID)
		}
		config = mergeAuthConfig(config, storedSecret("SELECT COALESCE(auth_config_json, '{}') FROM requests WHERE id = ?", req.ID))
		encToken, err := security.EncryptString(token)
		if err != nil {
			return result, err
		}
		encConfig, err := security.EncryptString(config)
		if err != nil {
			return result, err
		}
		assertions := req.AssertionsJson
		if assertions == "" {
			assertions = "[]"
		}
		if _, err := tx.Exec(`INSERT INTO requests
			(id, project_id, folder_id, name, method, base_url, port, use_port, api_path, req_body, headers_json, params_json, body_type, auth_type, auth_token, auth_config_json, assertions_json)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, folder_id = excluded.folder_id, name = excluded.name,
				method = excluded.method, base_url = excluded.base_url, port = excluded.port, use_port = excluded.use_port,
				api_path = excluded.api_path, req_body = excluded.req_body, headers_json = excluded.headers_json,
				params_json = excluded.params_json, body_type = excluded.body_type, auth_type = excluded.auth_type,
				auth_token = excluded.auth_token, auth_config_json = excluded.auth_config_json, assertions_json = excluded.assertions_json`,
			req.ID, req.ProjectID, nullable(req.FolderID), req.Name, req.Method, req.BaseURL, req.Port, boolToInt(req.UsePort), req.ApiPath, req.ReqBody,
			defaultString(req.HeadersJson, "[]"), defaultString(req.ParamsJson, "[]"), defaultString(req.BodyType, "json"), defaultString(req.AuthType, "none"),
			encToken, encConfig, assertions); err != nil {
			return result, fmt.Errorf("import request %q: %w", req.Name, err)
		}
		result.Requests++
	}
	for _, env := range data.Environments {
		if _, err := tx.Exec("INSERT INTO environments (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name", env.ID, env.Name); err != nil {
			return result, fmt.Errorf("import environment %q: %w", env.Name, err)
		}
		keep := make([]any, 0, len(env.Variables)+1)
		keep = append(keep, env.ID)
		for _, v := range env.Variables {
			value := v.Value
			if value == "" {
				value = storedSecret("SELECT var_val FROM env_variables WHERE id = ?", v.ID)
			}
			encVal, err := security.EncryptString(value)
			if err != nil {
				return result, err
			}
			if _, err := tx.Exec(`INSERT INTO env_variables (id, env_id, var_key, var_val, enabled) VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET env_id = excluded.env_id, var_key = excluded.var_key, var_val = excluded.var_val, enabled = excluded.enabled`,
				v.ID, env.ID, v.Key, encVal, boolToInt(v.Enabled)); err != nil {
				return result, fmt.Errorf("import variable %q: %w", v.Key, err)
			}
			keep = append(keep, v.ID)
		}
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(keep)-1), ",")
		query := "DELETE FROM env_variables WHERE env_id = ?"
		if placeholders != "" {
			query += " AND id NOT IN (" + placeholders + ")"
		}
		if _, err := tx.Exec(query, keep...); err != nil {
			return result, err
		}
		result.Environments++
	}
	if err := tx.Commit(); err != nil {
		return result, fmt.Errorf("commit workspace import: %w", err)
	}

	for _, scenario := range data.Scenarios {
		for i := range scenario.Steps {
			if scenario.Steps[i].AuthToken == "" {
				scenario.Steps[i].AuthToken = m.storedStepSecret("SELECT COALESCE(auth_token, '') FROM scenario_steps WHERE id = ?", scenario.Steps[i].ID)
			}
			scenario.Steps[i].AuthConfigJson = mergeAuthConfig(defaultString(scenario.Steps[i].AuthConfigJson, "{}"), m.storedStepSecret("SELECT COALESCE(auth_config_json, '{}') FROM scenario_steps WHERE id = ?", scenario.Steps[i].ID))
		}
		if err := m.SaveScenario(scenario); err != nil {
			return result, fmt.Errorf("import scenario %q: %w", scenario.Name, err)
		}
		result.Scenarios++
	}
	return result, nil
}

func (m *DBManager) storedStepSecret(query, id string) string {
	var value string
	if err := m.db.QueryRow(query, id).Scan(&value); err != nil {
		return ""
	}
	return decryptSecret(value)
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
