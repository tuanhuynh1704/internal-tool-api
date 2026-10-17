export namespace core {
	
	export class MockRequestLog {
	    id: string;
	    timestamp: string;
	    method: string;
	    path: string;
	    status: number;
	    headers: Record<string, string>;
	    body: string;
	    matched: boolean;
	
	    static createFrom(source: any = {}) {
	        return new MockRequestLog(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.timestamp = source["timestamp"];
	        this.method = source["method"];
	        this.path = source["path"];
	        this.status = source["status"];
	        this.headers = source["headers"];
	        this.body = source["body"];
	        this.matched = source["matched"];
	    }
	}
	export class MockRoute {
	    id: string;
	    path: string;
	    method: string;
	    statusCode: number;
	    responseHeaders: Record<string, string>;
	    responseBody: string;
	    delayMs: number;
	    enabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new MockRoute(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.path = source["path"];
	        this.method = source["method"];
	        this.statusCode = source["statusCode"];
	        this.responseHeaders = source["responseHeaders"];
	        this.responseBody = source["responseBody"];
	        this.delayMs = source["delayMs"];
	        this.enabled = source["enabled"];
	    }
	}
	export class MockServerStatus {
	    isRunning: boolean;
	    port: number;
	    url: string;
	    logs: MockRequestLog[];
	
	    static createFrom(source: any = {}) {
	        return new MockServerStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.isRunning = source["isRunning"];
	        this.port = source["port"];
	        this.url = source["url"];
	        this.logs = this.convertValues(source["logs"], MockRequestLog);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RequestPayload {
	    method: string;
	    url: string;
	    headers: Record<string, string>;
	    body: string;
	    bodyType?: string;
	
	    static createFrom(source: any = {}) {
	        return new RequestPayload(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.method = source["method"];
	        this.url = source["url"];
	        this.headers = source["headers"];
	        this.body = source["body"];
	        this.bodyType = source["bodyType"];
	    }
	}
	export class TimingDetails {
	    dnsTimeMs: number;
	    tcpTimeMs: number;
	    tlsTimeMs: number;
	    ttfbMs: number;
	    downloadTimeMs: number;
	    totalTimeMs: number;
	
	    static createFrom(source: any = {}) {
	        return new TimingDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dnsTimeMs = source["dnsTimeMs"];
	        this.tcpTimeMs = source["tcpTimeMs"];
	        this.tlsTimeMs = source["tlsTimeMs"];
	        this.ttfbMs = source["ttfbMs"];
	        this.downloadTimeMs = source["downloadTimeMs"];
	        this.totalTimeMs = source["totalTimeMs"];
	    }
	}
	export class ResponsePayload {
	    status: number;
	    statusText: string;
	    body: string;
	    bodyBase64?: string;
	    isBinary?: boolean;
	    truncated?: boolean;
	    headers: Record<string, string>;
	    responseTimeMs: number;
	    responseSizeByte: number;
	    timing: TimingDetails;
	
	    static createFrom(source: any = {}) {
	        return new ResponsePayload(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.statusText = source["statusText"];
	        this.body = source["body"];
	        this.bodyBase64 = source["bodyBase64"];
	        this.isBinary = source["isBinary"];
	        this.truncated = source["truncated"];
	        this.headers = source["headers"];
	        this.responseTimeMs = source["responseTimeMs"];
	        this.responseSizeByte = source["responseSizeByte"];
	        this.timing = this.convertValues(source["timing"], TimingDetails);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class StressTestResult {
	    totalRequests: number;
	    successCount: number;
	    failureCount: number;
	    abortedRequests: number;
	    averageTimeMs: number;
	    minTimeMs: number;
	    maxTimeMs: number;
	    p50Ms: number;
	    p90Ms: number;
	    p95Ms: number;
	    p99Ms: number;
	    rps: number;
	    totalDurationSec: number;
	    cancelled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new StressTestResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.totalRequests = source["totalRequests"];
	        this.successCount = source["successCount"];
	        this.failureCount = source["failureCount"];
	        this.abortedRequests = source["abortedRequests"];
	        this.averageTimeMs = source["averageTimeMs"];
	        this.minTimeMs = source["minTimeMs"];
	        this.maxTimeMs = source["maxTimeMs"];
	        this.p50Ms = source["p50Ms"];
	        this.p90Ms = source["p90Ms"];
	        this.p95Ms = source["p95Ms"];
	        this.p99Ms = source["p99Ms"];
	        this.rps = source["rps"];
	        this.totalDurationSec = source["totalDurationSec"];
	        this.cancelled = source["cancelled"];
	    }
	}

}

export namespace main {
	
	export class AppInfo {
	    name: string;
	    version: string;
	    outputFileName: string;
	    buildTime: string;
	    os: string;
	
	    static createFrom(source: any = {}) {
	        return new AppInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.outputFileName = source["outputFileName"];
	        this.buildTime = source["buildTime"];
	        this.os = source["os"];
	    }
	}
	export class AutomationAssertion {
	    type: string;
	    target?: string;
	    operator: string;
	    expected: string;
	    enabled?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AutomationAssertion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.target = source["target"];
	        this.operator = source["operator"];
	        this.expected = source["expected"];
	        this.enabled = source["enabled"];
	    }
	}
	export class AutomationAssertionResult {
	    rule: AutomationAssertion;
	    passed: boolean;
	    message: string;
	    actual?: any;
	
	    static createFrom(source: any = {}) {
	        return new AutomationAssertionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rule = this.convertValues(source["rule"], AutomationAssertion);
	        this.passed = source["passed"];
	        this.message = source["message"];
	        this.actual = source["actual"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AutomationStepResult {
	    stepId: string;
	    stepName: string;
	    stepOrder: number;
	    method: string;
	    url: string;
	    status: number;
	    statusText: string;
	    durationMs: number;
	    responseBody: string;
	    responseHeaders: Record<string, string>;
	    passed: boolean;
	    assertionDetails: AutomationAssertionResult[];
	    extracted: Record<string, any>;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new AutomationStepResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.stepId = source["stepId"];
	        this.stepName = source["stepName"];
	        this.stepOrder = source["stepOrder"];
	        this.method = source["method"];
	        this.url = source["url"];
	        this.status = source["status"];
	        this.statusText = source["statusText"];
	        this.durationMs = source["durationMs"];
	        this.responseBody = source["responseBody"];
	        this.responseHeaders = source["responseHeaders"];
	        this.passed = source["passed"];
	        this.assertionDetails = this.convertValues(source["assertionDetails"], AutomationAssertionResult);
	        this.extracted = source["extracted"];
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AutomationRunSummary {
	    runId: string;
	    scenarioId: string;
	    scenarioName: string;
	    status: string;
	    totalSteps: number;
	    passedSteps: number;
	    failedSteps: number;
	    skippedSteps: number;
	    totalDurationMs: number;
	    avgDurationMs: number;
	    successRate: number;
	    passed: boolean;
	    runtimeContext: Record<string, any>;
	    stepResults: AutomationStepResult[];
	
	    static createFrom(source: any = {}) {
	        return new AutomationRunSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.runId = source["runId"];
	        this.scenarioId = source["scenarioId"];
	        this.scenarioName = source["scenarioName"];
	        this.status = source["status"];
	        this.totalSteps = source["totalSteps"];
	        this.passedSteps = source["passedSteps"];
	        this.failedSteps = source["failedSteps"];
	        this.skippedSteps = source["skippedSteps"];
	        this.totalDurationMs = source["totalDurationMs"];
	        this.avgDurationMs = source["avgDurationMs"];
	        this.successRate = source["successRate"];
	        this.passed = source["passed"];
	        this.runtimeContext = source["runtimeContext"];
	        this.stepResults = this.convertValues(source["stepResults"], AutomationStepResult);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class DBActivityHistory {
	    id: string;
	    method: string;
	    url: string;
	    status: number;
	    duration: number;
	    timestamp: string;
	    createdAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new DBActivityHistory(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.method = source["method"];
	        this.url = source["url"];
	        this.status = source["status"];
	        this.duration = source["duration"];
	        this.timestamp = source["timestamp"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class DBEnvVariable {
	    id: string;
	    key: string;
	    value: string;
	    enabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DBEnvVariable(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.key = source["key"];
	        this.value = source["value"];
	        this.enabled = source["enabled"];
	    }
	}
	export class DBEnvironment {
	    id: string;
	    name: string;
	    variables: DBEnvVariable[];
	
	    static createFrom(source: any = {}) {
	        return new DBEnvironment(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.variables = this.convertValues(source["variables"], DBEnvVariable);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DBFolder {
	    id: string;
	    projectId: string;
	    parentId?: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new DBFolder(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.projectId = source["projectId"];
	        this.parentId = source["parentId"];
	        this.name = source["name"];
	    }
	}
	export class DBProject {
	    id: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new DBProject(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	    }
	}
	export class DBRequest {
	    id: string;
	    projectId: string;
	    folderId?: string;
	    name: string;
	    method: string;
	    baseUrl: string;
	    port: string;
	    usePort: boolean;
	    apiPath: string;
	    reqBody: string;
	    headersJson: string;
	    paramsJson: string;
	    bodyType: string;
	    authType: string;
	    authToken: string;
	    authConfigJson: string;
	    assertionsJson: string;
	
	    static createFrom(source: any = {}) {
	        return new DBRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.projectId = source["projectId"];
	        this.folderId = source["folderId"];
	        this.name = source["name"];
	        this.method = source["method"];
	        this.baseUrl = source["baseUrl"];
	        this.port = source["port"];
	        this.usePort = source["usePort"];
	        this.apiPath = source["apiPath"];
	        this.reqBody = source["reqBody"];
	        this.headersJson = source["headersJson"];
	        this.paramsJson = source["paramsJson"];
	        this.bodyType = source["bodyType"];
	        this.authType = source["authType"];
	        this.authToken = source["authToken"];
	        this.authConfigJson = source["authConfigJson"];
	        this.assertionsJson = source["assertionsJson"];
	    }
	}
	export class DBScenarioStep {
	    id: string;
	    scenarioId: string;
	    stepOrder: number;
	    name: string;
	    method: string;
	    apiPath: string;
	    headersJson: string;
	    paramsJson: string;
	    body: string;
	    bodyType: string;
	    authType: string;
	    authToken: string;
	    authConfigJson: string;
	    assertionsJson: string;
	    extractVarsJson: string;
	
	    static createFrom(source: any = {}) {
	        return new DBScenarioStep(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.scenarioId = source["scenarioId"];
	        this.stepOrder = source["stepOrder"];
	        this.name = source["name"];
	        this.method = source["method"];
	        this.apiPath = source["apiPath"];
	        this.headersJson = source["headersJson"];
	        this.paramsJson = source["paramsJson"];
	        this.body = source["body"];
	        this.bodyType = source["bodyType"];
	        this.authType = source["authType"];
	        this.authToken = source["authToken"];
	        this.authConfigJson = source["authConfigJson"];
	        this.assertionsJson = source["assertionsJson"];
	        this.extractVarsJson = source["extractVarsJson"];
	    }
	}
	export class DBScenario {
	    id: string;
	    name: string;
	    description: string;
	    baseUrl: string;
	    stopOnError: boolean;
	    delayMs: number;
	    steps: DBScenarioStep[];
	
	    static createFrom(source: any = {}) {
	        return new DBScenario(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.baseUrl = source["baseUrl"];
	        this.stopOnError = source["stopOnError"];
	        this.delayMs = source["delayMs"];
	        this.steps = this.convertValues(source["steps"], DBScenarioStep);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class DBScenarioTestResult {
	    id: string;
	    runId: string;
	    stepId: string;
	    stepOrder: number;
	    status: string;
	    duration: number;
	    method: string;
	    url: string;
	    httpStatus: number;
	    responseBody: string;
	    responseHeaders: string;
	    assertionDetails: string;
	    extractedVars: string;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new DBScenarioTestResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.runId = source["runId"];
	        this.stepId = source["stepId"];
	        this.stepOrder = source["stepOrder"];
	        this.status = source["status"];
	        this.duration = source["duration"];
	        this.method = source["method"];
	        this.url = source["url"];
	        this.httpStatus = source["httpStatus"];
	        this.responseBody = source["responseBody"];
	        this.responseHeaders = source["responseHeaders"];
	        this.assertionDetails = source["assertionDetails"];
	        this.extractedVars = source["extractedVars"];
	        this.error = source["error"];
	    }
	}
	export class DBScenarioTestRun {
	    id: string;
	    scenarioId: string;
	    status: string;
	    startedAt: string;
	    finishedAt: string;
	    duration: number;
	
	    static createFrom(source: any = {}) {
	        return new DBScenarioTestRun(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.scenarioId = source["scenarioId"];
	        this.status = source["status"];
	        this.startedAt = source["startedAt"];
	        this.finishedAt = source["finishedAt"];
	        this.duration = source["duration"];
	    }
	}
	export class DBUIStep {
	    id: string;
	    scenarioId: string;
	    sortOrder: number;
	    type: string;
	    selector: string;
	    value: string;
	    timeout: number;
	    configJson: string;
	    createdAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new DBUIStep(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.scenarioId = source["scenarioId"];
	        this.sortOrder = source["sortOrder"];
	        this.type = source["type"];
	        this.selector = source["selector"];
	        this.value = source["value"];
	        this.timeout = source["timeout"];
	        this.configJson = source["configJson"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class DBUIScenario {
	    id: string;
	    projectId?: string;
	    folderId?: string;
	    name: string;
	    browser: string;
	    baseUrl: string;
	    createdAt?: string;
	    updatedAt?: string;
	    steps: DBUIStep[];
	
	    static createFrom(source: any = {}) {
	        return new DBUIScenario(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.projectId = source["projectId"];
	        this.folderId = source["folderId"];
	        this.name = source["name"];
	        this.browser = source["browser"];
	        this.baseUrl = source["baseUrl"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	        this.steps = this.convertValues(source["steps"], DBUIStep);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class DBUITestResult {
	    id: string;
	    runId: string;
	    stepId: string;
	    stepOrder: number;
	    status: string;
	    error: string;
	    duration: number;
	    screenshotPath: string;
	    details: string;
	
	    static createFrom(source: any = {}) {
	        return new DBUITestResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.runId = source["runId"];
	        this.stepId = source["stepId"];
	        this.stepOrder = source["stepOrder"];
	        this.status = source["status"];
	        this.error = source["error"];
	        this.duration = source["duration"];
	        this.screenshotPath = source["screenshotPath"];
	        this.details = source["details"];
	    }
	}
	export class DBUITestRun {
	    id: string;
	    scenarioId: string;
	    status: string;
	    startedAt: string;
	    finishedAt: string;
	    duration: number;
	
	    static createFrom(source: any = {}) {
	        return new DBUITestRun(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.scenarioId = source["scenarioId"];
	        this.status = source["status"];
	        this.startedAt = source["startedAt"];
	        this.finishedAt = source["finishedAt"];
	        this.duration = source["duration"];
	    }
	}
	export class DBWorkspaceSession {
	    activeTabId: string;
	    openTabIds: string[];
	    activeEnvId: string;
	    activeProjectId: string;
	    activeSidebarTab: string;
	
	    static createFrom(source: any = {}) {
	        return new DBWorkspaceSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.activeTabId = source["activeTabId"];
	        this.openTabIds = source["openTabIds"];
	        this.activeEnvId = source["activeEnvId"];
	        this.activeProjectId = source["activeProjectId"];
	        this.activeSidebarTab = source["activeSidebarTab"];
	    }
	}
	export class PostmanImportResult {
	    projectId: string;
	    projectName: string;
	    importedFolders: number;
	    importedRequests: number;
	
	    static createFrom(source: any = {}) {
	        return new PostmanImportResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.projectId = source["projectId"];
	        this.projectName = source["projectName"];
	        this.importedFolders = source["importedFolders"];
	        this.importedRequests = source["importedRequests"];
	    }
	}
	export class ProjectDataPayload {
	    projects: DBProject[];
	    folders: DBFolder[];
	    requests: DBRequest[];
	
	    static createFrom(source: any = {}) {
	        return new ProjectDataPayload(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.projects = this.convertValues(source["projects"], DBProject);
	        this.folders = this.convertValues(source["folders"], DBFolder);
	        this.requests = this.convertValues(source["requests"], DBRequest);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class UpdateStatus {
	    phase: string;
	    percent: number;
	    errorMsg?: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.phase = source["phase"];
	        this.percent = source["percent"];
	        this.errorMsg = source["errorMsg"];
	    }
	}
	export class WorkspaceImportResult {
	    projects: number;
	    folders: number;
	    requests: number;
	    environments: number;
	    scenarios: number;
	
	    static createFrom(source: any = {}) {
	        return new WorkspaceImportResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.projects = source["projects"];
	        this.folders = source["folders"];
	        this.requests = source["requests"];
	        this.environments = source["environments"];
	        this.scenarios = source["scenarios"];
	    }
	}

}

export namespace ui {
	
	export class StepExecutionResult {
	    stepId: string;
	    stepOrder: number;
	    stepType: string;
	    stepName: string;
	    status: string;
	    durationMs: number;
	    error?: string;
	    screenshotPath?: string;
	    screenshotB64?: string;
	    details?: string;
	
	    static createFrom(source: any = {}) {
	        return new StepExecutionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.stepId = source["stepId"];
	        this.stepOrder = source["stepOrder"];
	        this.stepType = source["stepType"];
	        this.stepName = source["stepName"];
	        this.status = source["status"];
	        this.durationMs = source["durationMs"];
	        this.error = source["error"];
	        this.screenshotPath = source["screenshotPath"];
	        this.screenshotB64 = source["screenshotB64"];
	        this.details = source["details"];
	    }
	}
	export class TestRunSummary {
	    runId: string;
	    scenarioId: string;
	    scenarioName: string;
	    status: string;
	    // Go type: time
	    startedAt: any;
	    // Go type: time
	    finishedAt: any;
	    durationMs: number;
	    totalSteps: number;
	    passedSteps: number;
	    failedSteps: number;
	    skippedSteps: number;
	    stepResults: StepExecutionResult[];
	    errorMessage?: string;
	
	    static createFrom(source: any = {}) {
	        return new TestRunSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.runId = source["runId"];
	        this.scenarioId = source["scenarioId"];
	        this.scenarioName = source["scenarioName"];
	        this.status = source["status"];
	        this.startedAt = this.convertValues(source["startedAt"], null);
	        this.finishedAt = this.convertValues(source["finishedAt"], null);
	        this.durationMs = source["durationMs"];
	        this.totalSteps = source["totalSteps"];
	        this.passedSteps = source["passedSteps"];
	        this.failedSteps = source["failedSteps"];
	        this.skippedSteps = source["skippedSteps"];
	        this.stepResults = this.convertValues(source["stepResults"], StepExecutionResult);
	        this.errorMessage = source["errorMessage"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace updater {
	
	export class UpdateInfo {
	    Version: string;
	    URL: string;
	    SHA256: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Version = source["Version"];
	        this.URL = source["URL"];
	        this.SHA256 = source["SHA256"];
	    }
	}

}

