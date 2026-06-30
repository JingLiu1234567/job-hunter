import type { Config } from "@/types/config/config"
import { browser, i18n, storage } from "#imports"
import { isLLMProvider } from "@/types/config/provider"
import { CONFIG_STORAGE_KEY } from "@/utils/constants/config"
import { sendMessage } from "@/utils/message"

/** 跟随浏览器界面语言，决定 LLM 用什么语言输出分析结果。 */
function outputLanguageName(): string {
  const code = browser.i18n.getUILanguage().toLowerCase()
  if (code.startsWith("ja"))
    return "日本語"
  if (code.startsWith("ko"))
    return "한국어"
  if (code.startsWith("zh"))
    return "简体中文"
  return "English"
}

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
  /** 硬否决项：缺了它基本一票否决（语言/工签/法定证照/明确 required 的核心硬技能）。未满足直接 🔴 */
  veto?: boolean
}

/** 散落在 Requirements 之外、其它板块里的"其他要求"——仅展示，不计入评分。 */
export interface ImplicitRequirement {
  /** 这条来自 JD 的哪个板块（用 JD 原文里的板块标题，逐字、原文语言） */
  section: string
  /** 把信号翻译成候选人能对照自己的具体说法（输出语言） */
  text: string
  /** JD 原文逐字引用，保持原文语言；用于后续网页定位 */
  quote: string
  /** 一句话说明为什么这也是个要求（输出语言） */
  why: string
  /** quote 能否在 JD 原文里精确定位（决定下一轮能否点击高亮） */
  located: boolean
}

export interface MatchResult {
  /** 仅含硬性、可核实的要求（参与评分） */
  requirements: RequirementMatch[]
  /** 软性、不可核实的要求（仅展示，不计入评分） */
  softRequirements: string[]
  /** 藏在职责/文化等处的隐形要求（仅展示，不计入评分） */
  implicit: ImplicitRequirement[]
  /** 由规则算出：🟢 recommend / 🟡 maybe / 🔴 skip */
  verdict: Verdict
  /** 一句话建议（投不投 + 为什么），由清单规则生成，保证与逐条结果一致 */
  recommendation: string
  /** JD 是否明示"不必满足全部要求"（前端醒目提示用） */
  flexible: boolean
}

const THINK_TAG_RE = /<\/think>([\s\S]*)/

/**
 * 通用分隔符解析：每条记录由若干 `FIELD: 值` 行组成，记录间以单独一行 `---` 分隔。
 * 比 JSON 健壮——值里出现引号、逗号、换行都不会破坏解析（LLM 在值里写 "freelance"
 * 这类未转义引号会把 JSON 撑破，这里完全不受影响）。
 * 块边界：遇到 `---`，或遇到一个"当前块已填过"的字段时开启新块——
 * 即使模型漏字段或忘了写 `---` 也能正确切分。字段名大小写不敏感。
 */
function parseDelimitedBlocks(raw: string, fields: readonly string[]): Record<string, string>[] {
  const [, body = raw] = raw.match(THINK_TAG_RE) || []
  const labelRe = new RegExp(`^\\s*(${fields.join("|")})\\s*[:：]\\s*(.*)$`, "i")
  const items: Record<string, string>[] = []
  let cur: Record<string, string> | null = null
  let field: string | null = null

  const flush = () => {
    if (cur && Object.keys(cur).length > 0)
      items.push(cur)
    cur = null
    field = null
  }

  for (const line of body.split(/\r?\n/)) {
    const label = line.match(labelRe)
    if (label) {
      const key = label[1].toLowerCase()
      if (cur && cur[key] != null)
        flush()
      if (!cur)
        cur = {}
      cur[key] = label[2].trim()
      field = key
    }
    else if (/^\s*---\s*$/.test(line)) {
      flush()
    }
    else if (cur && field && line.trim()) {
      cur[field] = `${cur[field]} ${line.trim()}`.trim()
    }
  }
  flush()
  return items
}

// ---- Step 1: 只看 JD，客观抽取要求（不看简历，避免偏向已匹配项）----
function extractSystem(lang: string): string {
  return `你是招聘要求分析专家。请从职位描述(JD)中提取**对候选人的资格要求**（候选人需要"具备"什么），分两类：

- "must"：硬性资格。常见段落标题（写法多样，按含义识别，不要死抠字面）：Minimum/Basic/Required Qualifications、Qualifications、Requirements、Required Skills、What you'll need、What you bring、Who you are、About you、Skills & Experience、Must have、Essential、We're looking for、任职要求、岗位要求 等。**逐条**提取。
- "nice"：加分项。常见标题：Preferred Qualifications、Nice to have、Nice-to-haves、Bonus、Bonus points、A plus、Plus、Desirable、Good to have、Advantageous、Ideally、Even better、加分项、优先 等。**逐条**提取。

关键区分（很重要）：
- 按**功能**判断，不要死抠标题文字：凡是"候选人需要具备/最好具备的条件"就是资格要求；标题怎么写都算。
- **只提取"候选人需要具备的资格"**：学历、年限、技能、工具、经验、证书、语言等。
- **绝不要**把 "Responsibilities / 工作职责 / 你将要做什么(will / responsible for / 动词开头的职责句)" 当成要求——那是岗位职责，不是对候选人的资格，一律忽略。
- 只有当 JD 完全没有任何资格段落时，才从全文推断候选人必须具备的硬性条件。
- 如果 JD 没有 Preferred / 加分 段落，就**不要硬造 nice**；**忽略** LinkedIn 自动生成的 "Desired Skills and Experience" 之类的关键词标签，那不是真正的加分段落。
- **措辞降级（很重要）**：只要某条带有 ideal / preferred / a plus / nice to have / bonus / desirable / ideally / would be great / 优先 / 最好 / 加分 等"优先而非必需"的措辞，**无论它出现在哪个段落（哪怕在 Requirements 里）**，一律归类为 **nice**，绝不要放进 must。例如 "a master's degree ... is ideal" → nice。

另外，**每一条（无论 must 还是 nice）都要标 soft（true / false）**——区分"可核实的硬条件"和"无法核实的软素质"。判据：**这条能不能在简历里用具体证据核实？**
- soft=false（硬，可核实）：具体技能/工具/技术（SQL、Python、Azure）、年限、学历专业、特定领域经验、特定方法论、证书、语言。
- soft=true（软，简历几乎无法证明）：诚实、细心/注意细节、独立工作、责任心、抗压、遵循指南、是否使用某类工具（如"不使用AI写作工具"）、泛泛的"沟通能力/分析能力/批判性思维"等通用素质或态度。

还要标出极少数**硬否决项（veto=yes）**——这类条件**与能力高低无关，是客观的"准入资格"**，不具备就连初筛都过不了。**严格仅限以下三类**，且 JD 必须明确表述：
1. **人类语言**能力被明确要求（如 "Fluency in Thai is required"、"Native German speaker"）；
2. **工作权利**：工作签证 / work authorization / right to work / 国籍 / 特定居住地（onsite in X）等准入要求；
3. **法律或行业强制的执照 / 注册资质**（如注册会计师 ACA、护理执照、律师资格、安全许可 security clearance）。

**绝对不要**把下面这些标成 veto（这是最常见的误标）：
- 编程语言 / 技术 / 工具 / 框架 / 平台（Python、SQL、Word、Excel、Azure、React…）——**即使写在 "Must Have" 里、即使用 strong / required 形容，也只是普通 must，不是 veto**；
- 学历 / 专业 / 年限 / 院校层次（如 "Russell Group 2.1"、"3+ years"）——是 must，不是 veto；
- 任何 soft 素质、ideal / preferred / 加分项。

判否决要**极其保守**：只有上面三类"客观准入门槛"才算，拿不准一律 veto=no。veto=yes 的条目必然是 must 且 soft=no。

铁律：
1. 忠实保留具体信息——年限（如"3年以上"）、学历及专业、技术/工具/证书/语言名。**禁止**概括成"具有X方面的扎实背景"。
2. 一个要点对应一条，保留关键数字/学历/专业/技术名。
3. 资格段落里每一条都要在，别漏。

只看 JD，不分析候选人。所有输出文字（要求点）用「${lang}」书写。

**输出格式（严格遵守，不要用 JSON）**：每条要求输出四行，字段名后跟冒号；条与条之间用单独一行 \`---\` 分隔。除此之外不要输出任何多余文字或代码块。引号、逗号照常写即可，不需要转义。格式如下：

TEXT: 要求点
TYPE: must 或 nice
SOFT: yes 或 no
VETO: yes 或 no
---
TEXT: …
TYPE: …
SOFT: …
VETO: …`
}

// ---- Step 2: 拿要求逐条比简历，严格诚实，不许抬分 ----
function matchSystem(lang: string): string {
  return `你是严格、诚实的求职匹配助手，绝不为了讨好用户而抬高匹配度。
给你一份【候选人简历】和一组【职位要求】。逐条判断简历是否满足每条要求：
- "yes"：简历有明确证据
- "no"：简历明显不具备
- "unclear"：简历没提到、无法确认
宁可保守：没有明确证据就不要给 yes。每条给一句很短的 note（用「${lang}」书写，符合的依据，或缺了什么）。
保持要求的条数、文字、type 与输入一致。要求点(text)也用「${lang}」书写。

**输出格式（严格遵守，不要用 JSON）**：每条输出四行，字段名后跟冒号；条与条之间用单独一行 \`---\` 分隔。除此之外不要输出任何多余文字或代码块。引号、逗号照常写即可，不需要转义。格式如下：

TEXT: 要求点（与输入一致）
TYPE: must 或 nice
MET: yes 或 no 或 unclear
NOTE: 很短的说明
---
TEXT: …
TYPE: …
MET: …
NOTE: …`
}

// ---- Step 3: 挖 Requirements 板块之外、散落在其它板块里的"其他要求"（只看 JD，必须逐字引用原文）----
function implicitSystem(lang: string): string {
  return `你是资深招聘分析专家。除了 JD 里**明确列出**的"任职要求/加分项"板块，很多对候选人的真实期望，是**散落在其它板块**里的——比如 About the job / 岗位介绍、Key Responsibilities / 工作职责、Assessment / 考核、团队与文化、工作方式等。请把这些"**其他要求**"挖出来——它们也决定候选人是否真的合适，但求职者容易忽略。

我会给你完整 JD，以及一份**已经提取过的明确要求**清单（这些**不要再重复**）。

铁律（很重要，避免空泛和编造）：
1. **每一条都必须能从 JD 里逐字引用一句原文作为依据**（QUOTE 字段）。QUOTE 必须和 JD 原文**一字不差**（保持原文语言、大小写、标点）。引不出原文的，**绝对不要输出这一条**。
2. **每一条都要标出它来自 JD 的哪个板块**（SECTION 字段）：用 JD 里**该板块的原文标题，逐字照抄**（如 "About the job"、"Key Responsibilities"、"Assessment"）。如果该内容在没有标题的开头介绍段，就写该 JD 的起始板块名（多为 "About the job"）。**动态识别**——JD 里有什么板块就标什么，别套用固定清单。
3. **不要重复**"已提取的明确要求"里已有的内容。
4. 把信号**翻译成候选人能对照自己的具体说法**：
   - "in a fast-paced startup environment" → "能在快节奏、规则不明确的环境里自驱推进"
   - 职责里反复出现某工具（Figma / SQL）却没列进要求 → "实际需要会用 Figma"
   - "looking for freelance experts" → "这是 freelance/兼职性质，需接受灵活但不稳定的合作"
   - "qualification exam"、"ID verification" → "需通过岗位考核并完成身份核验"
5. **不要**把泛泛的客套话（"join our amazing team"、"we value diversity"）当要求。挖到几条写几条，**最多 5 条**；真没有就什么都不输出。
6. TEXT 和 WHY 用「${lang}」书写；SECTION 和 QUOTE 保持 JD 原文、逐字。

**输出格式（严格遵守，不要用 JSON）**：每条输出四行，字段名后跟冒号；条与条之间用单独一行 \`---\` 分隔。除此之外不要输出任何多余文字、解释或代码块。引号、逗号照常写即可，不需要转义。格式如下：

SECTION: 该条来自的板块原文标题
TEXT: 其他要求（具体说法）
QUOTE: JD原文逐字引用
WHY: 一句话为什么
---
SECTION: …
TEXT: …
QUOTE: …
WHY: …`
}

/** 归一化：统一卷曲/直引号、破折号、空白、大小写，用于把 quote 和 JD 原文对齐。 */
function normalizeForMatch(s: string): string {
  return s
    .replace(/[‘’‚‛＇]/g, "'")
    .replace(/[“”„‟＂]/g, "\"")
    // 各种连字符/破折号（含非断行连字符 U+2011、减号 U+2212）统一成普通 "-"
    .replace(/[‐‑‒–—―−﹘﹣－]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/**
 * quote 能否在 JD 里定位（容忍引号/标点细微差异）：
 * 先整段匹配；不中则尝试 quote 的较长连续片段（≥18 字符）是否出现在 JD 里。
 * 返回 false 即"定位不到"——既可能是模型改写，也可能是编造。
 */
function locateInJd(normalizedJd: string, quote: string): boolean {
  const q = normalizeForMatch(quote)
  if (q.length < 6)
    return false
  if (normalizedJd.includes(q))
    return true
  const words = q.split(" ")
  // 从最长往短试连续片段，命中较长片段即认为定位成功
  for (let len = words.length; len >= 4; len--) {
    for (let start = 0; start + len <= words.length; start++) {
      const chunk = words.slice(start, start + len).join(" ")
      if (chunk.length >= 18 && normalizedJd.includes(chunk))
        return true
    }
  }
  return false
}

/** quote 在 JD 中的起始位置（用于从上到下排序）；定位不到返回很大的数，排末尾。 */
function quotePosition(normalizedJd: string, quote: string): number {
  const q = normalizeForMatch(quote)
  const exact = normalizedJd.indexOf(q)
  if (exact !== -1)
    return exact
  // 退化：用 quote 的较长前缀找位置
  for (let len = Math.min(q.length, 60); len >= 18; len -= 6) {
    const idx = normalizedJd.indexOf(q.slice(0, len))
    if (idx !== -1)
      return idx
  }
  return Number.MAX_SAFE_INTEGER
}

async function extractImplicit(
  providerId: string,
  lang: string,
  jd: string,
  knownReqs: string[],
): Promise<ImplicitRequirement[]> {
  try {
    const raw = await callLLM(
      providerId,
      implicitSystem(lang),
      `【已提取的明确要求（不要重复）】\n${knownReqs.map(r => `- ${r}`).join("\n")}\n\n【职位描述 JD】\n${jd}`,
    )
    const blocks = parseDelimitedBlocks(raw, ["SECTION", "TEXT", "QUOTE", "WHY"])
    const normalizedJd = normalizeForMatch(jd)
    const seen = new Set<string>()
    return blocks
      .filter(r => r.text && r.quote)
      .map(r => ({
        section: (r.section ?? "").trim(),
        text: r.text.trim(),
        quote: r.quote.trim(),
        why: (r.why ?? "").trim(),
        located: locateInJd(normalizedJd, r.quote),
      }))
      .filter((r) => {
        const key = normalizeForMatch(r.text)
        if (!key || seen.has(key))
          return false
        seen.add(key)
        return true
      })
      // 按 quote 在 JD 中出现的位置从上到下排序（定位不到的排末尾）
      .sort((a, b) => quotePosition(normalizedJd, a.quote) - quotePosition(normalizedJd, b.quote))
      .slice(0, 5)
  }
  catch {
    // 隐形要求是增量信息，分析失败不应让整次匹配失败
    return []
  }
}

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

  // 硬否决：仅当否决项被"明确不满足(no)"时才直接 🔴。
  // "unclear"（如简历没写签证状态）不算失败——避免把没写≠没有的情况误杀。
  const vetoFailed = reqs.filter(r => r.veto && r.met === "no").map(r => r.text)

  const m = String(mustMet)
  const t = String(mustTotal)

  if (vetoFailed.length > 0) {
    return {
      verdict: "skip",
      recommendation: i18n.t("jobMatch.rec.veto", [vetoFailed.join("、")]),
    }
  }

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

  const missingStr = missing.join(", ")
  let recommendation: string
  if (verdict === "recommend") {
    recommendation = missing.length === 0
      ? i18n.t("jobMatch.rec.recommendAll", [m, t])
      : i18n.t("jobMatch.rec.recommendSome", [m, t, missingStr])
  }
  else if (verdict === "maybe") {
    recommendation = i18n.t("jobMatch.rec.maybe", [m, t, missingStr])
  }
  else {
    recommendation = i18n.t("jobMatch.rec.skip", [m, t])
  }

  return { verdict, recommendation }
}

export async function analyzeMatch(resume: string, jd: string): Promise<MatchResult> {
  const lang = outputLanguageName()
  if (!resume.trim()) {
    throw new Error(i18n.t("jobMatch.error.noResume"))
  }
  if (!jd.trim()) {
    throw new Error(i18n.t("jobMatch.error.noJd"))
  }

  const config = await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`)
  if (!config) {
    throw new Error(i18n.t("jobMatch.error.noConfig"))
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
    throw new Error(i18n.t("jobMatch.error.noLlm"))
  }

  // Step 1：抽取 JD 要求 + 标注 soft/hard（只看 JD）
  const extractRaw = await callLLM(providerId, extractSystem(lang), `【职位描述 JD】\n${jd}`)
  const rawReqs = parseDelimitedBlocks(extractRaw, ["TEXT", "TYPE", "SOFT", "VETO"])
  const allReqs = rawReqs
    .filter(r => r.text)
    .map((r) => {
      const type = (r.type?.toLowerCase().includes("nice") ? "nice" : "must") as ReqType
      const soft = /^(yes|true|是|soft)/i.test((r.soft ?? "").trim())
      // 否决项只在"硬性必须"上成立，避免误标
      const veto = type === "must" && !soft && /^(yes|true|是)/i.test((r.veto ?? "").trim())
      return { text: r.text.trim(), type, soft, veto }
    })
  if (allReqs.length === 0) {
    const preview = jd.replace(/\s+/g, " ").slice(0, 80)
    throw new Error(i18n.t("jobMatch.error.noReqs", [String(jd.length), preview]))
  }

  // 只对"硬性、可核实"的要求评分；软性的单独展示、不计分
  const hardReqs = allReqs.filter(r => !r.soft)
  const softRequirements = allReqs.filter(r => r.soft).map(r => r.text)
  const flexible = jdIsFlexible(jd)
  const knownReqs = allReqs.map(r => r.text)

  // 去掉软性后几乎没有硬性要求（如纯软素质的众包帖）：不强判，给中性提示
  if (hardReqs.length === 0) {
    const implicit = await extractImplicit(providerId, lang, jd, knownReqs)
    return {
      requirements: [],
      softRequirements,
      implicit,
      verdict: "maybe",
      recommendation: i18n.t("jobMatch.rec.noHard"),
      flexible,
    }
  }

  // Step 2：逐条比对简历（只比硬性要求）
  const matchRaw = await callLLM(
    providerId,
    matchSystem(lang),
    `【候选人简历】\n${resume}\n\n【职位要求】\n${JSON.stringify(hardReqs.map(({ text, type }) => ({ text, type })), null, 2)}`,
  )
  // Step 3：串行挖隐形要求（避免与上一步并发触发限流）
  const implicit = await extractImplicit(providerId, lang, jd, knownReqs)
  const rawMatches = parseDelimitedBlocks(matchRaw, ["TEXT", "TYPE", "MET", "NOTE"])
  const validMet = new Set(["yes", "no", "unclear"])
  // veto 是 JD 属性，在抽取步已定；按文本匹配接回匹配结果，序号兜底
  const vetoByText = new Map(hardReqs.map(r => [normalizeForMatch(r.text), r.veto]))
  const matched: RequirementMatch[] = rawMatches
    .filter(m => m.text)
    .map((m, i) => {
      const met = (m.met ?? "").trim().toLowerCase()
      const veto = vetoByText.get(normalizeForMatch(m.text)) ?? hardReqs[i]?.veto ?? false
      return {
        text: m.text.trim(),
        type: (m.type?.toLowerCase().includes("nice") ? "nice" : "must") as ReqType,
        met: (validMet.has(met) ? met : "unclear") as Met,
        note: (m.note ?? "").trim() || undefined,
        veto,
      }
    })

  if (matched.length === 0) {
    throw new Error(i18n.t("jobMatch.card.emptyResult"))
  }

  // must 排在前面，方便用户先看硬要求
  matched.sort((a, b) => (a.type === b.type ? 0 : a.type === "must" ? -1 : 1))

  const { verdict, recommendation } = decide(matched)
  return { requirements: matched, softRequirements, implicit, verdict, recommendation, flexible }
}
