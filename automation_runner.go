package main

import (
	"context"
	"encoding/json"
	"fmt"
	"internal-api-client/core"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// AutomationAssertion mirrors the persisted assertion JSON and is intentionally
// backend-owned so the same scenarios can run from the desktop UI and CI/CLI.
type AutomationAssertion struct {
	Type     string `json:"type"`
	Target   string `json:"target,omitempty"`
	Operator string `json:"operator"`
	Expected string `json:"expected"`
	Enabled  *bool  `json:"enabled,omitempty"`
}

type AutomationExtraction struct {
	VarName string `json:"varName"`
	Source  string `json:"source"`
	Path    string `json:"path"`
}

type AutomationAssertionResult struct {
	Rule    AutomationAssertion `json:"rule"`
	Passed  bool                `json:"passed"`
	Message string              `json:"message"`
	Actual  any                 `json:"actual,omitempty"`
}

type AutomationStepResult struct {
	StepID           string                      `json:"stepId"`
	StepName         string                      `json:"stepName"`
	StepOrder        int                         `json:"stepOrder"`
	Method           string                      `json:"method"`
	URL              string                      `json:"url"`
	Status           int                         `json:"status"`
	StatusText       string                      `json:"statusText"`
	DurationMs       int64                       `json:"durationMs"`
	ResponseBody     string                      `json:"responseBody"`
	ResponseHeaders  map[string]string           `json:"responseHeaders"`
	Passed           bool                        `json:"passed"`
	AssertionDetails []AutomationAssertionResult `json:"assertionDetails"`
	Extracted        map[string]any              `json:"extracted"`
	Error            string                      `json:"error,omitempty"`
}

type AutomationRunSummary struct {
	RunID           string                 `json:"runId"`
	ScenarioID      string                 `json:"scenarioId"`
	ScenarioName    string                 `json:"scenarioName"`
	Status          string                 `json:"status"`
	TotalSteps      int                    `json:"totalSteps"`
	PassedSteps     int                    `json:"passedSteps"`
	FailedSteps     int                    `json:"failedSteps"`
	SkippedSteps    int                    `json:"skippedSteps"`
	TotalDurationMs int64                  `json:"totalDurationMs"`
	AvgDurationMs   int64                  `json:"avgDurationMs"`
	SuccessRate     int                    `json:"successRate"`
	Passed          bool                   `json:"passed"`
	RuntimeContext  map[string]any         `json:"runtimeContext"`
	StepResults     []AutomationStepResult `json:"stepResults"`
}

type AutomationProgressEvent struct {
	RunID      string                `json:"runId"`
	ScenarioID string                `json:"scenarioId"`
	Phase      string                `json:"phase"`
	Current    int                   `json:"current"`
	Total      int                   `json:"total"`
	StepResult AutomationStepResult  `json:"stepResult,omitempty"`
	Summary    *AutomationRunSummary `json:"summary,omitempty"`
}

var automationTemplatePattern = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)

func runAutomationScenario(ctx context.Context, engine *core.HttpClientEngine, scenario DBScenario, variables map[string]string, progress func(AutomationProgressEvent)) AutomationRunSummary {
	started := time.Now()
	runID, err := newImportID("api_run")
	if err != nil {
		runID = fmt.Sprintf("api_run_%d", started.UnixNano())
	}
	contextValues := make(map[string]any, len(variables))
	for key, value := range variables {
		contextValues[key] = value
	}
	summary := AutomationRunSummary{RunID: runID, ScenarioID: scenario.ID, ScenarioName: scenario.Name, Status: "RUNNING", TotalSteps: len(scenario.Steps), RuntimeContext: map[string]any{}, StepResults: make([]AutomationStepResult, 0, len(scenario.Steps))}
	if progress != nil {
		progress(AutomationProgressEvent{RunID: runID, ScenarioID: scenario.ID, Phase: "start", Total: len(scenario.Steps)})
	}

	for index, step := range scenario.Steps {
		if err := ctx.Err(); err != nil {
			summary.Status = "CANCELLED"
			summary.SkippedSteps = len(scenario.Steps) - index
			break
		}
		if index > 0 && scenario.DelayMs > 0 {
			select {
			case <-ctx.Done():
				summary.Status = "CANCELLED"
				summary.SkippedSteps = len(scenario.Steps) - index
				break
			case <-time.After(time.Duration(scenario.DelayMs) * time.Millisecond):
			}
			if summary.Status == "CANCELLED" {
				break
			}
		}
		if progress != nil {
			progress(AutomationProgressEvent{RunID: runID, ScenarioID: scenario.ID, Phase: "step_start", Current: index + 1, Total: len(scenario.Steps)})
		}
		result := executeAutomationStep(ctx, engine, scenario.BaseURL, step, contextValues)
		summary.StepResults = append(summary.StepResults, result)
		if result.Passed {
			summary.PassedSteps++
		} else {
			summary.FailedSteps++
		}
		if progress != nil {
			progress(AutomationProgressEvent{RunID: runID, ScenarioID: scenario.ID, Phase: "step_end", Current: index + 1, Total: len(scenario.Steps), StepResult: result})
		}
		if !result.Passed && scenario.StopOnError {
			summary.SkippedSteps = len(scenario.Steps) - index - 1
			break
		}
	}

	summary.TotalDurationMs = time.Since(started).Milliseconds()
	if len(summary.StepResults) > 0 {
		summary.AvgDurationMs = summary.TotalDurationMs / int64(len(summary.StepResults))
	}
	if summary.Status == "RUNNING" {
		if summary.FailedSteps > 0 {
			summary.Status = "FAILED"
		} else {
			summary.Status = "PASSED"
		}
	}
	summary.Passed = summary.Status == "PASSED"
	if summary.TotalSteps > 0 {
		summary.SuccessRate = summary.PassedSteps * 100 / summary.TotalSteps
	}
	summary.RuntimeContext = redactedAutomationContext(contextValues)
	if progress != nil {
		progress(AutomationProgressEvent{RunID: runID, ScenarioID: scenario.ID, Phase: "done", Current: len(summary.StepResults), Total: len(scenario.Steps), Summary: &summary})
	}
	return summary
}

func executeAutomationStep(ctx context.Context, engine *core.HttpClientEngine, baseURL string, step DBScenarioStep, values map[string]any) AutomationStepResult {
	result := AutomationStepResult{StepID: step.ID, StepName: step.Name, StepOrder: step.StepOrder, Method: step.Method, ResponseHeaders: map[string]string{}, AssertionDetails: []AutomationAssertionResult{}, Extracted: map[string]any{}}
	targetURL, err := automationURL(baseURL, step.ApiPath, step.ParamsJson, values)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.URL = targetURL
	headers, err := automationHeaders(step.HeadersJson, values)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	if err := applyAutomationAuth(&targetURL, headers, step, values); err != nil {
		result.Error = err.Error()
		return result
	}
	result.URL = targetURL
	payload := core.RequestPayload{Method: step.Method, URL: targetURL, Headers: headers, Body: interpolateAutomation(step.Body, values), BodyType: step.BodyType}
	response, err := engine.ExecuteWithContext(ctx, payload)
	if err != nil {
		result.StatusText = "Network Error"
		result.Error = err.Error()
		result.AssertionDetails = append(result.AssertionDetails, AutomationAssertionResult{Passed: false, Message: "Request failed: " + err.Error()})
		return result
	}
	result.Status, result.StatusText, result.DurationMs, result.ResponseBody, result.ResponseHeaders = response.Status, response.StatusText, response.ResponseTime, response.Body, response.Headers
	var parsed any
	if json.Unmarshal([]byte(response.Body), &parsed) != nil {
		parsed = nil
	}
	var assertions []AutomationAssertion
	if step.AssertionsJson != "" {
		if err := json.Unmarshal([]byte(step.AssertionsJson), &assertions); err != nil {
			result.Error = "invalid assertions: " + err.Error()
			return result
		}
	}
	passed := true
	if len(assertions) == 0 {
		passed = response.Status >= 200 && response.Status < 300
		result.AssertionDetails = append(result.AssertionDetails, AutomationAssertionResult{Passed: passed, Actual: response.Status, Message: "Default status check (2xx)"})
	} else {
		for _, assertion := range assertions {
			if assertion.Enabled != nil && !*assertion.Enabled {
				continue
			}
			evaluation := evaluateAutomationAssertion(assertion, response, parsed, values)
			result.AssertionDetails = append(result.AssertionDetails, evaluation)
			if !evaluation.Passed {
				passed = false
			}
		}
	}
	result.Extracted = extractAutomationVariables(step.ExtractVarsJson, response, parsed, values)
	result.Passed = passed
	return result
}

func interpolateAutomation(input string, values map[string]any) string {
	return automationTemplatePattern.ReplaceAllStringFunc(input, func(match string) string {
		part := automationTemplatePattern.FindStringSubmatch(match)
		if len(part) == 2 {
			if value, ok := values[strings.TrimSpace(part[1])]; ok && value != nil {
				return fmt.Sprint(value)
			}
		}
		return match
	})
}

func automationURL(baseURL, path, paramsJSON string, values map[string]any) (string, error) {
	target := interpolateAutomation(strings.TrimSpace(path), values)
	if !strings.HasPrefix(target, "http://") && !strings.HasPrefix(target, "https://") {
		target = strings.TrimRight(interpolateAutomation(baseURL, values), "/") + "/" + strings.TrimLeft(target, "/")
	}
	parsed, err := url.Parse(target)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid step URL %q", target)
	}
	if strings.TrimSpace(paramsJSON) == "" {
		return parsed.String(), nil
	}
	var params []struct {
		Key     string `json:"key"`
		Value   string `json:"value"`
		Enabled *bool  `json:"enabled"`
	}
	if err := json.Unmarshal([]byte(paramsJSON), &params); err != nil {
		return "", fmt.Errorf("invalid query parameters: %w", err)
	}
	query := parsed.Query()
	for _, param := range params {
		if param.Enabled != nil && !*param.Enabled {
			continue
		}
		key := strings.TrimSpace(interpolateAutomation(param.Key, values))
		if key != "" {
			query.Add(key, interpolateAutomation(param.Value, values))
		}
	}
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func automationHeaders(raw string, values map[string]any) (map[string]string, error) {
	headers := map[string]string{}
	if strings.TrimSpace(raw) == "" {
		return headers, nil
	}
	var decoded any
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return nil, fmt.Errorf("invalid headers: %w", err)
	}
	add := func(key string, value any) {
		key = strings.TrimSpace(interpolateAutomation(key, values))
		if key != "" {
			headers[key] = interpolateAutomation(fmt.Sprint(value), values)
		}
	}
	switch data := decoded.(type) {
	case map[string]any:
		for key, value := range data {
			add(key, value)
		}
	case []any:
		for _, item := range data {
			if object, ok := item.(map[string]any); ok {
				if key, exists := object["key"]; exists {
					if enabled, ok := object["enabled"].(bool); ok && !enabled {
						continue
					}
					add(fmt.Sprint(key), object["value"])
				} else {
					for key, value := range object {
						add(key, value)
					}
				}
			}
		}
	default:
		return nil, fmt.Errorf("headers must be a JSON object or array")
	}
	return headers, nil
}

func applyAutomationAuth(targetURL *string, headers map[string]string, step DBScenarioStep, values map[string]any) error {
	switch step.AuthType {
	case "bearer":
		if step.AuthToken != "" {
			headers["Authorization"] = "Bearer " + interpolateAutomation(step.AuthToken, values)
		}
	case "apikey":
		var cfg map[string]any
		if err := json.Unmarshal([]byte(step.AuthConfigJson), &cfg); err != nil {
			return fmt.Errorf("invalid API key configuration: %w", err)
		}
		key, value, placement := fmt.Sprint(cfg["key"]), fmt.Sprint(cfg["value"]), fmt.Sprint(cfg["addTo"])
		if key == "" || key == "<nil>" {
			key = fmt.Sprint(cfg["apiKeyName"])
		}
		if value == "" || value == "<nil>" {
			value = fmt.Sprint(cfg["apiKeyValue"])
		}
		if placement == "" || placement == "<nil>" {
			placement = fmt.Sprint(cfg["apiKeyAddTo"])
		}
		if value == "" || value == "<nil>" {
			value = step.AuthToken
		}
		if key == "" || key == "<nil>" {
			key = "X-API-Key"
		}
		key, value = interpolateAutomation(key, values), interpolateAutomation(value, values)
		if placement == "query" {
			parsed, err := url.Parse(*targetURL)
			if err != nil {
				return err
			}
			query := parsed.Query()
			query.Add(key, value)
			parsed.RawQuery = query.Encode()
			*targetURL = parsed.String()
		} else {
			headers[key] = value
		}
	}
	return nil
}

func evaluateAutomationAssertion(rule AutomationAssertion, response core.ResponsePayload, body any, values map[string]any) AutomationAssertionResult {
	expected := interpolateAutomation(rule.Expected, values)
	actual := any(nil)
	switch rule.Type {
	case "status":
		actual = response.Status
	case "time":
		actual = response.ResponseTime
	case "header":
		for key, value := range response.Headers {
			if strings.EqualFold(key, rule.Target) {
				actual = value
				break
			}
		}
	case "body_text":
		actual = response.Body
	case "body_json":
		actual = automationJSONPath(body, rule.Target)
	default:
		return AutomationAssertionResult{Rule: rule, Passed: false, Message: "Unsupported assertion type: " + rule.Type}
	}
	passed := compareAutomation(actual, expected, rule.Operator, rule.Type == "status")
	return AutomationAssertionResult{Rule: rule, Passed: passed, Actual: actual, Message: fmt.Sprintf("%s %s %q", rule.Type, rule.Operator, expected)}
}

func compareAutomation(actual any, expected, operator string, status bool) bool {
	if operator == "exists" {
		return actual != nil && fmt.Sprint(actual) != ""
	}
	if operator == "not_exists" {
		return actual == nil || fmt.Sprint(actual) == ""
	}
	if status && strings.HasSuffix(strings.ToLower(expected), "xx") && len(expected) == 3 {
		n, err := strconv.Atoi(expected[:1])
		return err == nil && intValue(actual) >= n*100 && intValue(actual) < (n+1)*100
	}
	actualText := fmt.Sprint(actual)
	switch operator {
	case "eq", "equals", "":
		return actualText == expected
	case "neq", "not_equals":
		return actualText != expected
	case "contains":
		return strings.Contains(actualText, expected)
	case "gt", "greater_than":
		return floatValue(actual) > floatValue(expected)
	case "gte", "greater_than_or_equal":
		return floatValue(actual) >= floatValue(expected)
	case "lt", "less_than":
		return floatValue(actual) < floatValue(expected)
	case "lte", "less_than_or_equal":
		return floatValue(actual) <= floatValue(expected)
	case "regex":
		matched, err := regexp.MatchString(expected, actualText)
		return err == nil && matched
	default:
		return false
	}
}

func intValue(value any) int { number, _ := strconv.Atoi(fmt.Sprint(value)); return number }
func floatValue(value any) float64 {
	number, _ := strconv.ParseFloat(fmt.Sprint(value), 64)
	return number
}

func automationJSONPath(value any, path string) any {
	if value == nil {
		return nil
	}
	clean := strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(path), "$."), "$")
	if clean == "" {
		return value
	}
	parts := regexp.MustCompile(`\\.|\\[|\\]`).Split(clean, -1)
	current := value
	for _, part := range parts {
		if part == "" {
			continue
		}
		switch typed := current.(type) {
		case map[string]any:
			current = typed[part]
		case []any:
			index, err := strconv.Atoi(part)
			if err != nil || index < 0 || index >= len(typed) {
				return nil
			}
			current = typed[index]
		default:
			return nil
		}
		if current == nil {
			return nil
		}
	}
	return current
}

func extractAutomationVariables(raw string, response core.ResponsePayload, body any, values map[string]any) map[string]any {
	extracted := map[string]any{}
	var rules []AutomationExtraction
	if strings.TrimSpace(raw) == "" || json.Unmarshal([]byte(raw), &rules) != nil {
		return extracted
	}
	for _, rule := range rules {
		if strings.TrimSpace(rule.VarName) == "" {
			continue
		}
		var value any
		if rule.Source == "header" {
			for key, candidate := range response.Headers {
				if strings.EqualFold(key, strings.Trim(strings.TrimPrefix(rule.Path, "header["), "]")) {
					value = candidate
					break
				}
			}
		} else {
			value = automationJSONPath(body, rule.Path)
		}
		if value != nil {
			values[rule.VarName] = value
			extracted[rule.VarName] = redactAutomationValue(rule.VarName, value)
		}
	}
	return extracted
}

func redactAutomationValue(key string, value any) any {
	lower := strings.ToLower(key)
	if strings.Contains(lower, "token") || strings.Contains(lower, "secret") || strings.Contains(lower, "password") || strings.Contains(lower, "key") {
		return "***"
	}
	return value
}
func redactedAutomationContext(values map[string]any) map[string]any {
	result := make(map[string]any, len(values))
	for key, value := range values {
		result[key] = redactAutomationValue(key, value)
	}
	return result
}
