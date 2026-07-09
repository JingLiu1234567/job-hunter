# Chrome Web Store Listing — Job Hunter

## Short description (≤132 characters)

Honest job-match scoring against your own résumé, plus inline bilingual translation — for job-hunting in a second language.

## Detailed description

**Stop guessing whether a job post is worth your time.**

Job Hunter reads a job posting the way a careful human would — not the way a typical ATS keyword-matcher does — and gives you a requirement-by-requirement verdict against your own résumé, so you can decide "is this worth applying to?" in seconds instead of minutes.

**🎯 Honest match scoring, not inflated scores**
- Extracts the real hard requirements from a job post (not the fluff), separating "must-have" from "nice-to-have"
- Checks each one against your résumé — yes / no / unclear, with a one-line reason
- Distinguishes "your résumé doesn't mention this" (fixable — just add it) from "this is a genuine gap" (not fixable by wording alone), so you're not misled into thinking a real gap is just a résumé-writing problem
- Flags true deal-breakers (visa/work authorization, licenses, language fluency) separately from ordinary requirements — no more being scared off by a "3 days in office" line that got wrongly treated as a hard veto
- Mines "hidden" requirements buried in the responsibilities/culture sections that never made it into the formal qualifications list, and lets you click one to jump to and highlight the exact sentence in the job post

**🌐 Inline bilingual translation**
Read the whole job post in your own language, side-by-side with the original — powered by the AI provider you choose.

**💬 Context-aware AI chat**
A floating chat panel that already knows the job post, your résumé, and your latest match results — ask it "why is this one unclear?" or have it draft a cover letter tailored to this specific role, grounded in what's actually on your résumé (it won't invent experience you don't have).

**🈯 Follows your language, not just a fixed list**
Analysis and chat responses automatically follow your browser's language — not limited to a hardcoded set of languages.

**🔒 Your data, your keys**
Bring your own API key for the AI provider of your choice (OpenAI, Anthropic, DeepSeek, OpenRouter, and more). Your résumé and job data are sent only to the provider you configure — never to our servers. Everything is stored locally in your browser.

Built by a job-seeker, for job-seekers who are applying in a language that isn't their first.

Job Hunter also inherits page-translation, video-subtitle-translation, and text-to-speech features from the open-source [Read Frog](https://github.com/mengxi-ream/read-frog) project it's forked from.

**Open source:** https://github.com/JingLiu1234567/job-hunter
**Privacy policy:** https://github.com/JingLiu1234567/job-hunter/blob/main/PRIVACY.md

## Suggested category

Productivity

## Suggested permission justifications (for the Chrome Web Store review form)

- **storage** — save your résumé, settings, and AI provider configuration locally on your device.
- **tabs** — detect the active tab's URL to know when a job posting or supported page is open.
- **scripting** — inject the translation/match-analysis UI into the page you're viewing.
- **host permissions (all sites)** — the translation and job-match features need to run on whatever job board or article page you're currently reading; there's no fixed list of supported sites.
- **webNavigation** — detect in-page navigation on single-page apps (e.g. LinkedIn) so the extension re-analyzes the new job post without a full page reload.
- **alarms** — run local, offline maintenance only (periodic local config backup, local cache cleanup) — no network calls are triggered by this.
- **contextMenus** — add right-click menu translation actions.
- **cookies** — used narrowly to detect sign-in state for the optional Read Frog account feature.
- **identity** — used only for the optional "Sync to Google Drive" backup feature (Google OAuth).
- **offscreen / sidePanel** — support the text-to-speech playback and the side-panel UI surface.
