package main

import (
	"database/sql"
	"internal-api-client/internal/security"
	"testing"

	_ "modernc.org/sqlite"
)

func newPostmanImportTestDB(t *testing.T) *DBManager {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	for _, statement := range []string{
		"CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
		"CREATE TABLE folders (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, name TEXT NOT NULL)",
		`CREATE TABLE requests (
			id TEXT PRIMARY KEY, project_id TEXT NOT NULL, folder_id TEXT, name TEXT NOT NULL,
			method TEXT NOT NULL, base_url TEXT NOT NULL, port TEXT NOT NULL, use_port INTEGER NOT NULL,
			api_path TEXT NOT NULL, req_body TEXT NOT NULL, headers_json TEXT NOT NULL, params_json TEXT,
			body_type TEXT, auth_type TEXT, auth_token TEXT, auth_config_json TEXT
		)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	return &DBManager{db: db}
}

func TestImportPostmanCollectionPreservesHierarchyAndRequestData(t *testing.T) {
	manager := newPostmanImportTestDB(t)
	collection := `{
		"info":{"name":"Orders"},
		"item":[{
			"name":"Admin","item":[{
				"name":"Nested","item":[{
					"name":"Create order","request":{
						"method":"POST","url":{"protocol":"https","host":["api","example","com"],"path":["v1","orders"],"query":[{"key":"dryRun","value":"true"}]},
						"header":[{"key":"Content-Type","value":"application/json"}],
						"body":{"mode":"raw","raw":"{\"name\":\"test\"}"},
						"auth":{"type":"bearer","bearer":[{"key":"token","value":"secret"}]}
					}
				}]
			}]
		}]
	}`

	result, err := manager.ImportPostmanCollection(collection)
	if err != nil {
		t.Fatalf("import failed: %v", err)
	}
	if result.ImportedFolders != 2 || result.ImportedRequests != 1 {
		t.Fatalf("unexpected import counts: %+v", result)
	}

	var projectID, parentID, folderID, baseURL, apiPath, body, authToken string
	if err := manager.db.QueryRow("SELECT project_id, parent_id FROM folders WHERE name = 'Nested'").Scan(&projectID, &parentID); err != nil {
		t.Fatal(err)
	}
	if projectID != result.ProjectID || parentID == "" {
		t.Fatalf("nested folder is not linked to its imported project/parent: project=%q parent=%q", projectID, parentID)
	}
	if err := manager.db.QueryRow("SELECT folder_id, base_url, api_path, req_body, auth_token FROM requests WHERE name = 'Create order'").Scan(&folderID, &baseURL, &apiPath, &body, &authToken); err != nil {
		t.Fatal(err)
	}
	decryptedToken, err := security.DecryptString(authToken)
	if err != nil {
		t.Fatal(err)
	}
	if folderID == "" || baseURL != "https://api.example.com" || apiPath != "/v1/orders?dryRun=true" || body != `{"name":"test"}` || decryptedToken != "secret" {
		t.Fatalf("request was not imported correctly: folder=%q base=%q path=%q body=%q token=%q", folderID, baseURL, apiPath, body, authToken)
	}
}

func TestImportPostmanCollectionRollsBackOnInvalidItem(t *testing.T) {
	manager := newPostmanImportTestDB(t)
	_, err := manager.ImportPostmanCollection(`{"info":{"name":"Broken"},"item":[{"name":"Valid folder","item":[{"name":"Missing request"}]}]}`)
	if err == nil {
		t.Fatal("expected invalid item to fail import")
	}
	var projects, folders int
	if err := manager.db.QueryRow("SELECT COUNT(*) FROM projects").Scan(&projects); err != nil {
		t.Fatal(err)
	}
	if err := manager.db.QueryRow("SELECT COUNT(*) FROM folders").Scan(&folders); err != nil {
		t.Fatal(err)
	}
	if projects != 0 || folders != 0 {
		t.Fatalf("failed import left partial data: projects=%d folders=%d", projects, folders)
	}
}
