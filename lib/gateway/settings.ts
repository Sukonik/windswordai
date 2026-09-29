import type { ExecutionMode } from "../../gateway/src/types.ts";
import type { GatewaySettings } from "./client.ts";

const KEY = "windsword-gateway";
const MODE_KEY = "windsword-mode";
const CHOICE_KEY = "windsword-choice";

function read<T>(key: string): T | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}
function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be blocked; state still works for this session */
  }
}

/** Only the gateway URL and gateway token live in the browser. Provider API keys never do. */
export const loadGatewaySettings = (): GatewaySettings => read<GatewaySettings>(KEY) ?? {};
export const saveGatewaySettings = (s: GatewaySettings) => write(KEY, s);
export const loadMode = (): ExecutionMode => (read<ExecutionMode>(MODE_KEY) === "standard" ? "standard" : "secure_local");
export const saveMode = (m: ExecutionMode) => write(MODE_KEY, m);
export const loadChoice = () => read<{ providerId: string; model: string }>(CHOICE_KEY);
export const saveChoice = (c: { providerId: string; model: string }) => write(CHOICE_KEY, c);
