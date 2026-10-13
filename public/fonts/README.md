# Subtitle font

`subtitle.ttf` is **Be Vietnam Pro SemiBold** (SIL OFL 1.1, see `OFL.txt`), source:
https://github.com/google/fonts/tree/main/ofl/bevietnampro

It covers full Vietnamese (all diacritics such as ư ơ ở ỗ ặ Đ) plus Latin, so Vietnamese and
English subtitles render identically on every platform.

`resolveChineseFontFile()` in `src/lib/video-composer/composer.ts` picks this file first, and
`resolveChineseFontFamily()` returns `Be Vietnam Pro SemiBold` so libass (karaoke captions) uses it too.
