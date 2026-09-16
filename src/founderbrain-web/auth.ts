import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Config } from "./types";

export interface AuthSession { token: string | null; email: string | null; signIn(email: string): Promise<void>; signOut(): Promise<void>; subscribe(listener: (token: string | null, email: string | null) => void): () => void; }

export function configuredAuth(config: Config): AuthSession {
  if (config.authMode === "local-demo") return {
    token: null, email: "demo@local", async signIn() {}, async signOut() {}, subscribe(listener) { listener(null, "demo@local"); return () => {}; },
  };
  if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error("Managed authentication is not configured.");
  const client: SupabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { storage: window.sessionStorage, storageKey: "founderbrain.auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return {
    token: null, email: null,
    async signIn(email) { const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin, shouldCreateUser: false } }); if (error) throw error; },
    async signOut() { const { error } = await client.auth.signOut(); window.sessionStorage.removeItem("founderbrain.auth"); if (error) throw error; },
    subscribe(listener) {
      void client.auth.getSession().then(({ data }) => listener(data.session?.access_token ?? null, data.session?.user.email ?? null));
      const { data } = client.auth.onAuthStateChange((_event, session) => listener(session?.access_token ?? null, session?.user.email ?? null));
      return () => data.subscription.unsubscribe();
    },
  };
}
