
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const STORAGE_URL_KEY = 'fleet_sb_url';
const STORAGE_ANON_KEY = 'fleet_sb_key';

// Hardcoded credentials provided by user
const HARDCODED_URL = 'https://wqccvxkbmoqgiiplogew.supabase.co';
const HARDCODED_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxY2N2eGtibW9xZ2lpcGxvZ2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMTQ3NDcsImV4cCI6MjA3ODY5MDc0N30.IwXMBEUgCmD-7iuDmhqGhnCpx-rbRJCMB-s7zYTlAsk';

let supabaseInstance: SupabaseClient | null = null;

export const getSupabaseConfig = () => {
  let envUrl, envKey;
  try {
    // Safely attempt to access process.env
    envUrl = process.env.VITE_SUPABASE_URL;
    envKey = process.env.VITE_SUPABASE_ANON_KEY;
  } catch (e) {
    // process is not defined, ignore
  }
  
  const localUrl = localStorage.getItem(STORAGE_URL_KEY);
  const localKey = localStorage.getItem(STORAGE_ANON_KEY);

  // Prioridad: 1. Env Vars (Vercel), 2. LocalStorage (Manual), 3. Hardcoded (Fallback)
  const finalUrl = envUrl || localUrl || HARDCODED_URL;
  const finalKey = envKey || localKey || HARDCODED_KEY;

  return {
    url: finalUrl,
    key: finalKey
  };
};

export const isSupabaseConfigured = (): boolean => {
  const { url, key } = getSupabaseConfig();
  return !!(url && key);
};

export const getSupabaseClient = (): SupabaseClient | null => {
  if (supabaseInstance) return supabaseInstance;

  const { url, key } = getSupabaseConfig();

  if (url && key) {
    try {
      // Basic validation to prevent crashes with bad URLs
      if (!url.startsWith('http')) {
          console.error("Supabase URL inválida:", url);
          return null;
      }
      
      supabaseInstance = createClient(url, key);
      // Log discreto para confirmar conexión en producción
      console.log("🔌 Conectando a Supabase:", url);
      return supabaseInstance;
    } catch (e) {
      console.error("Failed to initialize Supabase client", e);
      return null;
    }
  }
  console.warn("⚠️ Credenciales de Supabase no encontradas.");
  return null;
};

export const setupSupabase = (url: string, key: string): boolean => {
  if (!url || !key) return false;
  
  const cleanUrl = url.trim();
  const cleanKey = key.trim();

  try {
    new URL(cleanUrl); // Validate URL format
  } catch (e) {
    console.error("Invalid URL format");
    return false;
  }

  localStorage.setItem(STORAGE_URL_KEY, cleanUrl);
  localStorage.setItem(STORAGE_ANON_KEY, cleanKey);
  
  supabaseInstance = null; // Force recreation on next call
  
  // Create the client immediately to verify it doesn't crash
  try {
    getSupabaseClient();
    return true;
  } catch (e) {
    return false;
  }
};

export const disconnectSupabase = () => {
  localStorage.removeItem(STORAGE_URL_KEY);
  localStorage.removeItem(STORAGE_ANON_KEY);
  supabaseInstance = null;
};

export const resetConnection = () => {
    disconnectSupabase();
    // Automatically re-init with defaults will happen on next getSupabaseClient call
};