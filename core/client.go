package core

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptrace"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ==========================================
// 1. DATA MODELS
// ==========================================

type TimingDetails struct {
	DNSTimeMs      int64 `json:"dnsTimeMs"`
	TCPTimeMs      int64 `json:"tcpTimeMs"`
	TLSTimeMs      int64 `json:"tlsTimeMs"`
	TTFBMs         int64 `json:"ttfbMs"`
	DownloadTimeMs int64 `json:"downloadTimeMs"`
	TotalTimeMs    int64 `json:"totalTimeMs"`
}

type RequestPayload struct {
	Method   string            `json:"method"`
	URL      string            `json:"url"`
	Headers  map[string]string `json:"headers"`
	Body     string            `json:"body"`
	BodyType string            `json:"bodyType,omitempty"`
}

type ResponsePayload struct {
	Status       int               `json:"status"`
	StatusText   string            `json:"statusText"`
	Body         string            `json:"body"`
	Headers      map[string]string `json:"headers"`
	ResponseTime int64             `json:"responseTimeMs"`
	ResponseSize int64             `json:"responseSizeByte"`
	Timing       TimingDetails     `json:"timing"`
}

type StreamChunk struct {
	ReqID     string            `json:"reqId"`
	Index     int               `json:"index"`
	Status    int               `json:"status,omitempty"`
	Headers   map[string]string `json:"headers,omitempty"`
	Data      string            `json:"data"`
	EventType string            `json:"eventType,omitempty"`
	IsEnd     bool              `json:"isEnd"`
	Error     string            `json:"error,omitempty"`
}

type StressTestTick struct {
	ElapsedSec   float64 `json:"elapsedSec"`
	CurrentReqs  int64   `json:"currentReqs"`
	SuccessCount int64   `json:"successCount"`
	FailureCount int64   `json:"failureCount"`
	CurrentRPS   float64 `json:"currentRps"`
	AvgLatencyMs int64   `json:"avgLatencyMs"`
	P95Ms        int64   `json:"p95Ms"`
}

type StressTestResult struct {
	TotalRequests    int64   `json:"totalRequests"`
	SuccessCount     int64   `json:"successCount"`
	FailureCount     int64   `json:"failureCount"`
	AverageTimeMs    int64   `json:"averageTimeMs"`
	MinTimeMs        int64   `json:"minTimeMs"`
	MaxTimeMs        int64   `json:"maxTimeMs"`
	P50Ms            int64   `json:"p50Ms"`
	P90Ms            int64   `json:"p90Ms"`
	P95Ms            int64   `json:"p95Ms"`
	P99Ms            int64   `json:"p99Ms"`
	RPS              float64 `json:"rps"`
	TotalDurationSec float64 `json:"totalDurationSec"`
	Cancelled        bool    `json:"cancelled"`
}

// ==========================================
// 2. HTTP CLIENT ENGINE
// ==========================================

type HttpClientEngine struct {
	Client       *http.Client
	cancelStress context.CancelFunc
	stressMu     sync.Mutex
}

func NewHttpClientEngine(allowInsecure bool, timeoutSec int) *HttpClientEngine {
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: allowInsecure,
		},
		MaxIdleConns:        100,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
	}

	return &HttpClientEngine{
		Client: &http.Client{
			Transport: transport,
			Timeout:   time.Duration(timeoutSec) * time.Second,
		},
	}
}

func (e *HttpClientEngine) Execute(payload RequestPayload) (ResponsePayload, error) {
	return e.execute(context.Background(), payload)
}

// ExecuteWithContext executes one request with caller-controlled cancellation.
// Automation runs use this instead of Execute so a stopped scenario interrupts
// the in-flight HTTP request instead of waiting for the client timeout.
func (e *HttpClientEngine) ExecuteWithContext(ctx context.Context, payload RequestPayload) (ResponsePayload, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	return e.execute(ctx, payload)
}

// execute keeps the public single-request API while allowing load-test workers
// to cancel in-flight HTTP I/O through their run context.
func (e *HttpClientEngine) execute(ctx context.Context, payload RequestPayload) (ResponsePayload, error) {
	var resPayload ResponsePayload
	resPayload.Headers = make(map[string]string)

	bodyReader, generatedContentType, err := requestBody(payload)
	if err != nil {
		return resPayload, err
	}

	req, err := http.NewRequestWithContext(ctx, payload.Method, payload.URL, bodyReader)
	if err != nil {
		return resPayload, err
	}

	for k, v := range payload.Headers {
		req.Header.Set(k, v)
	}
	if generatedContentType != "" && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", generatedContentType)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "InternalApiClient-Go/2.0")
	}

	// Trace Network Timings
	var traceMu sync.Mutex
	var dnsStart, dnsDone time.Time
	var connStart, connDone time.Time
	var tlsStart, tlsDone time.Time
	var gotFirstByte time.Time

	trace := &httptrace.ClientTrace{
		DNSStart: func(info httptrace.DNSStartInfo) {
			traceMu.Lock()
			if dnsStart.IsZero() {
				dnsStart = time.Now()
			}
			traceMu.Unlock()
		},
		DNSDone: func(info httptrace.DNSDoneInfo) {
			traceMu.Lock()
			dnsDone = time.Now()
			traceMu.Unlock()
		},
		ConnectStart: func(network, addr string) {
			traceMu.Lock()
			if connStart.IsZero() {
				connStart = time.Now()
			}
			traceMu.Unlock()
		},
		ConnectDone: func(network, addr string, err error) {
			traceMu.Lock()
			if err == nil || connDone.IsZero() {
				connDone = time.Now()
			}
			traceMu.Unlock()
		},
		TLSHandshakeStart: func() {
			traceMu.Lock()
			if tlsStart.IsZero() {
				tlsStart = time.Now()
			}
			traceMu.Unlock()
		},
		TLSHandshakeDone: func(state tls.ConnectionState, err error) {
			traceMu.Lock()
			tlsDone = time.Now()
			traceMu.Unlock()
		},
		GotFirstResponseByte: func() {
			traceMu.Lock()
			if gotFirstByte.IsZero() {
				gotFirstByte = time.Now()
			}
			traceMu.Unlock()
		},
	}

	req = req.WithContext(httptrace.WithClientTrace(req.Context(), trace))

	startTime := time.Now()
	resp, err := e.Client.Do(req)
	if err != nil {
		return resPayload, err
	}
	defer resp.Body.Close()

	bodyReadStart := time.Now()
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return resPayload, err
	}
	totalDuration := time.Since(startTime).Milliseconds()

	// Calculate granular timings
	var dnsTime, tcpTime, tlsTime, ttfbTime, downloadTime int64
	traceMu.Lock()
	if !dnsStart.IsZero() && !dnsDone.IsZero() {
		dnsTime = dnsDone.Sub(dnsStart).Milliseconds()
	}
	if !connStart.IsZero() && !connDone.IsZero() {
		tcpTime = connDone.Sub(connStart).Milliseconds()
	}
	if !tlsStart.IsZero() && !tlsDone.IsZero() {
		tlsTime = tlsDone.Sub(tlsStart).Milliseconds()
	}
	if !gotFirstByte.IsZero() {
		ttfbTime = gotFirstByte.Sub(startTime).Milliseconds()
	} else {
		ttfbTime = totalDuration
	}
	traceMu.Unlock()
	downloadTime = time.Since(bodyReadStart).Milliseconds()

	for k, v := range resp.Header {
		if len(v) > 0 {
			resPayload.Headers[k] = strings.Join(v, ", ")
		}
	}

	resPayload.Status = resp.StatusCode
	resPayload.StatusText = resp.Status
	resPayload.Body = string(bodyBytes)
	resPayload.ResponseTime = totalDuration
	resPayload.ResponseSize = int64(len(bodyBytes))
	resPayload.Timing = TimingDetails{
		DNSTimeMs:      dnsTime,
		TCPTimeMs:      tcpTime,
		TLSTimeMs:      tlsTime,
		TTFBMs:         ttfbTime,
		DownloadTimeMs: downloadTime,
		TotalTimeMs:    totalDuration,
	}

	return resPayload, nil
}

// ==========================================
// 3. STRESS TEST ENGINE
// ==========================================

func (e *HttpClientEngine) CancelStressTest() {
	e.stressMu.Lock()
	defer e.stressMu.Unlock()
	if e.cancelStress != nil {
		e.cancelStress()
		e.cancelStress = nil
	}
}

func calculatePercentiles(latencies []int64) (min, max, p50, p90, p95, p99 int64) {
	if len(latencies) == 0 {
		return 0, 0, 0, 0, 0, 0
	}
	sorted := make([]int64, len(latencies))
	copy(sorted, latencies)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })

	n := len(sorted)
	min = sorted[0]
	max = sorted[n-1]

	getP := func(percent float64) int64 {
		idx := int(float64(n-1) * percent)
		if idx >= n {
			idx = n - 1
		}
		return sorted[idx]
	}

	p50 = getP(0.50)
	p90 = getP(0.90)
	p95 = getP(0.95)
	p99 = getP(0.99)
	return
}

func (e *HttpClientEngine) ExecuteStressTestWithProgress(
	payload RequestPayload,
	concurrency int,
	totalRequests int,
	durationSec int,
	rampUpSec int,
	targetRPS int,
	onTick func(StressTestTick),
) StressTestResult {
	if concurrency < 1 || durationSec < 0 || totalRequests < 0 || targetRPS < 0 {
		return StressTestResult{FailureCount: 1}
	}
	if targetRPS > 1_000_000_000 { // time.NewTicker would panic at sub-nanosecond intervals
		return StressTestResult{FailureCount: 1}
	}
	e.stressMu.Lock()
	ctx, cancel := context.WithCancel(context.Background())
	if durationSec > 0 {
		ctx, cancel = context.WithTimeout(ctx, time.Duration(rampUpSec+durationSec)*time.Second)
	}
	e.cancelStress = cancel
	e.stressMu.Unlock()

	defer func() {
		e.stressMu.Lock()
		if e.cancelStress != nil {
			cancel()
			e.cancelStress = nil
		}
		e.stressMu.Unlock()
	}()

	var wg sync.WaitGroup
	var successCount, failureCount, totalDurationMs int64
	var actualTotalRequests int64
	var isCancelled atomic.Bool

	var latenciesMu sync.Mutex
	var latencies []int64

	useDuration := durationSec > 0

	var jobs chan struct{}
	if !useDuration {
		jobs = make(chan struct{}, concurrency)
		go func() {
			defer close(jobs)
			for i := 0; i < totalRequests; i++ {
				select {
				case jobs <- struct{}{}:
				case <-ctx.Done():
					return
				}
			}
		}()
	}

	var delayPerThread time.Duration
	if rampUpSec > 0 && concurrency > 1 {
		delayPerThread = time.Duration(rampUpSec) * time.Second / time.Duration(concurrency)
	}

	var rateLimiter <-chan time.Time
	if targetRPS > 0 {
		ticker := time.NewTicker(time.Second / time.Duration(targetRPS))
		defer ticker.Stop()
		rateLimiter = ticker.C
	}

	testStartTime := time.Now()

	// Live progress ticker
	tickerStop := make(chan struct{})
	if onTick != nil {
		go func() {
			tickInterval := time.NewTicker(300 * time.Millisecond)
			defer tickInterval.Stop()
			for {
				select {
				case <-tickerStop:
					return
				case <-tickInterval.C:
					elapsed := time.Since(testStartTime).Seconds()
					curReqs := atomic.LoadInt64(&actualTotalRequests)
					succ := atomic.LoadInt64(&successCount)
					fail := atomic.LoadInt64(&failureCount)
					totDur := atomic.LoadInt64(&totalDurationMs)

					var curRPS float64
					if elapsed > 0 {
						curRPS = float64(curReqs) / elapsed
					}
					var avgLat int64
					if succ > 0 {
						avgLat = totDur / succ
					}

					var p95 int64
					latenciesMu.Lock()
					if len(latencies) > 0 {
						_, _, _, _, p95, _ = calculatePercentiles(latencies)
					}
					latenciesMu.Unlock()

					onTick(StressTestTick{
						ElapsedSec:   elapsed,
						CurrentReqs:  curReqs,
						SuccessCount: succ,
						FailureCount: fail,
						CurrentRPS:   curRPS,
						AvgLatencyMs: avgLat,
						P95Ms:        p95,
					})
				}
			}
		}()
	}

	for w := 0; w < concurrency; w++ {
		wg.Add(1)

		if delayPerThread > 0 {
			time.Sleep(delayPerThread)
		}

		go func() {
			defer wg.Done()

			if useDuration {
				for {
					select {
					case <-ctx.Done():
						isCancelled.Store(ctx.Err() == context.Canceled)
						return
					default:
						if rateLimiter != nil {
							select {
							case <-rateLimiter:
							case <-ctx.Done():
								isCancelled.Store(ctx.Err() == context.Canceled)
								return
							}
						}

						atomic.AddInt64(&actualTotalRequests, 1)
						res, err := e.execute(ctx, payload)
						if err != nil || res.Status >= 400 {
							atomic.AddInt64(&failureCount, 1)
						} else {
							atomic.AddInt64(&successCount, 1)
							atomic.AddInt64(&totalDurationMs, res.ResponseTime)
							latenciesMu.Lock()
							if len(latencies) < 50000 {
								latencies = append(latencies, res.ResponseTime)
							}
							latenciesMu.Unlock()
						}
					}
				}
			} else {
				for range jobs {
					select {
					case <-ctx.Done():
						isCancelled.Store(ctx.Err() == context.Canceled)
						return
					default:
						if rateLimiter != nil {
							select {
							case <-rateLimiter:
							case <-ctx.Done():
								isCancelled.Store(ctx.Err() == context.Canceled)
								return
							}
						}
						atomic.AddInt64(&actualTotalRequests, 1)
						res, err := e.execute(ctx, payload)
						if err != nil || res.Status >= 400 {
							atomic.AddInt64(&failureCount, 1)
						} else {
							atomic.AddInt64(&successCount, 1)
							atomic.AddInt64(&totalDurationMs, res.ResponseTime)
							latenciesMu.Lock()
							if len(latencies) < 50000 {
								latencies = append(latencies, res.ResponseTime)
							}
							latenciesMu.Unlock()
						}
					}
				}
			}
		}()
	}

	wg.Wait()
	close(tickerStop)

	elapsedSec := time.Since(testStartTime).Seconds()

	var avgTime int64
	if successCount > 0 {
		avgTime = totalDurationMs / successCount
	}

	var rps float64
	if elapsedSec > 0 {
		rps = float64(actualTotalRequests) / elapsedSec
	}

	minT, maxT, p50, p90, p95, p99 := calculatePercentiles(latencies)

	return StressTestResult{
		TotalRequests:    actualTotalRequests,
		SuccessCount:     successCount,
		FailureCount:     failureCount,
		AverageTimeMs:    avgTime,
		MinTimeMs:        minT,
		MaxTimeMs:        maxT,
		P50Ms:            p50,
		P90Ms:            p90,
		P95Ms:            p95,
		P99Ms:            p99,
		RPS:              rps,
		TotalDurationSec: elapsedSec,
		Cancelled:        isCancelled.Load(),
	}
}

func (e *HttpClientEngine) ExecuteStressTest(payload RequestPayload, concurrency int, totalRequests int, durationSec int, rampUpSec int, targetRPS int) StressTestResult {
	return e.ExecuteStressTestWithProgress(payload, concurrency, totalRequests, durationSec, rampUpSec, targetRPS, nil)
}

// ==========================================
// 4. STREAMING ENGINE (SSE / LLM Streams)
// ==========================================

func (e *HttpClientEngine) ExecuteStream(ctx context.Context, payload RequestPayload, reqID string, onChunk func(StreamChunk)) error {
	var bodyReader io.Reader
	if payload.Body != "" {
		bodyReader = strings.NewReader(payload.Body)
	}

	req, err := http.NewRequestWithContext(ctx, payload.Method, payload.URL, bodyReader)
	if err != nil {
		return err
	}

	for k, v := range payload.Headers {
		req.Header.Set(k, v)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "InternalApiClient-Go/2.0")
	}

	resp, err := e.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	headers := make(map[string]string)
	for k, v := range resp.Header {
		if len(v) > 0 {
			headers[k] = strings.Join(v, ", ")
		}
	}

	// Send initial metadata chunk
	onChunk(StreamChunk{
		ReqID:   reqID,
		Index:   0,
		Status:  resp.StatusCode,
		Headers: headers,
		Data:    "",
		IsEnd:   false,
	})

	reader := bufio.NewReader(resp.Body)
	chunkIndex := 1
	buf := make([]byte, 2048)

	for {
		select {
		case <-ctx.Done():
			onChunk(StreamChunk{
				ReqID: reqID,
				Index: chunkIndex,
				IsEnd: true,
				Error: "Stream stopped by client",
			})
			return ctx.Err()
		default:
			n, err := reader.Read(buf)
			if n > 0 {
				onChunk(StreamChunk{
					ReqID: reqID,
					Index: chunkIndex,
					Data:  string(buf[:n]),
					IsEnd: false,
				})
				chunkIndex++
			}
			if err != nil {
				if err == io.EOF {
					onChunk(StreamChunk{
						ReqID: reqID,
						Index: chunkIndex,
						IsEnd: true,
					})
					return nil
				}
				onChunk(StreamChunk{
					ReqID: reqID,
					Index: chunkIndex,
					IsEnd: true,
					Error: err.Error(),
				})
				return err
			}
		}
	}
}

type formDataField struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Enabled  bool   `json:"enabled"`
	Type     string `json:"type"`
	FilePath string `json:"filePath"`
}

func requestBody(payload RequestPayload) (io.Reader, string, error) {
	if payload.BodyType != "formdata" {
		if payload.Body == "" {
			return nil, "", nil
		}
		return strings.NewReader(payload.Body), "", nil
	}
	var fields []formDataField
	if err := json.Unmarshal([]byte(payload.Body), &fields); err != nil {
		return nil, "", fmt.Errorf("parse form-data fields: %w", err)
	}
	var buffer bytes.Buffer
	writer := multipart.NewWriter(&buffer)
	for _, field := range fields {
		if !field.Enabled || strings.TrimSpace(field.Key) == "" {
			continue
		}
		if field.Type == "file" {
			file, err := os.Open(field.FilePath)
			if err != nil {
				return nil, "", fmt.Errorf("open form-data file %q: %w", field.FilePath, err)
			}
			part, err := writer.CreateFormFile(field.Key, filepath.Base(field.FilePath))
			if err == nil {
				_, err = io.Copy(part, file)
			}
			file.Close()
			if err != nil {
				return nil, "", fmt.Errorf("write form-data file %q: %w", field.FilePath, err)
			}
		} else if err := writer.WriteField(field.Key, field.Value); err != nil {
			return nil, "", err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return &buffer, writer.FormDataContentType(), nil
}
