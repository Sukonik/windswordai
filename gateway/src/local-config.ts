import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SecretStore } from "./stores.ts";

interface LocalConfigFile {
  version: 1;
  googleClientId?: string;
  /** Reference into the encrypted vault; the raw secret is never in this file. */
  googleClientSecretRef?: string;
  authRequired?: boolean;
}

/**
 * Settings entered through the local setup page. The Google client secret goes into the encrypted vault
 * (AES-256-GCM); this file holds only the public client id, the vault reference and the sign-in switch.
 */
export class LocalConfig {
  private path: string;
  private secrets: SecretStore;
  constructor(dir: string, secrets: SecretStore) {
    this.path = join(dir, "local-config.json");
    this.secrets = secrets;
  }

  private read(): LocalConfigFile {
    try {
      return existsSync(this.path) ? (JSON.parse(readFileSync(this.path, "utf8")) as LocalConfigFile) : { version: 1 };
    } catch {
      return { version: 1 };
    }
  }

  private write(file: LocalConfigFile) {
    writeFileSync(this.path, JSON.stringify(file, null, 2), { mode: 0o600 });
  }

  get authRequired() {
    return this.read().authRequired === true;
  }

  get googleClientId() {
    return this.read().googleClientId;
  }

  async googleClientSecret(): Promise<string | undefined> {
    const ref = this.read().googleClientSecretRef;
    if (!ref) return undefined;
    try { return await this.secrets.get(ref); } catch { return undefined; }
  }

  async saveGoogle(input: { clientId: string; clientSecret?: string; authRequired: boolean }) {
    const file = this.read();
    file.googleClientId = input.clientId;
    if (input.clientSecret) {
      const previous = file.googleClientSecretRef;
      file.googleClientSecretRef = await this.secrets.put(input.clientSecret);
      if (previous) await this.secrets.delete(previous);
    }
    file.authRequired = input.authRequired;
    this.write(file);
  }

  async clearGoogle() {
    const file = this.read();
    if (file.googleClientSecretRef) await this.secrets.delete(file.googleClientSecretRef);
    delete file.googleClientSecretRef;
    delete file.googleClientId;
    file.authRequired = false;
    this.write(file);
  }
}
