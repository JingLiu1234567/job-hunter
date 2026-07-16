// Extract the job-description text from the current page.
// Primary strategy is layout-independent: locate the "About the job" heading in
// the page text and slice from there. This avoids grabbing a stale/previous
// job's leftover DOM on LinkedIn's SPA search page, and doesn't depend on
// LinkedIn's ever-changing class names.

// JD 容器选择器：用 id 和 [class*=] 属性匹配，抗 LinkedIn class 名变动。
// 这些都精确指向"职位描述"区域，天然排除 Premium 资料卡 / 申请者对比小组件。
const LINKEDIN_JD_SELECTORS = [
  "#job-details",
  "[class*='jobs-description__content']",
  "[class*='jobs-box__html-content']",
  "[class*='jobs-description-content']",
  "article[class*='jobs-description']",
  ".jobs-search__job-details",
  ".jobs-details__main-content",
]

// JD 正文常见的特征词（标题等）。Premium 资料卡 / 申请者对比小组件不含这些，
// 用它来判断"抓到的到底是不是职位描述"，避免误抓你自己的资料。
const JD_SIGNALS = [
  "About the job",
  "About this role",
  "About this job",
  "Responsibilities",
  "Qualifications",
  "Requirements",
  "What you",
  "Who you are",
  "Preferred",
  "Minimum",
  "Nice to have",
  "Role Description",
  "职位描述",
  "岗位职责",
  "任职要求",
]

function looksLikeJD(text: string): boolean {
  return JD_SIGNALS.some(s => text.includes(s))
}

// Headings that mark the start of the real JD body (in priority order).
const PRIMARY_ANCHORS = ["About the job", "About this role", "About this job"]
const SECTION_ANCHORS = [
  "Role Description",
  "Position Overview",
  "Principal Accountabilities",
  "Responsibilities",
  "Minimum Qualifications",
  "Requirements",
  "Qualifications",
  "Required Skills",
  "职位描述",
  "岗位职责",
  "任职要求",
]

const MAX_JD_CHARS = 9000

function stripInjectedTranslations(text: string): string {
  const latinTotal = text.match(/[a-z]/gi)?.length ?? 0
  if (latinTotal < 200) {
    return text
  }
  return text
    .split("\n")
    .filter((line) => {
      const cjk = line.match(/[一-鿿]/g)?.length ?? 0
      const latin = line.match(/[a-z]/gi)?.length ?? 0
      return !(cjk > 3 && cjk >= latin)
    })
    .join("\n")
}

function clean(text: string): string {
  return stripInjectedTranslations(text)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_JD_CHARS)
}

/** Slice the page text from the JD heading onward (current job, not stale ones). */
function sliceFromAnchor(text: string): string {
  for (const anchor of PRIMARY_ANCHORS) {
    const i = text.indexOf(anchor)
    if (i !== -1) {
      return text.slice(i)
    }
  }
  let earliest = -1
  for (const anchor of SECTION_ANCHORS) {
    const i = text.indexOf(anchor)
    if (i !== -1 && (earliest === -1 || i < earliest)) {
      earliest = i
    }
  }
  return earliest === -1 ? "" : text.slice(earliest)
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

// 职位"标题卡"区域候选选择器（工作模式/薪资标签通常在这里，不在 JD 正文容器内）。
// 用 [class*=] 抗 LinkedIn class 名变动；命中就地取文字，范围小，误抓风险低。
const LINKEDIN_TOPCARD_SELECTORS = [
  "[class*='jobs-unified-top-card']",
  "[class*='job-details-jobs-unified-top-card']",
  "[class*='topcard']",
]

function extractTopCardText(): string {
  const body = document.body
  if (!body)
    return ""
  for (const selector of LINKEDIN_TOPCARD_SELECTORS) {
    const el = body.querySelector<HTMLElement>(selector)
    if (el && isVisible(el)) {
      const text = el.innerText ?? ""
      if (text.trim().length > 0)
        return text
    }
  }
  return ""
}

const WORK_MODE_RE = {
  hybrid: /\bhybrid\b|混合(?:办公|模式|工作)/i,
  onsite: /\bon-?site\b|\bin-?office\b|现场办公|驻场|坐班/i,
  remote: /\b(?:fully\s+)?remote\b|远程(?:办公|工作)/i,
} as const

/** 正文里没有直接的"Hybrid"标签词，但明确写了"每周到岗 N 天"这类混合办公的具体描述。 */
const HYBRID_DAYS_RE = /\d+\s*days?\s*(?:a|per)\s*week[^.]{0,30}(?:office|on-?site)/i
const HYBRID_DAYS_RE_ZH = /每周[^。]{0,6}\d+\s*天[^。]{0,10}(?:到岗|办公室|坐班)/

function detectWorkMode(text: string): "remote" | "hybrid" | "onsite" | undefined {
  if (!text)
    return undefined
  if (WORK_MODE_RE.hybrid.test(text) || HYBRID_DAYS_RE.test(text) || HYBRID_DAYS_RE_ZH.test(text))
    return "hybrid"
  if (WORK_MODE_RE.onsite.test(text))
    return "onsite"
  if (WORK_MODE_RE.remote.test(text))
    return "remote"
  return undefined
}

// 货币符号 + 数字（可选区间、可选 k 简写），如 "$98,900 - $164,900" / "£50k"。
const SALARY_RE = /[$£€¥]\s?\d[\d,]*(?:\.\d+)?\s?k?(?:\s*(?:[-–—]|to)\s*[$£€¥]?\s?\d[\d,]*(?:\.\d+)?\s?k?)?/gi

// 数字附近出现这些词，说明这不是薪资本身（奖金/养老金/福利津贴等），排除掉。
const SALARY_NEGATIVE_CONTEXT_RE = /\b(?:bonus|discretionary|pension|allowance|perkbox|voucher|reward\s+scheme)\b/i
// 只有在 JD 正文里退化查找时才要求"数字附近得出现薪资相关词"；
// LinkedIn 标题卡区域本来就是专门展示薪资的地方，不需要这层校验。
const SALARY_POSITIVE_CONTEXT_RE = /\b(?:salary|compensation|remuneration|base\s*pay|pay\s*range|package)\b/i
const SALARY_CONTEXT_WINDOW = 40

function hasNearbyContext(text: string, idx: number, len: number, re: RegExp): boolean {
  const before = text.slice(Math.max(0, idx - SALARY_CONTEXT_WINDOW), idx)
  const after = text.slice(idx + len, idx + len + SALARY_CONTEXT_WINDOW)
  return re.test(before) || re.test(after)
}

function detectSalary(text: string, opts: { requirePositiveContext?: boolean } = {}): string | undefined {
  if (!text)
    return undefined
  for (const m of text.matchAll(SALARY_RE)) {
    const raw = m[0]
    const digits = raw.replace(/\D/g, "")
    // 过滤掉"$5"这种明显不是薪资的小额匹配：至少 4 位数字，或者带 k 简写
    if (digits.length < 4 && !/k/i.test(raw))
      continue
    const idx = m.index ?? text.indexOf(raw)
    // 排除明显是奖金/养老金/福利津贴的数字，不是真正的薪资
    if (hasNearbyContext(text, idx, raw.length, SALARY_NEGATIVE_CONTEXT_RE))
      continue
    if (opts.requirePositiveContext && !hasNearbyContext(text, idx, raw.length, SALARY_POSITIVE_CONTEXT_RE))
      continue
    const after = text.slice(idx + raw.length, idx + raw.length + 24)
    const unit = after.match(/^\s*(?:per\s+(?:year|annum|hour|month|day)|\/\s?(?:yr|hr|mo)|annually)/i)
    return unit ? `${raw} ${unit[0].trim()}` : raw
  }
  return undefined
}

export interface JobMeta {
  /** 工作模式：远程/混合/现场——抓不到就 undefined，不强行展示 */
  workMode?: "remote" | "hybrid" | "onsite"
  /** 薪资范围（如有提及）——抓不到就 undefined */
  salary?: string
}

/**
 * 抓取工作模式和薪资这类"纯展示信息"：优先用 LinkedIn 标题卡区域（准确、范围小），
 * 抓不到再退化到 JD 正文里找（这一步要求数字附近有"salary/compensation"等词，
 * 且排除"bonus/pension"等语境，避免把奖金/福利津贴误当成薪资）。
 * 不参与打分，抓不到就不显示，不强行标"未提及"。
 */
export function extractJobMeta(jd: string): JobMeta {
  const topCardText = extractTopCardText()
  return {
    workMode: detectWorkMode(topCardText) ?? detectWorkMode(jd),
    salary: detectSalary(topCardText) ?? detectSalary(jd, { requirePositiveContext: true }),
  }
}

/**
 * 找到精确的 JD 容器元素（抗 class 改名）。收集所有可见候选，
 * 优先"看起来像 JD"的、再按长度，取最佳——绝不会落到 Premium 资料卡上。
 * 抓不到就返回 null，由调用方决定退化策略。
 * 供 extractJD()（取文本喂给 LLM）和高亮定位（限定搜索范围，避免撞到导航栏/侧边栏其它职位）共用。
 */
export function findJdContainerElement(): HTMLElement | null {
  const body = document.body
  if (!body)
    return null

  const seen = new Set<HTMLElement>()
  const candidates: { el: HTMLElement, text: string, signal: boolean }[] = []
  for (const selector of LINKEDIN_JD_SELECTORS) {
    for (const el of body.querySelectorAll<HTMLElement>(selector)) {
      if (seen.has(el) || !isVisible(el))
        continue
      seen.add(el)
      const raw = el.innerText ?? ""
      if (raw.trim().length < 80)
        continue
      candidates.push({ el, text: clean(raw), signal: looksLikeJD(raw) })
    }
  }
  candidates.sort((a, b) => Number(b.signal) - Number(a.signal) || b.text.length - a.text.length)
  if (candidates[0] && (candidates[0].signal || candidates[0].text.length > 200)) {
    return candidates[0].el
  }

  // 选择器全失配（LinkedIn 的 class 名经常变动）：退化用标题锚点找容器。
  return findContainerByAnchor()
}

/**
 * 选择器全失配时的退化方案：找到 JD 标题锚点（"About the job" 等）所在的文本节点，
 * 从它的父元素往上爬，取一个文本量明显更大、且像 JD 的祖先容器。
 * 标题文字本身比 class 名稳定得多，抗 LinkedIn 改版能力更强。
 */
function findContainerByAnchor(): HTMLElement | null {
  const body = document.body
  if (!body)
    return null
  const anchors = [...PRIMARY_ANCHORS, ...SECTION_ANCHORS]
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  let anchorEl: HTMLElement | null = null
  while (node) {
    if (anchors.some(a => node!.data.includes(a))) {
      anchorEl = node.parentElement
      break
    }
    node = walker.nextNode() as Text | null
  }
  if (!anchorEl)
    return null

  // 从命中锚点的元素往上爬，取文本量明显更大、且像 JD 的祖先容器；
  // 长度超过 20000 字符大概率已经爬出 JD 正文、覆盖了侧边栏等无关内容，就此打住。
  let best: HTMLElement | null = null
  let candidate: HTMLElement | null = anchorEl
  let depth = 0
  while (candidate && candidate !== body && depth < 12) {
    const text = candidate.innerText ?? ""
    if (text.trim().length > 200 && looksLikeJD(text)) {
      best = candidate
      if (text.length > 20000)
        break
    }
    candidate = candidate.parentElement
    depth++
  }
  return best
}

export function extractJD(): string {
  const body = document.body
  if (!body)
    return ""

  // 1) 首选：精确的 JD 容器（抗 class 改名）。
  const container = findJdContainerElement()
  if (container) {
    return clean(container.innerText ?? "")
  }

  // 2) 退化：在整页文字里从 JD 标题锚点切出正文（应对非 LinkedIn 或选择器全失配）。
  const fromAnchor = sliceFromAnchor(body.innerText ?? "")
  if (fromAnchor.trim().length > 200) {
    return clean(fromAnchor)
  }

  // 3) 退化：含 JD 特征的最大 main/article 区域（避免抓到资料卡/导航）。
  let best = ""
  for (const el of body.querySelectorAll<HTMLElement>("main, article, [role=main]")) {
    const text = el.innerText ?? ""
    if (looksLikeJD(text) && text.length > best.length) {
      best = text
    }
  }
  if (best.trim().length > 200) {
    return clean(sliceFromAnchor(best) || best)
  }

  // 都没有 JD 特征：返回空，让上层提示"请打开职位详情页"。
  return ""
}
