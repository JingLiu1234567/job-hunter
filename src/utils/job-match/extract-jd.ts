// Extract the job-description text from the current page.
// Targets LinkedIn's JD containers (both the job-view page and the search-page
// detail panel), then a requirement-keyword-anchored block, then main, then body.

const LINKEDIN_JD_SELECTORS = [
  ".jobs-description__content",
  ".jobs-description-content__text",
  ".jobs-box__html-content",
  "#job-details",
  "article.jobs-description__container",
  ".jobs-description",
  ".jobs-search__job-details",
  ".jobs-details__main-content",
  ".scaffold-layout__detail",
]

// Words that signal we're looking at the actual requirements/JD body.
const JD_KEYWORDS = [
  "Responsibilities",
  "Qualifications",
  "Requirements",
  "About the job",
  "About the role",
  "What you",
  "Who you are",
  "Minimum qualifications",
  "Preferred qualifications",
  "职责",
  "任职要求",
  "岗位要求",
]

const MAX_JD_CHARS = 6000

function clean(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_JD_CHARS)
}

/** Find the tightest element that contains JD keywords — likely the JD body. */
function findByKeyword(): string {
  let best = ""
  for (const el of document.querySelectorAll<HTMLElement>("section, article, div")) {
    const text = el.innerText ?? ""
    if (text.length < 200 || text.length > 9000)
      continue
    if (!JD_KEYWORDS.some(kw => text.includes(kw)))
      continue
    // prefer the tightest container (least surrounding noise)
    if (best === "" || text.length < best.length)
      best = text
  }
  return best
}

export function extractJD(): string {
  // 1) LinkedIn-specific containers
  for (const selector of LINKEDIN_JD_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector)
    const text = el?.innerText?.trim()
    if (text && text.length > 120) {
      return clean(text)
    }
  }

  // 2) Keyword-anchored block (works on most job sites)
  const byKeyword = findByKeyword()
  if (byKeyword.length > 120) {
    return clean(byKeyword)
  }

  // 3) Largest main/article region
  let best = ""
  for (const el of document.querySelectorAll<HTMLElement>("main, article, [role=main]")) {
    const text = el.innerText?.trim() ?? ""
    if (text.length > best.length) {
      best = text
    }
  }
  if (best.length > 150) {
    return clean(best)
  }

  // 4) Fallback: whole page
  return clean(document.body?.innerText ?? "")
}
