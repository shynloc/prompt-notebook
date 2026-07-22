import { OpenAiCompatibleAdapter } from "./providers/openai-compatible";
import type { AiProviderAdapter, AiProviderType } from "./types";

export class AiProviderRegistry {
  private readonly adapters: Map<AiProviderType, AiProviderAdapter>;

  constructor(adapters: AiProviderAdapter[] = [new OpenAiCompatibleAdapter()]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.type, adapter]));
  }

  get(type: AiProviderType) {
    const adapter = this.adapters.get(type);
    if (!adapter) throw new Error(`Unsupported AI provider type: ${type}`);
    return adapter;
  }
}
