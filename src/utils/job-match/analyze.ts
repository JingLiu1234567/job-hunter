import { browser, i18n } from "#imports"
import { pickLLMProviderId } from "@/utils/job-match/provider"
import { sendMessage } from "@/utils/message"

/**
 * 跟随浏览器界面语言，决定 LLM 用什么语言输出分析结果。聊天面板也用这个，保证语气一致。
 * 用 Intl.DisplayNames 从浏览器语言代码生成该语言的原生名称（如 ar → العربية、it → italiano），
 * 不写死具体语言列表——理论上覆盖 Intl 支持的所有语言，不用每加一种语言就改一次代码。
 * 认不出的语言代码（极冷门/畸形）才退化成英文。
 */
export function outputLanguageName(): string {
  const code = browser.i18n.getUILanguage()
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code)
    if (name)
      return name
  }
  catch {
    // Intl.DisplayNames 对畸形/未知 locale code 会抛错，退化到英文
  }
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
  /**
   * met === "unclear" 时，区分"简历没写"(not_mentioned，值得建议补简历) 和
   * "简历写了但要求本身/证据有解读空间"(ambiguous，补简历没用)。其它 met 值下无意义。
   */
  unclearReason?: "not_mentioned" | "ambiguous"
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
  /** 工作模式（远程/混合/现场）——纯展示信息，从页面/JD正文抓取，不参与打分 */
  workMode?: "remote" | "hybrid" | "onsite"
  /** 薪资范围（如有提及）——纯展示信息，不参与打分 */
  salary?: string
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
- 只有当 JD 完全没有任何资格段落时，才从全文推断候选人必须具备的硬性条件。**如果已经有明确的资格段落**，开头介绍/岗位简介里对候选人的**笼统画像描述**（如 "we are looking for a high-calibre graduate"、"a self-starter"、"this is a junior/entry level position"）**不要**单独抽成一条 must/nice——那是候选人画像的软性描述，不是可核实的资格条目，除非资格段落本身也明确列出了同样的条目（如 Requirements 里写了"应届毕业生优先"）。但资格段落之外**明确的规则性表述**（如用 "requires/must" 说明的到岗安排、工作权限等）仍要提取，只是不要套用画像式描述。
- 如果 JD 没有 Preferred / 加分 段落，就**不要硬造 nice**；**忽略** LinkedIn 自动生成的 "Desired Skills and Experience" 之类的关键词标签，那不是真正的加分段落。
- **措辞降级（很重要）**：只要某条带有 ideal / preferred / a plus / nice to have / bonus / desirable / ideally / would be great / 优先 / 最好 / 加分 等"优先而非必需"的措辞，**无论它出现在哪个段落（哪怕在 Requirements 里）**，一律归类为 **nice**，绝不要放进 must。例如 "a master's degree ... is ideal" → nice。

另外，**每一条（无论 must 还是 nice）都要标 soft（true / false）**——区分"可核实的硬条件"和"无法核实的软素质"。判据：**这条能不能在简历里用具体证据核实？**
- soft=false（硬，可核实）：具体技能/工具/技术（SQL、Python、Azure）、年限、学历专业、特定领域经验、特定方法论、证书、语言。
- soft=true（软，简历几乎无法证明）：诚实、细心/注意细节、独立工作、责任心、抗压、遵循指南、是否使用某类工具（如"不使用AI写作工具"）、泛泛的"沟通能力/分析能力/批判性思维"等通用素质或态度。
- **工作安排类条件也算 soft=true**：每周到岗天数 / 混合或远程办公偏好、合同性质（全职/兼职/合同工）等——这些是候选人"是否愿意接受"的安排，不是能力，简历通常也不会写是否接受，一律 soft=true（展示但不计分）。**例外**：真正的签证 / 工作权利 / 国籍 / 居留资格类准入门槛仍是 soft=false 且可能 veto=yes（见下文 veto 规则），不要和普通到岗安排混淆。

还要标出极少数**硬否决项（veto=yes）**——这类条件**与能力高低无关，是客观的"准入资格"**，不具备就连初筛都过不了。**严格仅限以下三类**，且 JD 必须明确表述：
1. **人类语言**能力被明确要求（如 "Fluency in Thai is required"、"Native German speaker"）；
2. **工作权利/居留资格**：工作签证 / work authorization / right to work / 国籍 / 必须已定居或愿自费搬迁到某地（如 "must already be based in Germany"、"no visa sponsorship available"）等**准入门槛**；
3. **法律或行业强制的执照 / 注册资质**（如注册会计师 ACA、护理执照、律师资格、安全许可 security clearance）。

**绝对不要**把下面这些标成 veto（这是最常见的误标）：
- 编程语言 / 技术 / 工具 / 框架 / 平台（Python、SQL、Word、Excel、Azure、React…）——**即使写在 "Must Have" 里、即使用 strong / required 形容，也只是普通 must，不是 veto**；
- 学历 / 专业 / 年限 / 院校层次（如 "Russell Group 2.1"、"3+ years"）——是 must，不是 veto；
- **常规到岗安排**（如 "3 days per week in the office"、hybrid、onsite X days/week）——这是工作方式安排，不是准入资格，不是 veto（而且应标 soft=true，见上文，不计入评分）；
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

**表面描述 vs 底层能力（重要，避免误判 unclear）**：有些要求点字面上写的是具体工具名/具体表述，但那只是这项能力的**常见例证**，不是字面本身的硬性门槛——常见信号：要求写在"数据处理/分析""文档能力""沟通协作""理解XX行为"这类通用能力标题下、JD 整体面向非技术背景候选人（如提到"无需工程背景"）、或例子是 Excel/Word/PPT/Google 系列这类入门级通用工具。这种情况下，只要简历显示候选人用更高阶、等价或实质对应的方式（工具、设计、行为）达成了同样的底层能力/关切（如用 Python/SQL/pandas 做数据清洗对应"熟练使用 Excel/Google Sheets"；用"保守匹配、抵制虚高分数、人工审核+审计日志"这类设计对应"理解AI输出的不确定性与用户信任考量"），应判 **yes**，note 里写明"虽未用 JD 的字面表述，但通过 XX 实质达成同等底层能力"。
**不要**在以下情况套用此规则（这时字面表述本身就是门槛，不能替代）：JD 明确说明这是团队协作/交付媒介、必须对接的具体系统（如"团队用 Salesforce 管理客户数据"）、或字面内容本身就是要求的核心（如"熟练使用 Photoshop"这种专业软件要求，而非泛化的"设计能力"例证）。拿不准就仍按 unclear 处理，不要滥用这条规则抬分。

**枚举类别要求（"A、B、C 或 D"）**：如果一条要求本身是"经验类型 A、B、C 或 D"这种**任选其一**的枚举（常见于"X年XX、YY、ZZ或相关岗位经验"这类表述），只要简历证据命中枚举里的**任意一个**类别，就判 yes，不要因为简历更贴近其中一类、不贴近你主观认为的"默认类别"就判 unclear/no。note 里写明命中的是哪一类。

**复合要求（一条里塞了好几个并列分句）**：如果一条要求包含多个用"、""和""以及"并列的分句（如"翻译需求、设计工作流、撰写用户故事、产出可测试结果"），只要简历证据覆盖了其中**大部分/核心**分句，就判 yes，note 里如实注明哪个分句没有证据；只有当核心分句基本都没体现时，才判 unclear。不要因为漏了一个次要分句就整条判 unclear/no。

**年限区间要求（如"0-2年""1-3年经验"，重要，避免方向判反）**：这类要求里真正要核实的是**经验类型**是否吻合（如"技术/客户对接/软件/云/AI 相关岗位"），年限区间通常是用来标注"这是初级/资历较浅岗位"，不是精确的硬上限。如果候选人证据显示的经验**类型**吻合，但年限明显**超过**区间上限（如区间是 0-2 年，候选人有 3 年以上相关经历/研究），判 **yes**（类型和最低门槛都满足了，"超过上限"不是"经验不够"），note 里如实提醒"经验年限已超过 JD 设定的区间上限，这类初级岗位有时会因'资历过高、预期薪资/留任风险'反而筛掉资深候选人，投递时可注意说明意愿"。**不要**把"年限超过上限"误判成 unclear 或当成"经验不够"处理——这是方向性错误。

保持要求的条数、文字、type 与输入一致。要求点(text)也用「${lang}」书写。

**UNCLEAR_REASON 字段（仅当 MET=unclear 时有意义，避免给错建议）**：只有当 MET 判为 unclear 时才需要认真填这个字段，区分两种完全不同的"不确定"：
- "not_mentioned"：简历**确实没提**这方面的经历/技能，属于"简历表达缺口"——candidate 如果真的具备，补进简历就能满足。
- "ambiguous"：简历**已经提到**相关经历，只是这条要求本身有解读空间、或候选人证据是否严格满足这条要求存在主观判断空间（如经验类型算不算数、是否算"标准工作经验"等）——这种情况"补进简历"帮不上忙，不要建议候选人去补简历，因为该写的都写了，问题不在简历表达。
MET 不是 unclear 时，这个字段填 "n/a"。

**输出格式（严格遵守，不要用 JSON）**：每条输出五行，字段名后跟冒号；条与条之间用单独一行 \`---\` 分隔。除此之外不要输出任何多余文字或代码块。引号、逗号照常写即可，不需要转义。格式如下：

TEXT: 要求点（与输入一致）
TYPE: must 或 nice
MET: yes 或 no 或 unclear
UNCLEAR_REASON: not_mentioned 或 ambiguous 或 n/a
NOTE: 很短的说明
---
TEXT: …
TYPE: …
MET: …
UNCLEAR_REASON: …
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
  // "no"（简历明确不具备）和 "unclear"（简历没提到）虽然都不计入 mustMet，
  // 但含义完全不同：前者是真实差距，后者可能只是简历没写清楚。分开统计，
  // 避免"大部分是没写清楚"的情况被当成"大部分是真不满足"一样劝退。
  const mustNo = musts.filter(r => r.met === "no").length
  const mustUnclear = musts.filter(r => r.met === "unclear").length
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

  // unclear 内部还要再分：大部分是"简历没写"(not_mentioned，补简历有用)，
  // 还是大部分是"简历写了但判定有解读空间"(ambiguous，补简历没用)——
  // 两种情况该给的建议完全不同，选文案时要看这个，不能只看 unclear 的数量。
  const mustUnclearAmbiguous = musts.filter(r => r.met === "unclear" && r.unclearReason === "ambiguous").length
  const mustUnclearNotMentioned = mustUnclear - mustUnclearAmbiguous

  let verdict: Verdict
  // "大部分未满足项其实是 unclear"这种情况，不直接判 skip——
  // 用来选更贴切的 maybe 文案（而不是暗示真的差距很大）。
  let unclearDominant = false
  if (mustRatio >= 1) {
    verdict = "recommend"
  }
  else if (mustRatio <= 0.5) {
    // 真实不满足(no) 才是硬伤；缺口如果大多是"简历没写"(unclear)而非"明确不具备"(no)，
    // 不直接判 skip，先升到 maybe，而不是当成和 no 一样的真实差距。
    if (mustNo > mustUnclear) {
      verdict = "skip"
    }
    else {
      verdict = "maybe"
      unclearDominant = true
    }
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
    if (unclearDominant) {
      // 缺口里大多是"简历写了但判定有解读空间"，"补简历"这句建议是错的，换一版文案。
      recommendation = mustUnclearAmbiguous > mustUnclearNotMentioned
        ? i18n.t("jobMatch.rec.maybeAmbiguous", [m, t, missingStr])
        : i18n.t("jobMatch.rec.maybeUnclear", [m, t, missingStr])
    }
    else {
      recommendation = i18n.t("jobMatch.rec.maybe", [m, t, missingStr])
    }
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

  const providerId = await pickLLMProviderId()
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
  const rawMatches = parseDelimitedBlocks(matchRaw, ["TEXT", "TYPE", "MET", "UNCLEAR_REASON", "NOTE"])
  const validMet = new Set(["yes", "no", "unclear"])
  // veto 是 JD 属性，在抽取步已定；按文本匹配接回匹配结果，序号兜底
  const vetoByText = new Map(hardReqs.map(r => [normalizeForMatch(r.text), r.veto]))
  const matched: RequirementMatch[] = rawMatches
    .filter(m => m.text)
    .map((m, i) => {
      const met = (m.met ?? "").trim().toLowerCase()
      const veto = vetoByText.get(normalizeForMatch(m.text)) ?? hardReqs[i]?.veto ?? false
      const unclearReasonRaw = (m.unclear_reason ?? "").trim().toLowerCase()
      return {
        text: m.text.trim(),
        type: (m.type?.toLowerCase().includes("nice") ? "nice" : "must") as ReqType,
        met: (validMet.has(met) ? met : "unclear") as Met,
        unclearReason: unclearReasonRaw === "ambiguous" ? "ambiguous" : "not_mentioned",
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
