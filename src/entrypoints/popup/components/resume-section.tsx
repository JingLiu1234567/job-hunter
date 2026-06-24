import { useEffect, useState } from "react"
import { i18n } from "#imports"
import { getResume, setResume } from "@/utils/job-match/storage"

/**
 * "我的简历" — paste & save resume text in the popup.
 * Stored locally; used by the job-match scoring feature.
 */
export function ResumeSection() {
  const [text, setText] = useState("")
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void getResume().then(setText)
  }, [])

  const handleSave = async () => {
    await setResume(text)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-neutral-200 pt-3 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium">{i18n.t("jobMatch.resume.title")}</span>
        <button
          type="button"
          onClick={() => void handleSave()}
          className="cursor-pointer rounded-md bg-green-500 px-2.5 py-0.5 text-xs font-medium text-white transition-colors hover:bg-green-600"
        >
          {saved ? i18n.t("jobMatch.resume.saved") : i18n.t("jobMatch.resume.save")}
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setSaved(false)
        }}
        rows={5}
        placeholder={i18n.t("jobMatch.resume.placeholder")}
        className="border-border bg-background w-full resize-none rounded-md border p-2 text-xs leading-relaxed outline-none focus:border-green-500"
      />
      <span className="text-xs text-neutral-500 dark:text-neutral-400">
        {text.trim().length > 0 ? `${text.trim().length} ${i18n.t("jobMatch.resume.charUnit")}` : i18n.t("jobMatch.resume.empty")}
      </span>
    </div>
  )
}
