import { useState, useEffect } from 'react';
import './splash-screen.scss';

export default function SplashScreen({ onComplete }: { onComplete: () => void }) {
    const [phase, setPhase] = useState<'logo' | 'text' | 'fade'>('logo');

    useEffect(() => {
        const t1 = setTimeout(() => setPhase('text'), 800);
        const t2 = setTimeout(() => setPhase('fade'), 3000);
        const t3 = setTimeout(onComplete, 3800);
        return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }, [onComplete]);

    return (
        <div className={`splash-screen splash-${phase}`}>
            <div className="splash-bg">
                <div className="splash-grid" />
                <div className="splash-particles">
                    {Array.from({ length: 30 }).map((_, i) => (
                        <div key={i} className="particle" style={{
                            left: `${Math.random() * 100}%`,
                            animationDelay: `${Math.random() * 5}s`,
                            animationDuration: `${3 + Math.random() * 4}s`,
                        }} />
                    ))}
                </div>
            </div>

            <div className="splash-content">
                <div className="splash-logo-container">
                    <div className="splash-ring splash-ring-outer" />
                    <div className="splash-ring splash-ring-middle" />
                    <div className="splash-ring splash-ring-inner" />
                    <div className="splash-core">
                        <svg viewBox="0 0 100 100" className="splash-icon">
                            <polygon points="50,10 90,75 10,75" fill="none" stroke="currentColor" strokeWidth="2" />
                            <polygon points="50,25 75,65 25,65" fill="none" stroke="currentColor" strokeWidth="1.5" />
                            <circle cx="50" cy="50" r="8" fill="currentColor" />
                        </svg>
                    </div>
                </div>

                <h1 className="splash-title">
                    <span className="splash-word splash-word-d">D</span>
                    <span className="splash-word splash-word-o">O</span>
                    <span className="splash-word splash-word-n">N</span>
                    <span className="splash-word splash-word-n2">N</span>
                    <span className="splash-word splash-word-e">E</span>
                    <span className="splash-word splash-word-h">H</span>
                    <span className="splash-word splash-word-u">U</span>
                    <span className="splash-word splash-word-n3">N</span>
                    <span className="splash-word splash-word-t">T</span>
                    <span className="splash-word splash-word-e2">E</span>
                    <span className="splash-word splash-word-r">R</span>
                </h1>

                <div className="splash-subtitle">
                    <span className="splash-sub-line" />
                    <span className="splash-sub-text">TRADING HUB</span>
                    <span className="splash-sub-line" />
                </div>

                <div className="splash-loader">
                    <div className="splash-loader-bar" />
                </div>
            </div>
        </div>
    );
}
