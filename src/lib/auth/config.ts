/**
 * Auth/data backend configuration.
 * This product uses its OWN Supabase project via STUDIO_SUPABASE_URL /
 * STUDIO_SUPABASE_ANON_KEY. When either is unset the app runs in local mock
 * mode: a local session (no network) and the local SQLite store.
 */
export interface StudioAuthConfig {
  mode: "supabase" | "mock";
  url?: string;
  anonKey?: string;
}

export function getStudioAuthConfig(env: Record<string, string | undefined> = process.env): StudioAuthConfig {
  const url = env.STUDIO_SUPABASE_URL?.trim();
  const anonKey = env.STUDIO_SUPABASE_ANON_KEY?.trim();
  if (url && anonKey) return { mode: "supabase", url, anonKey };
  return { mode: "mock" };
}
