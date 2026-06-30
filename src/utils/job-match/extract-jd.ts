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

export function extractJD(): string {
  const body = document.body
  if (!body)
    return ""

  // 1) 首选：精确的 JD 容器（抗 class 改名）。收集所有可见候选，
  //    优先"看起来像 JD"的、再按长度，取最佳——绝不会落到 Premium 资料卡上。
  const seen = new Set<HTMLElement>()
  const candidates: { text: string, signal: boolean }[] = []
  for (const selector of LINKEDIN_JD_SELECTORS) {
    for (const el of body.querySelectorAll<HTMLElement>(selector)) {
      if (seen.has(el) || !isVisible(el))
        continue
      seen.add(el)
      const raw = el.innerText ?? ""
      if (raw.trim().length < 80)
        continue
      candidates.push({ text: clean(raw), signal: looksLikeJD(raw) })
    }
  }
  candidates.sort((a, b) => Number(b.signal) - Number(a.signal) || b.text.length - a.text.length)
  if (candidates[0] && (candidates[0].signal || candidates[0].text.length > 200)) {
    return candidates[0].text
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
