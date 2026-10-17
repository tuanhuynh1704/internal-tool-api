package ui

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/playwright-community/playwright-go"
)

// ProgressCallback is called when step status updates
type ProgressCallback func(event StepProgressEvent)

// activeRun holds the controls of one running scenario. The run ID guards
// against a finishing run removing the handles of a newer run of the same
// scenario.
type activeRun struct {
	runID  string
	cancel context.CancelFunc
	close  func()
}

// Runner coordinates UI test scenario execution
type Runner struct {
	engine     *BrowserEngine
	screenshot *ScreenshotManager

	activeMu sync.Mutex
	runs     map[string]*activeRun
}

// NewRunner creates a new Runner instance
func NewRunner(engine *BrowserEngine, sm *ScreenshotManager) *Runner {
	if engine == nil {
		engine = NewBrowserEngine()
	}
	if sm == nil {
		sm = NewScreenshotManager()
	}
	return &Runner{
		engine:     engine,
		screenshot: sm,
		runs:       make(map[string]*activeRun),
	}
}

// CancelRun cancels an actively running test scenario
func (r *Runner) CancelRun(scenarioID string) {
	r.activeMu.Lock()
	run := r.runs[scenarioID]
	r.activeMu.Unlock()
	if run == nil {
		return
	}
	log.Printf("[ui-runner] Cancelling scenario %s", scenarioID)
	run.cancel()
	if run.close != nil {
		run.close()
	}
}

// RunScenario executes all steps in a UIScenario sequentially
func (r *Runner) RunScenario(
	ctx context.Context,
	scenario UIScenario,
	envVars map[string]string,
	headless bool,
	ignoreHTTPSErrors bool,
	onProgress ProgressCallback,
) TestRunSummary {
	runID := fmt.Sprintf("run_%d", time.Now().UnixNano())
	startedAt := time.Now()

	summary := TestRunSummary{
		RunID:        runID,
		ScenarioID:   scenario.ID,
		ScenarioName: scenario.Name,
		Status:       RunStatusRunning,
		StartedAt:    startedAt,
		TotalSteps:   len(scenario.Steps),
		StepResults:  make([]StepExecutionResult, 0, len(scenario.Steps)),
	}

	// Register cancel func
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	run := &activeRun{runID: runID, cancel: cancel}
	r.activeMu.Lock()
	r.runs[scenario.ID] = run
	r.activeMu.Unlock()

	defer func() {
		r.activeMu.Lock()
		if current := r.runs[scenario.ID]; current != nil && current.runID == runID {
			delete(r.runs, scenario.ID)
		}
		r.activeMu.Unlock()
	}()

	if onProgress != nil {
		onProgress(StepProgressEvent{
			RunID:      runID,
			ScenarioID: scenario.ID,
			Phase:      "start",
			Current:    0,
			Total:      len(scenario.Steps),
		})
	}

	// Resolve environment variables on scenario level (BaseURL)
	resolvedBaseURL := interpolateVariables(scenario.BaseURL, envVars)

	// Launch single browser session for the entire scenario
	browser, bCtx, page, err := r.engine.LaunchBrowserSession(scenario.Browser, headless, ignoreHTTPSErrors)
	if err != nil {
		summary.Status = RunStatusFailed
		summary.FinishedAt = time.Now()
		summary.DurationMs = summary.FinishedAt.Sub(startedAt).Milliseconds()
		summary.ErrorMessage = fmt.Sprintf("Failed to launch browser: %v", err)
		if onProgress != nil {
			onProgress(StepProgressEvent{
				RunID:      runID,
				ScenarioID: scenario.ID,
				Phase:      "done",
				Summary:    &summary,
			})
		}
		return summary
	}

	// Ensure browser session is cleanly closed upon exit
	defer func() {
		if page != nil {
			_ = page.Close()
		}
		if bCtx != nil {
			_ = bCtx.Close()
		}
		if browser != nil {
			_ = browser.Close()
		}
	}()
	r.activeMu.Lock()
	run.close = func() {
		if bCtx != nil {
			_ = bCtx.Close()
		}
	}
	r.activeMu.Unlock()

	var consoleMu sync.Mutex
	consoleLogs := make([]string, 0, 20)
	bCtx.OnConsole(func(message playwright.ConsoleMessage) {
		consoleMu.Lock()
		defer consoleMu.Unlock()
		if len(consoleLogs) < 50 {
			consoleLogs = append(consoleLogs, fmt.Sprintf("[%s] %s", message.Type(), message.Text()))
		}
	})
	tracePath := r.screenshot.GenerateTracePath(scenario.ID, runID)
	traceStarted := bCtx.Tracing().Start(playwright.TracingStartOptions{
		Screenshots: playwright.Bool(true),
		Snapshots:   playwright.Bool(true),
		Sources:     playwright.Bool(true),
		Title:       playwright.String(scenario.Name),
	}) == nil
	traceSaved := false
	defer func() {
		if traceStarted && !traceSaved {
			_ = bCtx.Tracing().Stop()
		}
	}()

	hasFailed := false

	// Execute steps sequentially
	for idx, rawStep := range scenario.Steps {
		// Check for cancellation
		select {
		case <-ctx.Done():
			summary.Status = RunStatusCancelled
			summary.ErrorMessage = "Test run cancelled by user."
			hasFailed = true
		default:
		}

		if hasFailed {
			// Mark remaining steps as SKIPPED
			stepRes := StepExecutionResult{
				StepID:     rawStep.ID,
				StepOrder:  rawStep.SortOrder,
				StepType:   rawStep.Type,
				StepName:   getStepDisplayName(rawStep),
				Status:     StatusSkipped,
				DurationMs: 0,
			}
			summary.SkippedSteps++
			summary.StepResults = append(summary.StepResults, stepRes)
			if onProgress != nil {
				onProgress(StepProgressEvent{
					RunID:      runID,
					ScenarioID: scenario.ID,
					Phase:      "step_end",
					Current:    idx + 1,
					Total:      len(scenario.Steps),
					StepResult: stepRes,
				})
			}
			continue
		}

		// Interpolate variables for the step
		step := rawStep
		step.Selector = interpolateVariables(step.Selector, envVars)
		step.Value = interpolateVariables(step.Value, envVars)
		step.ConfigJSON = interpolateConfigJSON(step.ConfigJSON, envVars)

		stepRes := StepExecutionResult{
			StepID:    step.ID,
			StepOrder: step.SortOrder,
			StepType:  step.Type,
			StepName:  getStepDisplayName(step),
			Status:    StatusRunning,
		}

		if onProgress != nil {
			onProgress(StepProgressEvent{
				RunID:      runID,
				ScenarioID: scenario.ID,
				Phase:      "step_start",
				Current:    idx + 1,
				Total:      len(scenario.Steps),
				StepResult: stepRes,
			})
		}

		stepStart := time.Now()
		details, stepErr := ExecuteStep(ctx, page, step, resolvedBaseURL)
		stepDuration := time.Since(stepStart).Milliseconds()

		stepRes.DurationMs = stepDuration
		stepRes.Details = details

		if stepErr != nil {
			hasFailed = true
			stepRes.Status = StatusFailed
			stepRes.Error = stepErr.Error()
			summary.FailedSteps++

			// Capture screenshot on failure
			screenshotPath := r.screenshot.GenerateScreenshotPath(scenario.ID, step.ID)
			_, scErr := page.Screenshot(playwright.PageScreenshotOptions{
				Path:     playwright.String(screenshotPath),
				FullPage: playwright.Bool(true),
			})
			if scErr == nil {
				stepRes.ScreenshotPath = screenshotPath
			} else {
				log.Printf("[ui-runner] Failed to capture failure screenshot: %v", scErr)
			}
			if traceStarted && !traceSaved {
				if err := bCtx.Tracing().Stop(tracePath); err == nil {
					traceSaved = true
					stepRes.Details = strings.TrimSpace(stepRes.Details + "\nTrace artifact: " + tracePath)
				}
			}
			consoleMu.Lock()
			if len(consoleLogs) > 0 {
				stepRes.Details = strings.TrimSpace(stepRes.Details + "\nBrowser console:\n" + strings.Join(consoleLogs, "\n"))
			}
			consoleMu.Unlock()
		} else {
			stepRes.Status = StatusPassed
			summary.PassedSteps++
		}

		summary.StepResults = append(summary.StepResults, stepRes)

		if onProgress != nil {
			onProgress(StepProgressEvent{
				RunID:      runID,
				ScenarioID: scenario.ID,
				Phase:      "step_end",
				Current:    idx + 1,
				Total:      len(scenario.Steps),
				StepResult: stepRes,
			})
		}
	}

	summary.FinishedAt = time.Now()
	summary.DurationMs = summary.FinishedAt.Sub(startedAt).Milliseconds()

	if summary.Status == RunStatusRunning {
		if summary.FailedSteps > 0 {
			summary.Status = RunStatusFailed
		} else {
			summary.Status = RunStatusPassed
		}
	}

	if onProgress != nil {
		onProgress(StepProgressEvent{
			RunID:      runID,
			ScenarioID: scenario.ID,
			Phase:      "done",
			Current:    len(scenario.Steps),
			Total:      len(scenario.Steps),
			Summary:    &summary,
		})
	}

	return summary
}

// variablePattern matches {{ name }} with the same rules as the API runner, so
// a variable name that works in API automation also works in UI tests.
var variablePattern = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)

// interpolateConfigJSON substitutes variables inside the string values of a
// step's JSON config. Substituting into the raw JSON text would let a value
// containing a quote or backslash corrupt the document.
func interpolateConfigJSON(raw string, envVars map[string]string) string {
	if strings.TrimSpace(raw) == "" || len(envVars) == 0 {
		return raw
	}
	var cfg map[string]any
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return raw // ExecuteStep reports the invalid configuration
	}
	for key, value := range cfg {
		if text, ok := value.(string); ok {
			cfg[key] = interpolateVariables(text, envVars)
		}
	}
	encoded, err := json.Marshal(cfg)
	if err != nil {
		return raw
	}
	return string(encoded)
}

// interpolateVariables replaces {{varName}} with matching value from envVars
func interpolateVariables(text string, envVars map[string]string) string {
	if text == "" || len(envVars) == 0 {
		return text
	}
	re := variablePattern
	return re.ReplaceAllStringFunc(text, func(match string) string {
		sub := re.FindStringSubmatch(match)
		if len(sub) > 1 {
			varKey := strings.TrimSpace(sub[1])
			if val, exists := envVars[varKey]; exists {
				return val
			}
		}
		return match
	})
}

// getStepDisplayName generates a friendly readable description of the step
func getStepDisplayName(step UIStep) string {
	switch step.Type {
	case StepNavigate:
		val := step.Value
		if val == "" {
			val = step.Selector
		}
		return fmt.Sprintf("Navigate to %s", val)
	case StepClick:
		return fmt.Sprintf("Click %s", step.Selector)
	case StepDblClick:
		return fmt.Sprintf("Double Click %s", step.Selector)
	case StepInput:
		return fmt.Sprintf("Input into %s", step.Selector)
	case StepClear:
		return fmt.Sprintf("Clear %s", step.Selector)
	case StepSelect:
		return fmt.Sprintf("Select '%s' in %s", step.Value, step.Selector)
	case StepCheck:
		return fmt.Sprintf("Check %s", step.Selector)
	case StepUncheck:
		return fmt.Sprintf("Uncheck %s", step.Selector)
	case StepHover:
		return fmt.Sprintf("Hover over %s", step.Selector)
	case StepScroll:
		return fmt.Sprintf("Scroll %s", step.Selector)
	case StepPressKey:
		return fmt.Sprintf("Press Key on %s", step.Selector)
	case StepUploadFile:
		return fmt.Sprintf("Upload file to %s", step.Selector)
	case StepWait:
		return fmt.Sprintf("Wait %s", step.Value)
	case StepAssertExists:
		return fmt.Sprintf("Assert Element Exists: %s", step.Selector)
	case StepAssertVisible:
		return fmt.Sprintf("Assert Element Visible: %s", step.Selector)
	case StepAssertEnabled:
		return fmt.Sprintf("Assert Element Enabled: %s", step.Selector)
	case StepAssertText:
		return fmt.Sprintf("Assert Text of %s", step.Selector)
	case StepAssertValue:
		return fmt.Sprintf("Assert Value of %s", step.Selector)
	case StepAssertAttribute:
		return fmt.Sprintf("Assert Attribute of %s", step.Selector)
	case StepAssertURL:
		return fmt.Sprintf("Assert URL matches '%s'", step.Value)
	case StepAssertTitle:
		return fmt.Sprintf("Assert Title matches '%s'", step.Value)
	default:
		return string(step.Type)
	}
}
