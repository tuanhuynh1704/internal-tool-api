package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"internal-api-client/core"
)

func TestAutomationURLIncludesEnabledParametersAndVariables(t *testing.T) {
	url, err := automationURL("https://example.test/api", "/orders?existing=yes", `[{"key":"page","value":"{{page}}","enabled":true},{"key":"hidden","value":"no","enabled":false}]`, map[string]any{"page": 2})
	if err != nil {
		t.Fatal(err)
	}
	if url != "https://example.test/api/orders?existing=yes&page=2" && url != "https://example.test/api/orders?page=2&existing=yes" {
		t.Fatalf("unexpected URL %q", url)
	}
}

func TestAutomationComparisonSupportsInclusiveOperators(t *testing.T) {
	if !compareAutomation(100, "100", "gte", false) {
		t.Fatal("gte should pass at its boundary")
	}
	if !compareAutomation(100, "100", "lte", false) {
		t.Fatal("lte should pass at its boundary")
	}
	if !compareAutomation(201, "2xx", "eq", true) {
		t.Fatal("2xx status range should pass")
	}
}

func TestAutomationRunCancelsInflightRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	summary := runAutomationScenario(ctx, core.NewHttpClientEngine(false, 30), DBScenario{ID: "scenario", Name: "scenario", Steps: []DBScenarioStep{{ID: "step", StepOrder: 1, Name: "slow", Method: "GET", ApiPath: server.URL, HeadersJson: "[]", ParamsJson: "[]"}}}, nil, nil)
	if summary.Status != "CANCELLED" {
		t.Fatalf("expected cancellation, got %s", summary.Status)
	}
}
