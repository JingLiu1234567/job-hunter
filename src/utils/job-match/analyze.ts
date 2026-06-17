import type { Config } from "@/types/config/config"
import { storage } from "#imports"
import { isLLMProvider } from "@/types/config/provider"
import { CONFIG_STORAGE_KEY } from "@/utils/constants/config"
import { sendMessage } from "@/utils/message"

export type ReqType = "must" | "nice"
export type Met = "yes" | "no" | "unclear"
export type Verdict = "recommend" | "maybe" | "skip"

export interface RequirementMatch {
  /** 要求点，简洁中文 */
  text: string
  /** 必须 / 加分 */
  type: ReqType
  /** 简历是否满足 */
  met: Met
  /** 一句话依据或缺口 */
  note?: string
}

export interface MatchResult {
  requirements: RequirementMatch[]
  /** 由规则算出：🟢 recommend / 🟡 maybe / 🔴 skip */
  verdict: Verdict
  /** 一句话建议（投不投 + 为什么），由清单规则生成，保证与逐条结果一致 */
  recommendation: string
}

const THINK_TAG_RE = /<\/think>([\s\S]*)/

function extractJson(raw: string): string {
  const [, afterThink = raw] = raw.match(THINK_TAG_RE) || []
  const start = afterThink.indexOf("{")
  const end = afterThink.lastIndexOf("}")
  if (start === -1 || end === -1 || end < start) {
    throw new Error("模型未返回有效的 JSON")
  }
  return afterThink.slice(start, end + 1)
}

// ---- Step 1: 只看 JD，客观抽取要求（不看简历，避免偏向已匹配项）----
const EXTRACT_SYSTEM = `你是招聘要求分析专家。请从职位描述(JD)中**穷尽地、忠实地**提取对候选人的要求，按下面三类来源全部覆盖，不要遗漏：

A. 显式要求段（标题常见：Minimum Qualifications / Requirements / Qualifications / Basic Qualifications / What you'll need / Who you are 等）：把这一段里**每一条都列出来**，标为 must（除非该段写明是 preferred）。
B. 隐含要求：从 Responsibilities / Position Overview / About the role 等背景段落里，提炼出隐含的能力或经验要求，也标为 must。
C. 加分项（标题常见：Preferred Qualifications / Nice to have / Bonus）：标为 nice。

铁律：
1. 忠实保留具体信息——年限（如"3年以上"）、学历及专业（如"本科，计算机/数据科学等相关专业"）、技术/工具/证书/语言名。**禁止**概括成"具有X方面的扎实背景"这类笼统说法。
2. 一个要点对应一条。"3年以上 applied AI / automation / 等领域经验"是**一条**"3年以上相关领域经验"，**不要**拆成多条笼统"背景"。
3. 宁可多列、绝不漏抽，尤其 A 段每一条都必须在。

只看 JD，不分析任何候选人。每条用简洁中文但保留关键数字/学历/专业/技术名。只输出 JSON，不要多余文字、不要代码块：
{"requirements":[{"text":"要求点","type":"must"或"nice"}]}`

// ---- Step 2: 拿要求逐条比简历，严格诚实，不许抬分 ----
const MATCH_SYSTEM = `你是严格、诚实的求职匹配助手，绝不为了讨好用户而抬高匹配度。
给你一份【候选人简历】和一组【职位要求】。逐条判断简历是否满足每条要求：
- "yes"：简历有明确证据
- "no"：简历明显不具备
- "unclear"：简历没提到、无法确认
宁可保守：没有明确证据就不要给 yes。每条给一句很短的中文 note（符合的依据，或缺了什么）。
保持要求的条数、文字、type 与输入一致。只输出 JSON，不要多余文字、不要代码块：
{"matches":[{"text":"要求点","type":"must"或"nice","met":"yes"或"no"或"unclear","note":"很短的说明"}]}`

async function callLLM(providerId: string, system: string, prompt: string): Promise<string> {
  const { text } = await sendMessage("backgroundGenerateText", {
    providerId,
    system,
    prompt,
    temperature: 0,
    maxRetries: 1,
  })
  return text
}

/** 把逐条匹配结果汇成 🟢🟡🔴 结论 + 一句话建议（透明规则，与清单一致）。 */
function decide(reqs: RequirementMatch[]): { verdict: Verdict, recommendation: string } {
  const musts = reqs.filter(r => r.type === "must")
  const mustMissing = musts.filter(r => r.met === "no").map(r => r.text)
  const mustUnclear = musts.filter(r => r.met === "unclear").map(r => r.text)
  const niceMissing = reqs.filter(r => r.type === "nice" && r.met !== "yes").map(r => r.text)

  if (mustMissing.length > 0) {
    return {
      verdict: "skip",
      recommendation: `不建议投：你不满足硬性要求 ——「${mustMissing.join("、")}」`,
    }
  }
  if (mustUnclear.length > 0) {
    return {
      verdict: "maybe",
      recommendation: `可以考虑：硬性要求大体满足，但这些简历没体现 ——「${mustUnclear.join("、")}」，投前最好补上`,
    }
  }
  if (niceMissing.length > 0) {
    return {
      verdict: "recommend",
      recommendation: `值得投：硬性要求都匹配，缺的只是加分项（${niceMissing.join("、")}），不影响`,
    }
  }
  return { verdict: "recommend", recommendation: "值得投：要求基本都匹配" }
}

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

  // 选一个填了 API Key 的 LLM（跳过空的 OpenAI 占位、跳过微软/谷歌纯翻译）。
  function hasApiKey(p: Config["providersConfig"][number]): boolean {
    const key = (p as { apiKey?: unknown }).apiKey
    return typeof key === "string" && key.trim().length > 0
  }
  const providers = config.providersConfig
  const llmWithKey = providers.filter(p => isLLMProvider(p.provider) && hasApiKey(p))
  const providerId
    = llmWithKey.find(p => p.enabled)?.id
      ?? llmWithKey[0]?.id
      ?? providers.find(p => p.provider === "ollama" && p.enabled)?.id
  if (!providerId) {
    throw new Error("没找到已填 API Key 的大模型(LLM)。请在插件设置里给 DeepSeek 填好 API Key 并启用")
  }

  // Step 1：抽取 JD 要求（只看 JD）
  const extractRaw = await callLLM(providerId, EXTRACT_SYSTEM, `【职位描述 JD】\n${jd}`)
  const { requirements: rawReqs = [] } = JSON.parse(extractJson(extractRaw)) as {
    requirements?: { text?: string, type?: string }[]
  }
  const requirements = rawReqs
    .filter(r => r.text)
    .map(r => ({ text: r.text as string, type: (r.type === "nice" ? "nice" : "must") as ReqType }))
  if (requirements.length === 0) {
    const preview = jd.replace(/\s+/g, " ").slice(0, 80)
    throw new Error(`没能解析出职位要求（抓到正文约 ${jd.length} 字，开头：「${preview}…」）。确认在职位详情页再试`)
  }

  // Step 2：逐条比对简历
  const matchRaw = await callLLM(
    providerId,
    MATCH_SYSTEM,
    `【候选人简历】\n${resume}\n\n【职位要求】\n${JSON.stringify(requirements, null, 2)}`,
  )
  const { matches: rawMatches = [] } = JSON.parse(extractJson(matchRaw)) as {
    matches?: { text?: string, type?: string, met?: string, note?: string }[]
  }
  const validMet = new Set(["yes", "no", "unclear"])
  const matched: RequirementMatch[] = rawMatches
    .filter(m => m.text)
    .map(m => ({
      text: m.text as string,
      type: (m.type === "nice" ? "nice" : "must") as ReqType,
      met: (validMet.has(m.met ?? "") ? m.met : "unclear") as Met,
      note: m.note,
    }))

  // must 排在前面，方便用户先看硬要求
  matched.sort((a, b) => (a.type === b.type ? 0 : a.type === "must" ? -1 : 1))

  const { verdict, recommendation } = decide(matched)
  return { requirements: matched, verdict, recommendation }
}
