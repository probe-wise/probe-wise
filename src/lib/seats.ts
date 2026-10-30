import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { isSupabaseConfigured } from "@/lib/env";
import { createAnonClient } from "@/lib/supabase/server";

export const SEATS_TAG = "seats";

/**
 * Seats a brand-new visitor could still claim, or null if unknown
 * (Supabase not configured or unreachable). Public and identical for everyone,
 * so it's cached on the server for about a minute.
 * The real cap is enforced in the database by claim_seat(); this number is display-only.
 */
export async function getSeatsRemaining(): Promise<number | null> {
  "use cache";
  cacheTag(SEATS_TAG);
  cacheLife("minutes");

  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await createAnonClient().rpc("seats_remaining");
    if (error || typeof data !== "number") return null;
    return Math.max(0, data);
  } catch {
    return null;
  }
}
