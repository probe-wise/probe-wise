import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { Database } from "@/lib/database.types";
import { requireSupabaseEnv } from "@/lib/env";

/** Per-request client that acts as the signed-in user (RLS applies). */
export async function createClient() {
  const { url, key } = requireSupabaseEnv();
  // Per-request by nature. Without this, runtime prefetching renders with cookies available and the
  // SDK's token-expiry check hits Date.now() during prerender.
  await connection();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Safe to ignore: proxy.ts refreshes the session on every request.
        }
      },
    },
  });
}

/** Cookie-less client for public data (e.g. the landing-page seat counter). */
export function createAnonClient() {
  const { url, key } = requireSupabaseEnv();
  return createPlainClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
