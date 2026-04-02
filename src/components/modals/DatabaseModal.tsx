import React, { useEffect, useState } from 'react';
import { Database, Flame, Layers3, Check, X } from 'lucide-react';
import type { DatabaseProvider } from '../../types';
import type {
  DatabaseConfig,
  FirebaseDatabaseConfig,
  SupabaseDatabaseConfig,
} from '../../utils/database-config';

interface DatabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialConfig: DatabaseConfig | null;
  onSave: (config: DatabaseConfig) => void;
}

const providerCards = {
  supabase: {
    icon: Layers3,
    title: 'Supabase',
    description: 'Postgres + Auth + Storage + Realtime. Best default for production-grade app generation.',
  },
  firebase: {
    icon: Flame,
    title: 'Firebase',
    description: 'Fast setup for Auth, Firestore, Storage, and client-first realtime apps.',
  },
};

const emptySupabase: SupabaseDatabaseConfig = {
  provider: 'supabase',
  projectUrl: '',
  anonKey: '',
  serviceRoleKey: '',
};

const emptyFirebase: FirebaseDatabaseConfig = {
  provider: 'firebase',
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
  measurementId: '',
};

export function DatabaseModal({ isOpen, onClose, initialConfig, onSave }: DatabaseModalProps) {
  const [provider, setProvider] = useState<DatabaseProvider>('supabase');
  const [supabaseConfig, setSupabaseConfig] = useState<SupabaseDatabaseConfig>(emptySupabase);
  const [firebaseConfig, setFirebaseConfig] = useState<FirebaseDatabaseConfig>(emptyFirebase);

  useEffect(() => {
    if (!isOpen) return;

    if (initialConfig?.provider === 'firebase') {
      setProvider('firebase');
      setFirebaseConfig({ ...emptyFirebase, ...initialConfig });
    } else if (initialConfig?.provider === 'supabase') {
      setProvider('supabase');
      setSupabaseConfig({ ...emptySupabase, ...initialConfig });
    } else {
      setProvider('supabase');
      setSupabaseConfig(emptySupabase);
      setFirebaseConfig(emptyFirebase);
    }
  }, [initialConfig, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const canSave =
    provider === 'supabase'
      ? Boolean(supabaseConfig.projectUrl.trim() && supabaseConfig.anonKey.trim())
      : Boolean(
          firebaseConfig.apiKey.trim() &&
            firebaseConfig.authDomain.trim() &&
            firebaseConfig.projectId.trim() &&
            firebaseConfig.appId.trim()
        );

  const handleSave = () => {
    onSave(provider === 'supabase' ? supabaseConfig : firebaseConfig);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm p-3 sm:flex sm:items-center sm:justify-center sm:p-4">
      <div className="flex h-full items-end sm:h-auto sm:items-center sm:justify-center">
        <div className="flex w-full max-w-3xl max-h-[calc(100vh-1.5rem)] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl sm:max-h-[90vh]">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-4 sm:px-5">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                <Database className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-white sm:text-lg">Database Setup</h2>
                <p className="text-xs text-zinc-400 sm:text-sm">
                  Configure the provider the agent should use when generating backend-enabled apps.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5">
            <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-6">
              <div className="space-y-3">
                {(['supabase', 'firebase'] as DatabaseProvider[]).map((key) => {
                  const item = providerCards[key];
                  const Icon = item.icon;

                  return (
                    <button
                      key={key}
                      onClick={() => setProvider(key)}
                      className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                        provider === key
                          ? 'border-indigo-500 bg-indigo-500/10 text-white'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      <div className="mb-2 flex items-center gap-3">
                        <Icon className="h-5 w-5" />
                        <div className="font-semibold">{item.title}</div>
                      </div>
                      <p className="text-xs leading-5 text-zinc-400">{item.description}</p>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                {provider === 'supabase' ? (
                  <>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-zinc-300">Project URL</label>
                      <input
                        type="text"
                        value={supabaseConfig.projectUrl}
                        onChange={(e) =>
                          setSupabaseConfig((prev) => ({ ...prev, projectUrl: e.target.value }))
                        }
                        placeholder="https://your-project.supabase.co"
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-zinc-300">Anon Key</label>
                      <textarea
                        value={supabaseConfig.anonKey}
                        onChange={(e) =>
                          setSupabaseConfig((prev) => ({ ...prev, anonKey: e.target.value }))
                        }
                        placeholder="eyJ..."
                        className="min-h-20 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 sm:min-h-24"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-zinc-300">
                        Service Role Key
                      </label>
                      <textarea
                        value={supabaseConfig.serviceRoleKey || ''}
                        onChange={(e) =>
                          setSupabaseConfig((prev) => ({ ...prev, serviceRoleKey: e.target.value }))
                        }
                        placeholder="Optional, only for trusted server-side routes"
                        className="min-h-20 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 sm:min-h-24"
                      />
                    </div>
                  </>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-zinc-300">API Key</label>
                      <input
                        type="text"
                        value={firebaseConfig.apiKey}
                        onChange={(e) =>
                          setFirebaseConfig((prev) => ({ ...prev, apiKey: e.target.value }))
                        }
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-zinc-300">Auth Domain</label>
                      <input
                        type="text"
                        value={firebaseConfig.authDomain}
                        onChange={(e) =>
                          setFirebaseConfig((prev) => ({ ...prev, authDomain: e.target.value }))
                        }
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-zinc-300">Project ID</label>
                      <input
                        type="text"
                        value={firebaseConfig.projectId}
                        onChange={(e) =>
                          setFirebaseConfig((prev) => ({ ...prev, projectId: e.target.value }))
                        }
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-zinc-300">Storage Bucket</label>
                      <input
                        type="text"
                        value={firebaseConfig.storageBucket || ''}
                        onChange={(e) =>
                          setFirebaseConfig((prev) => ({ ...prev, storageBucket: e.target.value }))
                        }
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-zinc-300">
                        Messaging Sender ID
                      </label>
                      <input
                        type="text"
                        value={firebaseConfig.messagingSenderId || ''}
                        onChange={(e) =>
                          setFirebaseConfig((prev) => ({ ...prev, messagingSenderId: e.target.value }))
                        }
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-zinc-300">App ID</label>
                      <input
                        type="text"
                        value={firebaseConfig.appId}
                        onChange={(e) =>
                          setFirebaseConfig((prev) => ({ ...prev, appId: e.target.value }))
                        }
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-sm font-medium text-zinc-300">
                        Measurement ID
                      </label>
                      <input
                        type="text"
                        value={firebaseConfig.measurementId || ''}
                        onChange={(e) =>
                          setFirebaseConfig((prev) => ({ ...prev, measurementId: e.target.value }))
                        }
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                      />
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-4 py-3 text-sm text-zinc-400">
                  The selected provider is written into the project files so the agent can scaffold matching code, env vars, SDK setup, auth, and CRUD flows automatically.
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-zinc-800 bg-zinc-950 px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-5">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              Save Database Config
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
