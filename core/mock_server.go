package core

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
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

const (
	// mockMaxDelay keeps simulated latency below the server write timeout so a
	// delayed response is still delivered to the client.
	mockMaxDelay      = 60 * time.Second
	mockWriteTimeout  = mockMaxDelay + 10*time.Second
	mockMaxBodyLogged = 1 << 20
)

type MockServerEngine struct {
	mu        sync.RWMutex
	server    *http.Server
	port      int
	routes    []MockRoute
	isRunning bool
	logs      []MockRequestLog
	logSeq    atomic.Uint64
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
			m.routes = cloneRoutes(routes)
			return nil
		}
		_ = m.stopInternal()
	}

	m.port = port
	m.routes = cloneRoutes(routes)

	mux := http.NewServeMux()
	mux.HandleFunc("/", m.handleRequest)

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return fmt.Errorf("cannot bind mock server on port %d: %w", port, err)
	}

	server := &http.Server{
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: mockWriteTimeout,
	}
	m.server = server
	m.isRunning = true

	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			m.mu.Lock()
			if m.server == server {
				m.isRunning = false
			}
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

// cloneRoutes deep-copies the routes so request handlers never share (and
// concurrently write) the header maps owned by the caller.
func cloneRoutes(routes []MockRoute) []MockRoute {
	out := make([]MockRoute, len(routes))
	for i, route := range routes {
		out[i] = route
		out[i].ResponseHeaders = make(map[string]string, len(route.ResponseHeaders))
		for key, value := range route.ResponseHeaders {
			out[i].ResponseHeaders[http.CanonicalHeaderKey(strings.TrimSpace(key))] = value
		}
	}
	return out
}

func (m *MockServerEngine) UpdateRoutes(routes []MockRoute) {
	cloned := cloneRoutes(routes)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.routes = cloned
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
		url = fmt.Sprintf("http://127.0.0.1:%d", m.port)
	}

	return MockServerStatus{
		IsRunning: m.isRunning,
		Port:      m.port,
		URL:       url,
		Logs:      logsCopy,
	}
}

// routeMatchScore ranks how specifically a route matches a request path.
// Higher is better; -1 means no match. Exact paths beat parameterised paths
// (":id" or "{id}" segments), which beat prefix matches; among prefixes the
// longest wins, and "*" is the last resort.
func routeMatchScore(routePath, reqPath string) int {
	if routePath == "*" {
		return 0
	}
	if routePath == reqPath {
		return 1_000_000
	}
	routeSegs := strings.Split(strings.Trim(routePath, "/"), "/")
	reqSegs := strings.Split(strings.Trim(reqPath, "/"), "/")
	if len(routeSegs) == len(reqSegs) {
		score := 500_000
		matched := true
		for i, seg := range routeSegs {
			isParam := strings.HasPrefix(seg, ":") || (strings.HasPrefix(seg, "{") && strings.HasSuffix(seg, "}"))
			switch {
			case isParam && reqSegs[i] != "":
				score += 1
			case seg == reqSegs[i]:
				score += 10
			default:
				matched = false
			}
		}
		if matched {
			return score
		}
	}
	if routePath != "/" && !strings.HasSuffix(routePath, "/") && strings.HasPrefix(reqPath, routePath+"/") {
		return 1_000 + len(routePath)
	}
	return -1
}

func matchMockRoute(routes []MockRoute, method, reqPath string) *MockRoute {
	var best *MockRoute
	bestScore := -1
	for i := range routes {
		route := &routes[i]
		if !route.Enabled {
			continue
		}
		exactMethod := strings.EqualFold(route.Method, method)
		if !exactMethod && route.Method != "*" {
			continue
		}
		score := routeMatchScore(route.Path, reqPath)
		if score < 0 {
			continue
		}
		score *= 2
		if exactMethod {
			score++
		}
		if score > bestScore {
			best, bestScore = route, score
		}
	}
	return best
}

func (m *MockServerEngine) handleRequest(w http.ResponseWriter, r *http.Request) {
	m.mu.RLock()
	routes := m.routes
	m.mu.RUnlock()

	reqPath := r.URL.Path
	reqMethod := r.Method

	matchedRoute := matchMockRoute(routes, reqMethod, reqPath)

	bodyBytes, _ := io.ReadAll(io.LimitReader(r.Body, mockMaxBodyLogged))
	reqHeaders := make(map[string]string)
	for k, v := range r.Header {
		reqHeaders[k] = strings.Join(v, ", ")
	}

	status := http.StatusNotFound
	notFound, _ := json.Marshal(map[string]string{"error": "Mock route not found", "path": reqPath})
	respBody := string(notFound)
	headers := map[string]string{"Content-Type": "application/json"}

	if matchedRoute != nil {
		if matchedRoute.DelayMs > 0 {
			delay := time.Duration(matchedRoute.DelayMs) * time.Millisecond
			if delay > mockMaxDelay {
				delay = mockMaxDelay
			}
			timer := time.NewTimer(delay)
			select {
			case <-timer.C:
			case <-r.Context().Done():
				timer.Stop()
				return
			}
		}
		status = matchedRoute.StatusCode
		if status <= 0 {
			status = http.StatusOK
		}
		respBody = matchedRoute.ResponseBody
		// Copy before adding defaults: the route map is shared by concurrent requests.
		headers = make(map[string]string, len(matchedRoute.ResponseHeaders)+1)
		for key, value := range matchedRoute.ResponseHeaders {
			headers[key] = value
		}
		if _, hasContentType := headers["Content-Type"]; !hasContentType {
			headers["Content-Type"] = "application/json"
		}
		if status < 100 || status > 999 {
			// net/http panics on such codes; report the misconfiguration instead.
			status = http.StatusInternalServerError
			invalid, _ := json.Marshal(map[string]any{"error": "Invalid mock status code", "statusCode": matchedRoute.StatusCode})
			respBody = string(invalid)
			headers["Content-Type"] = "application/json"
		}
	}

	logEntry := MockRequestLog{
		ID:        fmt.Sprintf("log_%d_%d", time.Now().UnixNano(), m.logSeq.Add(1)),
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
