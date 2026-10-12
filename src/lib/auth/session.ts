"use client";
/**
 * Client session: Supabase email+password when configured, otherwise a mock
 * local session kept in localStorage (development / self-hosted mock mode).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { StudioAuthConfig } from "./config";

export interface StudioSession { email: string; userId: string; mode: "supabase" | "mock" }

const MOCK_KEY = "studio-mock-session";
let cfgPromise: Promise<StudioAuthConfig> | null = null;
let client: SupabaseClient | null = null;

export function loadAuthConfig(): Promise<StudioAuthConfig> {
  cfgPromise ??= fetch("/api/auth/config").then((r) => r.json()).catch(() => ({ mode: "mock" as const }));
  return cfgPromise;
}

async function sb(): Promise<SupabaseClient | null> {
  const cfg = await loadAuthConfig();
  if (cfg.mode !== "supabase" || !cfg.url || !cfg.anonKey) return null;
  client ??= createClient(cfg.url, cfg.anonKey);
  return client;
}

export function mockSessionFor(email: string): StudioSession {
  return { email: email.trim().toLowerCase(), userId: `local-${email.trim().toLowerCase()}`, mode: "mock" };
}

export async function getSession(): Promise<StudioSession | null> {
  const c = await sb();
  if (c) {
    const { data } = await c.auth.getSession();
    const u = data.session?.user;
    return u ? { email: u.email ?? "", userId: u.id, mode: "supabase" } : null;
  }
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    return raw ? (JSON.parse(raw) as StudioSession) : null;
  } catch {
    return null;
  }
}

export async function signIn(email: string, password: string, signUp = false): Promise<StudioSession> {
  if (!email.includes("@")) throw new Error("Please enter a valid email");
  if (password.length < 6) throw new Error("Password must be at least 6 characters");
  const c = await sb();
  if (c) {
    const res = signUp
      ? await c.auth.signUp({ email, password })
      : await c.auth.signInWithPassword({ email, password });
    if (res.error) throw new Error(res.error.message);
    const u = res.data.user;
    if (!u) throw new Error("Check your inbox to confirm your email");
    return { email: u.email ?? email, userId: u.id, mode: "supabase" };
  }
  const s = mockSessionFor(email);
  localStorage.setItem(MOCK_KEY, JSON.stringify(s));
  return s;
}

export async function signOut(): Promise<void> {
  const c = await sb();
  if (c) await c.auth.signOut();
  localStorage.removeItem(MOCK_KEY);
}
