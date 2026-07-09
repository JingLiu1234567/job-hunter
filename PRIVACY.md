# Privacy Policy — Job Hunter

**Last updated:** 2026-07-09

Job Hunter is a browser extension forked from the open-source [Read Frog](https://github.com/mengxi-ream/read-frog) project, extended with an original job-matching feature (résumé vs. job description scoring, AI chat, and cover-letter drafting). This policy explains what data the extension collects, where it goes, and what choices you have.

## Summary

- Your résumé, the job descriptions you analyze, and your chat conversations are sent **only** to the AI provider (e.g. OpenAI, Anthropic, DeepSeek, OpenRouter, or a self-hosted endpoint) that **you** configure with **your own** API key. They are never sent to a server operated by us.
- Everything the extension stores is kept **on your own device** (`chrome.storage.local`). Nothing is uploaded to our servers by default.
- Basic, anonymous feature-usage analytics are collected by default (Chrome/Edge) to help us understand which features are used; you can turn this off at any time. It never includes your résumé, job posting content, chat messages, or API keys.
- A few optional features — disabled unless you explicitly turn them on — send data to Google or to the original Read Frog service. These are described below.

## 1. Data used for the job-match, translation, and chat features

When you use the résumé-matching, page-translation, subtitle-translation, or AI-chat features, the relevant content (your résumé text, the job posting or page text, your chat messages) is sent directly from your browser to the AI/translation provider **you configured** in Settings, using **your own API key**. We do not operate a server in this path, and we cannot see this content.

If you instead select a non-AI translation engine (Google Translate, Microsoft Translator, or DeepL) for page/subtitle translation, the text being translated is sent directly to that provider's own servers instead.

If you enable the optional text-to-speech ("read aloud") feature, the text to be spoken is sent to Microsoft's Edge text-to-speech service to generate audio.

## 2. Local storage

The following data is stored **only on your device**, using the browser's local extension storage. It is never transmitted anywhere unless you explicitly use one of the optional sync/save features described in section 3:

- Your saved résumé text
- Your configured AI provider settings, including API keys
- Match-analysis results, chat history (for the current session), and panel layout preferences
- General extension settings (language, custom actions, etc.)
- Local rolling backups of your configuration, so you can recover it after an accidental reset

## 3. Optional features that send data elsewhere

These are **off by default** and require an explicit action from you to activate:

- **Sync to Google Drive** — if you sign in with Google and enable this backup feature, your extension configuration (including your AI provider API keys) is uploaded to a private, app-only folder in your own Google Drive that only this extension can access. This is sent directly to Google using your own Google account; we do not have access to it.
- **Notebase (beta)** — if you enable "Beta Experience" in settings, sign in to a Read Frog account, and explicitly click "Save to Notebase" on an AI result, that specific result is sent to and stored by the Read Frog service (readfrog.app) under your account.

## 4. Anonymous usage analytics

By default (on Chrome and Edge; off by default on Firefox), the extension sends anonymous feature-usage events — such as which feature was used, whether it succeeded, and how long it took — to help us understand product usage. These events:

- Are tied to a random identifier generated on your device, not to your name, email, or account
- Never include your résumé, job posting content, chat messages, page content, or API keys
- Do not include session recordings, autocapture of page content, or cross-site tracking

You can turn this off at any time in the extension's settings.

## 5. What we don't do

We do not sell your data. We do not operate a server that receives your résumé, job descriptions, or chat content. We do not have a crash-reporting or telemetry service beyond the anonymous analytics described above.

## 6. Third-party services this extension can connect to

Depending on which features and providers you enable, the extension may connect directly to: the AI provider(s) you configure (e.g. OpenAI, Anthropic, DeepSeek, OpenRouter, or others), Google Translate, Microsoft Translator/Edge TTS, DeepL, Google (for Drive sync and OAuth sign-in), and the Read Frog service (readfrog.app) for account sign-in and the optional Notebase feature. Each of these is governed by that provider's own privacy policy.

## 7. Open source

This extension is open source under the GNU General Public License v3.0. You can review the full source code, including exactly how data is handled, at: https://github.com/JingLiu1234567/job-hunter

## 8. Contact

Questions about this policy can be sent to: beckyliu.2021219@gmail.com
