"use client";
import { useLocale } from "@/lib/i18n";

/** AGPL source-code notice, shown in the current UI locale. */
export function SiteFooter() {
  const vi = useLocale() === "vi";
  return (
    <footer className="py-2 text-center text-xs text-muted-foreground">
      {vi
        ? "UGCBatch Studio là phần mềm tự do theo giấy phép AGPL-3.0, dựa trên ClipForge."
        : "UGCBatch Studio is free software under AGPL-3.0, based on ClipForge."}{" "}
      <a className="underline" href="https://github.com/dnlamchuai-cyber/ugcbatch-studio" target="_blank" rel="noopener noreferrer">
        {vi ? "Mã nguồn" : "Source code"}
      </a>
    </footer>
  );
}
