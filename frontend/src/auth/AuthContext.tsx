import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { authApi, AuthApiError, setAuthCsrfToken } from './client';
import type { IdentitySession, IdentityStatus } from './types';
import { RecoveryCodesDialog } from './RecoveryCodesDialog';

export type AuthPhase = 'checking' | 'setup' | 'login' | 'error' | 'authenticated';

type AuthContextValue = {
  phase: AuthPhase;
  session: IdentitySession | null;
  setupRequired: boolean;
  sso: IdentityStatus['sso'];
  error: string;
  notice: string;
  pendingRecoveryCodes: string[];
  refresh: () => Promise<void>;
  refreshStatus: () => Promise<boolean>;
  login: (body: { email: string; password: string }) => Promise<void>;
  setup: (body: { name: string; email: string; password: string }) => Promise<void>;
  acceptInvitation: (body: { invitation_code: string; password: string }) => Promise<void>;
  recover: (body: { email: string; recovery_code: string; new_password: string }) => Promise<void>;
  logout: () => Promise<void>;
  clearSession: (notice?: string) => void;
  updateSession: (session: IdentitySession) => void;
  dismissRecoveryCodes: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '發生未預期的帳號錯誤。';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AuthPhase>('checking');
  const [session, setSession] = useState<IdentitySession | null>(null);
  const phaseRef = useRef<AuthPhase>('checking');
  const sessionRef = useRef<IdentitySession | null>(null);
  const refreshRequestId = useRef(0);
  const statusRequestId = useRef(0);
  const [setupRequired, setSetupRequired] = useState(false);
  const [sso, setSso] = useState<IdentityStatus['sso']>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingRecoveryCodes, setPendingRecoveryCodes] = useState<string[]>([]);

  const updateSession = useCallback((next: IdentitySession) => {
    setAuthCsrfToken(next.csrf_token);
    sessionRef.current = next;
    setSession(next);
    setSetupRequired(false);
    phaseRef.current = 'authenticated';
    setPhase('authenticated');
    setError('');
    setNotice('');
    setPendingRecoveryCodes(next.recovery_codes ?? []);
  }, []);

  const refreshStatus = useCallback(async () => {
    if (phaseRef.current === 'checking') return false;
    refreshRequestId.current += 1;
    const requestId = ++statusRequestId.current;
    const updateUnauthenticatedPhase = !sessionRef.current && (phaseRef.current === 'login' || phaseRef.current === 'setup');
    try {
      const status = await authApi.status();
      if (requestId !== statusRequestId.current) return false;
      setSetupRequired(status.setup_required);
      setSso(status.sso);
      if (updateUnauthenticatedPhase && !sessionRef.current && (phaseRef.current === 'login' || phaseRef.current === 'setup')) {
        const nextPhase = status.setup_required ? 'setup' : 'login';
        phaseRef.current = nextPhase;
        setPhase(nextPhase);
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const clearSession = useCallback((nextNotice = '') => {
    refreshRequestId.current += 1;
    setAuthCsrfToken(null);
    sessionRef.current = null;
    setSession(null);
    setPendingRecoveryCodes([]);
    setNotice(nextNotice);
    const nextPhase = setupRequired ? 'setup' : 'login';
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
    void refreshStatus();
  }, [refreshStatus, setupRequired]);

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestId.current;
    const statusId = ++statusRequestId.current;
    phaseRef.current = 'checking';
    setPhase('checking');
    setError('');
    try {
      const status = await authApi.status();
      if (requestId !== refreshRequestId.current || statusId !== statusRequestId.current) return;
      setSetupRequired(status.setup_required);
      setSso(status.sso);
      if (status.setup_required) {
        setAuthCsrfToken(null);
        sessionRef.current = null;
        setSession(null);
        phaseRef.current = 'setup';
        setPhase('setup');
        return;
      }
      try {
        const current = await authApi.me();
        if (requestId !== refreshRequestId.current) return;
        updateSession(current);
      } catch (sessionError) {
        if (requestId !== refreshRequestId.current) return;
        if (sessionError instanceof AuthApiError && sessionError.status === 401) {
          setAuthCsrfToken(null);
          sessionRef.current = null;
          setSession(null);
          phaseRef.current = 'login';
          setPhase('login');
          return;
        }
        throw sessionError;
      }
    } catch (refreshError) {
      if (requestId !== refreshRequestId.current) return;
      setAuthCsrfToken(null);
      sessionRef.current = null;
      setSession(null);
      setError(errorMessage(refreshError));
      phaseRef.current = 'error';
      setPhase('error');
    }
  }, [updateSession]);

  const runAuth = useCallback(async (operation: () => Promise<IdentitySession>) => {
    setError('');
    try {
      updateSession(await operation());
    } catch (authError) {
      setError(errorMessage(authError));
      throw authError;
    }
  }, [updateSession]);

  const logout = useCallback(async () => {
    await authApi.logout();
    clearSession();
  }, [clearSession]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function handleExpired() {
      if (!sessionRef.current || phaseRef.current === 'checking' || phaseRef.current === 'error') return;
      clearSession('登入已逾期，請重新登入。');
    }
    window.addEventListener('ordivant-auth-expired', handleExpired);
    return () => window.removeEventListener('ordivant-auth-expired', handleExpired);
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(() => ({
    phase,
    session,
    setupRequired,
    sso,
    error,
    notice,
    pendingRecoveryCodes,
    refresh,
    refreshStatus,
    login: (body) => runAuth(() => authApi.login(body)),
    setup: (body) => runAuth(() => authApi.setup(body)),
    acceptInvitation: (body) => runAuth(() => authApi.acceptInvitation(body)),
    recover: (body) => runAuth(() => authApi.recover(body)),
    logout,
    clearSession,
    updateSession,
    dismissRecoveryCodes: () => setPendingRecoveryCodes([]),
  }), [phase, session, setupRequired, sso, error, notice, pendingRecoveryCodes, refresh, refreshStatus, runAuth, logout, clearSession, updateSession]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      <RecoveryCodesDialog codes={pendingRecoveryCodes} onClose={() => setPendingRecoveryCodes([])} />
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
