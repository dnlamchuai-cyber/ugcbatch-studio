import { NextRequest, NextResponse } from "next/server";
import { aiErrorCode } from "@/lib/error-codes";
import { withMockLlmConfig } from "@/lib/mock-ai";
import { generateTopicScript } from "@/lib/script-engine/generator";
import { parseOutputLanguage, type TopicNarrationStyle } from "@/lib/script-engine/prompts";
import { getDb } from "@/lib/db";
import { scripts as scriptsTable, projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { apiError, errText } from "@/lib/api-error";
import { llmErrorPair } from "@/lib/llm-error";
import { rejectUnsafeBaseUrls } from "@/lib/baseurl-gate";

const VALID_NARRATION = new Set<TopicNarrationStyle>([
  "knowledge",
  "story",
  "lifestyle",
  "inspiration",
  "travel",
]);

/** truncate topic to a project name (keep first 20 characters) */
function topicToName(topic: string): string {
  const t = topic.trim().replace(/\s+/g, " ");
  return t.length > 20 ? `${t.slice(0, 20)}…` : t;
}

/**
 * POST /api/topic/script —— one-sentence topic-to-video entry point (non-product / topic mode).
 * Completes in a single request: create project (contentType=topic) + generate multiple narration scripts with English search keywords and persist them.
 * The frontend can then call /api/project/[id]/stock-fill to auto-fill footage → /api/project/[id]/compose to render.
 *
 * body: { topic, narrationStyle?, targetDuration?, count?, platforms?, projectId?, llmConfig }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    { const blocked = await rejectUnsafeBaseUrls(body); if (blocked) return blocked; } // SSRF: private/metadata baseUrl → 400 BASEURL_BLOCKED
  } catch {
    return apiError(req, "Request body is not valid JSON", "Request body is not valid JSON", 400, "INVALID_JSON");
  }

  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) {
    return apiError(req, "Please enter a one-sentence topic", "Please enter a one-sentence topic", 400, "TOPIC_REQUIRED");
  }

  const llmConfig = withMockLlmConfig(body.llmConfig as { baseUrl?: string; apiKey?: string; model?: string } | undefined);
  if (!llmConfig?.baseUrl || !llmConfig?.apiKey || !llmConfig?.model) {
    return apiError(req, "Please configure the LLM parameters (baseUrl, apiKey, model)", "Please configure the LLM parameters (baseUrl, apiKey, model)", 400, "LLM_NOT_CONFIGURED");
  }

  const narrationStyle = VALID_NARRATION.has(body.narrationStyle as TopicNarrationStyle)
    ? (body.narrationStyle as TopicNarrationStyle)
    : "knowledge";
  const targetDuration =
    typeof body.targetDuration === "number" && body.targetDuration > 0 ? body.targetDuration : 25;
  const count = typeof body.count === "number" && body.count >= 1 && body.count <= 5 ? body.count : 3;
  const platforms = typeof body.platforms === "string" ? body.platforms : undefined;

  const db = getDb();

  // use an existing project or create a new topic project (create before generation so a draft project exists for retry even if generation fails)
  let projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : "";
  if (projectId) {
    const exists = await db
      .select({ id: projects.id, contentType: projects.contentType })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (exists.length === 0) {
      return apiError(req, "Project not found", "Project not found", 404, "PROJECT_NOT_FOUND");
    }
    // refuse to overwrite a product project with a topic script — it would silently convert it to topic type and delete its existing scripts
    if (exists[0].contentType === "product") {
      return NextResponse.json(
        { error: errText(req, "This project is a commerce project — please create a new topic project instead of overwriting it", "This project is a commerce project — please create a new topic project instead of overwriting it"), code: "PROJECT_TYPE_CONFLICT", projectId },
        { status: 409 }
      );
    }
  } else {
    const [created] = await db
      .insert(projects)
      .values({ name: topicToName(topic), contentType: "topic", topic, status: "draft" })
      .returning();
    projectId = created.id;
  }

  // generate scripts
  let generated;
  try {
    generated = await generateTopicScript({
      topic,
      narrationStyle,
      targetDuration,
      count,
      platforms,
      outputLanguage: parseOutputLanguage(body.outputLanguage),
      llmConfig: llmConfig as { baseUrl: string; apiKey: string; model: string },
    });
  } catch (error) {
    // LLM failures carry an actionable bilingual message (bad key / dead free endpoint / rate limit)
    const { zh, en } = llmErrorPair(error);
    // project already created; return projectId so the frontend can navigate and retry
    return NextResponse.json({ error: errText(req, `Script generation failed: ${en}`, `Script generation failed: ${en}`), code: aiErrorCode(error, "SCRIPT_FAILED"), projectId }, { status: 500 });
  }

  // persist to DB: delete old scripts → insert new ones → select first by default → update project status to scripting
  let savedScripts = generated;
  try {
    await db.delete(scriptsTable).where(eq(scriptsTable.projectId, projectId));
    const rows = await db
      .insert(scriptsTable)
      .values(
        generated.map((s, i) => ({
          projectId,
          version: 1,
          styleType: "custom" as const, // topic videos always use custom style type
          title: s.title,
          totalDuration: s.totalDuration,
          shots: s.shots,
          selected: i === 0,
        }))
      )
      .returning();
    savedScripts = rows.map((r) => ({
      id: r.id,
      title: r.title ?? "",
      styleType: r.styleType,
      totalDuration: r.totalDuration ?? 0,
      shots: r.shots ?? [],
      selected: r.selected ?? false,
    })) as typeof generated;
    await db
      .update(projects)
      .set({ status: "scripting", contentType: "topic", topic, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  } catch (e) {
    // DB persistence failure must return an error, never fall back to 200 — the frontend would navigate as if successful but find empty scripts (old scripts may already be deleted = data loss)
    console.error("topic script DB persistence failed:", e);
    return NextResponse.json({ error: errText(req, "Failed to save scripts to the database, please try again", "Failed to save scripts to the database, please try again"), code: "DB_SAVE_FAILED", projectId }, { status: 500 });
  }

  return NextResponse.json({ projectId, scripts: savedScripts });
}
