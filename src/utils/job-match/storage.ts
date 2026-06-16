import { storage } from "#imports"

// Local storage key for the user's saved resume text.
// Kept separate from Read Frog's config system on purpose: this is our own
// "找工作神器" feature data, so we avoid touching their config schema/migrations.
const RESUME_KEY = "local:jobhunter_resume"

export async function getResume(): Promise<string> {
  return (await storage.getItem<string>(RESUME_KEY)) ?? ""
}

export async function setResume(text: string): Promise<void> {
  await storage.setItem(RESUME_KEY, text)
}

/** Subscribe to resume changes (e.g. saved from the popup while a page is open). */
export function watchResume(callback: (text: string) => void): () => void {
  return storage.watch<string>(RESUME_KEY, newValue => callback(newValue ?? ""))
}
