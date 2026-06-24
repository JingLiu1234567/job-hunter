import mammoth from "mammoth"
import * as pdfjsLib from "pdfjs-dist"
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export class UnsupportedFileError extends Error {}

/** Extract plain text from an uploaded resume file (PDF / DOCX / TXT). */
export async function parseResumeFile(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (name.endsWith(".pdf")) {
    return parsePdf(file)
  }
  if (name.endsWith(".docx")) {
    return parseDocx(file)
  }
  if (name.endsWith(".txt") || file.type.startsWith("text/")) {
    return (await file.text()).trim()
  }
  throw new UnsupportedFileError(name)
}

async function parsePdf(file: File): Promise<string> {
  const data = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const parts: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    parts.push(content.items.map(item => ("str" in item ? item.str : "")).join(" "))
  }
  return parts.join("\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim()
}

async function parseDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value.trim()
}
