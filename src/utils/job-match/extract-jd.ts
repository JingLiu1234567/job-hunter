// Extract the job-description text from the current page.
// Tries LinkedIn's known JD containers first, then falls back to the main
// content region, then the whole body. innerText keeps only visible text.

const LINKEDIN_JD_SELECTORS = [
  ".jobs-description__content",
  ".jobs-description-content__text",
  ".jobs-box__html-content",
  "#job-details",
  "article.jobs-description__container",
  ".jobs-description",
]

const MAX_JD_CHARS = 6000

function clean(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_JD_CHARS)
}

export function extractJD(): string {
  // 1) LinkedIn-specific job description containers
  for (const selector of LINKEDIN_JD_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector)
    const text = el?.innerText?.trim()
    if (text && text.length > 80) {
      return clean(text)
    }
  }

  // 2) Generic: pick the largest main/article region (works on company career pages)
  let best = ""
  for (const el of document.querySelectorAll<HTMLElement>("main, article, [role=main]")) {
    const text = el.innerText?.trim() ?? ""
    if (text.length > best.length) {
      best = text
    }
  }
  if (best.length > 120) {
    return clean(best)
  }

  // 3) Fallback: whole page
  return clean(document.body?.innerText ?? "")
}
