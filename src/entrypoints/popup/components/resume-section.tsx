import { useEffect, useRef, useState } from "react"
import { i18n } from "#imports"
import { parseResumeFile, UnsupportedFileError } from "@/utils/job-match/parse-resume"
import { getResume, setResume } from "@/utils/job-match/storage"

/**
 * "My Resume" — paste OR upload (PDF / Word / txt) resume in the popup.
 * Stored locally; used by the job-match scoring feature.
 */
export function ResumeSection() {
  const [text, setText] = useState("")
  const [saved, setSaved] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [hint, setHint] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void getResume().then(setText)
  }, [])

  const handleSave = async () => {
    await setResume(text)
    setSaved(true)
    setHint("")
    setTimeout(() => setSaved(false), 2000)
  }

  const handleFile = async (file: File | undefined) => {
    if (!file)
      return
    setParsing(true)
    setHint("")
    try {
      const extracted = (await parseResumeFile(file)).trim()
      setText(extracted)
      await setResume(extracted)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
    catch (error) {
      setHint(error instanceof UnsupportedFileError
        ? i18n.t("jobMatch.resume.unsupported")
        : i18n.t("jobMatch.resume.parseFailed"))
    }
    finally {
      setParsing(false)
      if (fileInputRef.current)
        fileInputRef.current.value = ""
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-neutral-200 pt-3 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium">{i18n.t("jobMatch.resume.title")}</span>
        <div className="flex items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt"
            className="hidden"
            onChange={e => void handleFile(e.target.files?.[0])}
          />
          <button
            type="button"
            disabled={parsing}
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer rounded-md border border-green-500 px-2.5 py-0.5 text-xs font-medium text-green-600 transition-colors hover:bg-green-50 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-950"
          >
            {parsing ? i18n.t("jobMatch.resume.parsing") : i18n.t("jobMatch.resume.upload")}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            className="cursor-pointer rounded-md bg-green-500 px-2.5 py-0.5 text-xs font-medium text-white transition-colors hover:bg-green-600"
          >
            {saved ? i18n.t("jobMatch.resume.saved") : i18n.t("jobMatch.resume.save")}
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
        placeholder={i18n.t("jobMatch.resume.placeholder")}
        className="border-border bg-background w-full resize-none rounded-md border p-2 text-xs leading-relaxed outline-none focus:border-green-500"
      />
      {hint
        ? (
            <span className="text-xs text-red-600 dark:text-red-400">{hint}</span>
          )
        : (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {text.trim().length > 0 ? `${text.trim().length} ${i18n.t("jobMatch.resume.charUnit")}` : i18n.t("jobMatch.resume.empty")}
            </span>
          )}
    </div>
  )
}
