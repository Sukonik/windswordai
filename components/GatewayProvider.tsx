"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createDemoTransport, detectTransport, type GatewaySettings, type GatewayStatus, type Transport } from "@/lib/gateway/client";
import { loadGatewaySettings, loadMode, saveGatewaySettings, saveMode } from "@/lib/gateway/settings";
import type { ExecutionMode, ProviderView } from "@/gateway/src/types";

interface GatewayContextValue {
  status: GatewayStatus;
  transport: Transport;
  mode: ExecutionMode;
  setMode: (mode: ExecutionMode) => void;
  providers: ProviderView[];
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  settings: GatewaySettings;
  saveSettings: (s: GatewaySettings) => Promise<void>;
}

const GatewayContext = createContext<GatewayContextValue | null>(null);

export function useGateway() {
  const ctx = useContext(GatewayContext);
  if (!ctx) throw new Error("useGateway must be used inside <GatewayProvider>");
  return ctx;
}

export function GatewayProvider({ children }: { children: ReactNode }) {
  const [transport, setTransport] = useState<Transport>(() => createDemoTransport());
  const [status, setStatus] = useState<GatewayStatus>({ state: "checking" });
  const [mode, setModeState] = useState<ExecutionMode>("secure_local");
  const [settings, setSettings] = useState<GatewaySettings>({});
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const modeRef = useRef(mode);

  const load = useCallback(async (t: Transport, m: ExecutionMode) => {
    try {
      setProviders(await t.providers(m));
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load providers.");
    } finally {
      setLoading(false);
    }
  }, []);

  const connectTo = useCallback(async (s: GatewaySettings) => {
    setStatus({ state: "checking" });
    const found = await detectTransport(s);
    setTransport(found.transport);
    setStatus(found.status);
    await load(found.transport, modeRef.current);
  }, [load]);

  // Initial detection (once, on the client).
  useEffect(() => {
    const saved = loadGatewaySettings();
    const savedMode = loadMode();
    modeRef.current = savedMode;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating persisted client-only preferences
    setSettings(saved);
    setModeState(savedMode);
    void connectTo(saved);
  }, [connectTo]);

  const setMode = useCallback((next: ExecutionMode) => {
    modeRef.current = next;
    setModeState(next);
    saveMode(next);
    void load(transport, next);
  }, [load, transport]);

  const refresh = useCallback(() => load(transport, modeRef.current), [load, transport]);

  const saveSettings = useCallback(async (s: GatewaySettings) => {
    const clean = { url: s.url?.trim() || undefined, token: s.token?.trim() || undefined };
    setSettings(clean);
    saveGatewaySettings(clean);
    await connectTo(clean);
  }, [connectTo]);

  const value = useMemo(
    () => ({ status, transport, mode, setMode, providers, loading, error, refresh, settings, saveSettings }),
    [status, transport, mode, setMode, providers, loading, error, refresh, settings, saveSettings],
  );
  return <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>;
}
