import type { Config } from "@/types/config/config"
import { storage } from "#imports"
import { isLLMProvider } from "@/types/config/provider"
import { CONFIG_STORAGE_KEY } from "@/utils/constants/config"
import { sendMessage } from "@/utils/message"

export interface MatchResult {
  /** 0–100 匹配度 */
  score: number
  /** 一个词的结论 */
  verdict: "值得投" | "可投" | "谨慎" | "跳过"
  /** 你符合的点（最多 3 条） */
  matched: string[]
  /** 你欠缺的点（最多 3 条） */
  gaps: string[]
  /** 一句话建议 */
  summary: string
}

const THINK_TAG_RE = /<\/think>([\s\S]*)/

/** 从模型输出里抽出 JSON（容忍 <think> 标签和前后多余文字）。 */
function extractJson(raw: string): string {
  const [, afterThink = raw] = raw.match(THINK_TAG_RE) || []
  const start = afterThink.indexOf("{")
  const end = afterThink.lastIndexOf("}")
  if (start === -1 || end === -1 || end < start) {
    throw new Error("模型未返回有效的 JSON")
  }
  return afterThink.slice(start, end + 1)
}

const SYSTEM_PROMPT = `你是一名资深招聘顾问，帮助中文母语的求职者快速判断自己与某个英文职位的匹配度。
你会拿到「求职者简历」和「职位描述(JD)」。请先提炼简历里的能力点，再提炼 JD 的硬性要求，然后对比两者判断匹配度。

只输出一个 JSON 对象，不要任何额外文字、不要 Markdown 代码块，格式严格如下：
{
  "score": 0到100的整数,
  "verdict": "值得投" 或 "可投" 或 "谨慎" 或 "跳过",
  "matched": ["你符合的点，简短中文，最多3条"],
  "gaps": ["你欠缺的点，简短中文，最多3条"],
  "summary": "一句话中文建议，说明要不要投、怎么补短板"
}
要求：所有文字用简体中文；matched 与 gaps 各最多 3 条，每条不超过 15 字；评分客观，缺核心硬技能要扣分。`

/**
 * 用用户已配置的翻译 LLM（如 DeepSeek）做"简历 × JD"匹配分析。
 * 复用 Read Frog 的 provider 配置，不引入新的 key。
 */
export async function analyzeMatch(resume: string, jd: string): Promise<MatchResult> {
  if (!resume.trim()) {
    throw new Error("还没保存简历，请先在插件下拉框里粘贴并保存简历")
  }
  if (!jd.trim()) {
    throw new Error("没抓到职位描述，请打开一个职位详情页再试")
  }

  const config = await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`)
  if (!config) {
    throw new Error("插件配置未找到，请先在设置里配置 LLM 服务商")
  }

  // 匹配分析必须用大模型(LLM)，不能用微软/谷歌这类纯翻译服务，
  // 也要跳过没填 API Key 的占位（如 Read Frog 自带的空 OpenAI）。
  function hasApiKey(p: Config["providersConfig"][number]): boolean {
    const key = (p as { apiKey?: unknown }).apiKey
    return typeof key === "string" && key.trim().length > 0
  }

  const providers = config.providersConfig
  const llmWithKey = providers.filter(p => isLLMProvider(p.provider) && hasApiKey(p))
  // 优先已启用且有 key 的；其次有 key 但未启用的；最后本地 Ollama（无需 key）。
  const providerId
    = llmWithKey.find(p => p.enabled)?.id
      ?? llmWithKey[0]?.id
      ?? providers.find(p => p.provider === "ollama" && p.enabled)?.id

  if (!providerId) {
    throw new Error("没找到已填 API Key 的大模型(LLM)。请在插件设置里给 DeepSeek 填好 API Key 并启用")
  }

  // 走后台代理跑 LLM（复用 Read Frog 的 backgroundGenerateText，天然避开内容脚本的跨域限制）
  const { text } = await sendMessage("backgroundGenerateText", {
    providerId,
    system: SYSTEM_PROMPT,
    prompt: `【求职者简历】\n${resume}\n\n【职位描述 JD】\n${jd}`,
    temperature: 0,
    maxRetries: 1,
  })

  const parsed = JSON.parse(extractJson(text)) as Partial<MatchResult>

  return {
    score: Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0))),
    verdict: parsed.verdict ?? "谨慎",
    matched: (parsed.matched ?? []).slice(0, 3),
    gaps: (parsed.gaps ?? []).slice(0, 3),
    summary: parsed.summary ?? "",
  }
}
