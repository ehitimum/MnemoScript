import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ApiKeyProvider, CliStatus, KeyStatus } from './types';
import { parseCliUsage, summarizeUsage, type CliUsageReport, type ProviderUsage } from './usage';

export interface CliUsageState {
  report?: CliUsageReport;
  error?: string;
  /** Epoch ms of the last successful or failed fetch. */
  at: number;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * State for Settings → AI (app-wide, not per project): Claude Code account + plan limits, API key
 * status, and what MnemoScript used on this device. Phones skip everything CLI-related.
 */
export function useAiSettings(isMobile: boolean) {
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [keys, setKeys] = useState<KeyStatus | null>(null);
  const [usage, setUsage] = useState<CliUsageState | null>(null);
  const [local, setLocal] = useState<ProviderUsage[]>(() => summarizeUsage());
  const [refreshing, setRefreshing] = useState(false);

  const loadKeys = useCallback(
    () => api.aiKeyStatus().then(setKeys).catch(() => setKeys({ anthropic: false, openai: false, gemini: false })),
    [],
  );

  /** Status first; the usage report only when signed in (it needs the CLI's own sign-in). */
  const loadCli = useCallback(
    (): Promise<void> =>
      isMobile
        ? Promise.resolve()
        : api
            .aiCliStatus()
            .catch((): CliStatus => ({ installed: false, loggedIn: false }))
            .then((status) => {
              setCli(status);
              if (!status.installed || !status.loggedIn) return;
              return api
                .aiCliUsage()
                .then((r) => setUsage({ report: parseCliUsage(r.text), at: Date.now() }))
                .catch((e: unknown) => setUsage({ error: message(e), at: Date.now() }));
            }),
    [isMobile],
  );

  useEffect(() => {
    void loadKeys();
    void loadCli();
  }, [loadKeys, loadCli]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setLocal(summarizeUsage());
    void Promise.all([loadKeys(), loadCli()]).finally(() => setRefreshing(false));
  }, [loadKeys, loadCli]);

  const saveKey = useCallback(
    async (p: ApiKeyProvider, key: string) => {
      await api.aiSetApiKey(p, key);
      await loadKeys();
    },
    [loadKeys],
  );
  const clearKey = useCallback(
    async (p: ApiKeyProvider) => {
      await api.aiClearApiKey(p);
      await loadKeys();
    },
    [loadKeys],
  );

  return { cli, keys, usage, local, refreshing, refresh, saveKey, clearKey };
}

export type AiSettingsState = ReturnType<typeof useAiSettings>;
