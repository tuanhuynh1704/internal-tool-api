package core

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"testing"
	"time"
)

func TestMockServerEngine(t *testing.T) {
	engine := NewMockServerEngine()
	port := 19095

	routes := []MockRoute{
		{
			ID:              "route_1",
			Path:            "/api/v1/ping",
			Method:          "GET",
			StatusCode:      200,
			ResponseHeaders: map[string]string{"Content-Type": "application/json"},
			ResponseBody:    `{"pong": true}`,
			DelayMs:         10,
			Enabled:         true,
		},
		{
			ID:              "route_2",
			Path:            "/api/v1/users",
			Method:          "POST",
			StatusCode:      201,
			ResponseHeaders: map[string]string{"Content-Type": "application/json"},
			ResponseBody:    `{"id": 101, "created": true}`,
			DelayMs:         0,
			Enabled:         true,
		},
	}

	err := engine.Start(port, routes)
	if err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer engine.Stop()

	// Wait briefly for server to listen
	time.Sleep(50 * time.Millisecond)

	status := engine.GetStatus()
	if !status.IsRunning {
		t.Errorf("Expected mock server to be running")
	}

	// Test GET /api/v1/ping
	resp, err := http.Get(fmt.Sprintf("http://localhost:%d/api/v1/ping", port))
	if err != nil {
		t.Fatalf("Failed to send GET to mock server: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	bodyBytes, _ := io.ReadAll(resp.Body)
	if string(bodyBytes) != `{"pong": true}` {
		t.Errorf("Unexpected body: %s", string(bodyBytes))
	}

	// Check status logs
	statusAfter := engine.GetStatus()
	if len(statusAfter.Logs) == 0 {
		t.Errorf("Expected logs to contain the request")
	}
}

func TestMockRouteMatchingPrefersMostSpecificRoute(t *testing.T) {
	routes := cloneRoutes([]MockRoute{
		{ID: "prefix", Path: "/users", Method: "GET", Enabled: true},
		{ID: "param", Path: "/users/:id", Method: "GET", Enabled: true},
		{ID: "exact", Path: "/users/me", Method: "GET", Enabled: true},
		{ID: "any", Path: "*", Method: "*", Enabled: true},
	})
	cases := map[string]string{"/users/me": "exact", "/users/42": "param", "/users/42/orders": "prefix", "/other": "any"}
	for path, want := range cases {
		if got := matchMockRoute(routes, "GET", path); got == nil || got.ID != want {
			t.Fatalf("%s matched %v, want %s", path, got, want)
		}
	}
}

func TestMockServerConcurrentRequestsWithoutContentType(t *testing.T) {
	engine := NewMockServerEngine()
	port := 19096
	routes := []MockRoute{
		{ID: "r", Path: "/x", Method: "GET", StatusCode: 200, ResponseHeaders: map[string]string{}, ResponseBody: "ok", Enabled: true},
		{ID: "bad", Path: "/bad", Method: "GET", StatusCode: 42, Enabled: true},
	}
	if err := engine.Start(port, routes); err != nil {
		t.Fatal(err)
	}
	defer engine.Stop()
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/x", port)); err == nil {
				resp.Body.Close()
			}
		}()
	}
	wg.Wait()
	if routes[0].ResponseHeaders["Content-Type"] != "" {
		t.Fatal("caller's route map was mutated")
	}

	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/bad", port))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("invalid status code should yield 500, got %d", resp.StatusCode)
	}

	resp, err = http.Get(fmt.Sprintf("http://127.0.0.1:%d/a%%22b", port))
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	var decoded map[string]string
	if err := json.Unmarshal(body, &decoded); err != nil || decoded["path"] != `/a"b` {
		t.Fatalf("404 body is not valid JSON: %s", body)
	}
}
