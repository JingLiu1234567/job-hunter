import { storage } from "#imports"

// Local storage key for the user's saved resume text.
// Kept separate from Read Frog's config system on purpose: this is our own
// "Job Hunter" feature data, so we avoid touching their config schema/migrations.
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

// Remembered position/size of the match card, so it stays put across page reloads.
const CARD_LAYOUT_KEY = "local:jobhunter_card_layout"

export interface CardLayout {
  x?: number
  y?: number
  w?: number
  h?: number
}

export async function getCardLayout(): Promise<CardLayout> {
  return (await storage.getItem<CardLayout>(CARD_LAYOUT_KEY)) ?? {}
}

export async function setCardLayout(layout: CardLayout): Promise<void> {
  await storage.setItem(CARD_LAYOUT_KEY, layout)
}

// Remembered position/size of the AI chat panel — separate key so it doesn't
// collide with the match card's own remembered layout (both can be open at once).
const CHAT_LAYOUT_KEY = "local:jobhunter_chat_layout"

export async function getChatLayout(): Promise<CardLayout> {
  return (await storage.getItem<CardLayout>(CHAT_LAYOUT_KEY)) ?? {}
}

export async function setChatLayout(layout: CardLayout): Promise<void> {
  await storage.setItem(CHAT_LAYOUT_KEY, layout)
}
