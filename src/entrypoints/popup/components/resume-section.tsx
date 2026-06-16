import { useEffect, useState } from "react"
import { browser } from "#imports"
import { getResume, setResume } from "@/utils/job-match/storage"

/**
 * Scrape the user's own LinkedIn profile.
 * Runs INSIDE the LinkedIn tab via scripting.executeScript, so it must be
 * fully self-contained (no imports / outer references).
 */
function scrapeLinkedInProfile(): string {
  const parts: string[] = []

  const h1 = document.querySelector("h1")
  if (h1 && h1.innerText.trim()) {
    parts.push(`姓名：${h1.innerText.trim()}`)
  }

  const sectionIds = [
    "about",
    "experience",
    "education",
    "skills",
    "licenses_and_certifications",
    "projects",
    "honors_and_awards",
  ]
  for (const id of sectionIds) {
    const anchor = document.getElementById(id)
    const section = anchor ? anchor.closest("section") : null
    if (!section) {
      continue
    }
    const raw = (section as HTMLElement).innerText || ""
    // LinkedIn duplicates many labels (visible + screen-reader copy) — drop
    // consecutive identical lines.
    const lines = raw.split("\n").map(l => l.trim()).filter(Boolean)
    const deduped = lines.filter((line, i) => line !== lines[i - 1])
    if (deduped.length) {
      parts.push(deduped.join("\n"))
    }
  }

  return parts.join("\n\n")
}

/**
 * "我的简历" — paste resume, or import it from the user's LinkedIn profile.
 * Stored locally; used by the job-match scoring feature.
 */
export function ResumeSection() {
  const [text, setText] = useState("")
  const [saved, setSaved] = useState(false)
  const [importing, setImporting] = useState(false)
  const [hint, setHint] = useState("")

  useEffect(() => {
    void getResume().then(setText)
  }, [])

  const handleSave = async () => {
    await setResume(text)
    setSaved(true)
    setHint("")
    setTimeout(() => setSaved(false), 2000)
  }

  const handleImport = async () => {
    setImporting(true)
    setHint("")
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true })
      const tab = tabs[0]
      if (!tab?.id || !(tab.url ?? "").includes("linkedin.com/in/")) {
        setHint("请先打开你自己的领英主页（linkedin.com/in/…）再点导入")
        return
      }
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeLinkedInProfile,
      })
      const scraped = ((results?.[0]?.result as string | undefined) ?? "").trim()
      if (!scraped) {
        setHint("没读到资料：请确认在个人主页、且页面已加载完")
        return
      }
      setText(scraped)
      await setResume(scraped)
      setHint("已从领英导入并保存 ✓ 可手动编辑后再点保存")
    }
    catch (error) {
      setHint(`导入失败：${error instanceof Error ? error.message : "未知错误"}`)
    }
    finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-neutral-200 pt-3 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium">我的简历</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={importing}
            onClick={() => void handleImport()}
            className="cursor-pointer rounded-md border border-green-500 px-2.5 py-0.5 text-xs font-medium text-green-600 transition-colors hover:bg-green-50 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-950"
          >
            {importing ? "导入中…" : "领英导入"}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            className="cursor-pointer rounded-md bg-green-500 px-2.5 py-0.5 text-xs font-medium text-white transition-colors hover:bg-green-600"
          >
            {saved ? "已保存 ✓" : "保存"}
          </button>
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setSaved(false)
        }}
        rows={5}
        placeholder="把简历内容粘贴到这里，或点「领英导入」从你的领英主页读取…"
        className="border-border bg-background w-full resize-none rounded-md border p-2 text-xs leading-relaxed outline-none focus:border-green-500"
      />
      {hint
        ? (
            <span className="text-xs text-neutral-600 dark:text-neutral-300">{hint}</span>
          )
        : (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {text.trim().length > 0 ? `${text.trim().length} 字` : "尚未填写简历"}
            </span>
          )}
    </div>
  )
}
