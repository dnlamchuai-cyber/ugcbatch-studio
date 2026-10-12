import type { Locale, NamespaceMessages } from "../config";
import viGenerated from "./vi.generated.json";
import { auth } from "./auth";
import { common } from "./common";
import { home } from "./home";
import { start } from "./start";
import { topic } from "./topic";
import { newProject } from "./newProject";
import { clone } from "./clone";
import { batch } from "./batch";
import { products } from "./products";
import { settings } from "./settings";
import { generationSettings } from "./generationSettings";
import { showcase } from "./showcase";
import { script } from "./script";
import { assets } from "./assets";
import { video } from "./video";
import { exportPage } from "./exportPage";
import { projectsPage } from "./projectsPage";
import { presenters } from "./presenters";
import { mediaLab } from "./mediaLab";
import { production } from "./production";
import { transcript } from "./transcript";
import { materials } from "./materials";

// 所有命名空间集中注册（新增页面时在此追加一行）
const namespaces = {
  common,
  home,
  start,
  topic,
  newProject,
  clone,
  batch,
  products,
  settings,
  generationSettings,
  showcase,
  script,
  assets,
  video,
  exportPage,
  projectsPage,
  presenters,
  mediaLab,
  production,
  transcript,
  materials,
  auth,
};

/** messages[locale][namespace][key] = 翻译文本 */
export const messages: Record<Locale, Record<string, Record<string, string>>> = {
  en: Object.fromEntries(Object.entries(namespaces).map(([ns, m]) => [ns, m.en])),
  // Vietnamese: generated translations + per-namespace overrides; missing keys fall back to English.
  vi: Object.fromEntries(
    Object.entries(namespaces).map(([ns, m]) => [
      ns,
      { ...((viGenerated as Record<string, Record<string, string>>)[ns] ?? {}), ...((m as NamespaceMessages).vi ?? {}) },
    ])
  ),
};
