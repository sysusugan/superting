const LOCAL_TOOL_MIN_PARAMS_B = 4;
const TOOL_CAPABLE_CLOUD_PROVIDERS = new Set(["openai", "groq", "custom", "anthropic", "gemini"]);

export interface ChatToolSupportInput {
  isCloudAgent: boolean;
  chatAgentProvider: string;
  chatAgentModel: string;
}

export function estimateModelSizeB(modelId: string): number {
  const match = modelId.match(/-([\d.]+)[bB]/);
  return match ? parseFloat(match[1]) : 0;
}

export function isLocalChatProvider(provider: string): boolean {
  return !TOOL_CAPABLE_CLOUD_PROVIDERS.has(provider);
}

export function shouldEnableChatTools({
  isCloudAgent,
  chatAgentProvider,
  chatAgentModel,
}: ChatToolSupportInput): boolean {
  const isLocalProvider = isLocalChatProvider(chatAgentProvider);
  const localModelCanUseTool =
    isLocalProvider && estimateModelSizeB(chatAgentModel) >= LOCAL_TOOL_MIN_PARAMS_B;

  return isCloudAgent || !isLocalProvider || localModelCanUseTool;
}
