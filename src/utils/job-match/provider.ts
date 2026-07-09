import type { Config } from "@/types/config/config"
import { storage } from "#imports"
import { isLLMProvider } from "@/types/config/provider"
import { CONFIG_STORAGE_KEY } from "@/utils/constants/config"

export interface PickedLLMProvider {
  id: string
  /** 用户在设置里给这个 provider 起的名字（如 "Claude"、"DeepSeek"），聊天面板拿来指名道姓。 */
  name: string
}

/**
 * 选一个填了 API Key 的 LLM（跳过空的 OpenAI 占位、跳过微软/谷歌纯翻译）。
 * 匹配度分析和 AI 聊天面板共用这套挑选逻辑，避免各自维护一份。
 */
export async function pickLLMProvider(): Promise<PickedLLMProvider | undefined> {
  const config = await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`)
  if (!config)
    return undefined

  function hasApiKey(p: Config["providersConfig"][number]): boolean {
    const key = (p as { apiKey?: unknown }).apiKey
    return typeof key === "string" && key.trim().length > 0
  }
  const providers = config.providersConfig
  const llmWithKey = providers.filter(p => isLLMProvider(p.provider) && hasApiKey(p))
  const picked
    = llmWithKey.find(p => p.enabled)
      ?? llmWithKey[0]
      ?? providers.find(p => p.provider === "ollama" && p.enabled)
  return picked ? { id: picked.id, name: picked.name } : undefined
}

export async function pickLLMProviderId(): Promise<string | undefined> {
  return (await pickLLMProvider())?.id
}
