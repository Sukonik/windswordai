import type { ProviderAdapter, ProviderDescriptor } from "./types.ts";

/** Runtime provider registry. Register, re-order or disable providers without touching Chat. */
export class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): this {
    if (this.adapters.has(adapter.descriptor.id)) {
      throw new Error(`Provider already registered: ${adapter.descriptor.id}`);
    }
    this.adapters.set(adapter.descriptor.id, adapter);
    return this;
  }

  unregister(id: string): boolean {
    return this.adapters.delete(id);
  }

  get(id: string): ProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  descriptor(id: string): ProviderDescriptor | undefined {
    return this.adapters.get(id)?.descriptor;
  }

  setEnabled(id: string, enabled: boolean): void {
    const adapter = this.adapters.get(id);
    if (adapter) adapter.descriptor = { ...adapter.descriptor, enabled };
  }

  setOrder(id: string, order: number): void {
    const adapter = this.adapters.get(id);
    if (adapter) adapter.descriptor = { ...adapter.descriptor, order };
  }

  list(): ProviderAdapter[] {
    return [...this.adapters.values()].sort((a, b) => a.descriptor.order - b.descriptor.order);
  }
}
