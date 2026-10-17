package main

import (
	"database/sql"
	"encoding/json"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func newSchemaTestDB(t *testing.T) *DBManager {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatal(err)
	}
	// Every pooled connection to ":memory:" would be a separate database.
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	if err := migrateSchema(db); err != nil {
		t.Fatal(err)
	}
	return &DBManager{db: db}
}

func TestPostmanImportHandlesRealWorldCollections(t *testing.T) {
	manager := newSchemaTestDB(t)
	collection := `{
		"info":{"name":"Real"},
		"auth":{"type":"bearer","bearer":[{"key":"token","value":"{{token}}"}]},
		"item":[
			{"name":"Empty folder","item":[]},
			{"name":"Vars","request":{"method":"get","url":{"raw":"{{baseUrl}}/users?page=2"}}},
			{"name":"IPv6","request":{"method":"GET","url":"http://[::1]:8080/health"}},
			{"name":"Upload","request":{"method":"POST","url":"https://x.test/upload","auth":{"type":"noauth"},
				"body":{"mode":"formdata","formdata":[{"key":"note","value":"hi","type":"text"},{"key":"file","type":"file","src":"C:/a.png"}]}}}
		]
	}`
	result, err := manager.ImportPostmanCollection(collection)
	if err != nil {
		t.Fatalf("import failed: %v", err)
	}
	if result.ImportedFolders != 1 || result.ImportedRequests != 3 {
		t.Fatalf("unexpected counts %+v", result)
	}
	requests, err := manager.GetRequests()
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]DBRequest{}
	for _, r := range requests {
		byName[r.Name] = r
	}
	if r := byName["Vars"]; r.BaseURL != "{{baseUrl}}" || r.ApiPath != "/users?page=2" || r.Method != "GET" || r.AuthType != "bearer" || r.AuthToken != "{{token}}" {
		t.Fatalf("variable URL / inherited auth not imported: %+v", r)
	}
	if r := byName["IPv6"]; r.BaseURL != "http://[::1]" || r.Port != "8080" || !r.UsePort {
		t.Fatalf("IPv6 URL broken: %+v", r)
	}
	if r := byName["Upload"]; r.BodyType != "formdata" || !strings.Contains(r.ReqBody, `"filePath":"C:/a.png"`) || r.AuthType != "none" {
		t.Fatalf("form-data not imported: %+v", r)
	}
}

func TestUndecryptableSecretIsClearedInsteadOfLeaked(t *testing.T) {
	manager := newSchemaTestDB(t)
	if err := manager.CreateProject("p", "P"); err != nil {
		t.Fatal(err)
	}
	if err := manager.CreateRequest("r", "p", "", "R", "GET"); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.db.Exec("UPDATE requests SET auth_token = 'enc:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAA' WHERE id = 'r'"); err != nil {
		t.Fatal(err)
	}
	requests, err := manager.GetRequests()
	if err != nil {
		t.Fatal(err)
	}
	if requests[0].AuthToken != "" {
		t.Fatalf("ciphertext leaked as token: %q", requests[0].AuthToken)
	}
}

func TestRenameRequestKeepsBody(t *testing.T) {
	manager := newSchemaTestDB(t)
	_ = manager.CreateProject("p", "P")
	_ = manager.CreateRequest("r", "p", "", "Old", "POST")
	if err := manager.UpdateRequest(DBRequest{ID: "r", ProjectID: "p", Name: "Old", Method: "POST", BodyType: "formdata", ReqBody: `[{"key":"a","value":"1","enabled":true}]`, HeadersJson: "[]"}); err != nil {
		t.Fatal(err)
	}
	if err := manager.RenameRequest("r", "New"); err != nil {
		t.Fatal(err)
	}
	requests, _ := manager.GetRequests()
	if requests[0].Name != "New" || !strings.Contains(requests[0].ReqBody, `"key":"a"`) {
		t.Fatalf("rename damaged request: %+v", requests[0])
	}
}

func TestWorkspaceExportWithoutSecretsKeepsLocalSecretsOnImport(t *testing.T) {
	manager := newSchemaTestDB(t)
	_ = manager.CreateProject("p", "P")
	_ = manager.CreateRequest("r", "p", "", "R", "GET")
	if err := manager.UpdateRequest(DBRequest{ID: "r", ProjectID: "p", Name: "R", Method: "GET", AuthType: "basic", AuthToken: "tok", AuthConfigJson: `{"username":"u","password":"pw"}`, HeadersJson: "[]"}); err != nil {
		t.Fatal(err)
	}
	if err := manager.SaveEnvironment(DBEnvironment{ID: "e", Name: "E", Variables: []DBEnvVariable{{ID: "v1", Key: "api_token", Value: "s3cret", Enabled: true}, {ID: "v2", Key: "host", Value: "h", Enabled: true}}}); err != nil {
		t.Fatal(err)
	}
	projects, _ := manager.GetProjects()
	requests, _ := manager.GetRequests()
	envs, _ := manager.GetEnvironments()
	export := FullWorkspaceExport{Projects: projects, Requests: requests, Environments: envs, Version: "2.2"}
	redactWorkspaceSecrets(&export)
	encoded, _ := json.Marshal(export)
	if strings.Contains(string(encoded), "s3cret") || strings.Contains(string(encoded), `"pw"`) || strings.Contains(string(encoded), `"tok"`) {
		t.Fatalf("secrets leaked into export: %s", encoded)
	}

	var decoded FullWorkspaceExport
	_ = json.Unmarshal(encoded, &decoded)
	decoded.Requests[0].Name = "Renamed by import"
	result, err := manager.ImportWorkspace(decoded)
	if err != nil {
		t.Fatal(err)
	}
	if result.Requests != 1 || result.Environments != 1 {
		t.Fatalf("unexpected result %+v", result)
	}
	requests, _ = manager.GetRequests()
	envs, _ = manager.GetEnvironments()
	if requests[0].Name != "Renamed by import" || requests[0].AuthToken != "tok" || !strings.Contains(requests[0].AuthConfigJson, `"pw"`) {
		t.Fatalf("import lost local secrets: %+v", requests[0])
	}
	for _, v := range envs[0].Variables {
		if v.Key == "api_token" && v.Value != "s3cret" {
			t.Fatalf("env secret lost: %+v", v)
		}
	}
}
