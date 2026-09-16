import React, { useEffect, useRef, useState } from 'react';

interface Option { value: string; label: string; }

interface Props {
    value: string;
    options: Option[];
    onChange: (val: string) => void;
    disabled?: boolean;
    className?: string;
}

export const MwSelect: React.FC<Props> = ({ value, options, onChange, disabled, className }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const selected = options.find(o => o.value === value);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('pointerdown', handler);
        return () => document.removeEventListener('pointerdown', handler);
    }, [open]);

    return (
        <div className={`mw-sel ${className || ''}`} ref={ref}>
            <button
                className={`mw-sel__btn ${disabled ? 'mw-sel__btn--disabled' : ''}`}
                onClick={() => { if (!disabled) setOpen(o => !o); }}
                type='button'
            >
                <span>{selected?.label || '—'}</span>
                <svg className={`mw-sel__arrow ${open ? 'mw-sel__arrow--open' : ''}`} viewBox='0 0 12 8' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                    <path d='M1 1l5 5 5-5' />
                </svg>
            </button>
            {open && (
                <div className='mw-sel__list'>
                    {options.map(opt => (
                        <button
                            key={opt.value}
                            className={`mw-sel__item ${value === opt.value ? 'mw-sel__item--active' : ''}`}
                            onClick={() => { onChange(opt.value); setOpen(false); }}
                            type='button'
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
