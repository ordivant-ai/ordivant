import { createHash } from "node:crypto";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { createProvider, type Provider } from "@earendil-works/pi-ai/models";
import type { Api, Model, ProviderStreams } from "@earendil-works/pi-ai";
import type { ConfiguredProvider, ModelSelection } from "./types.js";

export interface ConfiguredModelRegistration {
  providerId: string;
  modelRef: { provider: string; modelId: string };
  actualModelIds: string[];
}

const OUTPUT_TOKEN_FLOOR = 16;

export function registerConfiguredProvider(
  models: { setProvider(provider: Provider): void },
  eventId: string,
  selection: ModelSelection,
  configured: ConfiguredProvider,
): ConfiguredModelRegistration {
  if (configured.id !== selection.provider_id || !configured.api_key || !configured.base_url) {
    throw new Error("Configured provider handoff is incomplete");
  }
  if (!Number.isInteger(selection.max_output_tokens) || selection.max_output_tokens < OUTPUT_TOKEN_FLOOR) {
    throw new Error(`Configured max_output_tokens must be at least ${OUTPUT_TOKEN_FLOOR} for the Responses API`);
  }
  const definition = configured.models.find((model) => model.id === selection.model_id);
  if (!definition || !definition.name || !Number.isInteger(definition.context_window) || definition.context_window < 1 ||
      !Number.isInteger(definition.max_output_tokens) || definition.max_output_tokens < OUTPUT_TOKEN_FLOOR) {
    throw new Error("Selected model is missing valid provider metadata");
  }
  if (!definition.reasoning_efforts.includes(selection.reasoning_effort)) {
    throw new Error("Selected reasoning effort is not supported by the configured model");
  }
  if (selection.max_output_tokens > definition.max_output_tokens) {
    throw new Error("Configured max_output_tokens exceeds the selected model limit");
  }

  const providerId = `ordivant-event-${createHash("sha256").update(eventId).digest("hex").slice(0, 24)}`;
  const actualModelIds: string[] = [];
  const thinkingLevelMap = Object.fromEntries(definition.reasoning_efforts.map((effort) => [effort, effort]));
  const model: Model<"openai-responses"> = {
    id: selection.model_id,
    name: definition.name,
    api: "openai-responses",
    provider: providerId,
    baseUrl: configured.base_url,
    input: ["text"],
    contextWindow: definition.context_window,
    maxTokens: selection.max_output_tokens,
    reasoning: true,
    thinkingLevelMap,
    compat: { sessionAffinityFormat: "openai" },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };

  const responses = openAIResponsesApi();
  const api: ProviderStreams = {
    stream: (requestedModel, context, options) => {
      const onPayload = async (payload: unknown, payloadModel: Model<Api>) => {
        const next = options?.onPayload ? await options.onPayload(payload, payloadModel) : undefined;
        return enforceRequestPolicy(next ?? payload, selection);
      };
      const onProviderStreamEvent = async (event: unknown, eventModel: Model<Api>) => {
        if (event && typeof event === "object" && (event as { type?: unknown }).type === "response.completed") {
          const response = (event as { response?: { model?: unknown } }).response;
          if (typeof response?.model === "string" && response.model) actualModelIds.push(response.model);
        }
        await options?.onProviderStreamEvent?.(event, eventModel);
      };
      return responses.stream(requestedModel, context, {
        ...options,
        maxTokens: selection.max_output_tokens,
        onPayload,
        onProviderStreamEvent,
        reasoningEffort: selection.reasoning_effort,
        maxRetries: 0,
        fetch: (input, init) => fetch(input, { ...init, redirect: "error" }),
      } as Parameters<typeof responses.stream>[2]);
    },
    streamSimple: (requestedModel, context, options) => {
      const onPayload = async (payload: unknown, payloadModel: Model<Api>) => {
        const next = options?.onPayload ? await options.onPayload(payload, payloadModel) : undefined;
        return enforceRequestPolicy(next ?? payload, selection);
      };
      const onProviderStreamEvent = async (event: unknown, eventModel: Model<Api>) => {
        if (event && typeof event === "object" && (event as { type?: unknown }).type === "response.completed") {
          const response = (event as { response?: { model?: unknown } }).response;
          if (typeof response?.model === "string" && response.model) actualModelIds.push(response.model);
        }
        await options?.onProviderStreamEvent?.(event, eventModel);
      };
      return responses.streamSimple(requestedModel, context, {
        ...options,
        maxTokens: selection.max_output_tokens,
        reasoning: selection.reasoning_effort,
        onPayload,
        onProviderStreamEvent,
        maxRetries: 0,
        fetch: (input, init) => fetch(input, { ...init, redirect: "error" }),
      });
    },
  };

  const provider = createProvider({
    id: providerId,
    name: configured.name,
    baseUrl: configured.base_url,
    auth: {
      apiKey: {
        name: "Ordivant configured provider key",
        resolve: async () => ({ auth: { apiKey: configured.api_key } }),
      },
    },
    models: [model],
    api,
  });
  models.setProvider(provider);
  return { providerId, modelRef: { provider: providerId, modelId: selection.model_id }, actualModelIds };
}

function enforceRequestPolicy(payload: unknown, selection: ModelSelection): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Responses adapter produced an invalid request body");
  }
  const body = payload as Record<string, unknown>;
  const reasoning = body.reasoning && typeof body.reasoning === "object" && !Array.isArray(body.reasoning)
    ? body.reasoning as Record<string, unknown>
    : {};
  return {
    ...body,
    model: selection.model_id,
    store: false,
    max_output_tokens: selection.max_output_tokens,
    reasoning: { ...reasoning, effort: selection.reasoning_effort },
  };
}
