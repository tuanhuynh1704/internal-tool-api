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
    RenameRequestInDB,
    DeleteRequestInDB,
    GetEnvironmentsFromDB,
    SaveEnvironmentToDB,
    DeleteEnvironmentFromDB,
    ExportFullWorkspace,
    GetActivityHistoryFromDB,
    SaveActivityHistoryToDB,
    DeleteActivityHistoryFromDB,
    ClearActivityHistoryInDB,
    GetWorkspaceSessionFromDB,
    SaveWorkspaceSessionToDB,
    GetAppSetting,
    SetAppSetting
} from '../../wailsjs/go/main/App';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { core, main } from '../../wailsjs/go/models';
import { AssertionRule } from '../utils/excelScenarioHelper';
import { evaluateAssertion, StepAssertionResult } from '../utils/scenarioRunnerEngine';
import {
    buildQueryStringKeepingTemplates,
    interpolateText,
    interpolateUrlTemplate,
    newId,
    parseQueryString,
    setHeader,
    utf8ToBase64
} from '../utils/requestHelpers';

/** Streams keep at most this many chunks in memory for the chunk list view. */
const MAX_STREAM_CHUNKS = 2000;

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

export interface WorkspaceSession {
    activeTabId: string;
    openTabIds: string[];
    activeEnvId: string;
    activeProjectId?: string;
    activeSidebarTab?: 'collections' | 'history';
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
    clearHistory: () => Promise<void>;
    deleteHistoryItem: (id: string) => Promise<void>;
    openHistoryAsTab: (item: HistoryItem) => void;
    saveSessionState: (override?: Partial<WorkspaceSession>) => void;
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
    exportWorkspace: (includeSecrets?: boolean) => Promise<string>;
    parseEnvVariables: (text: string) => string;
    buildFullUrl: (tab: ApiTab) => string;
    getMappedHeaders: (tab: ApiTab) => Record<string, string>;
    updateQueryParamsFromPath: (path: string) => void;
    updatePathFromQueryParams: (params: ParamPair[]) => void;
    handleStopStream: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const createApiTabFromDBRequest = (req: main.DBRequest): ApiTab => {
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

    let parsedAssertions: AssertionRule[] = [];
    try {
        const raw = JSON.parse((req as any).assertionsJson || '[]');
        parsedAssertions = Array.isArray(raw) ? raw : [];
    } catch {
        parsedAssertions = [];
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

    return {
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
        assertions: parsedAssertions,
        assertionResults: [],
        isStreaming: false,
        streamingActive: false,
        streamChunks: []
    };
};

/** The value persisted in requests.req_body for a tab (form bodies are JSON rows). */
const storedBodyOf = (tab: ApiTab): string =>
    tab.bodyType === 'urlencoded'
        ? JSON.stringify(tab.urlEncodedList || [])
        : tab.bodyType === 'formdata'
            ? JSON.stringify(tab.formDataList || [])
            : tab.reqBody;

const toDBRequest = (tab: ApiTab): main.DBRequest => ({
    id: tab.id,
    projectId: tab.projectId,
    folderId: tab.folderId || '',
    name: tab.name,
    method: tab.method,
    baseUrl: tab.baseUrl,
    port: tab.port,
    usePort: tab.usePort,
    apiPath: tab.apiPath,
    reqBody: storedBodyOf(tab),
    headersJson: JSON.stringify(tab.headersList),
    paramsJson: JSON.stringify(tab.paramsList),
    bodyType: tab.bodyType || 'json',
    authType: tab.authType || 'none',
    authToken: tab.authToken || '',
    authConfigJson: JSON.stringify(tab.authConfig || {}),
    assertionsJson: JSON.stringify(tab.assertions || [])
});

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

    // Latest tabs for callbacks that outlive a render (debounced saves, unload flush).
    const tabsRef = useRef<ApiTab[]>(tabs);
    tabsRef.current = tabs;
    const stopStreamListenerRef = useRef<(() => void) | null>(null);

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
                let targetEnvId = mapped[0].id;
                try {
                    const localStr = localStorage.getItem('internal_tool_workspace_session');
                    if (localStr) {
                        const parsed = JSON.parse(localStr);
                        if (parsed.activeEnvId && mapped.some(m => m.id === parsed.activeEnvId)) {
                            targetEnvId = parsed.activeEnvId;
                        }
                    }
                } catch {}
                if (activeEnvId === 'none' || !mapped.some(m => m.id === activeEnvId)) {
                    setActiveEnvId(targetEnvId);
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

    // Environment saves are applied to state immediately (so the next keystroke
    // builds on the latest value), written to the DB after a short debounce,
    // and serialised per environment so an older write can never land last.
    const envSaveChains = useRef(new Map<string, Promise<void>>());
    const envPendingSaves = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; env: Environment; waiters: Array<() => void> }>());

    const writeEnvironment = (envId: string): Promise<void> => {
        const pending = envPendingSaves.current.get(envId);
        if (!pending) return envSaveChains.current.get(envId) || Promise.resolve();
        clearTimeout(pending.timer);
        envPendingSaves.current.delete(envId);
        const { env, waiters } = pending;
        const chain = (envSaveChains.current.get(envId) || Promise.resolve())
            .then(() => SaveEnvironmentToDB({
                id: env.id,
                name: env.name,
                variables: env.variables.map(v => ({ id: v.id, key: v.key, value: v.value, enabled: v.enabled }))
            } as any))
            .catch(err => console.error("Failed to save environment:", err))
            .finally(() => waiters.forEach(resolve => resolve()));
        envSaveChains.current.set(envId, chain);
        return chain;
    };

    const flushEnvironmentSaves = () => {
        Array.from(envPendingSaves.current.keys()).forEach(id => void writeEnvironment(id));
    };

    const saveEnvironment = (env: Environment): Promise<void> => {
        setEnvironments(prev => {
            const exists = prev.some(e => e.id === env.id);
            if (exists) {
                return prev.map(e => e.id === env.id ? env : e);
            }
            return [...prev, env];
        });
        return new Promise<void>(resolve => {
            const previous = envPendingSaves.current.get(env.id);
            if (previous) clearTimeout(previous.timer);
            const waiters = [...(previous?.waiters || []), resolve];
            const timer = setTimeout(() => void writeEnvironment(env.id), 300);
            envPendingSaves.current.set(env.id, { timer, env, waiters });
        });
    };

    const deleteEnvironment = async (id: string) => {
        // Drop a pending save so it cannot re-create the environment afterwards.
        const pending = envPendingSaves.current.get(id);
        if (pending) {
            clearTimeout(pending.timer);
            envPendingSaves.current.delete(id);
            pending.waiters.forEach(resolve => resolve());
        }
        try {
            await (envSaveChains.current.get(id) || Promise.resolve());
            await DeleteEnvironmentFromDB(id);
            envSaveChains.current.delete(id);
            setEnvironments(prev => {
                const remaining = prev.filter(e => e.id !== id);
                if (activeEnvId === id) {
                    setActiveEnvId(remaining.length > 0 ? remaining[0].id : 'none');
                }
                return remaining;
            });
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
                    authConfigJson: '{}',
                    assertionsJson: '[]'
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

    const isSessionRestored = useRef(false);
    const sessionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const saveSessionState = useCallback((override?: Partial<WorkspaceSession>) => {
        let currentOpenTabIds = tabs.map(t => t.id);
        let currentActiveTabId = activeTabId;
        let currentActiveEnvId = activeEnvId;

        if (override?.openTabIds) currentOpenTabIds = override.openTabIds;
        if (override?.activeTabId !== undefined) currentActiveTabId = override.activeTabId;
        if (override?.activeEnvId !== undefined) currentActiveEnvId = override.activeEnvId;

        let existingSession: Partial<WorkspaceSession> = {};
        try {
            const str = localStorage.getItem('internal_tool_workspace_session');
            if (str) existingSession = JSON.parse(str);
        } catch {}

        const session: WorkspaceSession = {
            ...existingSession,
            openTabIds: currentOpenTabIds,
            activeTabId: currentActiveTabId,
            activeEnvId: currentActiveEnvId,
            ...override
        };

        try {
            localStorage.setItem('internal_tool_workspace_session', JSON.stringify(session));
        } catch {}

        if (sessionSaveTimer.current) clearTimeout(sessionSaveTimer.current);
        sessionSaveTimer.current = setTimeout(() => {
            void SaveWorkspaceSessionToDB(session as any);
        }, 300);
    }, [tabs, activeTabId, activeEnvId]);

    const restoreSession = useCallback((session: WorkspaceSession | null, currentDbRequests: main.DBRequest[]): boolean => {
        if (!session || !Array.isArray(session.openTabIds) || session.openTabIds.length === 0) {
            return false;
        }

        const reqMap = new Map(currentDbRequests.map(r => [r.id, r]));
        const matchedRequests: main.DBRequest[] = [];
        for (const tabId of session.openTabIds) {
            const found = reqMap.get(tabId);
            if (found) {
                matchedRequests.push(found);
            }
        }

        if (matchedRequests.length === 0) {
            return false;
        }

        const restoredTabs = matchedRequests.map(createApiTabFromDBRequest);
        setTabs(restoredTabs);

        const targetActiveId = restoredTabs.some(t => t.id === session.activeTabId)
            ? session.activeTabId
            : restoredTabs[0].id;
        setActiveTabId(targetActiveId);

        if (session.activeEnvId) {
            setActiveEnvId(session.activeEnvId);
        }

        isSessionRestored.current = true;
        return true;
    }, []);

    const loadActivityHistory = async () => {
        try {
            const dbHist = await GetActivityHistoryFromDB();
            if (dbHist && dbHist.length > 0) {
                const mapped: HistoryItem[] = dbHist.map(h => ({
                    id: h.id,
                    method: h.method,
                    url: h.url,
                    status: h.status,
                    time: h.duration,
                    timestamp: h.timestamp
                }));
                setHistory(mapped);
            }
        } catch (err) {
            console.error("Failed to load activity history from DB:", err);
        }
    };

    useEffect(() => {
        refreshWorkspaceData();
        loadEnvironments();
        loadActivityHistory();
    }, []);

    useEffect(() => {
        if (dbRequests.length === 0 || isSessionRestored.current) return;

        // 1. Try localStorage for immediate recovery (0ms)
        let savedSession: WorkspaceSession | null = null;
        try {
            const localStr = localStorage.getItem('internal_tool_workspace_session');
            if (localStr) savedSession = JSON.parse(localStr);
        } catch {}

        if (restoreSession(savedSession, dbRequests)) {
            return;
        }

        // 2. Fallback to DB
        GetWorkspaceSessionFromDB().then(dbSession => {
            if (isSessionRestored.current) return;
            if (dbSession && restoreSession(dbSession as any, dbRequests)) {
                return;
            }
            if (tabs.length === 0 && dbRequests.length > 0) {
                openSessionAsTab(dbRequests[0]);
                isSessionRestored.current = true;
            }
        }).catch(() => {
            if (!isSessionRestored.current && tabs.length === 0 && dbRequests.length > 0) {
                openSessionAsTab(dbRequests[0]);
                isSessionRestored.current = true;
            }
        });
    }, [dbRequests, restoreSession]);

    // Continuously save session whenever tabs, activeTabId or activeEnvId change
    useEffect(() => {
        if (isSessionRestored.current && tabs.length > 0) {
            saveSessionState();
        }
    }, [tabs, activeTabId, activeEnvId, saveSessionState]);

    // Fields that only live in memory; changing them never needs a DB write.
    const TRANSIENT_TAB_FIELDS = new Set(['response', 'assertionResults', 'streamChunks', 'streamingActive', 'isStreaming']);

    const saveTabToDB = async (tab: ApiTab) => {
        try {
            const record = toDBRequest(tab);
            await UpdateRequestInDB(record);
            // Keep the cache identical to what was stored (form bodies included),
            // so later operations built from the cache cannot erase data.
            setDbRequests(prev => prev.map(r => r.id === tab.id ? { ...r, ...record } : r));
        } catch (error) {
            console.error("Failed to auto-save request to DB:", error);
        }
    };

    const scheduleSave = (tabId: string) => {
        const previous = saveTimers.current.get(tabId);
        if (previous) clearTimeout(previous);
        saveTimers.current.set(tabId, setTimeout(() => {
            saveTimers.current.delete(tabId);
            const latest = tabsRef.current.find(t => t.id === tabId);
            if (latest) void saveTabToDB(latest);
        }, 350));
    };

    // Writes every pending debounced save immediately (window close/reload).
    const flushPendingSaves = () => {
        saveTimers.current.forEach((timer, tabId) => {
            clearTimeout(timer);
            const latest = tabsRef.current.find(t => t.id === tabId);
            if (latest) void saveTabToDB(latest);
        });
        saveTimers.current.clear();
    };

    // Ensure pending edits and the session are saved on window close/reload
    useEffect(() => {
        const handleBeforeUnload = () => {
            flushPendingSaves();
            flushEnvironmentSaves();
            if (tabsRef.current.length > 0) {
                try {
                    const existing = localStorage.getItem('internal_tool_workspace_session');
                    const parsed = existing ? JSON.parse(existing) : {};
                    const session: WorkspaceSession = {
                        ...parsed,
                        openTabIds: tabsRef.current.map(t => t.id),
                        activeTabId,
                        activeEnvId
                    };
                    localStorage.setItem('internal_tool_workspace_session', JSON.stringify(session));
                    void SaveWorkspaceSessionToDB(session as any);
                } catch {}
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        window.addEventListener('pagehide', handleBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            window.removeEventListener('pagehide', handleBeforeUnload);
        };
    }, [activeTabId, activeEnvId]);

    const updateTab = (tabId: string, fields: Partial<ApiTab>) => {
        if (!tabId) return;
        setTabs(prev => {
            const next = prev.map(t => (t.id === tabId ? { ...t, ...fields } : t));
            tabsRef.current = next;
            return next;
        });
        if (Object.keys(fields).some(key => !TRANSIENT_TAB_FIELDS.has(key))) {
            scheduleSave(tabId);
        }
    };

    // Edits go to the tab that is actually displayed, even if activeTabId still
    // points at a tab that has just been closed or deleted.
    const updateActiveTab = (fields: Partial<ApiTab>) => {
        const targetId = activeTab?.id || activeTabId;
        updateTab(targetId, fields);
    };

    // 2-Way Sync between Query Params and apiPath
    const updateQueryParamsFromPath = (path: string) => {
        if (!activeTab) return;
        const previous = activeTab.paramsList || [];
        // Disabled params are not part of the path; keep them instead of losing them.
        const disabled = previous.filter(p => !p.enabled);
        const qIndex = path.indexOf('?');
        if (qIndex === -1) {
            updateActiveTab({ apiPath: path, paramsList: disabled });
            return;
        }

        const used = new Set<string>();
        const newParams: ParamPair[] = parseQueryString(path.slice(qIndex + 1).split('#')[0]).map(({ key, value }) => {
            const match = previous.find(p => p.enabled && p.key === key && !used.has(p.id));
            if (match) used.add(match.id);
            return { id: match?.id || newId('param'), key, value, enabled: true, description: match?.description };
        });

        updateActiveTab({ apiPath: path, paramsList: [...newParams, ...disabled] });
    };

    const updatePathFromQueryParams = (params: ParamPair[]) => {
        if (!activeTab) return;
        const basePath = activeTab.apiPath.split('?')[0] || '';
        const enabledParams = params.filter(p => p.enabled && p.key.trim() !== '');

        if (enabledParams.length === 0) {
            updateActiveTab({ apiPath: basePath, paramsList: params });
            return;
        }

        // URLSearchParams would encode "{{token}}" as "%7B%7Btoken%7D%7D" and the
        // variable would never be substituted; keep templates literal.
        const query = buildQueryStringKeepingTemplates(enabledParams.map(p => ({ key: p.key.trim(), value: p.value })));
        updateActiveTab({ apiPath: `${basePath}?${query}`, paramsList: params });
    };
    const openSessionAsTab = (req: main.DBRequest) => {
        const existing = tabs.find(t => t.id === req.id);
        if (existing) {
            setActiveTabId(req.id);
            saveSessionState({ activeTabId: req.id });
            return;
        }

        const newTab = createApiTabFromDBRequest(req);
        setTabs(prev => {
            const nextTabs = [...prev, newTab];
            saveSessionState({
                openTabIds: nextTabs.map(t => t.id),
                activeTabId: req.id
            });
            return nextTabs;
        });
        setActiveTabId(req.id);
    };

    const createNewTab = (url = '', method = 'GET') => {
        const projId = projects[0]?.id || 'proj_default';
        createRequest(projId, '', 'Untitled Request', method);
    };

    const closeTab = (id: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        if (tabs.length === 1) return;
        // Persist edits still waiting in the debounce before the tab disappears.
        const pending = saveTimers.current.get(id);
        if (pending) {
            clearTimeout(pending);
            saveTimers.current.delete(id);
            const closing = tabs.find(t => t.id === id);
            if (closing) void saveTabToDB(closing);
        }
        const remainTabs = tabs.filter(t => t.id !== id);
        setTabs(remainTabs);
        let nextActiveId = activeTabId;
        if (activeTabId === id) {
            nextActiveId = remainTabs[remainTabs.length - 1].id;
            setActiveTabId(nextActiveId);
        }
        saveSessionState({
            openTabIds: remainTabs.map(t => t.id),
            activeTabId: nextActiveId
        });
    };

    const reorderTabs = (startIndex: number, endIndex: number) => {
        setTabs(prev => {
            const result = Array.from(prev);
            const [removed] = result.splice(startIndex, 1);
            result.splice(endIndex, 0, removed);
            saveSessionState({
                openTabIds: result.map(t => t.id)
            });
            return result;
        });
    };

    const deleteHistoryItem = async (id: string) => {
        try {
            await DeleteActivityHistoryFromDB(id);
            setHistory(prev => prev.filter(h => h.id !== id));
        } catch (err) {
            console.error("Failed to delete history item:", err);
        }
    };

    const clearHistory = async () => {
        try {
            await ClearActivityHistoryInDB();
            setHistory([]);
        } catch (err) {
            console.error("Failed to clear activity history:", err);
        }
    };

    const openHistoryAsTab = (item: HistoryItem) => {
        // 1. An open tab or saved request whose resolved URL is exactly the
        //    history URL. Partial matches (e.g. an empty path) would open an
        //    unrelated request.
        const existingTab = tabs.find(t => t.method === item.method && buildFullUrl(t) === item.url);
        if (existingTab) {
            setActiveTabId(existingTab.id);
            saveSessionState({ activeTabId: existingTab.id });
            return;
        }
        const matched = dbRequests.find(r => r.method === item.method && buildFullUrl(createApiTabFromDBRequest(r)) === item.url);
        if (matched) {
            openSessionAsTab(matched);
            return;
        }

        // 2. Create a new request & tab from the history item
        let baseUrl = item.url;
        let port = '8080';
        let usePort = false;
        let apiPath = '';
        const paramsList: ParamPair[] = [];

        try {
            const urlObj = new URL(item.url.startsWith('http') ? item.url : `http://${item.url}`);
            baseUrl = `${urlObj.protocol}//${urlObj.hostname.includes(':') ? `[${urlObj.hostname}]` : urlObj.hostname}`;
            if (urlObj.port) {
                port = urlObj.port;
                usePort = true;
            }
            apiPath = urlObj.pathname + urlObj.search;
            parseQueryString(urlObj.search.replace(/^\?/, '')).forEach(({ key, value }) => {
                paramsList.push({ id: newId('param'), key, value, enabled: true });
            });
        } catch {
            baseUrl = item.url;
        }

        const projId = projects[0]?.id || 'proj_default';
        const reqName = `${item.method} ${apiPath || baseUrl}`;
        const newReqId = 'req_' + crypto.randomUUID();

        const newTab: ApiTab = {
            id: newReqId,
            projectId: projId,
            name: reqName,
            method: item.method,
            baseUrl,
            port,
            usePort,
            apiPath,
            paramsList,
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

        void CreateRequestInDB(newReqId, projId, '', reqName, item.method).then(async () => {
            await UpdateRequestInDB(toDBRequest(newTab));
            await refreshWorkspaceData();
        });

        setTabs(prev => {
            const nextTabs = [...prev, newTab];
            saveSessionState({
                openTabIds: nextTabs.map(t => t.id),
                activeTabId: newReqId
            });
            return nextTabs;
        });
        setActiveTabId(newReqId);
    };

    // Removes tabs whose requests no longer exist and moves the active tab to a
    // surviving one, so later edits are not sent to a deleted tab id.
    const dropTabs = (shouldDrop: (t: ApiTab) => boolean) => {
        const remaining = tabsRef.current.filter(t => !shouldDrop(t));
        tabsRef.current.filter(shouldDrop).forEach(t => {
            const timer = saveTimers.current.get(t.id);
            if (timer) clearTimeout(timer);
            saveTimers.current.delete(t.id);
        });
        setTabs(remaining);
        tabsRef.current = remaining;
        const nextActive = remaining.some(t => t.id === activeTabId) ? activeTabId : (remaining[remaining.length - 1]?.id || '');
        if (nextActive !== activeTabId) setActiveTabId(nextActive);
        saveSessionState({ openTabIds: remaining.map(t => t.id), activeTabId: nextActive });
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
        dropTabs(t => t.projectId === id);
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
        // The backend deletes the whole subtree; close the tabs of every
        // request inside it as well.
        const subtree = new Set<string>([id]);
        let grew = true;
        while (grew) {
            grew = false;
            for (const folder of folders) {
                if (folder.parentId && subtree.has(folder.parentId) && !subtree.has(folder.id)) {
                    subtree.add(folder.id);
                    grew = true;
                }
            }
        }
        await DeleteFolderInDB(id);
        dropTabs(t => !!t.folderId && subtree.has(t.folderId));
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
        setTabs(prev => {
            const nextTabs = [...prev, newTab];
            saveSessionState({
                openTabIds: nextTabs.map(t => t.id),
                activeTabId: id
            });
            return nextTabs;
        });
        setActiveTabId(id);
    };

    const renameRequest = async (id: string, name: string) => {
        // Only the name column is written, and only the tab of *this* request
        // is renamed — never whichever tab happens to be active.
        await RenameRequestInDB(id, name);
        setTabs(prev => {
            const next = prev.map(t => (t.id === id ? { ...t, name } : t));
            tabsRef.current = next;
            return next;
        });
        setDbRequests(prev => prev.map(r => (r.id === id ? { ...r, name } : r)));
        await refreshWorkspaceData();
    };

    const deleteRequest = async (id: string) => {
        await DeleteRequestInDB(id);
        dropTabs(t => t.id === id);
        await refreshWorkspaceData();
    };
    const envResolver = (): ((name: string) => string | undefined) => {
        const currentEnv = environments.find(e => e.id === activeEnvId);
        const values = new Map((currentEnv?.variables || [])
            .filter(v => v.enabled && v.key.trim() !== '')
            .map(v => [v.key.trim(), v.value] as [string, string]));
        return (name: string) => values.get(name);
    };

    const parseEnvVariables = (text: string): string => {
        if (!text) return text;
        // Placeholders are captured once instead of compiling user-provided keys as regex.
        return interpolateText(text, envResolver());
    };

    const buildFullUrl = (tab: ApiTab): string => {
        const resolve = envResolver();
        let base = interpolateText(tab.baseUrl?.trim() || '', resolve);
        if (!base.startsWith('http://') && !base.startsWith('https://')) {
            base = 'http://' + base;
        }

        let portPart = '';
        if (tab.usePort && tab.port) {
            portPart = `:${interpolateText(tab.port.trim(), resolve)}`;
        }

        // Variables inside the path/query are encoded for the component they
        // land in, so a value such as "a&role=admin" cannot add parameters.
        let path = tab.apiPath?.trim() || '';
        if (path && !path.startsWith('/') && !path.startsWith('?') && !path.startsWith('{{')) {
            path = '/' + path;
        }
        path = interpolateUrlTemplate(path, resolve);
        if (path && !path.startsWith('/') && !path.startsWith('?')) {
            path = '/' + path;
        }

        let fullUrl = `${base}${portPart}${path}`;
        if (tab.authType === 'apikey' && tab.authConfig?.apiKeyAddTo === 'query' && tab.authConfig.apiKeyName) {
            const key = interpolateText(tab.authConfig.apiKeyName.trim(), resolve);
            const value = interpolateText(tab.authConfig.apiKeyValue?.trim() || '', resolve);
            if (key) {
                const hashIndex = fullUrl.indexOf('#');
                const hash = hashIndex >= 0 ? fullUrl.slice(hashIndex) : '';
                const main = hashIndex >= 0 ? fullUrl.slice(0, hashIndex) : fullUrl;
                const separator = main.includes('?') ? '&' : '?';
                fullUrl = `${main}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}${hash}`;
            }
        }
        return fullUrl;
    };

    const getMappedHeaders = (tab: ApiTab): Record<string, string> => {
        const mappedHeaders: Record<string, string> = {};

        tab.headersList?.filter(h => h.enabled && h.key.trim() !== '').forEach(h => {
            // Case-insensitive: "content-type" and "Content-Type" are one header.
            setHeader(mappedHeaders, parseEnvVariables(h.key.trim()), parseEnvVariables(h.value));
        });

        // Inject Auth (replaces a manual header of the same name, whatever its casing)
        if (tab.authType === 'bearer' && tab.authToken) {
            setHeader(mappedHeaders, 'Authorization', `Bearer ${parseEnvVariables(tab.authToken.trim())}`);
        } else if (tab.authType === 'basic' && (tab.authConfig?.username || tab.authConfig?.password)) {
            const u = parseEnvVariables(tab.authConfig.username?.trim() || '');
            const p = parseEnvVariables(tab.authConfig.password?.trim() || '');
            // UTF-8 aware: btoa() alone throws on characters such as "ậ".
            setHeader(mappedHeaders, 'Authorization', `Basic ${utf8ToBase64(`${u}:${p}`)}`);
        } else if (tab.authType === 'apikey' && (!tab.authConfig?.apiKeyAddTo || tab.authConfig.apiKeyAddTo === 'header') && tab.authConfig?.apiKeyName) {
            const k = parseEnvVariables(tab.authConfig.apiKeyName.trim());
            const v = parseEnvVariables(tab.authConfig.apiKeyValue?.trim() || '');
            if (k) {
                setHeader(mappedHeaders, k, v);
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
        const tabId = activeTab.id;
        try {
            await CancelStreamRequest(tabId);
        } catch (e) {
            console.error("Failed to cancel stream:", e);
        } finally {
            // The backend still sends a final chunk, but the UI must never wait for it.
            updateTab(tabId, { streamingActive: false });
            setLoading(false);
            setTimeout(() => {
                if (stopStreamListenerRef.current) {
                    stopStreamListenerRef.current();
                    stopStreamListenerRef.current = null;
                }
            }, 3000);
        }
    };

    const handleSendRequest = useCallback(async () => {
        if (!activeTab || loading) return;
        const tab = activeTab;
        const tabId = tab.id;
        setLoading(true);
        let streamOwnsLoading = false;

        try {
            updateTab(tabId, { response: null, streamChunks: [], assertionResults: [], streamingActive: tab.isStreaming });

            const finalUrl = buildFullUrl(tab);
            const headers = getMappedHeaders(tab);

            if (tab.bodyType === 'urlencoded' && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
            }

            const payload: core.RequestPayload = {
                method: tab.method,
                url: finalUrl,
                headers,
                body: getProcessedBody(tab),
                bodyType: tab.bodyType
            };

            // Streaming Request Branch
            if (tab.isStreaming) {
                if (stopStreamListenerRef.current) stopStreamListenerRef.current();
                const startTime = Date.now();
                const encoder = new TextEncoder();
                let accumulatedData = '';
                let accumulatedBytes = 0;
                let status: number | undefined;
                let responseHeaders: Record<string, string> | undefined;
                let pending: StreamChunkItem[] = [];
                let flushTimer: ReturnType<typeof setTimeout> | null = null;

                // Chunks are batched (one state update per ~50 ms) and the list
                // is capped, instead of copying the whole array for every chunk.
                const flush = (ended: boolean, error?: string) => {
                    flushTimer = null;
                    const batch = pending;
                    pending = [];
                    const elapsed = Date.now() - startTime;
                    setTabs(prev => prev.map(t => {
                        if (t.id !== tabId) return t;
                        const merged = [...(t.streamChunks || []), ...batch];
                        const streamResponse: any = {
                            status: status ?? t.response?.status ?? 0,
                            statusText: error ? `Stream error: ${error}` : ended ? 'Stream completed' : 'Stream Receiving...',
                            body: accumulatedData,
                            headers: responseHeaders || t.response?.headers || {},
                            responseTimeMs: elapsed,
                            responseSizeByte: accumulatedBytes,
                            timing: { dnsTimeMs: 0, tcpTimeMs: 0, tlsTimeMs: 0, ttfbMs: elapsed, downloadTimeMs: 0, totalTimeMs: elapsed }
                        };
                        return {
                            ...t,
                            streamChunks: merged.length > MAX_STREAM_CHUNKS ? merged.slice(-MAX_STREAM_CHUNKS) : merged,
                            response: streamResponse,
                            streamingActive: !ended
                        };
                    }));
                };

                const cancelStreamEvent = EventsOn('stream:chunk:' + tabId, (chunk: any) => {
                    if (chunk.status) status = chunk.status;
                    if (chunk.headers) responseHeaders = chunk.headers;
                    if (chunk.data) {
                        accumulatedData += chunk.data;
                        accumulatedBytes += encoder.encode(chunk.data).length;
                    }
                    pending.push({
                        index: chunk.index,
                        data: chunk.data,
                        timestamp: new Date().toLocaleTimeString(),
                        isEnd: chunk.isEnd,
                        status: chunk.status
                    });
                    if (chunk.isEnd) {
                        if (flushTimer) clearTimeout(flushTimer);
                        flush(true, chunk.error);
                        setLoading(false);
                        cancelStreamEvent();
                        if (stopStreamListenerRef.current === cancelStreamEvent) stopStreamListenerRef.current = null;
                        return;
                    }
                    if (!flushTimer) flushTimer = setTimeout(() => flush(false), 50);
                });
                stopStreamListenerRef.current = cancelStreamEvent;
                streamOwnsLoading = true;

                try {
                    await ExecuteStreamRequest(tabId, payload);
                } catch (error) {
                    cancelStreamEvent();
                    stopStreamListenerRef.current = null;
                    streamOwnsLoading = false;
                    throw error;
                }
                return;
            }

            // Standard Request Branch
            const result = await ExecuteRequest(payload);

            // Evaluate Assertions
            let assertionResults: StepAssertionResult[] = [];
            if (tab.assertions && tab.assertions.length > 0) {
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
                        if (v.enabled && v.key.trim()) envContext[v.key.trim()] = v.value;
                    });
                }

                assertionResults = tab.assertions
                    .filter(rule => rule.enabled !== false)
                    .map(rule => evaluateAssertion(rule, result, parsedJson, envContext));
            }

            updateTab(tabId, { response: result, assertionResults });

            const now = new Date();
            const newHistory: HistoryItem = {
                id: newId('hist'),
                method: tab.method,
                url: finalUrl,
                status: result.status,
                time: result.responseTimeMs,
                timestamp: now.toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
            };
            setHistory(prev => [newHistory, ...prev].slice(0, 100));
            void SaveActivityHistoryToDB({
                id: newHistory.id,
                method: newHistory.method,
                url: newHistory.url,
                status: newHistory.status,
                duration: newHistory.time,
                timestamp: newHistory.timestamp
            } as any);
        } catch (error: any) {
            console.error(error);
            const message = error?.message || String(error);
            updateTab(tabId, {
                streamingActive: false,
                response: {
                    status: 0,
                    statusText: 'Request Error',
                    body: message,
                    headers: {},
                    responseTimeMs: 0,
                    responseSizeByte: 0,
                    timing: { dnsTimeMs: 0, tcpTimeMs: 0, tlsTimeMs: 0, ttfbMs: 0, downloadTimeMs: 0, totalTimeMs: 0 }
                } as any
            });
        } finally {
            // A stream clears loading itself when its final chunk arrives.
            if (!streamOwnsLoading) setLoading(false);
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

    const exportWorkspace = async (includeSecrets = false): Promise<string> => {
        return await ExportFullWorkspace(includeSecrets);
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
            history, clearHistory, deleteHistoryItem, openHistoryAsTab, saveSessionState,
            loading, concurrency, setConcurrency, totalRequests, setTotalRequests, durationSec, setDurationSec, rampUpSec, setRampUpSec, targetRPS, setTargetRPS, stressResult, stressLoading,
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
