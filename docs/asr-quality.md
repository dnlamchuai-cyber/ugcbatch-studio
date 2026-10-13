# Local transcription quality evaluation

Tiny, Base and Small use local weights that output word timestamps. Plain weights without attention outputs cannot support word-deletion editing and have been removed from the options. Existing complete transcripts and edit versions remain readable; unfinished transcriptions from an old model restart with the current selection.

Tiny is the default, Base is the balanced tier, and Small is an experimental tier that needs more memory. Downloads come from public model repositories and recognition runs on this machine; no paid transcription calls are added. Consider the first download and cache size; switching models releases the old inference session.

## Reproducible evaluation

Prepare a JSON file containing only local audio paths and human reference text, each item shorter than 120 seconds:

```json
[{ "id": "product-01", "audio": "product.wav", "reference": "This insulated bottle doesn't leak even in a bag.", "language": "en" }]
```

```sh
node scripts/benchmark-local-asr.mjs --manifest samples.json --model tiny --output tiny-report.json --allow-download
node scripts/benchmark-local-asr.mjs --manifest samples.json --model base --output base-report.json --allow-download
node scripts/benchmark-local-asr.mjs --manifest samples.json --model small --output small-report.json --allow-download
```

Pass `--allow-download` only when the first download is allowed; without it later runs use the cache only. Use `--cache` to set the model cache directory. Each model runs in its own process, and the report includes character error rate (CER), recognized text per item, the share of valid timestamps, load/inference time, real-time factor and peak process memory. Audio is never uploaded.

CER only normalizes full-width characters, case, punctuation and whitespace; differences between Simplified and Traditional Chinese and between number spellings are kept. CER cannot replace human checks of meaning and timing alignment: for example, "ninety-nine" written out in Chinese characters versus "99", or a Simplified/Traditional conversion, still counts as a character difference. The valid-timestamp share only checks values, ordering and bounds; it does not measure word alignment accuracy.

## Local check on 2026-09-05

macOS arm64, Node CPU q8, the same 8.94-second system-synthesized Chinese product description:

| Model | Raw CER | Inference time | Real-time factor | Peak process memory | Valid timestamps |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tiny timestamped | 27.0% | 0.70 s | 0.078 | 760 MB | 100% |
| Base timestamped | 37.8% | 0.99 s | 0.111 | 1056 MB | 100% |
| Small timestamped | 37.8% | 1.83 s | 0.205 | 1947 MB | 100% |

On human review, Base and Small produced identical output for this sample, including Simplified/Traditional and number-format conversions; Tiny misrecognized content words, so this raw CER table cannot be taken to mean Tiny is more accurate. The sample is only a compatibility smoke test; it does not represent real noise, dialects, product terms or long audio, and is not used to switch the default model automatically.

In the browser, Tiny with WebGPU (encoder fp32 / decoder q4) also completed import, chunked extraction, transcription and timeline saving for the same audio. CPU q8 timings and text results are not the same as browser WebGPU/WASM results.
