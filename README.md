# AIVORA — Think. Create. Discover.
Created By Shiv Yogi.

A static, API-key-free AI assistant. It searches Wikipedia (public MediaWiki API) and DuckDuckGo's public Instant Answer API, then shows the retrieved text with source cards. Answers are assembled from retrieved sources — AIVORA does not generate text with a language model.

## Deploy
Upload the folder to a GitHub repo, then Settings → Pages → deploy from branch (root). No build step, no backend, no secrets.

## Files
index.html, style.css, script.js, assets/logo.svg

## Notes
- Chats, drafts and settings live in `localStorage`.
- DuckDuckGo's endpoint may be blocked, rate-limited or return little; Wikipedia still works and errors are shown in chat.
