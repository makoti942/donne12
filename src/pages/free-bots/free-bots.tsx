import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Button from '@/components/shared_ui/button';
import Text from '@/components/shared_ui/text';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { fetchXmlWithCache } from '@/utils/freebots-cache';
import './free-bots.scss';

interface BotData {
    name: string;
    description: string;
    difficulty: string;
    strategy: string;
    features: string[];
    xml: string;
    badge_text?: string;
    badge_class?: string;
}

const DEFAULT_FEATURES = ['Automated Trading', 'Risk Management', 'Profit Optimization'];

const FreeBots = observer(() => {
    const { dashboard, load_modal } = useStore();
    const { setActiveTab } = dashboard;
    const [availableBots, setAvailableBots] = useState<BotData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const getBotDescription = (botName: string): string => {
        const descriptions: { [key: string]: string } = {
            'STARTER BOT': 'Official starter bot. Optimized for beginners with standard risk management.',
            'POVERTY KILLER': 'High-performance digit trading bot with intelligent recovery and profit optimization.',
            'POVERTY KILLER V2.1': 'Updated version with enhanced performance and risk management.',
            'BEST RISE FALL': 'Automated rise and fall strategy optimized for consistent returns.',
            'MAKOTI AUTOMATED RISE FALL': 'Premium rise and fall strategy with advanced entry points and recovery.',
            'OVER1 R32 PRO': 'Professional Over 1 bot with R32 recovery strategy.',
            'OVER2 R43 PRO': 'Advanced Over 2 bot with R43 recovery system.',
            'THE CMV PRO': 'Premium CMV Pro trading bot with multi-strategy approach.',
            'UNDER BLAST PRO': 'High-performance Under trading bot with blast strategy.',
            'UNDER7 R56 PRO': 'Professional Under 7 bot with R56 recovery mechanism.',
            'UNDER8 R67 PRO': 'Advanced Under 8 bot with R67 recovery system.',
            'MAKOTIV3RISE FALL': 'Premium Rise/Fall bot with MACD analysis and intelligent recovery.',
            'MAKOTI RISE/FALL V4': 'Latest version with improved entry signals and advanced recovery management.',
            'FREE BOT WITH MARTINGALE': 'Simple martingale bot. Doubles stake after each loss, resets on win.',
        };

        for (const key in descriptions) {
            if (botName.includes(key) || key.includes(botName)) {
                return descriptions[key];
            }
        }
        return `Advanced trading bot: ${botName}. Features automated trading and risk management.`;
    };

    const getXmlFiles = () => [
        'STARTER_BOT.xml',
        'POVERTY_KILLER.xml',
        'POVERTY_KILLER_V2.1.xml',
        'BEST_RISE_FALL.xml',
        'MAKOTI_AUTOMATED_RISE_FALL.xml',
        'THE CMV PRO.xml',
        'UNDER BLAST PRO.xml',
        'OVER1_R32 PRO.xml',
        'OVER2_R43 PRO.xml',
        'UNDER8_R67 PRO.xml',
        'UNDER7_R56 PRO.xml',
        'MAKOTIV3RISE_FALL.xml',
        'MAKOTIRISE_FALLV4.xml',
        'FREE BOT WITH MARTINGALE.xml',
    ];

    const loadBotIntoBuilder = async (bot: BotData) => {
        if (bot.xml) {
            try {
                // Wait for Blockly workspace to be available
                let workspace = window.Blockly?.derivWorkspace;
                if (!workspace) {
                    for (let i = 0; i < 10; i++) {
                        await new Promise(r => setTimeout(r, 200));
                        workspace = window.Blockly?.derivWorkspace;
                        if (workspace) break;
                    }
                }

                if (!workspace || !window.Blockly) {
                    console.warn('Blockly workspace not available');
                    setActiveTab(DBOT_TABS.BOT_BUILDER);
                    return;
                }

                // Parse and load XML directly into workspace
                const xmlDom = window.Blockly.utils.xml.textToDom(bot.xml);
                workspace.clear();
                window.Blockly.Xml.domToWorkspace(xmlDom, workspace);
                workspace.strategy_to_load = bot.xml;
                workspace.current_strategy_id = `freebot_${Date.now()}`;

                setActiveTab(DBOT_TABS.BOT_BUILDER);
            } catch (err) {
                console.error('Failed to load bot:', err);
                setActiveTab(DBOT_TABS.BOT_BUILDER);
            }
        }
    };

    useEffect(() => {
        const loadBots = async () => {
            setError(null);

            const manifest = getXmlFiles().map(file => ({ name: file.replace('.xml', ''), file }));

            const skeletonBots: BotData[] = manifest.map(item => {
                const botName = (item.name || item.file.replace('.xml', '')).replace(/[_-]/g, ' ').replace('MAKOTIRISE FALLV4', 'MAKOTI RISE/FALL V4');
                const isPremiumPlus = botName.includes('MAKOTI RISE/FALL V4');
                return {
                    name: botName,
                    description: getBotDescription(botName),
                    difficulty: 'Intermediate',
                    strategy: 'Multi-Strategy',
                    features: DEFAULT_FEATURES,
                    xml: '',
                    badge_text: isPremiumPlus ? 'PREMIUM PLUS' : 'PREMIUM',
                    badge_class: isPremiumPlus ? 'premium-plus' : 'premium',
                };
            });
            setAvailableBots(skeletonBots);
            setIsLoading(false);

            try {
                const loadedBots: BotData[] = [];
                for (let i = 0; i < manifest.length; i++) {
                    const item = manifest[i];
                    try {
                        const xml = await fetchXmlWithCache(item.file);
                        if (xml) {
                            const botName = (item.name || item.file.replace('.xml', '')).replace(/[_-]/g, ' ').replace('MAKOTIRISE FALLV4', 'MAKOTI RISE/FALL V4');
                            const isPremiumPlus = botName.includes('MAKOTI RISE/FALL V4');
                            loadedBots.push({
                                name: botName,
                                description: getBotDescription(botName),
                                difficulty: 'Intermediate',
                                strategy: 'Multi-Strategy',
                                features: DEFAULT_FEATURES,
                                xml,
                                badge_text: isPremiumPlus ? 'PREMIUM PLUS' : 'PREMIUM',
                                badge_class: isPremiumPlus ? 'premium-plus' : 'premium',
                            });
                            setAvailableBots([...loadedBots, ...skeletonBots.slice(loadedBots.length)]);
                        }
                    } catch (err) {
                        console.warn(`Failed to load ${item.file}:`, err);
                    }
                }
            } catch (error) {
                console.error('Error loading bots:', error);
                setError('Failed to load bots. Please try again.');
            }
        };

        loadBots();
    }, []);

    return (
        <div className='free-bots'>
            <div className='free-bots__container'>
                {isLoading ? (
                    <div className='free-bots__loading'>
                        <Text size='s' color='general'>
                            {localize('Loading free bots...')}
                        </Text>
                    </div>
                ) : error ? (
                    <div className='free-bots__error'>
                        <Text size='s' color='general'>{error}</Text>
                        <div style={{ marginTop: '20px' }}>
                            <Button onClick={() => window.location.reload()}>{localize('Retry')}</Button>
                        </div>
                    </div>
                ) : availableBots.length === 0 ? (
                    <div className='free-bots__empty'>
                        <Text size='s' color='general'>
                            {localize('No bots available at the moment.')}
                        </Text>
                    </div>
                ) : (
                    <div className='free-bots__grid'>
                        {availableBots.map((bot, index) => (
                            <div
                                key={index}
                                className={`free-bot-card ${bot.badge_class ? `free-bot-card--${bot.badge_class}` : ''}`}
                                data-badge={bot.badge_text || 'PREMIUM'}
                            >
                                <div className='free-bot-card__header'>
                                    <Text size='s' weight='bold' className='free-bot-card__title'>
                                        {bot.name}
                                    </Text>
                                    <div className='free-bot-card__rating'>
                                        <span className='star'>★</span>
                                        <span className='star'>★</span>
                                        <span className='star'>★</span>
                                        <span className='star'>★</span>
                                        <span className='star'>★</span>
                                    </div>
                                    <Text size='xs' className='free-bot-card__description'>
                                        {bot.description}
                                    </Text>
                                </div>

                                <div className='free-bot-card__badges'>
                                    <span className={`free-bot-card__badge free-bot-card__badge--${bot.difficulty.toLowerCase()}`}>
                                        {bot.difficulty}
                                    </span>
                                    <span className='free-bot-card__badge free-bot-card__badge--strategy'>
                                        {bot.strategy}
                                    </span>
                                </div>

                                <div className='free-bot-card__features'>
                                    {bot.features.map((f, i) => (
                                        <span key={i} className='free-bot-card__feature-tag'>{f}</span>
                                    ))}
                                </div>

                                <Button
                                    className='free-bot-card__load-btn'
                                    onClick={() => loadBotIntoBuilder(bot)}
                                    primary
                                    has_effect
                                    type='button'
                                    disabled={!bot.xml}
                                >
                                    {bot.xml ? 'LOAD PREMIUM BOT' : 'LOADING...'}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});

export default FreeBots;
