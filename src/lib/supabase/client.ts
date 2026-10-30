"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { requireSupabaseEnv } from "@/lib/env";

export function createClient() {
  const { url, key } = requireSupabaseEnv();
  return createBrowserClient<Database>(url, key);
}
