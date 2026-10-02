package core

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type MockRoute struct {
	ID              string            `json:"id"`
	Path            string            `json:"path"`
	Method          string            `json:"method"`
	StatusCode      int               `json:"statusCode"`
	ResponseHeaders map[string]string `json:"responseHeaders"`
	ResponseBody    string            `json:"responseBody"`
	DelayMs         int               `json:"delayMs"`
	Enabled         bool              `json:"enabled"`
}

type MockRequestLog struct {
	ID        string            `json:"id"`
	Timestamp string            `json:"timestamp"`
	Method    string            `json:"method"`
	Path      string            `json:"path"`
	Status    int               `json:"status"`
	Headers   map[string]string `json:"headers"`
	Body      string            `json:"body"`
	Matched   bool              `json:"matched"`
}

type MockServerStatus struct {
	IsRunning bool             `json:"isRunning"`
	Port      int              `json:"port"`
	URL       string           `json:"url"`
	Logs      []MockRequestLog `json:"logs"`
}

type MockServerEngine struct {
	mu        sync.RWMutex
	server    *http.Server
	port      int
	routes    []MockRoute
	isRunning bool
	logs      []MockRequestLog
}

func NewMockServerEngine() *MockServerEngine {
	return &MockServerEngine{
		routes: make([]MockRoute, 0),
		logs:   make([]MockRequestLog, 0),
	}
}

func (m *MockServerEngine) Start(port int, routes []MockRoute) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.isRunning {
		if m.port == port {
			m.routes = routes
			return nil
		}
		_ = m.stopInternal()
	}

	m.port = port
	m.routes = routes

	mux := http.NewServeMux()
	mux.HandleFunc("/", m.handleRequest)

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return fmt.Errorf("cannot bind mock server on port %d: %w", port, err)
	}

	m.server = &http.Server{
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	m.isRunning = true

	go func() {
		if err := m.server.Serve(listener); err != nil && err != http.ErrServerClosed {
			m.mu.Lock()
			m.isRunning = false
			m.mu.Unlock()
		}
	}()

	return nil
}

func (m *MockServerEngine) Stop() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.stopInternal()
}

func (m *MockServerEngine) stopInternal() error {
	if !m.isRunning || m.server == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := m.server.Shutdown(ctx)
	m.isRunning = false
	m.server = nil
	return err
}

func (m *MockServerEngine) UpdateRoutes(routes []MockRoute) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.routes = routes
}

func (m *MockServerEngine) ClearLogs() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.logs = make([]MockRequestLog, 0)
}

func (m *MockServerEngine) GetStatus() MockServerStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()

	logsCopy := make([]MockRequestLog, len(m.logs))
	copy(logsCopy, m.logs)

	url := ""
	if m.isRunning {
		url = fmt.Sprintf("http://localhost:%d", m.port)
	}

	return MockServerStatus{
		IsRunning: m.isRunning,
		Port:      m.port,
		URL:       url,
		Logs:      logsCopy,
	}
}

func (m *MockServerEngine) handleRequest(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	routes := make([]MockRoute, len(m.routes))
	copy(routes, m.routes)
	m.mu.Unlock()

	reqPath := r.URL.Path
	reqMethod := r.Method

	var matchedRoute *MockRoute
	for i := range routes {
		route := &routes[i]
		if !route.Enabled {
			continue
		}
		methodMatch := route.Method == "*" || strings.EqualFold(route.Method, reqMethod)
		pathMatch := route.Path == "*" || route.Path == reqPath || (route.Path != "/" && strings.HasSuffix(route.Path, "/") == false && strings.HasPrefix(reqPath, route.Path+"/"))
		if methodMatch && pathMatch {
			matchedRoute = route
			break
		}
	}

	bodyBytes, _ := io.ReadAll(r.Body)
	reqHeaders := make(map[string]string)
	for k, v := range r.Header {
		reqHeaders[k] = strings.Join(v, ", ")
	}

	status := http.StatusNotFound
	respBody := `{"error": "Mock route not found", "path": "` + reqPath + `"}`
	headers := map[string]string{"Content-Type": "application/json"}

	if matchedRoute != nil {
		if matchedRoute.DelayMs > 0 {
			time.Sleep(time.Duration(matchedRoute.DelayMs) * time.Millisecond)
		}
		status = matchedRoute.StatusCode
		if status <= 0 {
			status = http.StatusOK
		}
		respBody = matchedRoute.ResponseBody
		headers = matchedRoute.ResponseHeaders
		if headers == nil {
			headers = make(map[string]string)
		}
		if _, hasContentType := headers["Content-Type"]; !hasContentType {
			headers["Content-Type"] = "application/json"
		}
	}

	logEntry := MockRequestLog{
		ID:        fmt.Sprintf("log_%d", time.Now().UnixNano()),
		Timestamp: time.Now().Format("15:04:05.000"),
		Method:    reqMethod,
		Path:      reqPath,
		Status:    status,
		Headers:   reqHeaders,
		Body:      string(bodyBytes),
		Matched:   matchedRoute != nil,
	}

	m.mu.Lock()
	if len(m.logs) >= 100 {
		m.logs = m.logs[1:]
	}
	m.logs = append(m.logs, logEntry)
	m.mu.Unlock()

	for k, v := range headers {
		w.Header().Set(k, v)
	}
	w.WriteHeader(status)
	_, _ = w.Write([]byte(respBody))
}
