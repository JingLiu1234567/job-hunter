// Extract the job-description text from the current page.
// Primary strategy is layout-independent: locate the "About the job" heading in
// the page text and slice from there. This avoids grabbing a stale/previous
// job's leftover DOM on LinkedIn's SPA search page, and doesn't depend on
// LinkedIn's ever-changing class names.

const LINKEDIN_JD_SELECTORS = [
  ".jobs-description__content",
  ".jobs-description-content__text",
  ".jobs-box__html-content",
  "#job-details",
  "article.jobs-description__container",
  ".jobs-search__job-details",
  ".jobs-details__main-content",
]

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
  // 1) Layout-independent: slice from the "About the job" heading in page text.
  const fromAnchor = sliceFromAnchor(document.body?.innerText ?? "")
  if (fromAnchor.trim().length > 200) {
    return clean(fromAnchor)
  }

  // 2) LinkedIn description containers — pick the largest VISIBLE one.
  let best = ""
  for (const selector of LINKEDIN_JD_SELECTORS) {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (!isVisible(el))
        continue
      const text = el.innerText ?? ""
      if (text.length > best.length) {
        best = text
      }
    }
  }
  if (best.length > 120) {
    return clean(best)
  }

  // 3) Largest main/article region, else whole body.
  for (const el of document.querySelectorAll<HTMLElement>("main, article, [role=main]")) {
    const text = el.innerText?.trim() ?? ""
    if (text.length > best.length) {
      best = text
    }
  }
  return clean(best || document.body?.innerText || "")
}
