import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import Home from '@/pages/Home';
import Studio from '@/pages/Studio';
import ProjectDetail from '@/pages/ProjectDetail';
import Deliverables from '@/pages/Deliverables';
import Legal from '@/pages/Legal';
import Support from '@/pages/Support';
import AdminCompliance from '@/pages/AdminCompliance';
import Integrations from '@/pages/Integrations';
import Connect from '@/pages/Connect';
import Exchange from '@/pages/Exchange';
import ExchangeAssistant from '@/pages/ExchangeAssistant';
import ExchangeRoom from '@/pages/ExchangeRoom';
import AdminExchange from '@/pages/AdminExchange';
import LegalAcceptanceGate from '@/components/LegalAcceptanceGate';
import OAuthConsent from '@/pages/OAuthConsent';
import { platformRuntime } from '@/api/iabtClient';
import { Navigate, useLocation } from 'react-router-dom';
// Add page imports here

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError } = useAuth();
  const { pathname, search } = useLocation();
  const publicPaths = new Set([
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/legal",
    "/privacy",
    "/terms",
    "/acceptable-use",
    "/support",
  ]);
  const isPublicPath = publicPaths.has(pathname);

  // Public policy pages stay available even when account authentication is required.
  if (isLoadingPublicSettings || (isLoadingAuth && !isPublicPath)) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError && !isPublicPath) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      const returnTo = pathname + search;
      return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/legal" element={<Legal />} />
      <Route path="/privacy" element={<Legal />} />
      <Route path="/terms" element={<Legal />} />
      <Route path="/acceptable-use" element={<Legal />} />
      <Route path="/support" element={<Support />} />
      <Route path="/oauth/consent" element={<OAuthConsent />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<LegalAcceptanceGate />}>
          <Route path="/" element={<Home />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/deliverables" element={<Deliverables />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/connect" element={<Connect />} />
          <Route path="/exchange" element={<Exchange />} />
          <Route path="/exchange/assistant" element={<ExchangeAssistant />} />
          <Route path="/exchange/rooms/:roomId" element={<ExchangeRoom />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/admin/compliance" element={<AdminCompliance />} />
          <Route path="/admin/exchange" element={<AdminExchange />} />
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          {platformRuntime.backend === 'standalone' && (
            <div className="fixed top-2 right-2 z-[9999] rounded-full bg-amber-400 px-3 py-1 text-xs font-bold text-black shadow-lg">
              STANDALONE STAGING
            </div>
          )}
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App