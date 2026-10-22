import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { base44, getPublicSettings } from '@/api/iabtClient';
import { loadAccountState } from './account-bootstrap';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [state, setState] = useState({ user: null, isAuthenticated: false, authError: null,
    appPublicSettings: null, isLoadingAuth: true, isLoadingPublicSettings: true, authChecked: false });
  const generation = useRef(0);

  const check = useCallback(async (authOnly = false) => {
    const current = ++generation.current;
    setState(previous => ({ ...previous, isLoadingAuth: true, isLoadingPublicSettings: !authOnly, authError: null }));
    const result = await loadAccountState({ getPublicSettings, getUser: () => base44.auth.me(), authOnly });
    if (current !== generation.current) return;
    setState(previous => ({ ...result, appPublicSettings: authOnly ? previous.appPublicSettings : result.appPublicSettings,
      isLoadingAuth: false, isLoadingPublicSettings: false, authChecked: true }));
  }, []);
  const checkAppState = useCallback(() => check(false), [check]);
  const checkUserAuth = useCallback(() => check(true), [check]);

  useEffect(() => {
    void checkAppState();
    return () => { generation.current += 1; };
  }, [checkAppState]);

  const logout = (shouldRedirect = true) => {
    generation.current += 1;
    setState(previous => ({ ...previous, user: null, isAuthenticated: false, authError: null,
      isLoadingAuth: false, isLoadingPublicSettings: false, authChecked: true }));
    return base44.auth.logout(shouldRedirect ? window.location.href : undefined);
  };

  return <AuthContext.Provider value={{ ...state, logout,
    navigateToLogin: () => base44.auth.redirectToLogin(window.location.href), checkUserAuth, checkAppState }}>
    {children}
  </AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
