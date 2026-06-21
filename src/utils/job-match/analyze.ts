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
  /** 仅含硬性、可核实的要求（参与评分） */
  requirements: RequirementMatch[]
  /** 软性、不可核实的要求（仅展示，不计入评分） */
  softRequirements: string[]
  /** 由规则算出：🟢 recommend / 🟡 maybe / 🔴 skip */
  verdict: Verdict
  /** 一句话建议（投不投 + 为什么），由清单规则生成，保证与逐条结果一致 */
  recommendation: string
  /** JD 是否明示"不必满足全部要求"（前端醒目提示用） */
  flexible: boolean
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
const EXTRACT_SYSTEM = `你是招聘要求分析专家。请从职位描述(JD)中提取**对候选人的资格要求**（候选人需要"具备"什么），分两类：

- "must"：硬性资格。常见段落标题（写法多样，按含义识别，不要死抠字面）：Minimum/Basic/Required Qualifications、Qualifications、Requirements、Required Skills、What you'll need、What you bring、Who you are、About you、Skills & Experience、Must have、Essential、We're looking for、任职要求、岗位要求 等。**逐条**提取。
- "nice"：加分项。常见标题：Preferred Qualifications、Nice to have、Nice-to-haves、Bonus、Bonus points、A plus、Plus、Desirable、Good to have、Advantageous、Ideally、Even better、加分项、优先 等。**逐条**提取。

关键区分（很重要）：
- 按**功能**判断，不要死抠标题文字：凡是"候选人需要具备/最好具备的条件"就是资格要求；标题怎么写都算。
- **只提取"候选人需要具备的资格"**：学历、年限、技能、工具、经验、证书、语言等。
- **绝不要**把 "Responsibilities / 工作职责 / 你将要做什么(will / responsible for / 动词开头的职责句)" 当成要求——那是岗位职责，不是对候选人的资格，一律忽略。
- 只有当 JD 完全没有任何资格段落时，才从全文推断候选人必须具备的硬性条件。
- 如果 JD 没有 Preferred / 加分 段落，就**不要硬造 nice**；**忽略** LinkedIn 自动生成的 "Desired Skills and Experience" 之类的关键词标签，那不是真正的加分段落。

另外，**每一条（无论 must 还是 nice）都要标 soft（true / false）**——区分"可核实的硬条件"和"无法核实的软素质"。判据：**这条能不能在简历里用具体证据核实？**
- soft=false（硬，可核实）：具体技能/工具/技术（SQL、Python、Azure）、年限、学历专业、特定领域经验、特定方法论、证书、语言。
- soft=true（软，简历几乎无法证明）：诚实、细心/注意细节、独立工作、责任心、抗压、遵循指南、是否使用某类工具（如"不使用AI写作工具"）、泛泛的"沟通能力/分析能力/批判性思维"等通用素质或态度。

铁律：
1. 忠实保留具体信息——年限（如"3年以上"）、学历及专业、技术/工具/证书/语言名。**禁止**概括成"具有X方面的扎实背景"。
2. 一个要点对应一条，保留关键数字/学历/专业/技术名。
3. 资格段落里每一条都要在，别漏。

只看 JD，不分析候选人。每条用简洁中文。只输出 JSON，不要多余文字、不要代码块：
{"requirements":[{"text":"要求点","type":"must"或"nice","soft":true或false}]}`

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

// JD 是否明示"不必满足全部要求"（命中则放宽结论门槛）。
const FLEXIBLE_PATTERNS = [
  "don't tick every box",
  "dont tick every box",
  "don't have all",
  "dont have all",
  "don't meet every",
  "dont meet every",
  "even if you don't",
  "even if you dont",
  "still love to hear",
  "encouraged to apply",
  "you don't need to meet",
  "good fit",
  "don't worry if",
]

function jdIsFlexible(jd: string): boolean {
  const lower = jd.toLowerCase()
  return FLEXIBLE_PATTERNS.some(p => lower.includes(p))
}

/**
 * must 主导的结论规则：
 * - must 全满足 → 🟢（不看 nice）
 * - must 满足 ≤ 一半 → 🔴（不看 nice）
 * - must 超过一半但未全满足 → 中间档：仅当 nice 满足 ≥70% 才升 🟢，否则 🟡
 */
function decide(reqs: RequirementMatch[]): { verdict: Verdict, recommendation: string } {
  const musts = reqs.filter(r => r.type === "must")
  const nices = reqs.filter(r => r.type === "nice")
  const mustTotal = musts.length
  const mustMet = musts.filter(r => r.met === "yes").length
  const niceTotal = nices.length
  const niceMet = nices.filter(r => r.met === "yes").length
  const missing = musts.filter(r => r.met !== "yes").map(r => r.text)

  const mustRatio = mustTotal === 0 ? 1 : mustMet / mustTotal

  let verdict: Verdict
  if (mustRatio >= 1) {
    verdict = "recommend"
  }
  else if (mustRatio <= 0.5) {
    verdict = "skip"
  }
  else {
    // 中间档：仅当存在加分项且满足度 ≥70% 时升绿
    const niceLift = niceTotal > 0 && niceMet / niceTotal >= 0.7
    verdict = niceLift ? "recommend" : "maybe"
  }

  let recommendation: string
  if (verdict === "recommend") {
    recommendation = missing.length === 0
      ? `值得投：硬性要求全部满足（${mustMet}/${mustTotal}）`
      : `值得投：硬性要求满足 ${mustMet}/${mustTotal}，加分项满足度高，仅差「${missing.join("、")}」`
  }
  else if (verdict === "maybe") {
    recommendation = `可以考虑：硬性要求满足 ${mustMet}/${mustTotal}，欠缺「${missing.join("、")}」，投前最好补强`
  }
  else {
    recommendation = `不建议投：硬性要求只满足 ${mustMet}/${mustTotal}，差距较大`
  }

  return { verdict, recommendation }
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

  // Step 1：抽取 JD 要求 + 标注 soft/hard（只看 JD）
  const extractRaw = await callLLM(providerId, EXTRACT_SYSTEM, `【职位描述 JD】\n${jd}`)
  const { requirements: rawReqs = [] } = JSON.parse(extractJson(extractRaw)) as {
    requirements?: { text?: string, type?: string, soft?: boolean }[]
  }
  const allReqs = rawReqs
    .filter(r => r.text)
    .map(r => ({
      text: r.text as string,
      type: (r.type === "nice" ? "nice" : "must") as ReqType,
      soft: r.soft === true,
    }))
  if (allReqs.length === 0) {
    const preview = jd.replace(/\s+/g, " ").slice(0, 80)
    throw new Error(`没能解析出职位要求（抓到正文约 ${jd.length} 字，开头：「${preview}…」）。确认在职位详情页再试`)
  }

  // 只对"硬性、可核实"的要求评分；软性的单独展示、不计分
  const hardReqs = allReqs.filter(r => !r.soft)
  const softRequirements = allReqs.filter(r => r.soft).map(r => r.text)
  const flexible = jdIsFlexible(jd)

  // 去掉软性后几乎没有硬性要求（如纯软素质的众包帖）：不强判，给中性提示
  if (hardReqs.length === 0) {
    return {
      requirements: [],
      softRequirements,
      verdict: "maybe",
      recommendation: "该职位没有可量化的硬性要求，主要看软素质与态度，请结合自身情况判断",
      flexible,
    }
  }

  // Step 2：逐条比对简历（只比硬性要求）
  const matchRaw = await callLLM(
    providerId,
    MATCH_SYSTEM,
    `【候选人简历】\n${resume}\n\n【职位要求】\n${JSON.stringify(hardReqs.map(({ text, type }) => ({ text, type })), null, 2)}`,
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

  if (matched.length === 0) {
    throw new Error("匹配结果为空，请重试（模型可能未正确返回）")
  }

  // must 排在前面，方便用户先看硬要求
  matched.sort((a, b) => (a.type === b.type ? 0 : a.type === "must" ? -1 : 1))

  const { verdict, recommendation } = decide(matched)
  return { requirements: matched, softRequirements, verdict, recommendation, flexible }
}
