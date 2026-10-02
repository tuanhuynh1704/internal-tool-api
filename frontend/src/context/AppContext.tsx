import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { 
    ExecuteRequest, 
    ExecuteStreamRequest,
    CancelStreamRequest,
    ExecuteLoadTest,
    CancelLoadTest,
    GetAllProjectsData,
    CreateProjectInDB,
    UpdateProjectInDB,
    DeleteProjectInDB,
    CreateFolderInDB,
    UpdateFolderInDB,
    DeleteFolderInDB,
    CreateRequestInDB,
    UpdateRequestInDB,
    DeleteRequestInDB,
    GetEnvironmentsFromDB,
    SaveEnvironmentToDB,
    DeleteEnvironmentFromDB,
    ExportFullWorkspace
} from '../../wailsjs/go/main/App';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { core, main } from '../../wailsjs/go/models';
import { AssertionRule } from '../utils/excelScenarioHelper';
import { evaluateAssertion, StepAssertionResult } from '../utils/scenarioRunnerEngine';

export interface KeyValueRow {
    id: string;
    key: string;
    value: string;
    enabled: boolean;
    description?: string;
}

export type HeaderPair = KeyValueRow;
export type ParamPair = KeyValueRow;

export interface FormDataRow extends KeyValueRow {
    type: 'text' | 'file';
    filePath?: string;
}

export interface AuthConfig {
    username?: string;
    password?: string;
    apiKeyName?: string;
    apiKeyValue?: string;
    apiKeyAddTo?: 'header' | 'query';
}

export interface StreamChunkItem {
    index: number;
    data: string;
    timestamp: string;
    isEnd?: boolean;
    status?: number;
}

export interface ApiTab {
    id: string;
    projectId: string;
    folderId?: string;
    name: string;
    method: string;
    baseUrl: string;
    port: string;
    usePort: boolean;
    apiPath: string;
    paramsList: ParamPair[];
    reqBody: string;
    bodyType: 'json' | 'raw' | 'urlencoded' | 'formdata' | 'none';
    urlEncodedList: KeyValueRow[];
    formDataList: FormDataRow[];
    headersList: HeaderPair[];
    authType: 'none' | 'bearer' | 'basic' | 'apikey';
    authToken: string;
    authConfig: AuthConfig;
    response: core.ResponsePayload | null;
    assertions: AssertionRule[];
    assertionResults?: StepAssertionResult[];
    isStreaming?: boolean;
    streamingActive?: boolean;
    streamChunks?: StreamChunkItem[];
}

export interface HistoryItem {
    id: string;
    method: string;
    url: string;
    status: number;
    time: number;
    timestamp: string;
}

export interface EnvVariable {
    id: string;
    key: string;
    value: string;
    enabled: boolean;
}

export interface Environment {
    id: string;
    name: string;
    variables: EnvVariable[];
}

interface AppContextType {
    tabs: ApiTab[];
    activeTabId: string;
    setActiveTabId: (id: string) => void;
    activeTab: ApiTab | null;
    updateActiveTab: (fields: Partial<ApiTab>) => void;
    createNewTab: (url?: string, method?: string) => void;
    closeTab: (id: string, e?: React.MouseEvent) => void;
    reorderTabs: (startIndex: number, endIndex: number) => void;
    history: HistoryItem[];
    loading: boolean;
    concurrency: number;
    setConcurrency: (num: number) => void;
    totalRequests: number;
    setTotalRequests: (num: number) => void;
    durationSec: number;
    setDurationSec: (num: number) => void;
    rampUpSec: number;
    setRampUpSec: (num: number) => void;
    targetRPS: number;
    setTargetRPS: (num: number) => void;
    stressResult: core.StressTestResult | null;
    stressLoading: boolean;
    handleSendRequest: () => Promise<void>;
    handleStartStressTest: () => Promise<void>;
    handleCancelStressTest: () => Promise<void>;
    environments: Environment[];
    setEnvironments: React.Dispatch<React.SetStateAction<Environment[]>>;
    activeEnvId: string;
    setActiveEnvId: (id: string) => void;
    saveEnvironment: (env: Environment) => Promise<void>;
    deleteEnvironment: (id: string) => Promise<void>;
    projects: main.DBProject[];
    folders: main.DBFolder[];
    dbRequests: main.DBRequest[];
    createProject: (name: string) => Promise<void>;
    renameProject: (id: string, name: string) => Promise<void>;
    deleteProject: (id: string) => Promise<void>;
    createFolder: (projectId: string, parentId: string, name: string) => Promise<void>;
    renameFolder: (id: string, name: string) => Promise<void>;
    deleteFolder: (id: string) => Promise<void>;
    createRequest: (projectId: string, folderId: string, name: string, method: string) => Promise<void>;
    renameRequest: (id: string, name: string) => Promise<void>;
    deleteRequest: (id: string) => Promise<void>;
    openSessionAsTab: (req: main.DBRequest) => void;
    refreshWorkspaceData: () => Promise<void>;
    exportWorkspace: () => Promise<string>;
    parseEnvVariables: (text: string) => string;
    buildFullUrl: (tab: ApiTab) => string;
    getMappedHeaders: (tab: ApiTab) => Record<string, string>;
    updateQueryParamsFromPath: (path: string) => void;
    updatePathFromQueryParams: (params: ParamPair[]) => void;
    handleStopStream: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
    const [tabs, setTabs] = useState<ApiTab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string>('');
    const [history, setHistory] = useState<HistoryItem[]>([]);
    
    const [loading, setLoading] = useState(false);
    const [concurrency, setConcurrency] = useState(10);
    const [totalRequests, setTotalRequests] = useState(100);
    const [durationSec, setDurationSec] = useState(0);
    const [rampUpSec, setRampUpSec] = useState(0);
    const [targetRPS, setTargetRPS] = useState(0);
    const [stressResult, setStressResult] = useState<core.StressTestResult | null>(null);
    const [stressLoading, setStressLoading] = useState(false);

    const [projects, setProjects] = useState<main.DBProject[]>([]);
    const [folders, setFolders] = useState<main.DBFolder[]>([]);
    const [dbRequests, setDbRequests] = useState<main.DBRequest[]>([]);

    const [environments, setEnvironments] = useState<Environment[]>([]);
    const [activeEnvId, setActiveEnvId] = useState<string>('none');
    const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0] || null;

    // Load Environments from SQLite DB
    const loadEnvironments = async () => {
        try {
            const dbEnvs = await GetEnvironmentsFromDB();
            if (dbEnvs && dbEnvs.length > 0) {
                const mapped: Environment[] = dbEnvs.map(e => ({
                    id: e.id,
                    name: e.name,
                    variables: (e.variables || []).map((v: any) => ({
                        id: v.id,
                        key: v.key,
                        value: v.value,
                        enabled: !!v.enabled
                    }))
                }));
                setEnvironments(mapped);
                if (activeEnvId === 'none' || !mapped.some(m => m.id === activeEnvId)) {
                    setActiveEnvId(mapped[0].id);
                }
            } else {
                const defaultEnv: Environment = {
                    id: 'env_default',
                    name: 'Local Environment',
                    variables: [
                        { id: 'v1', key: 'base_url', value: 'https://jsonplaceholder.typicode.com', enabled: true },
                        { id: 'v2', key: 'token', value: 'Bearer Secret_Local_Token_123', enabled: true }
                    ]
                };
                await SaveEnvironmentToDB({
                    id: defaultEnv.id,
                    name: defaultEnv.name,
                    variables: defaultEnv.variables.map(v => ({
                        id: v.id,
                        key: v.key,
                        value: v.value,
                        enabled: v.enabled
                    }))
                } as any);
                setEnvironments([defaultEnv]);
                setActiveEnvId(defaultEnv.id);
            }
        } catch (err) {
            console.error("Failed to load environments from DB:", err);
        }
    };

    const saveEnvironment = async (env: Environment) => {
        try {
            await SaveEnvironmentToDB({
                id: env.id,
                name: env.name,
                variables: env.variables.map(v => ({
                    id: v.id,
                    key: v.key,
                    value: v.value,
                    enabled: v.enabled
                }))
            } as any);
            setEnvironments(prev => {
                const exists = prev.some(e => e.id === env.id);
                if (exists) {
                    return prev.map(e => e.id === env.id ? env : e);
                }
                return [...prev, env];
            });
        } catch (err) {
            console.error("Failed to save environment:", err);
        }
    };

    const deleteEnvironment = async (id: string) => {
        try {
            await DeleteEnvironmentFromDB(id);
            const remaining = environments.filter(e => e.id !== id);
            setEnvironments(remaining);
            if (activeEnvId === id) {
                setActiveEnvId(remaining.length > 0 ? remaining[0].id : 'none');
            }
        } catch (err) {
            console.error("Failed to delete environment:", err);
        }
    };

    const refreshWorkspaceData = async () => {
        try {
            const data = await GetAllProjectsData();
            setProjects(data.projects || []);
            setFolders(data.folders || []);
            setDbRequests(data.requests || []);

            if (!data.projects || data.projects.length === 0) {
                const defaultProjId = 'proj_default';
                await CreateProjectInDB(defaultProjId, 'Default Project');
                const defaultReqId = 'req_default';
                await CreateRequestInDB(defaultReqId, defaultProjId, '', 'Untitled Request', 'GET');
                await UpdateRequestInDB({
                    id: defaultReqId,
                    projectId: defaultProjId,
                    folderId: '',
                    name: 'Untitled Request',
                    method: 'GET',
                    baseUrl: 'https://jsonplaceholder.typicode.com',
                    port: '8080',
                    usePort: false,
                    apiPath: '/posts/1',
                    reqBody: '',
                    headersJson: JSON.stringify([{ id: '1', key: 'Content-Type', value: 'application/json', enabled: true }]),
                    paramsJson: JSON.stringify([]),
                    bodyType: 'json',
                    authType: 'none',
                    authToken: '',
                    authConfigJson: '{}'
                });

                const freshData = await GetAllProjectsData();
                setProjects(freshData.projects || []);
                setFolders(freshData.folders || []);
                setDbRequests(freshData.requests || []);
            }
        } catch (e) {
            console.error("Failed to load workspace data:", e);
        }
    };

    useEffect(() => {
        refreshWorkspaceData();
        loadEnvironments();
    }, []);

    useEffect(() => {
        if (dbRequests.length > 0 && tabs.length === 0) {
            openSessionAsTab(dbRequests[0]);
        }
    }, [dbRequests]);

    const saveTabToDB = async (tab: ApiTab) => {
        try {
            const storedBody = tab.bodyType === 'urlencoded'
                ? JSON.stringify(tab.urlEncodedList || [])
                : tab.bodyType === 'formdata'
                    ? JSON.stringify(tab.formDataList || [])
                    : tab.reqBody;
            await UpdateRequestInDB({
                id: tab.id,
                projectId: tab.projectId,
                folderId: tab.folderId || '',
                name: tab.name,
                method: tab.method,
                baseUrl: tab.baseUrl,
                port: tab.port,
                usePort: tab.usePort,
                apiPath: tab.apiPath,
                reqBody: storedBody,
                headersJson: JSON.stringify(tab.headersList),
                paramsJson: JSON.stringify(tab.paramsList),
                bodyType: tab.bodyType || 'json',
                authType: tab.authType || 'none',
                authToken: tab.authToken || '',
                authConfigJson: JSON.stringify(tab.authConfig || {})
            });
            setDbRequests(prev => prev.map(r => r.id === tab.id ? {
                ...r,
                name: tab.name,
                method: tab.method,
                baseUrl: tab.baseUrl,
                port: tab.port,
                usePort: tab.usePort,
                apiPath: tab.apiPath,
                reqBody: tab.reqBody,
                headersJson: JSON.stringify(tab.headersList),
                paramsJson: JSON.stringify(tab.paramsList),
                bodyType: tab.bodyType || 'json',
                authType: tab.authType || 'none',
                authToken: tab.authToken || '',
                authConfigJson: JSON.stringify(tab.authConfig || {})
            } : r));
        } catch (error) {
            console.error("Failed to auto-save request to DB:", error);
        }
    };

    const updateActiveTab = (fields: Partial<ApiTab>) => {
        if (!activeTabId) return;
        setTabs(prev => prev.map(t => {
            if (t.id === activeTabId) {
                const newTab = { ...t, ...fields };
				const previous = saveTimers.current.get(newTab.id);
				if (previous) clearTimeout(previous);
				saveTimers.current.set(newTab.id, setTimeout(() => {
					saveTimers.current.delete(newTab.id);
					void saveTabToDB(newTab);
				}, 350));
                return newTab;
            }
            return t;
        }));
    };

    // 2-Way Sync between Query Params and apiPath
    const updateQueryParamsFromPath = (path: string) => {
        if (!activeTab) return;
        const qIndex = path.indexOf('?');
        if (qIndex === -1) {
            updateActiveTab({ apiPath: path, paramsList: [] });
            return;
        }

        const queryString = path.slice(qIndex + 1);
        const searchParams = new URLSearchParams(queryString);
        const newParams: ParamPair[] = [];

        searchParams.forEach((value, key) => {
            newParams.push({
                id: Date.now() + Math.random().toString(),
                key,
                value,
                enabled: true
            });
        });

        updateActiveTab({ apiPath: path, paramsList: newParams });
    };

    const updatePathFromQueryParams = (params: ParamPair[]) => {
        if (!activeTab) return;
        const basePath = activeTab.apiPath.split('?')[0] || '';
        const enabledParams = params.filter(p => p.enabled && p.key.trim() !== '');

        if (enabledParams.length === 0) {
            updateActiveTab({ apiPath: basePath, paramsList: params });
            return;
        }

        const searchParams = new URLSearchParams();
        enabledParams.forEach(p => {
            searchParams.append(p.key.trim(), p.value);
        });

        const newPath = `${basePath}?${searchParams.toString()}`;
        updateActiveTab({ apiPath: newPath, paramsList: params });
    };

    const openSessionAsTab = (req: main.DBRequest) => {
        const existing = tabs.find(t => t.id === req.id);
        if (existing) {
            setActiveTabId(req.id);
            return;
        }

        let parsedHeaders: HeaderPair[] = [];
        try {
            parsedHeaders = JSON.parse(req.headersJson || '[]');
        } catch {
            parsedHeaders = [{ id: '1', key: 'Content-Type', value: 'application/json', enabled: true }];
        }

        let parsedParams: ParamPair[] = [];
        try {
            parsedParams = JSON.parse(req.paramsJson || '[]');
        } catch {
            parsedParams = [];
        }

        let parsedAuthConfig: AuthConfig = {};
        try {
            parsedAuthConfig = JSON.parse(req.authConfigJson || '{}');
        } catch {
            parsedAuthConfig = {};
        }

        let urlEncodedList: KeyValueRow[] = [];
        let formDataList: FormDataRow[] = [];
        if (req.bodyType === 'urlencoded') {
            try { urlEncodedList = JSON.parse(req.reqBody || '[]'); } catch {
                urlEncodedList = Array.from(new URLSearchParams(req.reqBody || '')).map(([key, value], index) => ({ id: `legacy_url_${index}`, key, value, enabled: true }));
            }
        } else if (req.bodyType === 'formdata') {
            try { formDataList = JSON.parse(req.reqBody || '[]'); } catch { formDataList = []; }
        }

        const newTab: ApiTab = {
            id: req.id,
            projectId: req.projectId,
            folderId: req.folderId,
            name: req.name,
            method: req.method,
            baseUrl: req.baseUrl || '',
            port: req.port || '8080',
            usePort: !!req.usePort,
            apiPath: req.apiPath || '',
            paramsList: parsedParams,
            reqBody: ['urlencoded', 'formdata'].includes(req.bodyType) ? '' : (req.reqBody || ''),
            bodyType: (req.bodyType as any) || 'json',
            urlEncodedList,
            formDataList,
            headersList: parsedHeaders,
            authType: (req.authType as any) || 'none',
            authToken: req.authToken || '',
            authConfig: parsedAuthConfig,
            response: null,
            assertions: [],
            assertionResults: [],
            isStreaming: false,
            streamingActive: false,
            streamChunks: []
        };

        setTabs(prev => [...prev, newTab]);
        setActiveTabId(req.id);
    };

    const createNewTab = (url = '', method = 'GET') => {
        const projId = projects[0]?.id || 'proj_default';
        createRequest(projId, '', 'Untitled Request', method);
    };

    const closeTab = (id: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        if (tabs.length === 1) return;
        const remainTabs = tabs.filter(t => t.id !== id);
        setTabs(remainTabs);
        if (activeTabId === id) {
            setActiveTabId(remainTabs[remainTabs.length - 1].id);
        }
    };

    const reorderTabs = (startIndex: number, endIndex: number) => {
        setTabs(prev => {
            const result = Array.from(prev);
            const [removed] = result.splice(startIndex, 1);
            result.splice(endIndex, 0, removed);
            return result;
        });
    };

    const createProject = async (name: string) => {
        const id = 'proj_' + crypto.randomUUID();
        await CreateProjectInDB(id, name);
        await refreshWorkspaceData();
    };

    const renameProject = async (id: string, name: string) => {
        await UpdateProjectInDB(id, name);
        await refreshWorkspaceData();
    };

    const deleteProject = async (id: string) => {
        await DeleteProjectInDB(id);
        setTabs(prev => prev.filter(t => t.projectId !== id));
        await refreshWorkspaceData();
    };

    const createFolder = async (projectId: string, parentId: string, name: string) => {
        const id = 'fold_' + crypto.randomUUID();
        await CreateFolderInDB(id, projectId, parentId, name);
        await refreshWorkspaceData();
    };

    const renameFolder = async (id: string, name: string) => {
        await UpdateFolderInDB(id, name);
        await refreshWorkspaceData();
    };

    const deleteFolder = async (id: string) => {
        await DeleteFolderInDB(id);
        await refreshWorkspaceData();
    };

    const createRequest = async (projectId: string, folderId: string, name: string, method: string) => {
        const id = 'req_' + crypto.randomUUID();
        await CreateRequestInDB(id, projectId, folderId, name, method);
        await refreshWorkspaceData();
        
        const newTab: ApiTab = {
            id,
            projectId,
            folderId,
            name,
            method,
            baseUrl: 'https://jsonplaceholder.typicode.com',
            port: '8080',
            usePort: false,
            apiPath: '/posts/1',
            paramsList: [],
            reqBody: '',
            bodyType: 'json',
            urlEncodedList: [],
            formDataList: [],
            headersList: [{ id: '1', key: 'Content-Type', value: 'application/json', enabled: true }],
            authType: 'none',
            authToken: '',
            authConfig: {},
            response: null,
            assertions: [],
            assertionResults: [],
            isStreaming: false,
            streamingActive: false,
            streamChunks: []
        };
        setTabs(prev => [...prev, newTab]);
        setActiveTabId(id);
    };

    const renameRequest = async (id: string, name: string) => {
        const targetReq = dbRequests.find(r => r.id === id);
        if (targetReq) {
            await UpdateRequestInDB({ ...targetReq, name });
            updateActiveTab({ name });
            await refreshWorkspaceData();
        }
    };

    const deleteRequest = async (id: string) => {
        await DeleteRequestInDB(id);
        setTabs(prev => prev.filter(t => t.id !== id));
        await refreshWorkspaceData();
    };

    const parseEnvVariables = (text: string): string => {
        if (!text) return text;
        const currentEnv = environments.find(e => e.id === activeEnvId);
        if (!currentEnv) return text;

        const values = new Map(currentEnv.variables
            .filter(v => v.enabled && v.key.trim() !== '')
            .map(v => [v.key.trim(), v.value]));
        // Capture placeholders once instead of compiling user-provided keys as regex.
        return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key) => values.has(key.trim()) ? values.get(key.trim())! : match);
    };

    const buildFullUrl = (tab: ApiTab): string => {
        let base = parseEnvVariables(tab.baseUrl?.trim() || '');
        if (!base.startsWith('http://') && !base.startsWith('https://')) {
            base = 'http://' + base;
        }
        
        let portPart = '';
        if (tab.usePort && tab.port) {
            portPart = `:${parseEnvVariables(tab.port.trim())}`;
        }

        let path = parseEnvVariables(tab.apiPath?.trim() || '');
        if (path && !path.startsWith('/') && !path.startsWith('?')) {
            path = '/' + path;
        }

        let fullUrl = `${base}${portPart}${path}`;
        if (tab.authType === 'apikey' && tab.authConfig?.apiKeyAddTo === 'query' && tab.authConfig.apiKeyName) {
            const key = parseEnvVariables(tab.authConfig.apiKeyName.trim());
            const value = parseEnvVariables(tab.authConfig.apiKeyValue?.trim() || '');
            if (key) {
                const separator = fullUrl.includes('?') ? '&' : '?';
                fullUrl += `${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
            }
        }
        return fullUrl;
    };

    const getMappedHeaders = (tab: ApiTab): Record<string, string> => {
        const mappedHeaders: Record<string, string> = {};
        
        tab.headersList?.filter(h => h.enabled && h.key.trim() !== '').forEach(h => {
            mappedHeaders[parseEnvVariables(h.key.trim())] = parseEnvVariables(h.value);
        });

        // Inject Auth
        if (tab.authType === 'bearer' && tab.authToken) {
            mappedHeaders['Authorization'] = `Bearer ${parseEnvVariables(tab.authToken.trim())}`;
        } else if (tab.authType === 'basic' && (tab.authConfig?.username || tab.authConfig?.password)) {
            const u = parseEnvVariables(tab.authConfig.username?.trim() || '');
            const p = parseEnvVariables(tab.authConfig.password?.trim() || '');
            mappedHeaders['Authorization'] = `Basic ${btoa(`${u}:${p}`)}`;
        } else if (tab.authType === 'apikey' && (!tab.authConfig?.apiKeyAddTo || tab.authConfig.apiKeyAddTo === 'header') && tab.authConfig?.apiKeyName) {
            const k = parseEnvVariables(tab.authConfig.apiKeyName.trim());
            const v = parseEnvVariables(tab.authConfig.apiKeyValue?.trim() || '');
            if (k) {
                mappedHeaders[k] = v;
            }
        }

        return mappedHeaders;
    };

    const getProcessedBody = (tab: ApiTab): string => {
        if (tab.bodyType === 'none') return '';
        if (tab.bodyType === 'urlencoded') {
            const params = new URLSearchParams();
            tab.urlEncodedList?.filter(item => item.enabled && item.key.trim()).forEach(item => {
                params.append(parseEnvVariables(item.key.trim()), parseEnvVariables(item.value));
            });
            return params.toString();
        }
		if (tab.bodyType === 'formdata') {
			return JSON.stringify((tab.formDataList || []).filter(item => item.enabled && item.key.trim() !== '').map(item => ({
				...item,
				key: parseEnvVariables(item.key.trim()),
				value: parseEnvVariables(item.value)
			})));
		}
        return parseEnvVariables(tab.reqBody);
    };

    const handleStopStream = async () => {
        if (!activeTab) return;
        try {
            await CancelStreamRequest(activeTab.id);
            updateActiveTab({ streamingActive: false });
        } catch (e) {
            console.error("Failed to cancel stream:", e);
        }
    };

    const handleSendRequest = useCallback(async () => {
        if (!activeTab || loading) return;
        setLoading(true);
        updateActiveTab({ response: null, streamChunks: [], streamingActive: activeTab.isStreaming });

        const finalUrl = buildFullUrl(activeTab);
        const headers = getMappedHeaders(activeTab);

        if (activeTab.bodyType === 'urlencoded' && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }

        const payload: core.RequestPayload = {
            method: activeTab.method,
            url: finalUrl,
            headers,
            body: getProcessedBody(activeTab),
            bodyType: activeTab.bodyType
        };

        // Streaming Request Branch
        if (activeTab.isStreaming) {
            try {
                let accumulatedData = '';
                const startTime = Date.now();

                const cancelStreamEvent = EventsOn('stream:chunk:' + activeTab.id, (chunk: any) => {
                    if (chunk.data) {
                        accumulatedData += chunk.data;
                    }
                    const newChunk: StreamChunkItem = {
                        index: chunk.index,
                        data: chunk.data,
                        timestamp: new Date().toLocaleTimeString(),
                        isEnd: chunk.isEnd,
                        status: chunk.status
                    };
                    
                    setTabs(prev => prev.map(t => {
                        if (t.id === activeTab.id) {
                            const updatedChunks = [...(t.streamChunks || []), newChunk];
                            const mockResponse: any = {
                                status: chunk.status || t.response?.status || 200,
                                statusText: 'Stream Receiving...',
                                body: accumulatedData,
                                headers: chunk.headers || t.response?.headers || {},
                                responseTimeMs: Date.now() - startTime,
                                responseSizeByte: accumulatedData.length,
                                timing: {
                                    dnsTimeMs: 0,
                                    tcpTimeMs: 0,
                                    tlsTimeMs: 0,
                                    ttfbMs: Date.now() - startTime,
                                    downloadTimeMs: 0,
                                    totalTimeMs: Date.now() - startTime
                                }
                            };
                            return {
                                ...t,
                                streamChunks: updatedChunks,
                                response: mockResponse,
                                streamingActive: !chunk.isEnd
                            };
                        }
                        return t;
                    }));

                    if (chunk.isEnd) {
                        setLoading(false);
                        cancelStreamEvent();
                    }
                });

                await ExecuteStreamRequest(activeTab.id, payload);
            } catch (error) {
                console.error("Streaming error:", error);
                setLoading(false);
                updateActiveTab({ streamingActive: false });
            }
            return;
        }

        // Standard Request Branch
        try {
            const result = await ExecuteRequest(payload);

            // Evaluate Assertions
            let assertionResults: StepAssertionResult[] = [];
            if (activeTab.assertions && activeTab.assertions.length > 0) {
                let parsedJson: any = undefined;
                try {
                    parsedJson = JSON.parse(result.body);
                } catch {
                    parsedJson = undefined;
                }

                const envContext: Record<string, any> = {};
                const currentEnv = environments.find(e => e.id === activeEnvId);
                if (currentEnv) {
                    currentEnv.variables.forEach(v => {
                        if (v.enabled) envContext[v.key] = v.value;
                    });
                }

                assertionResults = activeTab.assertions
                    .filter(rule => rule.enabled !== false)
                    .map(rule => evaluateAssertion(rule, result, parsedJson, envContext));
            }

            updateActiveTab({ response: result, assertionResults });

            const newHistory: HistoryItem = {
                id: Date.now().toString(),
                method: activeTab.method,
                url: finalUrl,
                status: result.status,
                time: result.responseTimeMs,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            };
            setHistory(prev => [newHistory, ...prev].slice(0, 30));
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [activeTab, loading, environments, activeEnvId]);

    const handleStartStressTest = async () => {
        if (!activeTab) return;
        setStressLoading(true);
        setStressResult(null);
        try {
            const headers = getMappedHeaders(activeTab);
            if (activeTab.bodyType === 'urlencoded' && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
            }

            const payload: core.RequestPayload = {
                method: activeTab.method,
                url: buildFullUrl(activeTab),
                headers,
                body: getProcessedBody(activeTab),
                bodyType: activeTab.bodyType
            };
            const result = await ExecuteLoadTest(payload, concurrency, totalRequests, durationSec, rampUpSec, targetRPS);
            setStressResult(result);
        } catch (error) {
            console.error(error);
        } finally {
            setStressLoading(false);
        }
    };

    const handleCancelStressTest = async () => {
        try {
            await CancelLoadTest();
        } catch (e) {
            console.error("Cancel stress test error:", e);
        }
    };

    const exportWorkspace = async (): Promise<string> => {
        return await ExportFullWorkspace();
    };

    // Global Keybindings Listener
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSendRequest();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
                e.preventDefault();
                createNewTab();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
                e.preventDefault();
                if (activeTabId) {
                    closeTab(activeTabId);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleSendRequest, activeTabId]);

    return (
        <AppContext.Provider value={{
            tabs, activeTabId, setActiveTabId, activeTab, updateActiveTab, createNewTab, closeTab, reorderTabs,
            history, loading, concurrency, setConcurrency, totalRequests, setTotalRequests, durationSec, setDurationSec, rampUpSec, setRampUpSec, targetRPS, setTargetRPS, stressResult, stressLoading,
            handleSendRequest, handleStartStressTest, handleCancelStressTest,
            environments, setEnvironments, activeEnvId, setActiveEnvId, saveEnvironment, deleteEnvironment,
            projects, folders, dbRequests,
            createProject, renameProject, deleteProject,
            createFolder, renameFolder, deleteFolder,
            createRequest, renameRequest, deleteRequest,
            openSessionAsTab, refreshWorkspaceData, exportWorkspace,
            parseEnvVariables, buildFullUrl, getMappedHeaders,
            updateQueryParamsFromPath, updatePathFromQueryParams,
            handleStopStream
        }}>
            {children}
        </AppContext.Provider>
    );
}

export function useApp() {
    const context = useContext(AppContext);
    if (!context) throw new Error("useApp must be used within an AppProvider");
    return context;
}
