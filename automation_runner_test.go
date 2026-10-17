package main

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"internal-api-client/core"
)

func TestAutomationURLIncludesEnabledParametersAndVariables(t *testing.T) {
	url, err := automationURL("https://example.test/api", "/orders?existing=yes", `[{"key":"page","value":"{{page}}","enabled":true},{"key":"hidden","value":"no","enabled":false}]`, map[string]any{"page": 2})
	if err != nil {
		t.Fatal(err)
	}
	if url != "https://example.test/api/orders?existing=yes&page=2" {
		t.Fatalf("unexpected URL %q", url)
	}
}

func TestAutomationURLEncodesVariablesPerComponent(t *testing.T) {
	values := map[string]any{"base": "https://example.test/v1", "id": "a b?c#d", "q": "x&admin=true"}
	got, err := automationURL("", "{{base}}/users/{{id}}?filter={{q}}&z=1&a=2", "", values)
	if err != nil {
		t.Fatal(err)
	}
	want := "https://example.test/v1/users/a%20b%3Fc%23d?filter=x%26admin%3Dtrue&z=1&a=2"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestAutomationComparisonSupportsInclusiveOperators(t *testing.T) {
	if ok, _ := compareAutomation(100, true, "100", "gte", false); !ok {
		t.Fatal("gte should pass at its boundary")
	}
	if ok, _ := compareAutomation(100, true, "100", "lte", false); !ok {
		t.Fatal("lte should pass at its boundary")
	}
	if ok, _ := compareAutomation(201, true, "2xx", "eq", true); !ok {
		t.Fatal("2xx status range should pass")
	}
}

func TestAutomationComparisonRejectsMissingOrNonNumericValues(t *testing.T) {
	if ok, _ := compareAutomation(nil, false, "500", "lt", false); ok {
		t.Fatal("a missing value must not satisfy lt")
	}
	if ok, _ := compareAutomation(nil, false, "x", "neq", false); ok {
		t.Fatal("a missing value must not satisfy neq")
	}
	if ok, _ := compareAutomation("abc", true, "10", "gt", false); ok {
		t.Fatal("non-numeric values must not satisfy gt")
	}
}

func TestAutomationJSONPathResolvesNestedPathsAndKeepsNumbers(t *testing.T) {
	body := parseAutomationJSON(`{"data":{"items":[{"id":1234567,"big":9007199254740993,"nothing":null}]}}`)
	if got := automationValueString(automationJSONPath(body, "$.data.items[0].id")); got != "1234567" {
		t.Fatalf("nested id = %q", got)
	}
	if got := automationValueString(automationJSONPath(body, "$.data.items[0].big")); got != "9007199254740993" {
		t.Fatalf("big id lost precision: %q", got)
	}
	if _, found := automationJSONLookup(body, "$.data.items[0].nothing"); !found {
		t.Fatal("explicit null must be reported as present")
	}
	if _, found := automationJSONLookup(body, "$.data.missing"); found {
		t.Fatal("missing key must be reported as absent")
	}
	if got := interpolateAutomation("/users/{{id}}", map[string]any{"id": automationJSONPath(body, "$.data.items[0].id")}); got != "/users/1234567" {
		t.Fatalf("interpolated %q", got)
	}
}

func TestAutomationBasicAuthAndDisabledAssertions(t *testing.T) {
	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	step := DBScenarioStep{ID: "s", StepOrder: 1, Method: "GET", ApiPath: server.URL, AuthType: "basic", AuthConfigJson: `{"username":"admin","password":"mật:khẩu"}`, AssertionsJson: `[{"type":"status","operator":"eq","expected":"200","enabled":false}]`}
	result := executeAutomationStep(context.Background(), core.NewHttpClientEngine(false, 5), "", step, map[string]any{})
	if want := "Basic " + base64.StdEncoding.EncodeToString([]byte("admin:mật:khẩu")); gotAuth != want {
		t.Fatalf("authorization %q want %q", gotAuth, want)
	}
	if result.Passed {
		t.Fatal("a 500 response must fail when every assertion is disabled")
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

func TestAutomationCancelDuringLastStepIsReportedAsCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cancel()
		<-r.Context().Done()
	}))
	defer server.Close()
	summary := runAutomationScenario(ctx, core.NewHttpClientEngine(false, 30), DBScenario{ID: "scenario", Steps: []DBScenarioStep{{ID: "last", StepOrder: 1, Method: "GET", ApiPath: server.URL}}}, nil, nil)
	if summary.Status != "CANCELLED" || summary.Passed {
		t.Fatalf("expected CANCELLED, got %s", summary.Status)
	}
}

func TestAutomationHeadersAreCanonical(t *testing.T) {
	headers, err := automationHeaders(`[{"key":"authorization","value":"a","enabled":true}]`, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	headers["Authorization"] = "b"
	if len(headers) != 1 || !strings.EqualFold(headers["Authorization"], "b") {
		t.Fatalf("duplicate header keys: %#v", headers)
	}
}
