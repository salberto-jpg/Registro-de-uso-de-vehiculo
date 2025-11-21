
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const STORAGE_URL_KEY = 'fleet_sb_url';
const STORAGE_ANON_KEY = 'fleet_sb_key';

const HARDCODED_URL = 'https://wqccvxkbmoqgiiplogew.supabase.co';
const HARDCODED_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxY2N2eGtibW9xZ2lpcGxvZ2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMTQ3NDcsImV4cCI6MjA3ODY5MDc0N30.IwXMBEUgCmD-7iuDmhqGhnCpx-rbRJCMB-s7zYTlAsk';

let supabaseInstance: SupabaseClient | null = null;

export const getSupabaseConfig = () => {
  let envUrl, envKey;
  try {
    // Accessing process.env directly can sometimes cause issues in browser if not polyfilled
    // We check for existence implicitly or rely on the try/catch
    envUrl = process.env.VITE_SUPABASE_URL;
    envKey = process.env.VITE_SUPABASE_ANON_KEY;
  } catch (e) {
    // Ignore reference errors
  }
  
  const localUrl = localStorage.getItem(STORAGE_URL_KEY);
  const localKey = localStorage.getItem(STORAGE_ANON_KEY);

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
      if (!url.startsWith('http')) {
          return null;
      }
      supabaseInstance = createClient(url, key);
      return supabaseInstance;
    } catch (e) {
      console.error("Supabase init failed", e);
      return null;
    }
  }
  return null;
};

export const setupSupabase = (url: string, key: string): boolean => {
  if (!url || !key) return false;
  
  const cleanUrl = url.trim();
  const cleanKey = key.trim();

  try {
    new URL(cleanUrl); 
  } catch (e) {
    return false;
  }

  localStorage.setItem(STORAGE_URL_KEY, cleanUrl);
  localStorage.setItem(STORAGE_ANON_KEY, cleanKey);
  
  supabaseInstance = null; 
  
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
};