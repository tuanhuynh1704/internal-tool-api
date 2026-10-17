package core

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestUTF8CarryKeepsSplitCharacters(t *testing.T) {
	text := []byte("Xin chào 🚀")
	for cut := 1; cut < len(text); cut++ {
		complete, rest := utf8Carry(text[:cut])
		joined := string(complete) + string(append(rest, text[cut:]...))
		if joined != string(text) {
			t.Fatalf("cut %d: %q", cut, joined)
		}
		if !strings.HasSuffix(string(text[:cut]), string(rest)) {
			t.Fatalf("cut %d: rest is not a suffix", cut)
		}
	}
}

func TestPercentilesUseNearestRank(t *testing.T) {
	samples := []int64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
	_, _, p50, p90, _, p99 := calculatePercentiles(samples)
	if p50 != 5 || p90 != 9 || p99 != 10 {
		t.Fatalf("p50=%d p90=%d p99=%d", p50, p90, p99)
	}
}

func TestReservoirSamplesWholeRun(t *testing.T) {
	r := newLatencyReservoir(100)
	for i := int64(0); i < 10000; i++ {
		r.add(i)
	}
	var late int
	for _, v := range r.snapshot() {
		if v >= 5000 {
			late++
		}
	}
	if late < 20 {
		t.Fatalf("reservoir only kept early samples (%d late)", late)
	}
}

func TestStreamReportsEndWhenConnectionFails(t *testing.T) {
	engine := NewHttpClientEngine(false, 2)
	var chunks []StreamChunk
	err := engine.ExecuteStream(context.Background(), RequestPayload{Method: "GET", URL: "http://127.0.0.1:1/never"}, "r1", func(c StreamChunk) { chunks = append(chunks, c) })
	if err == nil {
		t.Fatal("expected connection error")
	}
	if len(chunks) != 1 || !chunks[0].IsEnd || chunks[0].Error == "" {
		t.Fatalf("expected a single end chunk with an error, got %#v", chunks)
	}
}

func TestStreamOutlivesRequestTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		time.Sleep(1500 * time.Millisecond)
		_, _ = w.Write([]byte("done"))
	}))
	defer server.Close()
	engine := NewHttpClientEngine(false, 1)
	var body strings.Builder
	var lastErr string
	if err := engine.ExecuteStream(context.Background(), RequestPayload{Method: "GET", URL: server.URL}, "r2", func(c StreamChunk) {
		body.WriteString(c.Data)
		if c.IsEnd {
			lastErr = c.Error
		}
	}); err != nil {
		t.Fatalf("stream failed: %v", err)
	}
	if body.String() != "done" || lastErr != "" {
		t.Fatalf("body %q err %q", body.String(), lastErr)
	}
}

func TestBinaryResponseIsShippedAsBase64(t *testing.T) {
	raw := []byte{0x89, 'P', 'N', 'G', 0xff, 0x00, 0xfe}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(raw) }))
	defer server.Close()
	res, err := NewHttpClientEngine(false, 5).Execute(RequestPayload{Method: "GET", URL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	decoded, _ := base64.StdEncoding.DecodeString(res.BodyBase64)
	if !res.IsBinary || string(decoded) != string(raw) {
		t.Fatalf("binary body not preserved: %#v", res)
	}
}

func TestStressDurationDoesNotCountAbortedRequestsAsFailures(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(400 * time.Millisecond):
		case <-r.Context().Done():
		}
	}))
	defer server.Close()
	result := NewHttpClientEngine(false, 5).ExecuteStressTest(RequestPayload{Method: "GET", URL: server.URL}, 4, 0, 1, 0, 0)
	if result.FailureCount != 0 {
		t.Fatalf("in-flight requests at the deadline were counted as failures: %#v", result)
	}
	if result.AbortedRequests == 0 {
		t.Fatalf("expected aborted requests to be reported: %#v", result)
	}
}
