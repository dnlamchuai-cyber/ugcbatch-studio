# API error codes

Error responses are `{ "error": "<English text>", "code": "<CODE>", ...extra }`.
Map `code` to VI/EN copy in the UI; show `error` only when the code is unknown.
When a step fails because of the AI provider, `code` is the specific `AI_*` cause; otherwise it is the step code (`SCRIPT_FAILED`, …).

| Code | HTTP | Routes | English `error` |
|---|---|---|---|
| AI_KEY_MISSING | 400 / 500 | ai/image, ai/video (no key); llm/script, topic/script, ad-template/generate (server key unset) | "Missing API Key, please configure the corresponding platform in settings first" / "Script generation failed: The server has no AI key configured (GEMINI_API_KEY)…" |
| AI_KEY_INVALID | 500 | llm/script, topic/script, ad-template/generate, ai/image, ai/video | "Script generation failed: Invalid or unauthorized API key: copy a fresh key from the provider…" |
| AI_QUOTA_EXCEEDED | 500 | same as AI_KEY_INVALID | "…Payment Required: this account is out of credit…" / "The shared demo AI key has reached today's limit…" |
| AI_RATE_LIMITED | 500 | same | "…Rate limited (common on free/shared endpoints)…" |
| AI_MODEL_NOT_FOUND | 500 | same | "…Endpoint or model not found…" |
| AI_REQUEST_REJECTED | 500 | same | "…Request rejected (400)…" / "…Request payload too large…" |
| AI_OUTPUT_TOO_LONG | 500 | same | "…The model ran out of output budget mid-generation…" |
| AI_MODEL_TOO_WEAK | 500 | llm/script, topic/script | "…The model produced no real voiceover lines…" |
| AI_PROVIDER_UNAVAILABLE | 500 | same as AI_KEY_INVALID | "…The provider is temporarily unavailable (5xx)…" |
| AI_NETWORK | 500 | same | "…Cannot reach the API endpoint…" |
| AI_TIMEOUT | 500 | same | "…Request timed out…" |
| LLM_NOT_CONFIGURED | 400 | llm/script, topic/script, ad-template/generate | "Please configure the LLM parameters (baseUrl, apiKey, model)" / "Please configure the LLM in settings first" |
| INVALID_JSON | 400 | topic/script | "Request body is not valid JSON" |
| MISSING_PARAMS | 400 | ai/image, ai/video | "Missing required parameters" |
| PRODUCT_NAME_REQUIRED | 400 | llm/script, ad-template/generate | "Please enter the product name" / "Please enter the product name first" |
| TOPIC_REQUIRED | 400 | topic/script | "Please enter a one-sentence topic" |
| PROJECT_NOT_FOUND | 404 | topic/script, project/[id]/compose | "Project not found" |
| PROJECT_TYPE_CONFLICT | 409 | llm/script, topic/script | "This project is a one-sentence topic project — …" / "This project is a commerce project — …" |
| DB_SAVE_FAILED | 500 | llm/script, topic/script | "Failed to save scripts to the database, please try again" |
| NO_SCRIPT | 400 | project/[id]/compose | "No script generated yet; cannot compose" |
| NO_ASSETS | 400 | project/[id]/compose | "No usable assets; generate assets in the assets step or upload product images first" |
| SCRIPT_FAILED | 500 | llm/script, topic/script | "Script generation failed: <detail>" |
| TEMPLATE_FAILED | 500 | ad-template/generate | "AI template generation failed: <detail>" |
| TEMPLATE_INVALID_OUTPUT | 502 | ad-template/generate | "The AI did not return a valid template recipe, please try again" / "Could not parse the AI's recipe, please try again" |
| IMAGE_FAILED | 500 | ai/image | provider message, or "Image generation failed" |
| VIDEO_FAILED | 500 | ai/video | provider message, or "Video generation failed" |
| VIDEO_NO_RESULT | 502 | ai/video | "Task completed but returned no video URL" |
| VIDEO_TASK_PENDING | 504 | ai/video | "<detail>. Task ID … has been saved and can be recovered from the assets page — do not resubmit" |
| REFERENCE_MEDIA_UNAVAILABLE | 400 | ai/video | "Reference video unavailable: …" / "Reference audio unavailable: …" |
| COMPOSE_FAILED | 500 | project/[id]/compose (POST) | error message, or "Video composition failed" |
| COMPOSITIONS_FETCH_FAILED | 500 | project/[id]/compose (GET) | error message, or "Failed to fetch compositions" |

Import errors keep their own contract (`IMPORT_BLOCKED`, `IMPORT_NOT_FOUND`, `IMPORT_UNSUPPORTED`, `IMPORT_PARTIAL`; see README).
