import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import ws from 'ws';
import dns from 'dns';
import { mockSupabase } from './mock-db';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

const realClient = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        transport: ws as any,
        params: {
          eventsPerSecond: 10,
        },
      },
      auth: {
        persistSession: false,
      },
      global: {
        fetch: (url, options = {}) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);
          return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
        },
      },
    })
  : null;

let useMock = true; // Default to safe offline/mock mode first

if (realClient && supabaseUrl) {
  try {
    const hostname = new URL(supabaseUrl).hostname;
    dns.lookup(hostname, (err) => {
      if (err) {
        console.warn(`⚠️ Supabase host ${hostname} is unreachable (offline). Remaining in Local Mock Database mode.`);
      } else {
        console.log(`✅ Supabase host ${hostname} is reachable. Upgraded to online database mode.`);
        useMock = false;
      }
    });
  } catch (e) {
    useMock = true;
  }
}

export const supabase = new Proxy({} as any, {
  get(target, prop) {
    if (useMock || !realClient) {
      return (mockSupabase as any)[prop];
    }
    return (realClient as any)[prop];
  }
});
