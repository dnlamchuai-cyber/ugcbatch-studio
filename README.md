# UGCBatch Studio

UGCBatch Studio is a SaaS that helps e-commerce sellers in the **United States** and **Vietnam** create short UGC-style product videos in batches, in **English** and **Vietnamese**.

You add a product, and the studio writes the script, builds the storyboard, generates or matches visuals, records the voiceover and burns in subtitles. The finished vertical videos are ready for TikTok Shop, Shopee, Amazon, Shopify stores and paid social ads.

## Who it's for

- **TikTok Shop sellers** (US and VN) who need a steady stream of fresh product videos.
- **Shopee sellers** in Vietnam who want short videos for listings and Shopee Video.
- **Amazon sellers** who need listing videos and social ads.
- **Shopify and dropshipping stores** running TikTok and Meta ads that need many creatives to test.
- **Agencies and freelancers** producing UGC ads for several brands.

## Key features

- **Scripts in English or Vietnamese:** the script, voiceover and subtitles follow the language of your product info. Vietnamese gets full diacritics. Product info written in other languages, including supplier listings, produces American English.
- **Batch generation:** create many variations per product (different hooks, styles and lengths) in one run.
- **Ad templates:** 391 ready-made video recipes such as unboxing, before/after, problem → solution, comparison, POV and gift guide. The studio recommends templates from your product name and selling points (English, Vietnamese or supplier text).
- **Storyboard and visuals:** shot-by-shot storyboard with camera moves. Visuals come from AI image/video models, your product photos, or stock footage.
- **Voiceover and subtitles:** free and premium TTS voices for English and Vietnamese, with word-timed karaoke-style subtitles in a font that supports Vietnamese.
- **Ad-compliance check:** flags risky wording before you publish. This covers absolute claims ("best", "#1", "100%"), unproven health claims, unsupported "natural/organic" claims and fake urgency, using US (FTC-style) and Vietnamese rules.
- **Dropshipping-safe copy:** scripts avoid claims dropshippers can't back up, such as guaranteed shipping times, "made in our factory" or local-warehouse claims.
- **Publish pack:** titles, hashtags, cover text and captions for each platform, plus export presets for TikTok, Reels and Shorts.
- **Product import:** paste a product link to pre-fill the name, price and photos where the store allows it (most stores with standard product metadata, including Shopify). Some marketplaces block automatic import. When that happens, upload your product photos and type the product name instead; everything else works the same.

## Local setup

Requirements: Node.js 20+, pnpm 10, and ffmpeg (bundled through npm on most platforms).

```bash
pnpm install
cp .env.example .env.local   # if present; otherwise create .env.local
pnpm dev                     # http://localhost:3000
```

Common environment variables:

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Server-side key for the default script model (never sent to the browser) |
| `LLM_MODEL` | Override the default script model |
| `STUDIO_PROVIDER_MODE=live` | Use real image/video providers (otherwise they are mocked) |
| `STUDIO_SUPABASE_URL`, `STUDIO_SUPABASE_ANON_KEY` | Enable email login (otherwise a local session is used) |
| `AI_PROVIDER_MOCK=1` | Zero-cost mock mode (see below) |

Useful scripts:

```bash
pnpm test          # unit tests (Vitest)
pnpm lint          # ESLint
pnpm tsc --noEmit  # type check
pnpm build         # production build
```

## Mock mode (`AI_PROVIDER_MOCK=1`)

Mock mode lets QA and developers run the full flow with **no API keys and no AI spend**.

```bash
AI_PROVIDER_MOCK=1 pnpm dev
```

With mock mode on:

- Script, publish-copy and review calls return instant, schema-valid sample output. Scripts are in English or Vietnamese to match the product info.
- Image and video generation return small bundled sample files from `public/mock/`.
- Voiceover returns a bundled sample clip with word timings, so subtitles still render.
- Product-link import still fetches the real page (free); everything after it is mocked.

Mock mode overrides `STUDIO_PROVIDER_MODE=live`.

---

## Tiếng Việt

**UGCBatch Studio** là nền tảng SaaS giúp người bán hàng tại **Mỹ** và **Việt Nam** tạo hàng loạt video sản phẩm ngắn phong cách UGC bằng **tiếng Anh** và **tiếng Việt**. Video dùng cho TikTok Shop, Shopee, Amazon, Shopify và quảng cáo TikTok/Meta.

**Dành cho:** người bán TikTok Shop, Shopee, Amazon; chủ shop Shopify và dropshipping; agency và freelancer làm video quảng cáo.

**Tính năng chính:**

- **Kịch bản, lồng tiếng và phụ đề theo ngôn ngữ bạn nhập:** nhập tiếng Việt thì ra tiếng Việt có dấu, nhập tiếng Anh thì ra tiếng Anh.
- **Tạo hàng loạt:** nhiều phiên bản cho mỗi sản phẩm (hook, phong cách, độ dài khác nhau).
- **391 mẫu video quảng cáo**, tự gợi ý theo tên và điểm bán hàng của sản phẩm (hỗ trợ tiếng Việt có dấu và không dấu).
- **Kiểm tra từ ngữ quảng cáo rủi ro** theo quy định Mỹ và Việt Nam: "tốt nhất", "số 1", cam kết chữa bệnh, khan hiếm giả…
- **Gói đăng bài:** tiêu đề, hashtag, chữ trên ảnh bìa cho từng nền tảng.
- **Nhập sản phẩm từ link** khi trang hỗ trợ. Một số sàn chặn việc lấy dữ liệu tự động; khi đó bạn chỉ cần tải ảnh sản phẩm lên và nhập tên sản phẩm.

**Chạy thử trên máy:**

```bash
pnpm install
pnpm dev
```

**Chế độ giả lập (không tốn phí AI):**

```bash
AI_PROVIDER_MOCK=1 pnpm dev
```

Mọi lệnh gọi AI (kịch bản, hình ảnh, video, giọng đọc) sẽ trả về dữ liệu mẫu ngay lập tức. Kịch bản mẫu ra tiếng Anh hoặc tiếng Việt theo ngôn ngữ bạn nhập. Chế độ này dùng để QA chạy toàn bộ quy trình mà không cần API key.

---

## License

This is a modified version of, forked from [xixihhhh/clipforge](https://github.com/xixihhhh/clipforge) under AGPL-3.0.

Licensed under AGPL-3.0; see [LICENSE](./LICENSE). Original copyright headers in the source are preserved. Source code for this version: https://github.com/dnlamchuai-cyber/ugcbatch-studio (also linked as "Source code" in the app footer).
