package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake"
	"github.com/nats-io/nats.go"
)

type fakeWaker struct {
	mutex       sync.Mutex
	supported   map[string]bool
	woken       []string
	seenCalls   []string
	retryAfter  time.Duration
	wakeFailing map[string]bool
}

func newFakeWaker(supported ...string) *fakeWaker {
	waker := &fakeWaker{supported: make(map[string]bool), retryAfter: 15 * time.Second}
	for _, service := range supported {
		waker.supported[service] = true
	}
	return waker
}

func (waker *fakeWaker) Supports(service string) bool {
	waker.mutex.Lock()
	defer waker.mutex.Unlock()
	return waker.supported[service]
}

func (waker *fakeWaker) Wake(service string) {
	waker.mutex.Lock()
	defer waker.mutex.Unlock()
	waker.woken = append(waker.woken, service)
}

func (waker *fakeWaker) Seen(service string) {
	waker.mutex.Lock()
	defer waker.mutex.Unlock()
	waker.seenCalls = append(waker.seenCalls, service)
}

func (waker *fakeWaker) seenServices() []string {
	waker.mutex.Lock()
	defer waker.mutex.Unlock()
	return append([]string(nil), waker.seenCalls...)
}

func (waker *fakeWaker) WakeIsFailing(_ context.Context, service string) bool {
	waker.mutex.Lock()
	defer waker.mutex.Unlock()
	return waker.wakeFailing[service]
}

func (waker *fakeWaker) failWakesFor(services ...string) *fakeWaker {
	waker.mutex.Lock()
	defer waker.mutex.Unlock()
	if waker.wakeFailing == nil {
		waker.wakeFailing = make(map[string]bool)
	}
	for _, service := range services {
		waker.wakeFailing[service] = true
	}
	return waker
}

func (waker *fakeWaker) RetryAfter() time.Duration { return waker.retryAfter }

func (waker *fakeWaker) wokenServices() []string {
	waker.mutex.Lock()
	defer waker.mutex.Unlock()
	return append([]string(nil), waker.woken...)
}

// A reply is the only unbiased evidence that a service was awake, and it has
// to be recorded whatever the reply says. A service cannot announce its own
// sleep - a spin-down signal is indistinguishable from a deploy, and an OOM
// kill sends nothing - so this stamp plus the next wake is what bounds how
// long each service was down.
func TestASuccessfulReplyStampsTheServiceAsSeen(t *testing.T) {
	waker := newFakeWaker(wake.Services...)
	brokerClient := &fakeBroker{response: contracts.NewEnvelope("request-id", contracts.RPCResponseData{
		StatusCode: http.StatusOK, Payload: []byte(`{"jobId":"01HZY000000000000000000000","status":"queued"}`),
	})}
	router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), waker, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/jobs/01HZY000000000000000000000", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	if seen := waker.seenServices(); !equalStrings(seen, []string{wake.ServiceDNA}) {
		t.Fatalf("stamped %v as seen, want [%s]", seen, wake.ServiceDNA)
	}
	if woken := waker.wokenServices(); len(woken) != 0 {
		t.Fatalf("a service that answered was woken anyway: %v", woken)
	}
}

// The opposite case, and the one that would quietly ruin the measurement:
// nobody answered, so nothing may be stamped as having been seen. Recording a
// liveness observation here would make a sleeping service look permanently
// awake and every derived sleep interval zero.
func TestNoResponderStampsNothingAsSeen(t *testing.T) {
	waker := newFakeWaker(wake.Services...)
	router := NewRouter(testGatewayConfig(), &fakeBroker{requestError: nats.ErrNoResponders}, newFakeEdgeStore(), waker, nil)
	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/jobs/01HZY000000000000000000000", nil))

	if seen := waker.seenServices(); len(seen) != 0 {
		t.Fatalf("stamped %v as seen although nobody replied", seen)
	}
}

func errorCodeOf(t *testing.T, body []byte) string {
	t.Helper()
	var envelope struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatalf("decode error body %q: %v", body, err)
	}
	return envelope.Error.Code
}

// The three transport failures are genuinely different events and the client
// needs to tell them apart: only no-responders is worth retrying hard on, and
// only no-responders is worth waking anybody over. Before this split the
// gateway collapsed everything except a deadline into one SERVICE_UNAVAILABLE.
func TestTransportFailuresAreClassifiedForTheClient(t *testing.T) {
	testCases := map[string]struct {
		requestError       error
		supportedServices  []string
		expectedStatus     int
		expectedCode       string
		expectedWoken      []string
		expectsRetryHeader bool
	}{
		"a sleeping service is woken and reported as waking": {
			requestError: nats.ErrNoResponders, supportedServices: []string{wake.ServiceDNA},
			expectedStatus: http.StatusServiceUnavailable, expectedCode: "SERVICE_WAKING",
			expectedWoken: []string{wake.ServiceDNA}, expectsRetryHeader: true,
		},
		"an unwakeable service stays plain unavailable": {
			// No wake platform covers dna here, so telling the client to retry
			// would send it after a responder that is never coming back.
			requestError: nats.ErrNoResponders, supportedServices: nil,
			expectedStatus: http.StatusServiceUnavailable, expectedCode: "SERVICE_UNAVAILABLE",
			expectedWoken: nil, expectsRetryHeader: false,
		},
		"a deadline means awake but slow, so nothing is woken": {
			requestError: context.DeadlineExceeded, supportedServices: []string{wake.ServiceDNA},
			expectedStatus: http.StatusGatewayTimeout, expectedCode: "SERVICE_TIMEOUT",
			expectedWoken: nil, expectsRetryHeader: false,
		},
		"any other broker fault stays unavailable": {
			requestError: errors.New("nats: connection closed"), supportedServices: []string{wake.ServiceDNA},
			expectedStatus: http.StatusServiceUnavailable, expectedCode: "SERVICE_UNAVAILABLE",
			expectedWoken: nil, expectsRetryHeader: false,
		},
	}
	for name, testCase := range testCases {
		t.Run(name, func(t *testing.T) {
			waker := newFakeWaker(testCase.supportedServices...)
			router := NewRouter(testGatewayConfig(), &fakeBroker{requestError: testCase.requestError}, newFakeEdgeStore(), waker, nil)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/jobs/01HZY000000000000000000000", nil))

			if response.Code != testCase.expectedStatus {
				t.Fatalf("status = %d, want %d", response.Code, testCase.expectedStatus)
			}
			if code := errorCodeOf(t, response.Body.Bytes()); code != testCase.expectedCode {
				t.Fatalf("error code = %q, want %q", code, testCase.expectedCode)
			}
			retryAfter := response.Header().Get("Retry-After")
			if testCase.expectsRetryHeader && retryAfter != "15" {
				t.Fatalf("Retry-After = %q, want %q", retryAfter, "15")
			}
			if !testCase.expectsRetryHeader && retryAfter != "" {
				t.Fatalf("Retry-After = %q, want it absent", retryAfter)
			}
			if woken := waker.wokenServices(); !equalStrings(woken, testCase.expectedWoken) {
				t.Fatalf("woke %v, want %v", woken, testCase.expectedWoken)
			}
		})
	}
}

// Each route must wake its own responder. Waking the wrong one would leave the
// service the request actually needs asleep while the client retries against
// it forever.
func TestEachRouteWakesItsOwnService(t *testing.T) {
	testCases := map[string]struct {
		method          string
		path            string
		body            string
		expectedService string
	}{
		"job status wakes dna":          {http.MethodGet, "/api/jobs/01HZY000000000000000000000", "", wake.ServiceDNA},
		"universe world wakes universe": {http.MethodGet, "/api/universe/worlds/9f8a1b2c-3d4e-4f50-8a1b-2c3d4e5f6071", "", wake.ServiceUniverse},
		"nature world wakes nature":     {http.MethodGet, "/api/nature/worlds/9f8a1b2c-3d4e-4f50-8a1b-2c3d4e5f6071", "", wake.ServiceNature},
	}
	for name, testCase := range testCases {
		t.Run(name, func(t *testing.T) {
			waker := newFakeWaker(wake.Services...)
			router := NewRouter(testGatewayConfig(), &fakeBroker{requestError: nats.ErrNoResponders}, newFakeEdgeStore(), waker, nil)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(testCase.method, testCase.path, strings.NewReader(testCase.body)))

			if code := errorCodeOf(t, response.Body.Bytes()); code != "SERVICE_WAKING" {
				t.Fatalf("error code = %q, want SERVICE_WAKING", code)
			}
			if woken := waker.wokenServices(); !equalStrings(woken, []string{testCase.expectedService}) {
				t.Fatalf("woke %v, want [%s]", woken, testCase.expectedService)
			}
		})
	}
}

// The staff console is the case that hurts most. It is used rarely, so the
// services behind it are usually asleep, and the first thing to fail is login
// itself - before any screen exists to explain it, and with no error the
// previous single SERVICE_UNAVAILABLE let a client distinguish from a real
// outage.
func TestAdminLoginWakesAuthService(t *testing.T) {
	waker := newFakeWaker(wake.Services...)
	router := NewRouter(testAdminGatewayConfig(), &fakeBroker{requestError: nats.ErrNoResponders}, newFakeEdgeStore(), waker, nil)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/admin/auth/login", strings.NewReader(`{"email":"staff@example.com","password":"x"}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)

	if code := errorCodeOf(t, response.Body.Bytes()); code != "SERVICE_WAKING" {
		t.Fatalf("error code = %q, want SERVICE_WAKING", code)
	}
	if woken := waker.wokenServices(); !equalStrings(woken, []string{wake.ServiceAuth}) {
		t.Fatalf("woke %v, want [%s]", woken, wake.ServiceAuth)
	}
}

// Covered at the transport rather than through the router because the
// analytics routes sit behind a session and a permission lookup, and this
// asserts the subject-to-responder derivation itself - the part that has to
// keep working when a route is added later.
func TestEveryServiceSubjectWakesItsOwnResponder(t *testing.T) {
	testCases := map[string]struct {
		subject         string
		expectedService string
	}{
		"dna":       {contracts.DNAJobGetQuerySubject, wake.ServiceDNA},
		"universe":  {contracts.UniverseWorldPublishSubject, wake.ServiceUniverse},
		"nature":    {contracts.NatureVariantCreateSubject, wake.ServiceNature},
		"auth":      {contracts.AuthAccountListQuerySubject, wake.ServiceAuth},
		"analytics": {contracts.AnalyticsOverviewGetQuerySubject, wake.ServiceAnalytics},
	}
	for name, testCase := range testCases {
		t.Run(name, func(t *testing.T) {
			waker := newFakeWaker(wake.Services...)
			transport := NewRPCTransport(testGatewayConfig(), &fakeBroker{requestError: nats.ErrNoResponders}, newFakeEdgeStore(), waker, nil)
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/", nil)

			if _, ok := transport.Request(response, request, testCase.subject, struct{}{}); ok {
				t.Fatal("a no-responders reply should not be reported as a successful request")
			}
			if code := errorCodeOf(t, response.Body.Bytes()); code != "SERVICE_WAKING" {
				t.Fatalf("error code = %q, want SERVICE_WAKING", code)
			}
			if woken := waker.wokenServices(); !equalStrings(woken, []string{testCase.expectedService}) {
				t.Fatalf("woke %v, want [%s]", woken, testCase.expectedService)
			}
		})
	}
}

// The write path is the one that cannot wake reactively: publishing to
// JetStream succeeds whether or not a consumer is alive, so this POST returns
// 202 with no error anywhere in the trace while the job sits at `queued`
// forever. The wake has to be fired before the fact, for both services the job
// will need.
func TestCreateWorldWakesTheWholeGenerationPathBeforePublishing(t *testing.T) {
	testCases := map[string]struct {
		path             string
		expectedServices []string
	}{
		"universe": {"/api/universe/worlds", []string{wake.ServiceDNA, wake.ServiceUniverse}},
		"nature":   {"/api/nature/worlds", []string{wake.ServiceDNA, wake.ServiceNature}},
	}
	for name, testCase := range testCases {
		t.Run(name, func(t *testing.T) {
			waker := newFakeWaker(wake.Services...)
			brokerClient := &fakeBroker{}
			router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), waker, nil)
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, testCase.path, strings.NewReader(validWorldInputJSON()))
			request.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(response, request)

			if response.Code != http.StatusAccepted {
				t.Fatalf("status = %d, want 202; the wake must not change the response", response.Code)
			}
			if woken := waker.wokenServices(); !equalStrings(woken, testCase.expectedServices) {
				t.Fatalf("woke %v, want %v", woken, testCase.expectedServices)
			}
		})
	}
}

// A malformed body is rejected before anything is published, and it must be
// rejected before anything is woken too - otherwise a burst of bad requests
// becomes a burst of outbound calls to every service in the fleet.
func TestAnInvalidCreateWorldRequestWakesNothing(t *testing.T) {
	waker := newFakeWaker(wake.Services...)
	router := NewRouter(testGatewayConfig(), &fakeBroker{}, newFakeEdgeStore(), waker, nil)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/universe/worlds", strings.NewReader(`{"not":"valid"}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.Code)
	}
	if woken := waker.wokenServices(); len(woken) != 0 {
		t.Fatalf("a rejected request woke %v", woken)
	}
}

// A cached read never reaches NATS, so it must never wake anything either -
// the cache exists precisely so a sleeping service is not needed at all.
func TestACacheHitWakesNothing(t *testing.T) {
	waker := newFakeWaker(wake.Services...)
	edgeStore := newFakeEdgeStore()
	worldID := "9f8a1b2c-3d4e-4f50-8a1b-2c3d4e5f6071"
	if err := edgeStore.Set(context.Background(), worldCacheNamespace, string(contracts.WorldFamilyUniverse)+":"+worldID, []byte(`{"worldId":"cached"}`), time.Minute); err != nil {
		t.Fatalf("seed cache: %v", err)
	}
	router := NewRouter(testGatewayConfig(), &fakeBroker{requestError: nats.ErrNoResponders}, edgeStore, waker, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/universe/worlds/"+worldID, nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 from cache", response.Code)
	}
	if woken := waker.wokenServices(); len(woken) != 0 {
		t.Fatalf("a cache hit woke %v", woken)
	}
}

func equalStrings(actual, expected []string) bool {
	if len(actual) != len(expected) {
		return false
	}
	for index := range actual {
		if actual[index] != expected[index] {
			return false
		}
	}
	return true
}

// The point of the whole failure tally: a service that is asleep and a
// service that is dead send the identical no-responders reply, and the
// gateway used to answer both with "starting up, please retry". A client
// obeying that spins forever against something that is never coming back.
func TestARepeatedlyFailedWakeStopsPromisingTheClientARetry(t *testing.T) {
	waker := newFakeWaker(wake.ServiceDNA).failWakesFor(wake.ServiceDNA)
	router := NewRouter(testGatewayConfig(), &fakeBroker{requestError: nats.ErrNoResponders}, newFakeEdgeStore(), waker, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/jobs/01HZY000000000000000000000", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.Code)
	}
	if code := errorCodeOf(t, response.Body.Bytes()); code != "SERVICE_UNAVAILABLE" {
		t.Fatalf("error code = %q, want SERVICE_UNAVAILABLE", code)
	}
	// No Retry-After: the header is what a client waits on, and there is
	// nothing worth waiting for.
	if retryAfter := response.Header().Get("Retry-After"); retryAfter != "" {
		t.Fatalf("Retry-After = %q, want it absent once wakes are failing", retryAfter)
	}
	// Still woken. Giving up on the wake as well would remove the only thing
	// that could bring the service back, and the call is single-flighted so
	// it costs almost nothing to keep trying.
	if woken := waker.wokenServices(); !equalStrings(woken, []string{wake.ServiceDNA}) {
		t.Fatalf("woke %v, want the gateway to keep trying [%s]", woken, wake.ServiceDNA)
	}
}

// One service failing must not change what the gateway says about another.
// The tally is per service precisely because a dead dna says nothing about
// nature.
func TestAFailingServiceDoesNotCondemnItsNeighbours(t *testing.T) {
	waker := newFakeWaker(wake.Services...).failWakesFor(wake.ServiceDNA)
	router := NewRouter(testGatewayConfig(), &fakeBroker{requestError: nats.ErrNoResponders}, newFakeEdgeStore(), waker, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/nature/worlds/9f8a1b2c-3d4e-4f50-8a1b-2c3d4e5f6071", nil))

	if code := errorCodeOf(t, response.Body.Bytes()); code != "SERVICE_WAKING" {
		t.Fatalf("error code = %q, want nature to still be reported as waking", code)
	}
	if retryAfter := response.Header().Get("Retry-After"); retryAfter != "15" {
		t.Fatalf("Retry-After = %q, want 15", retryAfter)
	}
}

// A deadline means the service answered too slowly, which is the opposite of
// not answering at all. The failure tally must not be consulted for it, or a
// slow service inherits a dead one's verdict.
func TestAFailingWakeDoesNotChangeATimeout(t *testing.T) {
	waker := newFakeWaker(wake.ServiceDNA).failWakesFor(wake.ServiceDNA)
	router := NewRouter(testGatewayConfig(), &fakeBroker{requestError: context.DeadlineExceeded}, newFakeEdgeStore(), waker, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/jobs/01HZY000000000000000000000", nil))

	if response.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want 504", response.Code)
	}
	if code := errorCodeOf(t, response.Body.Bytes()); code != "SERVICE_TIMEOUT" {
		t.Fatalf("error code = %q, want SERVICE_TIMEOUT", code)
	}
	if woken := waker.wokenServices(); len(woken) != 0 {
		t.Fatalf("a slow service was woken: %v", woken)
	}
}
