import { useState, useCallback, useEffect, useRef } from 'react';
import { generateOAuthURL } from '@/components/shared';
import './login-page.scss';

interface LoginPageProps {
    onLoginSuccess?: () => void;
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps) {
    const [loading, setLoading] = useState(false);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // If already logged in, skip login page
        if (localStorage.getItem('active_loginid')) {
            onLoginSuccess?.();
            return;
        }

        const handleMouseMove = (e: MouseEvent) => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            setMousePos({
                x: ((e.clientX - rect.left) / rect.width - 0.5) * 20,
                y: ((e.clientY - rect.top) / rect.height - 0.5) * 20,
            });
        };
        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, []);

    const handleLogin = useCallback(async () => {
        try {
            setLoading(true);
            const oauthUrl = await generateOAuthURL();
            if (oauthUrl) {
                window.location.replace(oauthUrl);
            } else {
                console.error('Failed to generate OAuth URL');
                setLoading(false);
            }
        } catch (error) {
            console.error('Login failed:', error);
            setLoading(false);
        }
    }, []);

    const handleSignup = useCallback(async () => {
        try {
            setLoading(true);
            const oauthUrl = await generateOAuthURL('registration');
            if (oauthUrl) {
                window.location.replace(oauthUrl);
            } else {
                console.error('Failed to generate signup URL');
                setLoading(false);
            }
        } catch (error) {
            console.error('Signup failed:', error);
            setLoading(false);
        }
    }, []);

    return (
        <div className="login-page" ref={containerRef}>
            {/* Animated background */}
            <div className="login-bg">
                <div className="login-grid" />
                <div className="login-glow login-glow-1" />
                <div className="login-glow login-glow-2" />
                <div className="login-glow login-glow-3" />
                <div className="login-lines">
                    {Array.from({ length: 20 }).map((_, i) => (
                        <div key={i} className="login-line" style={{
                            left: `${Math.random() * 100}%`,
                            animationDelay: `${Math.random() * 8}s`,
                            animationDuration: `${4 + Math.random() * 6}s`,
                        }} />
                    ))}
                </div>
            </div>

            {/* Main content */}
            <div
                className="login-content"
                style={{
                    transform: `translate(${mousePos.x * 0.3}px, ${mousePos.y * 0.3}px)`,
                }}
            >
                {/* 3D Logo */}
                <div className="login-logo-wrapper">
                    <div
                        className="login-logo-3d"
                        style={{
                            transform: `perspective(800px) rotateY(${mousePos.x * 0.5}deg) rotateX(${-mousePos.y * 0.5}deg)`,
                        }}
                    >
                        <div className="logo-ring logo-ring-1" />
                        <div className="logo-ring logo-ring-2" />
                        <div className="logo-ring logo-ring-3" />
                        <div className="logo-core">
                            <svg viewBox="0 0 120 120" className="logo-triangle">
                                <defs>
                                    <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" stopColor="#00d4ff" />
                                        <stop offset="50%" stopColor="#7b2ff7" />
                                        <stop offset="100%" stopColor="#ff0080" />
                                    </linearGradient>
                                </defs>
                                <polygon points="60,15 105,90 15,90" fill="none" stroke="url(#logoGrad)" strokeWidth="2" />
                                <polygon points="60,35 85,75 35,75" fill="none" stroke="url(#logoGrad)" strokeWidth="1.5" opacity="0.6" />
                                <circle cx="60" cy="60" r="10" fill="url(#logoGrad)" />
                            </svg>
                        </div>
                    </div>
                </div>

                {/* 3D Title */}
                <h1 className="login-title" style={{
                    transform: `perspective(800px) rotateY(${mousePos.x * 0.2}deg) rotateX(${-mousePos.y * 0.2}deg)`,
                }}>
                    <span className="title-line title-line-1">
                        {'DONNEHUNTER'.split('').map((char, i) => (
                            <span key={i} className="title-char" style={{ animationDelay: `${0.1 + i * 0.05}s` }}>
                                {char}
                            </span>
                        ))}
                    </span>
                    <span className="title-line title-line-2">
                        {'TRADING HUB'.split('').map((char, i) => (
                            <span key={i} className="title-char title-char-sub" style={{ animationDelay: `${0.8 + i * 0.04}s` }}>
                                {char === ' ' ? '\u00A0' : char}
                            </span>
                        ))}
                    </span>
                </h1>

                {/* Tagline */}
                <p className="login-tagline">
                    <span className="tagline-dot" />
                    Automated Trading Bot
                    <span className="tagline-dot" />
                </p>

                {/* Login card */}
                <div className="login-card">
                    <div className="login-card-glow" />

                    <div className="login-card-content">
                        <h2 className="login-card-title">Welcome Back</h2>
                        <p className="login-card-subtitle">
                            Connect your Deriv account to start automated trading
                        </p>

                        <button
                            className={`login-btn login-btn-primary ${loading ? 'loading' : ''}`}
                            onClick={handleLogin}
                            disabled={loading}
                        >
                            <span className="btn-bg" />
                            <span className="btn-content">
                                {loading ? (
                                    <span className="btn-spinner" />
                                ) : (
                                    <>
                                        <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                                            <polyline points="10 17 15 12 10 7" />
                                            <line x1="15" y1="12" x2="3" y2="12" />
                                        </svg>
                                        Log In with Deriv
                                    </>
                                )}
                            </span>
                        </button>

                        <div className="login-divider">
                            <span>or</span>
                        </div>

                        <button
                            className={`login-btn login-btn-secondary ${loading ? 'loading' : ''}`}
                            onClick={handleSignup}
                            disabled={loading}
                        >
                            <span className="btn-bg" />
                            <span className="btn-content">
                                {loading ? (
                                    <span className="btn-spinner" />
                                ) : (
                                    <>
                                        <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                            <circle cx="8.5" cy="7" r="4" />
                                            <line x1="20" y1="8" x2="20" y2="14" />
                                            <line x1="23" y1="11" x2="17" y2="11" />
                                        </svg>
                                        Create Free Account
                                    </>
                                )}
                            </span>
                        </button>

                        <p className="login-footer-text">
                            By continuing, you agree to our Terms of Service
                        </p>
                    </div>
                </div>

                {/* Floating stats */}
                <div className="login-stats">
                    <div className="stat-item">
                        <span className="stat-value">24/7</span>
                        <span className="stat-label">Trading</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-value">100%</span>
                        <span className="stat-label">Automated</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-value">AI</span>
                        <span className="stat-label">Powered</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
