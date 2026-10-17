package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"internal-api-client/core"
	"net/http"
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

var (
	automationTemplatePattern = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)
	// automationPathSeparator splits "$.data.items[0].id" into its segments.
	automationPathSeparator = regexp.MustCompile(`\.|\[|\]`)
)

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

	cancelled := func(index int) bool {
		if ctx.Err() == nil {
			return false
		}
		summary.Status = "CANCELLED"
		summary.SkippedSteps = len(scenario.Steps) - index
		return true
	}

	for index, step := range scenario.Steps {
		if cancelled(index) {
			break
		}
		if index > 0 && scenario.DelayMs > 0 {
			timer := time.NewTimer(time.Duration(scenario.DelayMs) * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
			case <-timer.C:
			}
			if cancelled(index) {
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
		// A step interrupted by Stop is reported as a cancellation, not as a
		// regular failure, even when it was the last step of the scenario.
		if cancelled(index + 1) {
			break
		}
		if !result.Passed && scenario.StopOnError {
			summary.SkippedSteps = len(scenario.Steps) - index - 1
			break
		}
	}

	summary.TotalDurationMs = time.Since(started).Milliseconds()
	if len(summary.StepResults) > 0 {
		// Average request time per executed step; inter-step delays are excluded.
		var stepTotal int64
		for _, result := range summary.StepResults {
			stepTotal += result.DurationMs
		}
		summary.AvgDurationMs = stepTotal / int64(len(summary.StepResults))
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
	parsed := parseAutomationJSON(response.Body)
	var assertions []AutomationAssertion
	if step.AssertionsJson != "" {
		if err := json.Unmarshal([]byte(step.AssertionsJson), &assertions); err != nil {
			result.Error = "invalid assertions: " + err.Error()
			return result
		}
	}
	passed := true
	evaluated := 0
	for _, assertion := range assertions {
		if assertion.Enabled != nil && !*assertion.Enabled {
			continue
		}
		evaluated++
		evaluation := evaluateAutomationAssertion(assertion, response, parsed, values)
		result.AssertionDetails = append(result.AssertionDetails, evaluation)
		if !evaluation.Passed {
			passed = false
		}
	}
	// Without any active assertion the step still has to return a 2xx; a
	// scenario whose rules are all disabled must not turn a 500 into a pass.
	if evaluated == 0 {
		passed = response.Status >= 200 && response.Status < 300
		result.AssertionDetails = append(result.AssertionDetails, AutomationAssertionResult{Passed: passed, Actual: response.Status, Message: "Default status check (2xx)"})
	}
	result.Extracted = extractAutomationVariables(step.ExtractVarsJson, response, parsed, values)
	result.Passed = passed
	return result
}

// parseAutomationJSON keeps numbers as json.Number so IDs survive without
// float64 rounding or exponent formatting (1234567 must not become 1.234567e+06).
func parseAutomationJSON(body string) any {
	decoder := json.NewDecoder(strings.NewReader(body))
	decoder.UseNumber()
	var parsed any
	if err := decoder.Decode(&parsed); err != nil {
		return nil
	}
	if decoder.More() {
		return nil
	}
	return parsed
}

// automationValueString renders a runtime value the way it appeared in JSON.
func automationValueString(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(typed), 'f', -1, 32)
	case bool:
		return strconv.FormatBool(typed)
	case map[string]any, []any:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return fmt.Sprint(typed)
		}
		return string(encoded)
	default:
		return fmt.Sprint(typed)
	}
}

func lookupAutomationVariable(name string, values map[string]any) (string, bool) {
	value, ok := values[strings.TrimSpace(name)]
	if !ok || value == nil {
		return "", false
	}
	return automationValueString(value), true
}

func interpolateAutomation(input string, values map[string]any) string {
	return automationTemplatePattern.ReplaceAllStringFunc(input, func(match string) string {
		part := automationTemplatePattern.FindStringSubmatch(match)
		if len(part) == 2 {
			if value, ok := lookupAutomationVariable(part[1], values); ok {
				return value
			}
		}
		return match
	})
}

// Characters that would change the structure of a URL when injected through a
// variable. Path values keep "/" so a variable may still hold a path prefix.
var (
	urlPathValueEscaper  = strings.NewReplacer("%", "%25", "?", "%3F", "#", "%23", " ", "%20", "\t", "%09", "\r", "%0D", "\n", "%0A")
	urlQueryRawEscaper   = strings.NewReplacer("#", "%23", " ", "%20", "\t", "%09", "\r", "%0D", "\n", "%0A")
	urlSchemeAuthorityRe = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*://`)
)

// interpolateURLTemplate substitutes {{variables}} in a URL template and
// encodes each value for the URL component it lands in: values that form the
// scheme/host (or the leading base URL) are inserted verbatim, path values are
// protected against "?"/"#", and query values are fully query-escaped.
func interpolateURLTemplate(template string, values map[string]any) string {
	type urlPart int
	const (
		partAuthority urlPart = iota
		partPath
		partQuery
		partFragment
	)
	matches := automationTemplatePattern.FindAllStringSubmatchIndex(template, -1)
	if len(matches) == 0 {
		return template
	}
	part := partPath
	start := 0
	if loc := urlSchemeAuthorityRe.FindStringIndex(template); loc != nil {
		part = partAuthority
		start = loc[1]
	} else if !strings.HasPrefix(template, "/") && !strings.HasPrefix(template, "?") {
		// A template that begins with a variable ("{{base_url}}/users") treats
		// that leading value as the base URL.
		part = partAuthority
	}
	var builder strings.Builder
	lastLiteral := byte(0)
	advance := func(literal string) {
		for i := 0; i < len(literal); i++ {
			c := literal[i]
			switch {
			case part == partAuthority && c == '/':
				part = partPath
			case part != partFragment && part != partQuery && c == '?':
				part = partQuery
			case part != partFragment && c == '#':
				part = partFragment
			}
			lastLiteral = c
		}
		builder.WriteString(literal)
	}
	cursor := 0
	if start > 0 {
		builder.WriteString(template[:start])
		cursor = start
	}
	for _, match := range matches {
		if match[0] < cursor {
			continue
		}
		advance(template[cursor:match[0]])
		name := template[match[2]:match[3]]
		value, ok := lookupAutomationVariable(name, values)
		if !ok {
			builder.WriteString(template[match[0]:match[1]])
		} else {
			switch part {
			case partAuthority:
				builder.WriteString(value)
			case partPath:
				builder.WriteString(urlPathValueEscaper.Replace(value))
			case partQuery:
				if lastLiteral == '=' {
					builder.WriteString(url.QueryEscape(value))
				} else {
					builder.WriteString(urlQueryRawEscaper.Replace(value))
				}
			case partFragment:
				builder.WriteString(url.PathEscape(value))
			}
		}
		cursor = match[1]
	}
	advance(template[cursor:])
	return builder.String()
}

// appendRawQuery adds one key/value pair without re-encoding or reordering the
// parameters that are already present (signed URLs depend on their order).
func appendRawQuery(parsed *url.URL, key, value string) {
	pair := url.QueryEscape(key) + "=" + url.QueryEscape(value)
	if parsed.RawQuery == "" {
		parsed.RawQuery = pair
	} else {
		parsed.RawQuery += "&" + pair
	}
}

func automationURL(baseURL, path, paramsJSON string, values map[string]any) (string, error) {
	target := interpolateURLTemplate(strings.TrimSpace(path), values)
	if !strings.HasPrefix(target, "http://") && !strings.HasPrefix(target, "https://") {
		target = strings.TrimRight(interpolateAutomation(strings.TrimSpace(baseURL), values), "/") + "/" + strings.TrimLeft(target, "/")
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
	for _, param := range params {
		if param.Enabled != nil && !*param.Enabled {
			continue
		}
		key := strings.TrimSpace(interpolateAutomation(param.Key, values))
		if key != "" {
			appendRawQuery(parsed, key, interpolateAutomation(param.Value, values))
		}
	}
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
			// Canonical keys make "authorization" and "Authorization" the same
			// header instead of two map entries racing inside http.Header.Set.
			headers[http.CanonicalHeaderKey(key)] = interpolateAutomation(automationValueString(value), values)
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
					add(automationValueString(key), object["value"])
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

func configString(cfg map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := cfg[key]; ok && value != nil {
			if text := automationValueString(value); text != "" {
				return text
			}
		}
	}
	return ""
}

func applyAutomationAuth(targetURL *string, headers map[string]string, step DBScenarioStep, values map[string]any) error {
	parseConfig := func() (map[string]any, error) {
		cfg := map[string]any{}
		if strings.TrimSpace(step.AuthConfigJson) == "" {
			return cfg, nil
		}
		if err := json.Unmarshal([]byte(step.AuthConfigJson), &cfg); err != nil {
			return nil, err
		}
		return cfg, nil
	}
	switch step.AuthType {
	case "bearer":
		if step.AuthToken != "" {
			headers["Authorization"] = "Bearer " + interpolateAutomation(step.AuthToken, values)
		}
	case "basic":
		cfg, err := parseConfig()
		if err != nil {
			return fmt.Errorf("invalid basic auth configuration: %w", err)
		}
		username := interpolateAutomation(configString(cfg, "username"), values)
		password := interpolateAutomation(configString(cfg, "password"), values)
		if username != "" || password != "" {
			headers["Authorization"] = "Basic " + base64.StdEncoding.EncodeToString([]byte(username+":"+password))
		}
	case "apikey":
		cfg, err := parseConfig()
		if err != nil {
			return fmt.Errorf("invalid API key configuration: %w", err)
		}
		key := configString(cfg, "apiKeyName", "key")
		value := configString(cfg, "apiKeyValue", "value")
		placement := configString(cfg, "apiKeyAddTo", "addTo")
		if value == "" {
			value = step.AuthToken
		}
		if key == "" {
			key = "X-API-Key"
		}
		key, value = interpolateAutomation(key, values), interpolateAutomation(value, values)
		if placement == "query" {
			parsed, err := url.Parse(*targetURL)
			if err != nil {
				return err
			}
			appendRawQuery(parsed, key, value)
			*targetURL = parsed.String()
		} else {
			headers[http.CanonicalHeaderKey(key)] = value
		}
	}
	return nil
}

func evaluateAutomationAssertion(rule AutomationAssertion, response core.ResponsePayload, body any, values map[string]any) AutomationAssertionResult {
	expected := interpolateAutomation(rule.Expected, values)
	var actual any
	found := true
	switch rule.Type {
	case "status":
		actual = response.Status
	case "time":
		actual = response.ResponseTime
	case "header":
		found = false
		for key, value := range response.Headers {
			if strings.EqualFold(key, rule.Target) {
				actual, found = value, true
				break
			}
		}
	case "body_text":
		actual = response.Body
	case "body_json":
		if body == nil && strings.TrimSpace(response.Body) != "null" {
			return AutomationAssertionResult{Rule: rule, Passed: false, Message: "Response body is not valid JSON"}
		}
		actual, found = automationJSONLookup(body, rule.Target)
	default:
		return AutomationAssertionResult{Rule: rule, Passed: false, Message: "Unsupported assertion type: " + rule.Type}
	}
	passed, reason := compareAutomation(actual, found, expected, rule.Operator, rule.Type == "status")
	message := fmt.Sprintf("%s %s %q", rule.Type, rule.Operator, expected)
	if reason != "" {
		message += " — " + reason
	}
	return AutomationAssertionResult{Rule: rule, Passed: passed, Actual: actual, Message: message}
}

// automationNumber converts a runtime value to float64, reporting whether the
// value really is numeric. Missing or non-numeric values never compare as 0.
func automationNumber(value any) (float64, bool) {
	switch typed := value.(type) {
	case nil:
		return 0, false
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case float64:
		return typed, true
	case json.Number:
		number, err := typed.Float64()
		return number, err == nil
	case string:
		number, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return number, err == nil && strings.TrimSpace(typed) != ""
	default:
		return 0, false
	}
}

func compareAutomation(actual any, found bool, expected, operator string, status bool) (bool, string) {
	switch operator {
	case "exists":
		if !found {
			return false, "value not found"
		}
		if text, ok := actual.(string); ok && text == "" {
			return false, "value is empty"
		}
		return true, ""
	case "not_exists":
		if !found {
			return true, ""
		}
		if text, ok := actual.(string); ok && text == "" {
			return true, ""
		}
		return false, "value exists"
	}
	if !found {
		return false, "value not found"
	}
	if status && strings.HasSuffix(strings.ToLower(expected), "xx") && len(expected) == 3 {
		n, err := strconv.Atoi(expected[:1])
		code, ok := automationNumber(actual)
		if err != nil || !ok {
			return false, "invalid status range"
		}
		inRange := code >= float64(n*100) && code < float64((n+1)*100)
		switch operator {
		case "neq", "not_equals":
			return !inRange, ""
		default:
			return inRange, ""
		}
	}
	actualText := automationValueString(actual)
	numericEqual := func() bool {
		left, okLeft := automationNumber(actual)
		right, okRight := automationNumber(expected)
		return okLeft && okRight && left == right
	}
	numeric := func(compare func(left, right float64) bool) (bool, string) {
		left, okLeft := automationNumber(actual)
		if !okLeft {
			return false, fmt.Sprintf("actual value %q is not a number", actualText)
		}
		right, okRight := automationNumber(expected)
		if !okRight {
			return false, fmt.Sprintf("expected value %q is not a number", expected)
		}
		return compare(left, right), ""
	}
	switch operator {
	case "eq", "equals", "":
		return actualText == expected || numericEqual(), ""
	case "neq", "not_equals":
		return actualText != expected && !numericEqual(), ""
	case "contains":
		return strings.Contains(actualText, expected), ""
	case "gt", "greater_than":
		return numeric(func(l, r float64) bool { return l > r })
	case "gte", "greater_than_or_equal":
		return numeric(func(l, r float64) bool { return l >= r })
	case "lt", "less_than":
		return numeric(func(l, r float64) bool { return l < r })
	case "lte", "less_than_or_equal":
		return numeric(func(l, r float64) bool { return l <= r })
	case "regex":
		matched, err := regexp.MatchString(expected, actualText)
		if err != nil {
			return false, "invalid regex: " + err.Error()
		}
		return matched, ""
	default:
		return false, "unsupported operator " + operator
	}
}

// automationJSONLookup resolves "$.a.b[0].c" and reports whether the path
// exists, so an explicit JSON null can be told apart from a missing key.
func automationJSONLookup(value any, path string) (any, bool) {
	clean := strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(path), "$."), "$")
	if clean == "" {
		return value, true
	}
	current := value
	for _, part := range automationPathSeparator.Split(clean, -1) {
		if part == "" {
			continue
		}
		switch typed := current.(type) {
		case map[string]any:
			next, ok := typed[part]
			if !ok {
				return nil, false
			}
			current = next
		case []any:
			index, err := strconv.Atoi(part)
			if err != nil || index < 0 || index >= len(typed) {
				return nil, false
			}
			current = typed[index]
		default:
			return nil, false
		}
	}
	return current, true
}

func automationJSONPath(value any, path string) any {
	result, _ := automationJSONLookup(value, path)
	return result
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
			name := strings.Trim(strings.TrimPrefix(strings.TrimSpace(rule.Path), "header["), "]")
			for key, candidate := range response.Headers {
				if strings.EqualFold(key, name) {
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

var automationSecretName = regexp.MustCompile(`(?i)(token|secret|password|passwd|pwd|api[_-]?key|apikey|auth|bearer|cookie|session|credential|private[_-]?key|access[_-]?key)`)

func redactAutomationValue(key string, value any) any {
	if automationSecretName.MatchString(key) {
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
