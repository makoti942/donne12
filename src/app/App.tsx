import { lazy, Suspense, useState, useCallback } from 'react';
import React from 'react';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router';
import { cleanupUrl, handleOAuthCallback } from '@/external/deriv-core';
import ChunkLoader from '@/components/loader/chunk-loader';
import LocalStorageSyncWrapper from '@/components/localStorage-sync-wrapper';
import RoutePromptDialog from '@/components/route-prompt-dialog';
import SplashScreen from '@/components/splash-screen/splash-screen';
import LoginPage from '@/components/login-page/login-page';
import { useAccountSwitching } from '@/hooks/useAccountSwitching';
import { useLanguageFromURL } from '@/hooks/useLanguageFromURL';
import { StoreProvider } from '@/hooks/useStore';
import { isPreviewMode, PREVIEW_BASE_PATH } from '@/utils/is-preview-mode';
import { localize, TranslationProvider } from '@deriv-com/translations';
import CoreStoreProvider from './CoreStoreProvider';
import i18nInstance from './i18n';
import './app-root.scss';

const Layout = lazy(() => import('../components/layout'));
const AppRoot = lazy(() => import('./app-root'));

const LanguageHandler = ({ children }: { children: React.ReactNode }) => {
    useLanguageFromURL();
    return <>{children}</>;
};

const routerBasename = isPreviewMode() ? PREVIEW_BASE_PATH : undefined;

const FourOhFour = () => (
    <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a1a',
        color: '#fff',
        fontFamily: "'Orbitron', sans-serif",
        gap: '1rem',
    }}>
        <h1 style={{ fontSize: '6rem', margin: 0, color: '#00d4ff', textShadow: '0 0 20px #00d4ff' }}>404</h1>
        <p style={{ fontSize: '1.2rem', color: 'rgba(255,255,255,0.5)', fontFamily: "'Rajdhani', sans-serif", letterSpacing: '0.2em' }}>
            PAGE NOT FOUND
        </p>
        <a href="/" style={{
            marginTop: '1rem',
            padding: '0.75rem 2rem',
            background: 'linear-gradient(135deg, #00d4ff, #7b2ff7)',
            color: '#fff',
            textDecoration: 'none',
            borderRadius: '8px',
            fontFamily: "'Rajdhani', sans-serif",
            fontWeight: 600,
            letterSpacing: '0.1em',
        }}>
            GO HOME
        </a>
    </div>
);

const router = createBrowserRouter(
    createRoutesFromElements(
        <Route
            path='/'
            element={
                <Suspense
                    fallback={<ChunkLoader message={localize('Please wait while we connect to the server...')} />}
                >
                    <TranslationProvider defaultLang='EN' i18nInstance={i18nInstance}>
                        <LanguageHandler>
                            <StoreProvider>
                                <LocalStorageSyncWrapper>
                                    <RoutePromptDialog />
                                    <CoreStoreProvider>
                                        <Layout />
                                    </CoreStoreProvider>
                                </LocalStorageSyncWrapper>
                            </StoreProvider>
                        </LanguageHandler>
                    </TranslationProvider>
                </Suspense>
            }
        >
            <Route index element={<AppRoot />} />
            <Route path='preview' element={<AppRoot />} />
            <Route path='*' element={<FourOhFour />} />
        </Route>
    ),
    { basename: routerBasename }
);

function App() {
    useAccountSwitching();

    const [phase, setPhase] = useState<'splash' | 'login' | 'app'>(() => {
        const splashSeen = sessionStorage.getItem('splash_seen') === 'true';
        const loggedIn = localStorage.getItem('active_loginid');
        if (splashSeen && loggedIn) return 'app';
        if (splashSeen) return 'login';
        return 'splash';
    });

    const handleSplashComplete = useCallback(() => {
        sessionStorage.setItem('splash_seen', 'true');
        setPhase('login');
    }, []);

    const handleLoginSuccess = useCallback(() => {
        setPhase('app');
    }, []);

    // Handle OAuth callback (redirect back from Deriv)
    React.useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        if (!urlParams.has('code')) return;

        const handleCallback = async () => {
            try {
                const authInfo = await handleOAuthCallback(window.location.href, {
                    clientId: process.env.NEXT_PUBLIC_DERIV_APP_ID || '',
                    redirectUri: window.location.origin,
                    scopes: 'trade',
                });

                const { DerivWSAccountsService } = await import('@/services/derivws-accounts.service');
                const accounts = await DerivWSAccountsService.fetchAccountsList(authInfo.access_token);

                if (accounts && accounts.length > 0) {
                    DerivWSAccountsService.storeAccounts(accounts);
                    const firstAccount = accounts[0];
                    localStorage.setItem('active_loginid', firstAccount.account_id);
                    const isDemo =
                        firstAccount.account_id.startsWith('VRT') || firstAccount.account_id.startsWith('VRTC');
                    localStorage.setItem('account_type', isDemo ? 'demo' : 'real');

                    const { api_base } = await import('@/external/bot-skeleton');
                    await api_base.init(true);

                    setPhase('app');
                } else {
                    console.error('No accounts returned after authentication');
                }
            } catch (error) {
                console.error('OAuth callback error:', error);
            } finally {
                cleanupUrl(window.location.origin);
            }
        };

        handleCallback();
    }, []);

    // Phase 1: Splash screen
    if (phase === 'splash') {
        return <SplashScreen onComplete={handleSplashComplete} />;
    }

    // Phase 2: Login page
    if (phase === 'login') {
        return <LoginPage onLoginSuccess={handleLoginSuccess} />;
    }

    // Phase 3: Main app
    return <RouterProvider router={router} />;
}

export default App;
