package ui

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/playwright-community/playwright-go"
)

// StepConfig represents optional advanced configuration inside config_json
type StepConfig struct {
	Operator      string `json:"operator,omitempty"`      // "equals" | "contains" | "starts_with" | "ends_with" | "regex"
	AttributeName string `json:"attributeName,omitempty"` // For assert_attribute
	KeyName       string `json:"keyName,omitempty"`       // For press_key (e.g. "Enter", "Escape")
	FilePath      string `json:"filePath,omitempty"`      // For upload_file
	ScrollX       int    `json:"scrollX,omitempty"`       // For scroll
	ScrollY       int    `json:"scrollY,omitempty"`       // For scroll
	WaitState     string `json:"waitState,omitempty"`     // "visible" | "hidden" | "attached" | "detached"
}

// ExecuteStep executes a single UIStep on the Playwright Page
func ExecuteStep(page playwright.Page, step UIStep, baseURL string) (string, error) {
	timeoutMs := float64(step.Timeout)
	if timeoutMs <= 0 {
		timeoutMs = 5000
	}

	var cfg StepConfig
	if step.ConfigJSON != "" && step.ConfigJSON != "{}" {
		_ = json.Unmarshal([]byte(step.ConfigJSON), &cfg)
	}

	switch step.Type {

	// ─── Browser Actions ──────────────────────────────────────────────────────────

	case StepNavigate:
		targetURL := step.Value
		if targetURL == "" {
			targetURL = step.Selector
		}
		if targetURL == "" {
			targetURL = baseURL
		} else if !strings.HasPrefix(targetURL, "http://") && !strings.HasPrefix(targetURL, "https://") {
			if baseURL != "" {
				base := strings.TrimRight(baseURL, "/")
				path := strings.TrimLeft(targetURL, "/")
				targetURL = base + "/" + path
			} else {
				targetURL = "http://" + targetURL
			}
		}
		_, err := page.Goto(targetURL, playwright.PageGotoOptions{
			Timeout: playwright.Float(timeoutMs),
		})
		if err != nil {
			return "", formatError("Navigate failed", targetURL, fmt.Sprintf("Failed to navigate to URL within %dms", int(timeoutMs)), err)
		}
		return fmt.Sprintf("Navigated to %s", targetURL), nil

	case StepClick:
		if step.Selector == "" {
			return "", fmt.Errorf("selector is required for click action")
		}
		err := page.Click(step.Selector, playwright.PageClickOptions{
			Timeout: playwright.Float(timeoutMs),
		})
		if err != nil {
			return "", formatError("Click failed", step.Selector, fmt.Sprintf("Element was not clickable within %dms", int(timeoutMs)), err)
		}
		return fmt.Sprintf("Clicked %s", step.Selector), nil

	case StepDblClick:
		if step.Selector == "" {
			return "", fmt.Errorf("selector is required for double click action")
		}
		err := page.Dblclick(step.Selector, playwright.PageDblclickOptions{
			Timeout: playwright.Float(timeoutMs),
		})
		if err != nil {
			return "", formatError("Double Click failed", step.Selector, fmt.Sprintf("Element was not double-clickable within %dms", int(timeoutMs)), err)
		}
		return fmt.Sprintf("Double clicked %s", step.Selector), nil

	case StepInput:
		if step.Selector == "" {
			return "", fmt.Errorf("selector is required for input action")
		}
		err := page.Fill(step.Selector, step.Value, playwright.PageFillOptions{
			Timeout: playwright.Float(timeoutMs),
		})
		if err != nil {
			return "", formatError("Input failed", step.Selector, fmt.Sprintf("Could not fill input within %dms", int(timeoutMs)), err)
		}
		return fmt.Sprintf("Filled '%s' into %s", step.Value, step.Selector), nil

	case StepClear:
		if step.Selector == "" {
			return "", fmt.Errorf("selector is required for clear action")
		}
		err := page.Fill(step.Selector, "", playwright.PageFillOptions{
			Timeout: playwright.Float(timeoutMs),
		})
		if err != nil {
			return "", formatError("Clear failed", step.Selector, fmt.Sprintf("Could not clear element within %dms", int(timeoutMs)), err)
		}
		return fmt.Sprintf("Cleared %s", step.Selector), nil

	case StepSelect:
		if step.Selector == "" {
			return "", fmt.Errorf("selector is required for select action")
		}
		_, err := page.SelectOption(step.Selector, playwright.SelectOptionValues{
			Values: playwright.StringSlice(step.Value),
		}, playwright.PageSelectOptionOptions{
			Timeout: playwright.Float(timeoutMs),
		})
		if err != nil {
			return "", formatError("Select option failed", step.Selector, fmt.Sprintf("Could not select option '%s' within %dms", step.Value, int(timeoutMs)), err)
		}
		return fmt.Sprintf("Selected '%s' on %s", step.Value, step.Selector), nil

	case StepCheck:
		if step.Selector == "" {
			return "", fmt.Errorf("selector is required for check action")
		}
		err := page.Check(step.Selector, playwright.PageCheckOptions{
			Timeout: playwright.Float(timeoutMs),
		})
		if err != nil {
			return "", formatError("Check failed", step.Selector, fmt.Sprintf("Could not check element within %dms", int(timeoutMs)), err)
		}
		return fmt.Sprintf("Checked %s", step.Selector), nil

	case StepUncheck:
		if step.Selector == "" {
			return "", fmt.Errorf("selector is required for uncheck action")
		}
		err := page.Uncheck(step.Selector, playwright.PageUncheckOptions{
			Timeout: playwright.Float(timeoutMs),
		})
		if err != nil {
			return "", formatError("Uncheck failed", step.Selector, fmt.Sprintf("Could not uncheck element within %dms", int(timeoutMs)), err)
		}
		return fmt.Sprintf("Unchecked %s", step.Selector), nil

	case StepHover:
		if step.Selector == "" {
			return "", fmt.Errorf("selector is required for hover action")
		}
		err := page.Hover(step.Selector, playwright.PageHoverOptions{
			Timeout: playwright.Float(timeoutMs),
		})
		if err != nil {
			return "", formatError("Hover failed", step.Selector, fmt.Sprintf("Could not hover on element within %dms", int(timeoutMs)), err)
		}
		return fmt.Sprintf("Hovered over %s", step.Selector), nil

	case StepScroll:
		if step.Selector != "" {
			locator := page.Locator(step.Selector)
			err := locator.ScrollIntoViewIfNeeded(playwright.LocatorScrollIntoViewIfNeededOptions{
				Timeout: playwright.Float(timeoutMs),
			})
			if err != nil {
				return "", formatError("Scroll to element failed", step.Selector, fmt.Sprintf("Could not scroll to element within %dms", int(timeoutMs)), err)
			}
			return fmt.Sprintf("Scrolled into view: %s", step.Selector), nil
		}
		// Scroll by coordinates
		_, err := page.Evaluate(fmt.Sprintf("window.scrollTo(%d, %d)", cfg.ScrollX, cfg.ScrollY))
		if err != nil {
			return "", fmt.Errorf("scroll by window coordinates failed: %w", err)
		}
		return fmt.Sprintf("Scrolled window to (%d, %d)", cfg.ScrollX, cfg.ScrollY), nil

	case StepPressKey:
		key := step.Value
		if key == "" {
			key = cfg.KeyName
		}
		if key == "" {
			key = "Enter"
		}
		target := step.Selector
		if target == "" {
			target = "body"
		}
		err := page.Press(target, key, playwright.PagePressOptions{
			Timeout: playwright.Float(timeoutMs),
		})
		if err != nil {
			return "", formatError("Press key failed", target, fmt.Sprintf("Could not press key '%s' within %dms", key, int(timeoutMs)), err)
		}
		return fmt.Sprintf("Pressed '%s' on %s", key, target), nil

	case StepUploadFile:
		if step.Selector == "" {
			return "", fmt.Errorf("selector is required for file upload")
		}
		filePath := step.Value
		if filePath == "" {
			filePath = cfg.FilePath
		}
		err := page.SetInputFiles(step.Selector, []string{filePath}, playwright.PageSetInputFilesOptions{
			Timeout: playwright.Float(timeoutMs),
		})
		if err != nil {
			return "", formatError("Upload file failed", step.Selector, fmt.Sprintf("Could not set input files for '%s'", filePath), err)
		}
		return fmt.Sprintf("Uploaded file '%s' to %s", filePath, step.Selector), nil

	case StepWait:
		if step.Selector != "" {
			state := playwright.WaitForSelectorStateVisible
			if cfg.WaitState == "hidden" {
				state = playwright.WaitForSelectorStateHidden
			} else if cfg.WaitState == "attached" {
				state = playwright.WaitForSelectorStateAttached
			} else if cfg.WaitState == "detached" {
				state = playwright.WaitForSelectorStateDetached
			}
			_, err := page.WaitForSelector(step.Selector, playwright.PageWaitForSelectorOptions{
				State:   state,
				Timeout: playwright.Float(timeoutMs),
			})
			if err != nil {
				return "", formatError("Wait for selector failed", step.Selector, fmt.Sprintf("Element state '%s' not reached within %dms", cfg.WaitState, int(timeoutMs)), err)
			}
			return fmt.Sprintf("Waited for %s to reach state %s", step.Selector, cfg.WaitState), nil
		}
		// Wait by milliseconds
		ms, _ := strconv.Atoi(step.Value)
		if ms <= 0 {
			ms = int(timeoutMs)
		}
		time.Sleep(time.Duration(ms) * time.Millisecond)
		return fmt.Sprintf("Waited %dms", ms), nil

	// ─── Assertions ───────────────────────────────────────────────────────────────

	case StepAssertExists:
		if step.Selector == "" {
			return "", fmt.Errorf("selector is required for assert_element_exists")
		}
		_, err := page.WaitForSelector(step.Selector, playwright.PageWaitForSelectorOptions{
			State:   playwright.WaitForSelectorStateAttached,
			Timeout: playwright.Float(timeoutMs),
		})
		if err != nil {
			return "", formatAssertionError("Assert Element Exists", step.Selector, "Element exists in DOM", "Element not found", int(timeoutMs))
		}
		return fmt.Sprintf("Verified element '%s' exists", step.Selector), nil

	case StepAssertVisible:
		if step.Selector == "" {
			return "", fmt.Errorf("selector is required for assert_element_visible")
		}
		_, err := page.WaitForSelector(step.Selector, playwright.PageWaitForSelectorOptions{
			State:   playwright.WaitForSelectorStateVisible,
			Timeout: playwright.Float(timeoutMs),
		})
		if err != nil {
			return "", formatAssertionError("Assert Element Visible", step.Selector, "Element is visible", "Element not visible or not found", int(timeoutMs))
		}
		return fmt.Sprintf("Verified element '%s' is visible", step.Selector), nil

	case StepAssertEnabled:
		if step.Selector == "" {
			return "", fmt.Errorf("selector is required for assert_element_enabled")
		}
		locator := page.Locator(step.Selector)
		enabled, err := locator.IsEnabled(playwright.LocatorIsEnabledOptions{
			Timeout: playwright.Float(timeoutMs),
		})
		if err != nil || !enabled {
			return "", formatAssertionError("Assert Element Enabled", step.Selector, "Element is enabled", "Element is disabled or not found", int(timeoutMs))
		}
		return fmt.Sprintf("Verified element '%s' is enabled", step.Selector), nil

	case StepAssertText:
		if step.Selector == "" {
			return "", fmt.Errorf("selector is required for assert_text")
		}
		locator := page.Locator(step.Selector)
		text, err := locator.InnerText(playwright.LocatorInnerTextOptions{
			Timeout: playwright.Float(timeoutMs),
		})
		if err != nil {
			return "", formatAssertionError("Assert Text", step.Selector, step.Value, "Could not retrieve text from element", int(timeoutMs))
		}
		if !checkMatch(text, step.Value, cfg.Operator) {
			return "", formatAssertionError("Assert Text", step.Selector, fmt.Sprintf("'%s' (%s)", step.Value, matchOpName(cfg.Operator)), fmt.Sprintf("'%s'", text), int(timeoutMs))
		}
		return fmt.Sprintf("Verified text of '%s' matches '%s'", step.Selector, step.Value), nil

	case StepAssertValue:
		if step.Selector == "" {
			return "", fmt.Errorf("selector is required for assert_value")
		}
		locator := page.Locator(step.Selector)
		val, err := locator.InputValue(playwright.LocatorInputValueOptions{
			Timeout: playwright.Float(timeoutMs),
		})
		if err != nil {
			return "", formatAssertionError("Assert Value", step.Selector, step.Value, "Could not retrieve input value", int(timeoutMs))
		}
		if !checkMatch(val, step.Value, cfg.Operator) {
			return "", formatAssertionError("Assert Value", step.Selector, fmt.Sprintf("'%s' (%s)", step.Value, matchOpName(cfg.Operator)), fmt.Sprintf("'%s'", val), int(timeoutMs))
		}
		return fmt.Sprintf("Verified value of '%s' matches '%s'", step.Selector, step.Value), nil

	case StepAssertAttribute:
		if step.Selector == "" {
			return "", fmt.Errorf("selector is required for assert_attribute")
		}
		attrName := cfg.AttributeName
		if attrName == "" {
			attrName = "value"
		}
		locator := page.Locator(step.Selector)
		attrVal, err := locator.GetAttribute(attrName, playwright.LocatorGetAttributeOptions{
			Timeout: playwright.Float(timeoutMs),
		})
		if err != nil {
			return "", formatAssertionError("Assert Attribute", step.Selector, fmt.Sprintf("Attribute [%s] == '%s'", attrName, step.Value), "Could not retrieve attribute", int(timeoutMs))
		}
		if !checkMatch(attrVal, step.Value, cfg.Operator) {
			return "", formatAssertionError("Assert Attribute", step.Selector, fmt.Sprintf("[%s] == '%s'", attrName, step.Value), fmt.Sprintf("[%s] == '%s'", attrName, attrVal), int(timeoutMs))
		}
		return fmt.Sprintf("Verified attribute [%s] of '%s' is '%s'", attrName, step.Selector, step.Value), nil

	case StepAssertURL:
		currURL := page.URL()
		if !checkMatch(currURL, step.Value, cfg.Operator) {
			return "", formatAssertionError("Assert URL", "page.url", fmt.Sprintf("'%s' (%s)", step.Value, matchOpName(cfg.Operator)), fmt.Sprintf("'%s'", currURL), int(timeoutMs))
		}
		return fmt.Sprintf("Verified URL matches '%s'", step.Value), nil

	case StepAssertTitle:
		title, err := page.Title()
		if err != nil {
			return "", formatAssertionError("Assert Page Title", "page.title", step.Value, "Could not get page title", int(timeoutMs))
		}
		if !checkMatch(title, step.Value, cfg.Operator) {
			return "", formatAssertionError("Assert Page Title", "page.title", fmt.Sprintf("'%s' (%s)", step.Value, matchOpName(cfg.Operator)), fmt.Sprintf("'%s'", title), int(timeoutMs))
		}
		return fmt.Sprintf("Verified page title matches '%s'", step.Value), nil

	default:
		return "", fmt.Errorf("unsupported step type: %s", step.Type)
	}
}

// checkMatch evaluates string comparison based on operator
func checkMatch(actual, expected, op string) bool {
	switch op {
	case "equals", "eq", "":
		return strings.TrimSpace(actual) == strings.TrimSpace(expected)
	case "contains":
		return strings.Contains(actual, expected)
	case "starts_with":
		return strings.HasPrefix(actual, expected)
	case "ends_with":
		return strings.HasSuffix(actual, expected)
	case "regex":
		matched, err := regexp.MatchString(expected, actual)
		return err == nil && matched
	default:
		return strings.Contains(actual, expected)
	}
}

func matchOpName(op string) string {
	switch op {
	case "contains":
		return "contains"
	case "starts_with":
		return "starts with"
	case "ends_with":
		return "ends with"
	default:
		return "equals"
	}
}

func formatError(action, target, reason string, err error) error {
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}
	return fmt.Errorf("%s\nTarget: %s\nReason: %s\nDetail: %s", action, target, reason, errMsg)
}

func formatAssertionError(assertionName, target, expected, actual string, timeoutMs int) error {
	return fmt.Errorf("Assertion Failed: %s\nTarget: %s\nExpected: %s\nActual: %s\nTimeout: %d ms", assertionName, target, expected, actual, timeoutMs)
}
