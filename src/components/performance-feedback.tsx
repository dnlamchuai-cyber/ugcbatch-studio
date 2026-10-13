"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { LuChartNoAxesColumn, LuCheck } from "react-icons/lu";
import type { StyleInsight, HookInsight } from "@/lib/performance-insights";

// style key → display name (aggregation returns the styleType key)
const STYLE_LABEL: Record<string, { vi: string; en: string }> = {
  pain_point: { vi: "Đánh vào nỗi đau", en: "Pain-point" },
  scene: { vi: "Gợi ý theo bối cảnh", en: "Scene" },
  comparison: { vi: "So sánh, review", en: "Comparison" },
  story: { vi: "Kể chuyện", en: "Story" },
  custom: { vi: "Tùy chỉnh", en: "Custom" },
};

// hook mechanism id → display name (corresponds to HOOK_PATTERNS in hook-patterns)
const HOOK_LABEL: Record<string, { vi: string; en: string }> = {
  visual_shock: { vi: "Gây ấn tượng thị giác", en: "Visual shock" },
  suspense_question: { vi: "Câu hỏi gây tò mò", en: "Suspense" },
  contrast: { vi: "Tương phản", en: "Contrast" },
  pain_strike: { vi: "Chạm đúng nỗi đau", en: "Pain-point" },
  before_after: { vi: "Trước – sau", en: "Before-after" },
  sound_hook: { vi: "Hook âm thanh", en: "Sound hook" },
  challenge_doubt: { vi: "Thách thức, nghi vấn", en: "Challenge" },
  identity: { vi: "Đồng cảm nhóm khách", en: "Identity" },
  number_benefit: { vi: "Lợi ích bằng con số", en: "Number" },
  unexpected: { vi: "Bất ngờ, ngược đời", en: "Unexpected" },
};

const NUM_FIELDS = [
  { key: "views", vi: "Lượt xem", en: "Views" },
  { key: "likes", vi: "Lượt thích", en: "Likes" },
  { key: "comments", vi: "Bình luận", en: "Comments" },
  { key: "shares", vi: "Chia sẻ", en: "Shares" },
  { key: "orders", vi: "Đơn hàng", en: "Orders" },
] as const;

type FormState = { platform: string; hookId: string; views: string; likes: string; comments: string; shares: string; orders: string; note: string };
const EMPTY: FormState = { platform: "tiktok", hookId: "", views: "", likes: "", comments: "", shares: "", orders: "", note: "" };

export function PerformanceFeedback({ projectId }: { projectId: string }) {
  const locale = useLocale();
  const en = locale !== "vi";
  const [form, setForm] = useState<FormState>(EMPTY);
  const [insights, setInsights] = useState<StyleInsight[]>([]);
  const [hookInsights, setHookInsights] = useState<HookInsight[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadInsights = useCallback(async () => {
    try {
      const r = await fetch("/api/insights/styles");
      const j = await r.json();
      setInsights(Array.isArray(j.insights) ? j.insights : []);
      setHookInsights(Array.isArray(j.hookInsights) ? j.hookInsights : []);
    } catch {
      /* silent: an empty insights section is acceptable */
    }
  }, []);
  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`/api/project/${projectId}/metrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setSaved(true);
      setForm({ ...EMPTY, platform: form.platform });
      loadInsights();
    } finally {
      setSaving(false);
    }
  };

  const fmtPct = (x: number) => (x * 100).toFixed(2) + "%";
  const styleName = (s: string) => STYLE_LABEL[s]?.[en ? "en" : "vi"] ?? s;
  const hookName = (h: string) => HOOK_LABEL[h]?.[en ? "en" : "vi"] ?? h;
  const canSave = Number(form.views) > 0;

  return (
    <Card className="glass-card">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <LuChartNoAxesColumn className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">{en ? "Performance feedback" : "Hiệu quả sau đăng"}</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {en
            ? "After publishing, log this video's numbers → learn which script style actually sells, and let it feed back into future scripts."
            : "Sau khi đăng, nhập số liệu của video này → biết kiểu kịch bản nào bán chạy hơn để áp dụng cho các kịch bản sau."}
        </p>

        {/* data entry form */}
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">{en ? "Platform" : "Nền tảng"}</span>
            <select
              value={form.platform}
              onChange={(e) => setForm({ ...form, platform: e.target.value })}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="tiktok">TikTok</option>
              <option value="shopee">Shopee</option>
              <option value="amazon">Amazon</option>
              <option value="facebook">Facebook</option>
              <option value="shopify">Shopify</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">{en ? "Hook" : "Hook"}</span>
            <select
              value={form.hookId}
              onChange={(e) => setForm({ ...form, hookId: e.target.value })}
              title={en ? "Which hook mechanism this video used (for hook A/B)" : "Video này dùng kiểu hook nào (để A/B test hook)"}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{en ? "— hook —" : "— chọn hook —"}</option>
              {Object.entries(HOOK_LABEL).map(([id, l]) => (
                <option key={id} value={id}>
                  {en ? l.en : l.vi}
                </option>
              ))}
            </select>
          </label>
          {NUM_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">{en ? f.en : f.vi}</span>
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                className="h-9 w-20"
                placeholder="0"
              />
            </label>
          ))}
          <Button onClick={submit} disabled={!canSave || saving} size="sm" className="brand-gradient text-white h-9">
            {saved ? <LuCheck className="w-4 h-4 mr-1" /> : null}
            {saving ? (en ? "Saving…" : "Đang lưu…") : saved ? (en ? "Saved" : "Đã lưu") : en ? "Save" : "Lưu"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mb-4">
          {en ? "Tip: views is required; the script style is captured automatically." : "Mẹo: bắt buộc nhập lượt xem; kiểu kịch bản được ghi nhận tự động."}
        </p>

        {/* aggregated insight: which style sells best */}
        {insights.length > 0 && (
          <div className="border-t border-border/50 pt-3">
            <p className="text-xs font-medium mb-2">
              {en ? "Which style sells best (all projects)" : "Kiểu kịch bản nào bán chạy nhất (mọi dự án)"}
            </p>
            <div className="space-y-1.5">
              {insights.map((it, i) => (
                <div key={it.style} className="flex items-center gap-3 text-xs">
                  <span className={`w-16 shrink-0 ${i === 0 ? "text-emerald-500 font-medium" : ""}`}>
                    {i === 0 ? "🏆 " : ""}
                    {styleName(it.style)}
                  </span>
                  <span className="text-muted-foreground">
                    {en ? "conv." : "chuyển đổi"} <b className={i === 0 ? "text-emerald-500" : ""}>{fmtPct(it.conversionRate)}</b>
                  </span>
                  <span className="text-muted-foreground">
                    {en ? "eng." : "tương tác"} {fmtPct(it.engagementRate)}
                  </span>
                  <span className="text-muted-foreground/70">
                    {en ? `${it.samples} sample(s)` : `${it.samples} mẫu`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* aggregated insight: which hook mechanism sells best */}
        {hookInsights.length > 0 && (
          <div className="border-t border-border/50 pt-3 mt-3">
            <p className="text-xs font-medium mb-2">
              {en ? "Which hook sells best (all projects)" : "Hook nào bán chạy nhất (mọi dự án)"}
            </p>
            <div className="space-y-1.5">
              {hookInsights.map((it, i) => (
                <div key={it.hookId} className="flex items-center gap-3 text-xs">
                  <span className={`w-16 shrink-0 ${i === 0 ? "text-emerald-500 font-medium" : ""}`}>
                    {i === 0 ? "🏆 " : ""}
                    {hookName(it.hookId)}
                  </span>
                  <span className="text-muted-foreground">
                    {en ? "conv." : "chuyển đổi"} <b className={i === 0 ? "text-emerald-500" : ""}>{fmtPct(it.conversionRate)}</b>
                  </span>
                  <span className="text-muted-foreground">
                    {en ? "eng." : "tương tác"} {fmtPct(it.engagementRate)}
                  </span>
                  <span className="text-muted-foreground/70">
                    {en ? `${it.samples} sample(s)` : `${it.samples} mẫu`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
