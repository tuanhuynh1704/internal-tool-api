package ui

import (
	"fmt"
	"log"
	"sync"

	"github.com/playwright-community/playwright-go"
)

// BrowserEngine manages the Playwright driver and browser instances
type BrowserEngine struct {
	mu sync.Mutex
	pw *playwright.Playwright
}

// NewBrowserEngine initializes a new BrowserEngine
func NewBrowserEngine() *BrowserEngine {
	return &BrowserEngine{}
}

// EnsurePlaywright initializes the Playwright driver if not already running
func (be *BrowserEngine) EnsurePlaywright(browser BrowserType) (*playwright.Playwright, error) {
	be.mu.Lock()
	defer be.mu.Unlock()

	if be.pw != nil {
		return be.pw, nil
	}

	pw, err := playwright.Run()
	if err != nil {
		// Attempt automatic driver installation
		log.Printf("[ui-engine] Playwright driver run failed, trying install: %v", err)
		installErr := playwright.Install(&playwright.RunOptions{
			Browsers: []string{string(normalizeBrowser(browser))},
		})
		if installErr != nil {
			return nil, fmt.Errorf("failed to install playwright browsers: %w (original error: %v)", installErr, err)
		}
		// Try running again after install
		pw, err = playwright.Run()
		if err != nil {
			return nil, fmt.Errorf("failed to start playwright after install: %w", err)
		}
	}

	be.pw = pw
	return be.pw, nil
}

// InstallBrowsers explicitly installs the browser selected by the scenario.
func (be *BrowserEngine) InstallBrowsers(browser BrowserType) error {
	return playwright.Install(&playwright.RunOptions{
		Browsers: []string{string(normalizeBrowser(browser))},
	})
}

func normalizeBrowser(browser BrowserType) BrowserType {
	switch browser {
	case BrowserFirefox, BrowserWebKit, BrowserChromium:
		return browser
	default:
		return BrowserChromium
	}
}

// LaunchBrowserSession launches a single browser, browser context, and page for a test run
func (be *BrowserEngine) LaunchBrowserSession(bType BrowserType, headless bool, ignoreHTTPSErrors bool) (playwright.Browser, playwright.BrowserContext, playwright.Page, error) {
	bType = normalizeBrowser(bType)
	pw, err := be.EnsurePlaywright(bType)
	if err != nil {
		return nil, nil, nil, err
	}

	var browserType playwright.BrowserType
	switch bType {
	case BrowserFirefox:
		browserType = pw.Firefox
	case BrowserWebKit:
		browserType = pw.WebKit
	case BrowserChromium:
		fallthrough
	default:
		browserType = pw.Chromium
	}

	browser, err := browserType.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(headless),
		Args: []string{
			"--disable-blink-features=AutomationControlled",
		},
	})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to launch %s browser: %w", bType, err)
	}

	context, err := browser.NewContext(playwright.BrowserNewContextOptions{
		Viewport: &playwright.Size{
			Width:  1280,
			Height: 800,
		},
		IgnoreHttpsErrors: playwright.Bool(ignoreHTTPSErrors),
	})
	if err != nil {
		_ = browser.Close()
		return nil, nil, nil, fmt.Errorf("failed to create browser context: %w", err)
	}

	page, err := context.NewPage()
	if err != nil {
		_ = context.Close()
		_ = browser.Close()
		return nil, nil, nil, fmt.Errorf("failed to create browser page: %w", err)
	}

	return browser, context, page, nil
}

// Close safely shuts down the Playwright driver
func (be *BrowserEngine) Close() error {
	be.mu.Lock()
	defer be.mu.Unlock()

	if be.pw != nil {
		err := be.pw.Stop()
		be.pw = nil
		return err
	}
	return nil
}
