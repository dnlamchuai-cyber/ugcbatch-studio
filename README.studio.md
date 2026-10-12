# UGCBatch Studio

A port of [ClipForge](https://github.com/xixihhhh/clipforge) (AGPL-3.0, © xixihhhh) for the US and Vietnam markets.
All upstream features (scripts, storyboard, ad-compliance checks, export…) are kept; only language/market changed.

- UI: English (default) and Vietnamese. Chinese UI is hidden.
- Scripts are written in the language of the product/topic input (English or Vietnamese; anything else → English, never Chinese).
- LLM: Gemini via `https://generativelanguage.googleapis.com/v1beta/openai/` using server env `GEMINI_API_KEY`; model from `LLM_MODEL` (default `gemini-3-flash-preview`). The key never reaches the browser.
- Video/image generation is mocked unless `STUDIO_PROVIDER_MODE=live`.
- Login: Supabase email auth when `STUDIO_SUPABASE_URL` + `STUDIO_SUPABASE_ANON_KEY` are set, otherwise a local mock session.

License: AGPL-3.0-only (see LICENSE and NOTICE). If you run a modified version as a network service you must offer its source.
