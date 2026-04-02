import type { DatabaseProvider } from '../types';

export interface SupabaseDatabaseConfig {
  provider: 'supabase';
  projectUrl: string;
  anonKey: string;
  serviceRoleKey?: string;
}

export interface FirebaseDatabaseConfig {
  provider: 'firebase';
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
  measurementId?: string;
}

export type DatabaseConfig = SupabaseDatabaseConfig | FirebaseDatabaseConfig;

export interface DatabaseStatus {
  provider: DatabaseProvider | null;
  isConfigured: boolean;
  config: DatabaseConfig | null;
}

function upsertEnvContent(existing: string | undefined, entries: Array<[string, string]>) {
  const lines = (existing || '').split(/\r?\n/);
  const nextLines = [...lines];

  for (const [key, value] of entries) {
    const entry = `${key}="${value}"`;
    const index = nextLines.findIndex((line) => line.startsWith(`${key}=`));

    if (index >= 0) {
      nextLines[index] = entry;
    } else {
      nextLines.push(entry);
    }
  }

  const normalized = nextLines.filter((line, index, arr) => {
    return !(index === arr.length - 1 && line === '');
  });

  return `${normalized.join('\n').trim()}\n`;
}

export function buildDatabaseFiles(config: DatabaseConfig, existingFiles: Record<string, string>) {
  const nextFiles = { ...existingFiles };

  nextFiles['database.config.json'] = JSON.stringify(config, null, 2);

  delete nextFiles['firebase-applet-config.json'];
  delete nextFiles['supabase-applet-config.json'];

  if (config.provider === 'supabase') {
    nextFiles['supabase-applet-config.json'] = JSON.stringify(config, null, 2);
    nextFiles['.env.example'] = upsertEnvContent(nextFiles['.env.example'], [
      ['VITE_SUPABASE_URL', config.projectUrl],
      ['VITE_SUPABASE_ANON_KEY', config.anonKey],
      ['SUPABASE_SERVICE_ROLE_KEY', config.serviceRoleKey || ''],
    ]);
  } else {
    nextFiles['firebase-applet-config.json'] = JSON.stringify(config, null, 2);
    nextFiles['.env.example'] = upsertEnvContent(nextFiles['.env.example'], [
      ['VITE_FIREBASE_API_KEY', config.apiKey],
      ['VITE_FIREBASE_AUTH_DOMAIN', config.authDomain],
      ['VITE_FIREBASE_PROJECT_ID', config.projectId],
      ['VITE_FIREBASE_STORAGE_BUCKET', config.storageBucket || ''],
      ['VITE_FIREBASE_MESSAGING_SENDER_ID', config.messagingSenderId || ''],
      ['VITE_FIREBASE_APP_ID', config.appId],
      ['VITE_FIREBASE_MEASUREMENT_ID', config.measurementId || ''],
    ]);
  }

  return nextFiles;
}

export function getDatabaseStatus(files: Record<string, string>): DatabaseStatus {
  const unifiedConfig = files['database.config.json'];

  if (unifiedConfig) {
    try {
      const config = JSON.parse(unifiedConfig) as DatabaseConfig;
      return {
        provider: config.provider,
        isConfigured: true,
        config,
      };
    } catch (_error) {
      return { provider: null, isConfigured: false, config: null };
    }
  }

  if (files['supabase-applet-config.json']) {
    try {
      const config = JSON.parse(files['supabase-applet-config.json']) as SupabaseDatabaseConfig;
      return { provider: 'supabase', isConfigured: true, config };
    } catch (_error) {
      return { provider: null, isConfigured: false, config: null };
    }
  }

  if (files['firebase-applet-config.json']) {
    try {
      const config = JSON.parse(files['firebase-applet-config.json']) as FirebaseDatabaseConfig;
      return { provider: 'firebase', isConfigured: true, config };
    } catch (_error) {
      return { provider: null, isConfigured: false, config: null };
    }
  }

  return { provider: null, isConfigured: false, config: null };
}
