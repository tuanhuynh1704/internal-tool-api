package core

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
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
	"unicode/utf8"
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
	BodyBase64   string            `json:"bodyBase64,omitempty"`
	IsBinary     bool              `json:"isBinary,omitempty"`
	Truncated    bool              `json:"truncated,omitempty"`
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
	AbortedRequests  int64   `json:"abortedRequests"`
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

// MaxResponseBodyBytes bounds how much of a response body is buffered so a
// multi-gigabyte download cannot exhaust the desktop process memory.
const MaxResponseBodyBytes = 64 << 20

// ==========================================
// 2. HTTP CLIENT ENGINE
// ==========================================

type HttpClientEngine struct {
	Client        *http.Client
	streamClient  *http.Client
	allowInsecure bool
	timeout       time.Duration

	stressMu     sync.Mutex
	stressRun    uint64
	cancelStress context.CancelFunc
}

func newTransport(allowInsecure bool, maxPerHost int, responseHeaderTimeout time.Duration) *http.Transport {
	return &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: allowInsecure,
		},
		MaxIdleConns:          maxPerHost * 4,
		MaxIdleConnsPerHost:   maxPerHost,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: responseHeaderTimeout,
		ForceAttemptHTTP2:     true,
	}
}

func NewHttpClientEngine(allowInsecure bool, timeoutSec int) *HttpClientEngine {
	timeout := time.Duration(timeoutSec) * time.Second
	return &HttpClientEngine{
		Client: &http.Client{
			Transport: newTransport(allowInsecure, 32, 0),
			Timeout:   timeout,
		},
		// Streams (SSE / LLM) legitimately last longer than the request timeout:
		// only waiting for the response headers is bounded, the body is not.
		streamClient: &http.Client{
			Transport: newTransport(allowInsecure, 8, timeout),
		},
		allowInsecure: allowInsecure,
		timeout:       timeout,
	}
}

func (e *HttpClientEngine) Execute(payload RequestPayload) (ResponsePayload, error) {
	return e.execute(context.Background(), e.Client, payload, nil)
}

// ExecuteWithContext executes one request with caller-controlled cancellation.
// Automation runs use this instead of Execute so a stopped scenario interrupts
// the in-flight HTTP request instead of waiting for the client timeout.
func (e *HttpClientEngine) ExecuteWithContext(ctx context.Context, payload RequestPayload) (ResponsePayload, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	return e.execute(ctx, e.Client, payload, nil)
}

// preparedBody is a request body built once and replayed for every request of
// a load test, so multipart files are not re-read from disk per request.
type preparedBody struct {
	data        []byte
	contentType string
}

func applyHeaders(req *http.Request, headers map[string]string) {
	// Sorted keys make the outcome deterministic when the map holds the same
	// header twice with different casing ("authorization" / "Authorization").
	keys := make([]string, 0, len(headers))
	for key := range headers {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		req.Header.Set(key, headers[key])
	}
}

// execute keeps the public single-request API while allowing load-test workers
// to cancel in-flight HTTP I/O through their run context.
func (e *HttpClientEngine) execute(ctx context.Context, client *http.Client, payload RequestPayload, prepared *preparedBody) (ResponsePayload, error) {
	var resPayload ResponsePayload
	resPayload.Headers = make(map[string]string)

	var bodyReader io.Reader
	var generatedContentType string
	if prepared != nil {
		if prepared.data != nil {
			bodyReader = bytes.NewReader(prepared.data)
		}
		generatedContentType = prepared.contentType
	} else {
		var err error
		bodyReader, generatedContentType, err = requestBody(payload)
		if err != nil {
			return resPayload, err
		}
	}

	req, err := http.NewRequestWithContext(ctx, payload.Method, payload.URL, bodyReader)
	if err != nil {
		return resPayload, err
	}

	applyHeaders(req, payload.Headers)
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
	resp, err := client.Do(req)
	if err != nil {
		return resPayload, err
	}
	defer resp.Body.Close()

	bodyReadStart := time.Now()
	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, MaxResponseBodyBytes+1))
	if err != nil {
		return resPayload, err
	}
	if len(bodyBytes) > MaxResponseBodyBytes {
		bodyBytes = bodyBytes[:MaxResponseBodyBytes]
		resPayload.Truncated = true
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
	if utf8.Valid(bodyBytes) {
		resPayload.Body = string(bodyBytes)
	} else {
		// Binary bodies (images, PDF, archives) cannot cross the JSON bridge as a
		// string without every invalid byte becoming U+FFFD, so ship the exact
		// bytes as base64 and keep a printable approximation in Body.
		resPayload.IsBinary = true
		resPayload.BodyBase64 = base64.StdEncoding.EncodeToString(bodyBytes)
		resPayload.Body = strings.ToValidUTF8(string(bodyBytes), "�")
	}
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
	}
}

// calculatePercentiles uses the nearest-rank definition: the p-th percentile
// is the smallest sample such that at least p% of the samples are <= it.
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
		rank := int(float64(n)*percent + 0.999999999)
		if rank < 1 {
			rank = 1
		}
		if rank > n {
			rank = n
		}
		return sorted[rank-1]
	}

	p50 = getP(0.50)
	p90 = getP(0.90)
	p95 = getP(0.95)
	p99 = getP(0.99)
	return
}

// latencyReservoir keeps a uniform random sample of every latency observed
// during the run (Vitter's algorithm R), so percentiles describe the whole
// test instead of only its first N requests.
type latencyReservoir struct {
	mu      sync.Mutex
	samples []int64
	seen    int64
	limit   int
	rng     *rand.Rand
}

func newLatencyReservoir(limit int) *latencyReservoir {
	return &latencyReservoir{limit: limit, samples: make([]int64, 0, 1024), rng: rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), 0x9e3779b97f4a7c15))}
}

func (r *latencyReservoir) add(value int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.seen++
	if len(r.samples) < r.limit {
		r.samples = append(r.samples, value)
		return
	}
	if j := r.rng.Int64N(r.seen); j < int64(r.limit) {
		r.samples[j] = value
	}
}

func (r *latencyReservoir) snapshot() []int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]int64, len(r.samples))
	copy(out, r.samples)
	return out
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
	if concurrency < 1 || durationSec < 0 || totalRequests < 0 || targetRPS < 0 || rampUpSec < 0 {
		return StressTestResult{FailureCount: 1}
	}
	if targetRPS > 1_000_000_000 { // time.NewTicker would panic at sub-nanosecond intervals
		return StressTestResult{FailureCount: 1}
	}
	useDuration := durationSec > 0
	if !useDuration && totalRequests == 0 {
		return StressTestResult{}
	}

	prepared := &preparedBody{}
	if reader, contentType, err := requestBody(payload); err != nil {
		return StressTestResult{FailureCount: 1}
	} else {
		prepared.contentType = contentType
		if reader != nil {
			data, err := io.ReadAll(reader)
			if err != nil {
				return StressTestResult{FailureCount: 1}
			}
			prepared.data = data
		}
	}

	// A dedicated client sized to the concurrency keeps every worker on a warm
	// connection; the default of 2 idle connections per host would make most
	// requests pay a fresh TCP+TLS handshake and skew every latency figure.
	client := &http.Client{
		Transport: newTransport(e.allowInsecure, concurrency, 0),
		Timeout:   e.timeout,
	}
	defer client.CloseIdleConnections()

	var userCancelled atomic.Bool
	runCtx, cancelRun := context.WithCancel(context.Background())
	ctx := runCtx
	cancelDeadline := context.CancelFunc(func() {})
	if useDuration {
		ctx, cancelDeadline = context.WithTimeout(runCtx, time.Duration(rampUpSec+durationSec)*time.Second)
	}
	defer cancelDeadline()
	defer cancelRun()

	e.stressMu.Lock()
	e.stressRun++
	runID := e.stressRun
	e.cancelStress = func() {
		userCancelled.Store(true)
		cancelRun()
	}
	e.stressMu.Unlock()

	defer func() {
		e.stressMu.Lock()
		// Only clear the handle if no newer run replaced it in the meantime.
		if e.stressRun == runID {
			e.cancelStress = nil
		}
		e.stressMu.Unlock()
	}()

	var wg sync.WaitGroup
	var successCount, failureCount, abortedCount, totalDurationMs, completedCount int64
	var actualTotalRequests int64
	reservoir := newLatencyReservoir(50000)

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
	var tickerDone sync.WaitGroup
	if onTick != nil {
		tickerDone.Add(1)
		go func() {
			defer tickerDone.Done()
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
					completed := atomic.LoadInt64(&completedCount)
					totDur := atomic.LoadInt64(&totalDurationMs)

					var curRPS float64
					if elapsed > 0 {
						curRPS = float64(curReqs) / elapsed
					}
					var avgLat int64
					if completed > 0 {
						avgLat = totDur / completed
					}
					// Sorting happens on a snapshot, outside the lock the workers use.
					_, _, _, _, p95, _ := calculatePercentiles(reservoir.snapshot())

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

	runOne := func() {
		atomic.AddInt64(&actualTotalRequests, 1)
		started := time.Now()
		res, err := e.execute(ctx, client, payload, prepared)
		if err != nil && ctx.Err() != nil {
			// Interrupted by the end of the test or by Cancel: this request never
			// got an answer from the server, so it is neither a success nor a failure.
			atomic.AddInt64(&actualTotalRequests, -1)
			atomic.AddInt64(&abortedCount, 1)
			return
		}
		latency := time.Since(started).Milliseconds()
		if err == nil {
			latency = res.ResponseTime
		}
		atomic.AddInt64(&completedCount, 1)
		atomic.AddInt64(&totalDurationMs, latency)
		reservoir.add(latency)
		if err != nil || res.Status >= 400 {
			atomic.AddInt64(&failureCount, 1)
		} else {
			atomic.AddInt64(&successCount, 1)
		}
	}

	waitTurn := func() bool {
		if rateLimiter == nil {
			return ctx.Err() == nil
		}
		select {
		case <-rateLimiter:
			return ctx.Err() == nil
		case <-ctx.Done():
			return false
		}
	}

	for w := 0; w < concurrency; w++ {
		if delayPerThread > 0 {
			timer := time.NewTimer(delayPerThread)
			select {
			case <-timer.C:
			case <-ctx.Done():
				timer.Stop()
			}
			if ctx.Err() != nil {
				break
			}
		}

		wg.Add(1)
		go func() {
			defer wg.Done()
			if useDuration {
				for waitTurn() {
					runOne()
				}
				return
			}
			for range jobs {
				if !waitTurn() {
					return
				}
				runOne()
			}
		}()
	}

	wg.Wait()
	close(tickerStop)
	tickerDone.Wait()

	elapsedSec := time.Since(testStartTime).Seconds()

	var avgTime int64
	if completedCount > 0 {
		avgTime = totalDurationMs / completedCount
	}

	var rps float64
	if elapsedSec > 0 {
		rps = float64(actualTotalRequests) / elapsedSec
	}

	minT, maxT, p50, p90, p95, p99 := calculatePercentiles(reservoir.snapshot())

	return StressTestResult{
		TotalRequests:    actualTotalRequests,
		SuccessCount:     successCount,
		FailureCount:     failureCount,
		AbortedRequests:  abortedCount,
		AverageTimeMs:    avgTime,
		MinTimeMs:        minT,
		MaxTimeMs:        maxT,
		P50Ms:            p50,
		P90Ms:            p90,
		P95Ms:            p95,
		P99Ms:            p99,
		RPS:              rps,
		TotalDurationSec: elapsedSec,
		Cancelled:        userCancelled.Load(),
	}
}

func (e *HttpClientEngine) ExecuteStressTest(payload RequestPayload, concurrency int, totalRequests int, durationSec int, rampUpSec int, targetRPS int) StressTestResult {
	return e.ExecuteStressTestWithProgress(payload, concurrency, totalRequests, durationSec, rampUpSec, targetRPS, nil)
}

// ==========================================
// 4. STREAMING ENGINE (SSE / LLM Streams)
// ==========================================

// utf8Carry returns the longest prefix of data that ends on a complete UTF-8
// sequence, plus the trailing bytes of a character split across two reads.
func utf8Carry(data []byte) (complete, rest []byte) {
	end := len(data)
	// A UTF-8 sequence is at most 4 bytes, so only the tail needs inspecting.
	for i := 1; i <= 3 && i <= len(data); i++ {
		b := data[len(data)-i]
		if b&0xC0 == 0x80 { // continuation byte
			continue
		}
		if b >= 0xC0 { // leading byte: is its sequence complete?
			need := 2
			if b >= 0xF0 {
				need = 4
			} else if b >= 0xE0 {
				need = 3
			}
			if i < need {
				end = len(data) - i
			}
		}
		break
	}
	return data[:end], data[end:]
}

func (e *HttpClientEngine) ExecuteStream(ctx context.Context, payload RequestPayload, reqID string, onChunk func(StreamChunk)) (err error) {
	chunkIndex := 0
	// Every exit path reports an end chunk, so the UI never waits forever for
	// a stream that failed before its first byte.
	endWith := func(cause error) error {
		chunk := StreamChunk{ReqID: reqID, Index: chunkIndex, IsEnd: true}
		if cause != nil {
			if ctx.Err() != nil {
				chunk.Error = "Stream stopped by client"
			} else {
				chunk.Error = cause.Error()
			}
		}
		onChunk(chunk)
		return cause
	}

	bodyReader, generatedContentType, err := requestBody(payload)
	if err != nil {
		return endWith(err)
	}
	req, err := http.NewRequestWithContext(ctx, payload.Method, payload.URL, bodyReader)
	if err != nil {
		return endWith(err)
	}

	applyHeaders(req, payload.Headers)
	if generatedContentType != "" && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", generatedContentType)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "InternalApiClient-Go/2.0")
	}

	client := e.streamClient
	if client == nil {
		client = e.Client
	}
	resp, err := client.Do(req)
	if err != nil {
		return endWith(err)
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
	chunkIndex = 1

	buf := make([]byte, 4096)
	var pending []byte

	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			data := append(pending, buf[:n]...)
			complete, rest := utf8Carry(data)
			pending = append([]byte(nil), rest...)
			if len(complete) > 0 {
				onChunk(StreamChunk{
					ReqID: reqID,
					Index: chunkIndex,
					Data:  string(complete),
					IsEnd: false,
				})
				chunkIndex++
			}
		}
		if readErr != nil {
			if len(pending) > 0 {
				onChunk(StreamChunk{ReqID: reqID, Index: chunkIndex, Data: strings.ToValidUTF8(string(pending), "�")})
				chunkIndex++
			}
			if errors.Is(readErr, io.EOF) {
				return endWith(nil)
			}
			return endWith(readErr)
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
