import React, { useCallback, useRef, useState, useEffect } from 'react';
import { ALL_SYMBOLS, SYMBOL_LABELS, PIP_SIZES, openMakotiWS, MakotiWS } from './makoti-ws';
import { onNewSystemMessage } from '@/auth/NewDerivAuth';
import { MwSelect } from './mw-select';
import DBotStore from '@/external/bot-skeleton/scratch/dbot-store';

const ENTRY_BOT_TEMPLATE = `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="^6#nw2SaD1$YyI2F;/K;">text</variable>
    <variable id="initStakeVar">Initial Stake</variable>
    <variable id="total_profit">Total Profit</variable>
    <variable id="martFactorVar">Martingale Factor</variable>
    <variable id="stakeVar">Current Stake</variable>
    <variable id="Y5/XSGh1;v85;8*pTo7c">prediction</variable>
    <variable id="first_trade_done">First Trade Done</variable>
    <variable id="normal_pred_var">Normal Prediction</variable>
    <variable id="recovery_pred_var">Recovery Prediction</variable>
    <variable id="is_recovery_var">is_recovery</variable>
    <variable id="entry_digit">Entry Digit</variable>
    <variable id="tp">Target Profit</variable>
    <variable id="sl">Stop Loss</variable>
    <variable id="initializedVar">Martingale Initialized</variable>
  </variables>
  <block type="trade_definition" id="}F,4#Sa]HciWV~Jye~gS" deletable="false" x="0" y="60">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="O=Zr3]zqZ|*|,(##^,4c" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">__SYMBOL__</field>
        <next>
          <block type="trade_definition_tradetype" id="i40q+Oi2S.]BY-XJFe9^" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">digits</field>
            <field name="TRADETYPE_LIST">overunder</field>
            <next>
              <block type="trade_definition_contracttype" id="LK05VSNer$#lcXas8F@e" deletable="false" movable="false">
                <field name="TYPE_LIST">both</field>
                <next>
                  <block type="trade_definition_candleinterval" id="` + '`nkOFF!xRr2R8Ezn7K9n' + `" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="T-9x~q$,1Ey3?SzFdNq#" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="UaD8ITktDA15Ca1).)ah" deletable="false" movable="false">
                            <field name="RESTARTONERROR">TRUE</field>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="INITIALIZATION">
      <block type="variables_set" id="setInitialStakeValue">
        <field name="VAR" id="initStakeVar">Initial Stake</field>
        <value name="VALUE">
                <block type="math_number" id="initialStakeValue">
                    <field name="NUM">__STAKE__</field>
          </block>
        </value>
        <next>
          <block type="variables_set" id="setMartingaleFactor">
            <field name="VAR" id="martFactorVar">Martingale Factor</field>
            <value name="VALUE">
              <block type="math_number" id="martFactorValue">
                <field name="NUM">2</field>
              </block>
            </value>
            <next>
              <block type="variables_set" id="setNormalPred">
                <field name="VAR" id="normal_pred_var">Normal Prediction</field>
                <value name="VALUE">
                  <block type="math_number" id="+0EAx;9?l]rH{O0/1hR=">
                    <field name="NUM">__NORMAL_PRED__</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="setRecoveryPred">
                    <field name="VAR" id="recovery_pred_var">Recovery Prediction</field>
                    <value name="VALUE">
                      <block type="math_number" id="7:(PiLkUR8q3fW_XG)=1">
                        <field name="NUM">5</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="setEntryDigit">
                        <field name="VAR" id="entry_digit">Entry Digit</field>
                        <value name="VALUE">
                          <block type="math_number" id="Ozejkz7EJvDFP9jt]*]z">
                            <field name="NUM">__ENTRY_DIGIT__</field>
                          </block>
                        </value>
                        <next>
                          <block type="variables_set" id="$1%D(\`QsOR%}PvNX/SB!">
                            <field name="VAR" id="Y5/XSGh1;v85;8*pTo7c">prediction</field>
                            <value name="VALUE">
                              <block type="variables_get" id="uhLXGL;h}k/!fYrY%s+g">
                                <field name="VAR" id="normal_pred_var">Normal Prediction</field>
                              </block>
                            </value>
                            <next>
                              <block type="variables_set" id="setTargetProfit">
                                <field name="VAR" id="tp">Target Profit</field>
                                <value name="VALUE">
                                  <block type="math_number" id="Fp@weP]m3}8FM?!ZUkU%">
                                    <field name="NUM">10</field>
                                  </block>
                                </value>
                                <next>
                                  <block type="variables_set" id="setStopLoss">
                                    <field name="VAR" id="sl">Stop Loss</field>
                                    <value name="VALUE">
                                      <block type="math_number" id="rM5S%;hX_EE$28Xl#dtG">
                                        <field name="NUM">50</field>
                                      </block>
                                    </value>
                                    <next>
                                      <block type="variables_set" id="setTotalProfit" collapsed="true">
                                        <field name="VAR" id="total_profit">Total Profit</field>
                                        <value name="VALUE">
                                          <block type="math_number" id="4*4-LHcQtmXex^lp]*PM">
                                            <field name="NUM">0</field>
                                          </block>
                                        </value>
                                        <next>
                                          <block type="variables_set" id="setFirstTradeDone" collapsed="true">
                                            <field name="VAR" id="first_trade_done">First Trade Done</field>
                                            <value name="VALUE">
                                              <block type="logic_boolean" id="D!yw{m7IWMs1uF]G]@Bd">
                                                <field name="BOOL">FALSE</field>
                                              </block>
                                            </value>
                                            <next>
                                              <block type="variables_set" id="markInitialized" collapsed="true">
                                                <field name="VAR" id="initializedVar">Martingale Initialized</field>
                                                <value name="VALUE">
                                                  <block type="logic_boolean" id="initializedTrue">
                                                    <field name="BOOL">TRUE</field>
                                                  </block>
                                                </value>
                                                <next>
                                                  <block type="variables_set" id="setCurrentStakeInitial" collapsed="true">
                                                    <field name="VAR" id="stakeVar">Current Stake</field>
                                                    <value name="VALUE">
                                                      <block type="variables_get" id="getInitialStake">
                                                        <field name="VAR" id="initStakeVar">Initial Stake</field>
                                                      </block>
                                                    </value>
                                                    <next>
                                                      <block type="variables_set" id="setIsRecovery" collapsed="true">
                                                        <field name="VAR" id="is_recovery_var">is_recovery</field>
                                                        <value name="VALUE">
                                                          <block type="logic_boolean" id="D^h5FipZ~WD=;#p_gg?N">
                                                            <field name="BOOL">FALSE</field>
                                                          </block>
                                                        </value>
                                                      </block>
                                                    </next>
                                                  </block>
                                                </next>
                                              </block>
                                            </next>
                                          </block>
                                        </next>
                                      </block>
                                    </next>
                                  </block>
                                </next>
                              </block>
                            </next>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions" id="/6=T~KI\`X+mn5$|K,]tI">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="true" vh_enabled="false"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <field name="VIRTUAL_HOOK_ENABLED">FALSE</field>
        <field name="BULK_TRADE_ENABLED">FALSE</field>
        <value name="DURATION">
          <shadow type="math_number_positive" id="T8\`V0lfU%!:y1+zCGft1">
            <field name="NUM">1</field>
          </shadow>
        </value>
        <value name="AMOUNT">
          <block type="variables_get" id="getStakeAmount">
            <field name="VAR" id="stakeVar">Current Stake</field>
          </block>
        </value>
        <value name="PREDICTION">
          <shadow type="math_number_positive" id="5@![w:8{U1\`h/%,(o8n(" inline="true">
            <field name="NUM">1</field>
          </shadow>
          <block type="variables_get" id="Cene|SE6T:[5DbOK\`J83">
            <field name="VAR" id="Y5/XSGh1;v85;8*pTo7c">prediction</field>
          </block>
        </value>
      </block>
    </statement>
  </block>
  <block type="during_purchase" id="+w,G6!xJ[/-nmPnseM#W" x="1034" y="60">
    <statement name="DURING_PURCHASE_STACK">
      <block type="controls_if" id="#V}P95eI72f!K:%T2~l_">
        <value name="IF0">
          <block type="check_sell" id="}59N!Q/\`.q~;0abDkIs#"></block>
        </value>
      </block>
    </statement>
  </block>
  <block type="after_purchase" id="c;hEA7}nM@_,g?5*L(=e" x="1034" y="292">
    <statement name="AFTERPURCHASE_STACK">
      <block type="variables_set" id="updateTotalProfit">
        <field name="VAR" id="total_profit">Total Profit</field>
        <value name="VALUE">
          <block type="math_arithmetic" id="addProfit">
            <field name="OP">ADD</field>
            <value name="A">
              <block type="variables_get" id="getTotalProfitA">
                <field name="VAR" id="total_profit">Total Profit</field>
              </block>
            </value>
            <value name="B">
              <block type="read_details" id="getContractProfit">
                <field name="DETAIL_INDEX">4</field>
              </block>
            </value>
          </block>
        </value>
        <next>
          <block type="controls_if" id="martingaleResultCheck">
            <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
            <value name="IF0">
              <block type="contract_check_result" id="checkWinResult">
                <field name="CHECK_RESULT">win</field>
              </block>
            </value>
            <statement name="DO0">
              <block type="variables_set" id="resetStakeAfterWin">
                <field name="VAR" id="stakeVar">Current Stake</field>
                <value name="VALUE">
                  <block type="variables_get" id="getInitialStakeOnWin">
                    <field name="VAR" id="initStakeVar">Initial Stake</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="resetRecovery">
                    <field name="VAR" id="is_recovery_var">is_recovery</field>
                    <value name="VALUE">
                      <block type="logic_boolean" id="mT0S7Y0xat726shrm(cA">
                        <field name="BOOL">FALSE</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="resetPrediction">
                        <field name="VAR" id="Y5/XSGh1;v85;8*pTo7c">prediction</field>
                        <value name="VALUE">
                          <block type="variables_get" id=",5DgI1~^8~V?u}7{Z$Nk">
                            <field name="VAR" id="normal_pred_var">Normal Prediction</field>
                          </block>
                        </value>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </statement>
            <statement name="ELSE">
              <block type="variables_set" id="increaseStakeAfterLoss">
                <field name="VAR" id="stakeVar">Current Stake</field>
                <value name="VALUE">
                  <block type="math_arithmetic" id="multiplyStakeByFactor">
                    <field name="OP">MULTIPLY</field>
                    <value name="A">
                      <shadow type="math_number" id="stakeShadow">
                        <field name="NUM">1</field>
                      </shadow>
                      <block type="variables_get" id="getCurrentStakeForMultiply">
                        <field name="VAR" id="stakeVar">Current Stake</field>
                      </block>
                    </value>
                    <value name="B">
                      <shadow type="math_number" id="factorShadow">
                        <field name="NUM">2</field>
                      </shadow>
                      <block type="variables_get" id="getMartingaleFactor">
                        <field name="VAR" id="martFactorVar">Martingale Factor</field>
                      </block>
                    </value>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="setRecovery">
                    <field name="VAR" id="is_recovery_var">is_recovery</field>
                    <value name="VALUE">
                      <block type="logic_boolean" id="HF(2UU5\`,6?ynX7@0?(M">
                        <field name="BOOL">TRUE</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="setRecoveryPrediction">
                        <field name="VAR" id="Y5/XSGh1;v85;8*pTo7c">prediction</field>
                        <value name="VALUE">
                          <block type="variables_get" id="j_]jtwpDTR{#1P*mHFE3">
                            <field name="VAR" id="recovery_pred_var">Recovery Prediction</field>
                          </block>
                        </value>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </statement>
            <next>
              <block type="controls_if" id="checkTPSL">
                <mutation xmlns="http://www.w3.org/1999/xhtml" elseif="1" else="1"></mutation>
                <value name="IF0">
                  <block type="logic_compare" id="compareTP">
                    <field name="OP">GTE</field>
                    <value name="A">
                      <block type="variables_get" id="getTotalProfitTP">
                        <field name="VAR" id="total_profit">Total Profit</field>
                      </block>
                    </value>
                    <value name="B">
                      <block type="variables_get" id="getTP">
                        <field name="VAR" id="tp">Target Profit</field>
                      </block>
                    </value>
                  </block>
                </value>
                <statement name="DO0">
                  <block type="text_print" id="printTP">
                    <value name="TEXT">
                      <block type="text" id="9JNhfx#$PxDW75.((^Tu">
                        <field name="TEXT">take profit hit</field>
                      </block>
                    </value>
                  </block>
                </statement>
                <value name="IF1">
                  <block type="logic_compare" id="compareSL">
                    <field name="OP">LTE</field>
                    <value name="A">
                      <block type="variables_get" id="getTotalProfitSL">
                        <field name="VAR" id="total_profit">Total Profit</field>
                      </block>
                    </value>
                    <value name="B">
                      <block type="math_single" id="negateSL">
                        <field name="OP">NEG</field>
                        <value name="NUM">
                          <block type="variables_get" id="getSL">
                            <field name="VAR" id="sl">Stop Loss</field>
                          </block>
                        </value>
                      </block>
                    </value>
                  </block>
                </value>
                <statement name="DO1">
                  <block type="text_print" id="printSL">
                    <value name="TEXT">
                      <block type="text" id="slText">
                        <field name="TEXT">Stop Loss Hit</field>
                      </block>
                    </value>
                  </block>
                </statement>
                <statement name="ELSE">
                  <block type="trade_again" id="G=znPPs6=xtZA|o(KBQX"></block>
                </statement>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
  </block>
  <block type="before_purchase" id="D_FIc+E9*cr|grV8}?n?" deletable="false" x="0" y="1264">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="controls_if" id="checkEntryCondition">
        <value name="IF0">
          <block type="logic_operation" id="orCondition">
            <field name="OP">OR</field>
            <value name="A">
              <block type="logic_compare" id="isFirstTradeDone">
                <field name="OP">EQ</field>
                <value name="A">
                  <block type="variables_get" id="9EtEqsYO\`|b7=3Sg!MjX">
                    <field name="VAR" id="first_trade_done">First Trade Done</field>
                  </block>
                </value>
                <value name="B">
                  <block type="logic_boolean" id="EU)Jw)jT3[([d#s\`5BNz">
                    <field name="BOOL">TRUE</field>
                  </block>
                </value>
              </block>
            </value>
            <value name="B">
              <block type="logic_compare" id="compareDigit">
                <field name="OP">EQ</field>
                <value name="A">
                  <block type="last_digit" id="getLastDigit"></block>
                </value>
                <value name="B">
                  <block type="variables_get" id="getEntryDigit">
                    <field name="VAR" id="entry_digit">Entry Digit</field>
                  </block>
                </value>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="variables_set" id="markFirstTradeDone">
            <field name="VAR" id="first_trade_done">First Trade Done</field>
            <value name="VALUE">
              <block type="logic_boolean" id="qiUsUt/MLSb/fE$\{fQgu">
                <field name="BOOL">TRUE</field>
              </block>
            </value>
            <next>
              <block type="controls_if" id="checkRecoveryPurchase">
                <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
                <value name="IF0">
                  <block type="logic_compare" id="compareIsRecovery">
                    <field name="OP">EQ</field>
                    <value name="A">
                      <block type="variables_get" id="i5_IE{q2r8~RBa1~r!q,">
                        <field name="VAR" id="is_recovery_var">is_recovery</field>
                      </block>
                    </value>
                    <value name="B">
                      <block type="logic_boolean" id="M@15MjSpUG$7=w~=Mu_/">
                        <field name="BOOL">FALSE</field>
                      </block>
                    </value>
                  </block>
                </value>
                <statement name="DO0">
                  <block type="purchase" id="og/YYS3nvV1*r61Co/hE">
                    <field name="PURCHASE_LIST">__CONTRACT_TYPE__</field>
                  </block>
                </statement>
                <statement name="ELSE">
                  <block type="purchase" id="purchaseRecovery">
                    <field name="PURCHASE_LIST">__CONTRACT_TYPE__</field>
                  </block>
                </statement>
              </block>
            </next>
          </block>
        </statement>
      </block>
    </statement>
  </block>
</xml>`;

type BotId = 'pvty_kill' | 'rf_v4';

interface SymbolDigitResult {
    symbol: string;
    label: string;
    pcts: number[];
    totalTicks: number;
    qualifies: boolean;
    detail: string;
}

interface SymbolDirectionResult {
    symbol: string;
    label: string;
    choppinessScore: number;
    bodyRatio: number;
    directionChanges: number;
    trendStrength: number;
    recentBodyRatio: number;
    qualifies: boolean;
    detail: string;
}

interface TriggerDigitResult {
    symbol: string;
    label: string;
    baselinePcts: number[];
    baselineWinPct: number;
    triggers: TriggerInfo[];
    qualifies: boolean;
    detail: string;
}

interface TriggerInfo {
    digit: number;
    occurrences: number;
    avgWinPctAfter: number;
    boost: number;
    consistency: number;
    windowSizes: { window: number; winPct: number; boost: number }[];
    digitShifts: { digit: number; before: number; after: number; shift: number }[];
    patternTrend: {
        olderBoost: number;
        recentBoost: number;
        olderOccurrences: number;
        recentOccurrences: number;
        trend: 'strengthening' | 'weakening' | 'stable' | 'new' | 'dying';
        trendPercent: number;
    };
    momentum: {
        winMomentum100: number;
        winMomentum50: number;
        winMomentum20: number;
        overallMomentum: number;
    };
    decayCurve: number[];
    bestEntryWindow: { start: number; end: number; peakWinPct: number };
    digitSurges: { digit: number; surgePct: number; count: number }[];
    confidence: number;
    digitPower: number[];
    // Tier 1 improvements
    zScore: number;         // statistical significance of boost
    pValue: number;         // probability boost is noise
    significance: 'high' | 'medium' | 'low' | 'none';
    triggerPower: number;   // how strong the trigger digit is in current market
}

type ScanResult = SymbolDigitResult | SymbolDirectionResult;

function isDigitResult(r: ScanResult): r is SymbolDigitResult {
    return (r as SymbolDigitResult).pcts !== undefined && 'totalTicks' in r && !('triggers' in r);
}

function calcDigitPcts(digits: number[]): number[] {
    const counts = Array(10).fill(0);
    digits.forEach(d => { if (d >= 0 && d <= 9) counts[d]++; });
    const total = digits.length || 1;
    return counts.map(c => (c / total) * 100);
}

// ── Entry Digit Trigger Analysis v2 ──
// Deep analysis: rolling momentum, decay curves, inter-digit correlation, power scoring
function analyzeTriggerDigits(
    digits: number[],
    contractType: 'DIGITOVER' | 'DIGITUNDER',
    barrier: number,
): { baselinePcts: number[]; baselineWinPct: number; triggers: TriggerInfo[] } {
    const len = digits.length;
    if (len < 30) return { baselinePcts: Array(10).fill(0), baselineWinPct: 0, triggers: [] };

    const isWin = (d: number) => contractType === 'DIGITOVER' ? d > barrier : d < barrier;

    // ── Rolling baseline percentages across 3 windows ──
    const win100 = calcDigitPcts(digits.slice(-100));
    const win50 = calcDigitPcts(digits.slice(-50));
    const win20 = calcDigitPcts(digits.slice(-20));

    // Baseline win% from full dataset
    const baselineWinPct = (digits.filter(d => isWin(d)).length / len) * 100;
    const baselinePcts = win100;

    // ── Digit Power Score: which digits are gaining/losing strength ──
    // Power = weighted combination of frequency + momentum
    const digitPower = Array(10).fill(0).map((_, d) => {
        const freq = win20[d]; // current frequency
        const momentum = win20[d] - win100[d]; // acceleration
        const consistency = win50[d] - win100[d]; // medium-term trend
        // Power: current freq weighted by momentum
        return freq + (momentum * 2) + (consistency * 0.5);
    });

    const triggers: TriggerInfo[] = [];

    for (let triggerDigit = 0; triggerDigit <= 9; triggerDigit++) {
        // Find all positions where this trigger digit appears
        const positions: number[] = [];
        for (let i = 0; i < len - 1; i++) {
            if (digits[i] === triggerDigit) positions.push(i);
        }

        if (positions.length < 3) continue;

        // ── Collect ALL digits that appear after each trigger occurrence ──
        const decayWindowSize = 25; // analyze up to 25 ticks after trigger
        const afterDigits: number[] = [];
        for (const pos of positions) {
            const end = Math.min(pos + decayWindowSize, len);
            for (let j = pos + 1; j < end; j++) {
                afterDigits.push(digits[j]);
            }
        }

        if (afterDigits.length === 0) continue;

        // ── Decay Curve: win% at each tick position after trigger ──
        // For each tick offset (1, 2, 3... 25), compute the win% across all trigger occurrences
        const decayCurve: number[] = [];
        for (let offset = 1; offset <= decayWindowSize; offset++) {
            let winCount = 0;
            let totalCount = 0;
            for (const pos of positions) {
                const tickIdx = pos + offset;
                if (tickIdx < len) {
                    totalCount++;
                    if (isWin(digits[tickIdx])) winCount++;
                }
            }
            decayCurve.push(totalCount > 0 ? (winCount / totalCount) * 100 : baselineWinPct);
        }

        // Find the best entry window (3-tick sliding window with highest avg win%)
        let bestStart = 0, bestEnd = 3, bestPeak = 0;
        for (let start = 0; start < decayCurve.length - 2; start++) {
            const avg = (decayCurve[start] + decayCurve[start + 1] + decayCurve[start + 2]) / 3;
            if (avg > bestPeak) {
                bestPeak = avg;
                bestStart = start;
                bestEnd = start + 3;
            }
        }

        // ── Calculate digit distribution AFTER trigger ──
        const afterPcts = calcDigitPcts(afterDigits);
        const digitShifts = baselinePcts.map((before, d) => ({
            digit: d,
            before,
            after: afterPcts[d],
            shift: afterPcts[d] - before,
        }));

        // ── Winning digit % after trigger ──
        const afterWinCount = afterDigits.filter(d => isWin(d)).length;
        const avgWinPctAfter = (afterWinCount / afterDigits.length) * 100;
        const boost = avgWinPctAfter - baselineWinPct;

        // ── Rolling Momentum: how win% changes across windows after trigger ──
        // For each trigger occurrence, compute win% in the first 100, 50, 20 ticks after
        let winM100 = 0, winM50 = 0, winM20 = 0, totalM100 = 0, totalM50 = 0, totalM20 = 0;
        for (const pos of positions) {
            for (let j = pos + 1; j < Math.min(pos + 101, len); j++) {
                totalM100++;
                if (isWin(digits[j])) winM100++;
            }
            for (let j = pos + 1; j < Math.min(pos + 51, len); j++) {
                totalM50++;
                if (isWin(digits[j])) winM50++;
            }
            for (let j = pos + 1; j < Math.min(pos + 21, len); j++) {
                totalM20++;
                if (isWin(digits[j])) winM20++;
            }
        }
        const pctM100 = totalM100 > 0 ? (winM100 / totalM100) * 100 : baselineWinPct;
        const pctM50 = totalM50 > 0 ? (winM50 / totalM50) * 100 : baselineWinPct;
        const pctM20 = totalM20 > 0 ? (winM20 / totalM20) * 100 : baselineWinPct;
        const overallMomentum = pctM20 - pctM100; // positive = win rate improving recently

        // ── Consistency: check across sub-windows ──
        const subWindows = [5, 10, 15, 20];
        let windowsWithBoost = 0;
        const windowResults: { window: number; winPct: number; boost: number }[] = [];
        for (const sw of subWindows) {
            let swWin = 0, swTotal = 0;
            for (const pos of positions) {
                const end = Math.min(pos + sw, len);
                for (let j = pos + 1; j < end; j++) {
                    swTotal++;
                    if (isWin(digits[j])) swWin++;
                }
            }
            if (swTotal === 0) continue;
            const swWinPct = (swWin / swTotal) * 100;
            const swBoost = swWinPct - baselineWinPct;
            windowResults.push({ window: sw, winPct: swWinPct, boost: swBoost });
            if (swBoost > 0) windowsWithBoost++;
        }
        const consistency = windowResults.length > 0
            ? (windowsWithBoost / windowResults.length) * 100
            : 0;

        // ── Inter-Digit Correlation: which specific digits surge after this trigger ──
        const digitSurges = Array(10).fill(0).map((_, d) => ({
            digit: d,
            surgePct: afterPcts[d] - baselinePcts[d],
            count: afterDigits.filter(x => x === d).length,
        })).filter(s => s.surgePct > 1) // only digits that actually surge
          .sort((a, b) => b.surgePct - a.surgePct);

        // ── Pattern Strength Over Time ──
        const halfLen = Math.floor(len / 2);
        const olderPositions = positions.filter(p => p < halfLen);
        const recentPositions = positions.filter(p => p >= halfLen);

        let olderBoost = 0;
        let olderOccurrences = olderPositions.length;
        if (olderOccurrences >= 2) {
            const olderAfter: number[] = [];
            for (const pos of olderPositions) {
                const end = Math.min(pos + 20, halfLen);
                for (let j = pos + 1; j < end; j++) olderAfter.push(digits[j]);
            }
            if (olderAfter.length > 0) {
                olderBoost = ((olderAfter.filter(d => isWin(d)).length / olderAfter.length) * 100) - baselineWinPct;
            }
        }

        let recentBoost = 0;
        let recentOccurrences = recentPositions.length;
        if (recentOccurrences >= 2) {
            const recentAfter: number[] = [];
            for (const pos of recentPositions) {
                const end = Math.min(pos + 20, len);
                for (let j = pos + 1; j < end; j++) recentAfter.push(digits[j]);
            }
            if (recentAfter.length > 0) {
                recentBoost = ((recentAfter.filter(d => isWin(d)).length / recentAfter.length) * 100) - baselineWinPct;
            }
        }

        let trend: 'strengthening' | 'weakening' | 'stable' | 'new' | 'dying';
        let trendPercent = 0;
        if (olderOccurrences < 2 && recentOccurrences >= 2) { trend = 'new'; trendPercent = recentBoost; }
        else if (olderOccurrences >= 2 && recentOccurrences < 2) { trend = 'dying'; trendPercent = -olderBoost; }
        else if (olderOccurrences >= 2 && recentOccurrences >= 2) {
            trendPercent = recentBoost - olderBoost;
            if (trendPercent > 5) trend = 'strengthening';
            else if (trendPercent < -5) trend = 'weakening';
            else trend = 'stable';
        } else { trend = 'stable'; trendPercent = 0; }

        // ── Composite Confidence Score (0-100) ──
        // Tier 1 improvements: z-score significance, digitPower integration, sample-size weighting

        // B: Z-Score — statistical significance of boost vs noise
        // H0: trigger has no effect, win% = baselineWinPct
        // SE = sqrt(p*(1-p)/n) where p = baseline win proportion, n = post-trigger sample size
        const n = afterDigits.length;
        const p = baselineWinPct / 100;
        const se = Math.sqrt(p * (1 - p) / Math.max(n, 1));
        const observedP = avgWinPctAfter / 100;
        const zScore = se > 0 ? (observedP - p) / se : 0;

        // Approximate p-value from z-score (two-tailed)
        // Using approximation: p ≈ 2 * (1 - Φ(|z|)) where Φ is standard normal CDF
        const absZ = Math.abs(zScore);
        const pValue = absZ < 0.5 ? 0.62 : absZ < 1 ? 0.32 : absZ < 1.5 ? 0.13 : absZ < 2 ? 0.046 : absZ < 2.5 ? 0.012 : absZ < 3 ? 0.0027 : 0.0003;

        // Significance tier
        let significance: 'high' | 'medium' | 'low' | 'none';
        if (pValue < 0.01 && positions.length >= 10) significance = 'high';
        else if (pValue < 0.05 && positions.length >= 6) significance = 'medium';
        else if (pValue < 0.15 && positions.length >= 4) significance = 'low';
        else significance = 'none';

        // C: Trigger Power — how strong the trigger digit itself is in current market
        const triggerPower = digitPower[triggerDigit];

        // D: Sample-size weight — downweight triggers with few occurrences
        // Full weight at 20+ occurrences, linear scale down to 0 at 0 occurrences
        const sampleWeight = Math.min(1, positions.length / 20);

        // Weighted components (0-100 scale)
        const boostScore = Math.min(30, Math.max(0, boost * 2)); // 0-30
        const consistencyScore = (consistency / 100) * 20; // 0-20
        const momentumScore = Math.min(20, Math.max(0, overallMomentum * 1.5)); // 0-20
        const decayScore = Math.min(15, Math.max(0, (bestPeak - baselineWinPct) * 1.5)); // 0-15
        const occScore = Math.min(15, (positions.length / 15) * 15); // 0-15

        // C: DigitPower bonus — boost confidence if trigger digit is gaining strength (0-10)
        const powerBonus = Math.min(10, Math.max(0, triggerPower * 0.8));

        // Raw score
        const rawScore = boostScore + consistencyScore + momentumScore + decayScore + occScore + powerBonus;

        // D: Apply sample-size penalty — low-occurrence triggers get heavily penalized
        const confidence = Math.min(100, rawScore * sampleWeight);

        triggers.push({
            digit: triggerDigit,
            occurrences: positions.length,
            avgWinPctAfter,
            boost,
            consistency,
            windowSizes: windowResults,
            digitShifts,
            patternTrend: {
                olderBoost, recentBoost, olderOccurrences, recentOccurrences,
                trend, trendPercent,
            },
            momentum: {
                winMomentum100: pctM100,
                winMomentum50: pctM50,
                winMomentum20: pctM20,
                overallMomentum,
            },
            decayCurve,
            bestEntryWindow: { start: bestStart + 1, end: bestEnd + 1, peakWinPct: bestPeak },
            digitSurges,
            confidence,
            digitPower,
            zScore,
            pValue,
            significance,
            triggerPower,
        });
    }

    // Sort by confidence (highest first), then boost
    triggers.sort((a, b) => {
        if (Math.abs(a.confidence - b.confidence) > 5) return b.confidence - a.confidence;
        return b.boost - a.boost;
    });

    return { baselinePcts, baselineWinPct, triggers };
}

/* ── Micro-choppiness analysis on the current growing candle ────────────── */
// Analyzes tick-level price action within the current (still-open) candle.
// Measures direction flip frequency, tick-run length, and body indecision.
// Higher score = more random / choppy (bad for 1-tick predictions).
function calcMicroChoppiness(prices: number[]): SymbolDirectionResult {
    const len = prices.length;
    if (len < 5) {
        return { symbol: '', label: '', choppinessScore: 0, bodyRatio: 0, directionChanges: 0, trendStrength: 0, recentBodyRatio: 0, qualifies: false, detail: 'Insufficient ticks' };
    }

    const open = prices[0];
    const close = prices[len - 1];
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const range = high - low || 1;

    // ── 1. Tick-level direction flips ───────────────────────────────
    let flips = 0, totalDir = 0, prevDir = 0;
    let runSum = 0, runCount = 0, curRun = 1;

    for (let i = 1; i < len; i++) {
        const dir = prices[i] > prices[i - 1] ? 1 : prices[i] < prices[i - 1] ? -1 : 0;
        if (dir === 0) continue;
        totalDir++;
        if (prevDir !== 0 && dir !== prevDir) {
            flips++;
            runSum += curRun;
            runCount++;
            curRun = 1;
        } else {
            curRun++;
        }
        prevDir = dir;
    }
    if (curRun > 0) { runSum += curRun; runCount++; }
    const avgRun = runCount > 0 ? runSum / runCount : 1;
    const flipRate = totalDir > 1 ? flips / (totalDir - 1) : 0;

    // ── 2. Body-to-range ratio (small = indecision = choppy) ─────────
    const body = Math.abs(close - open);
    const bodyRatio = body / range;

    // ── 3. Wick balance (balanced = indecision) ──────────────────────
    const upperWick = high - Math.max(open, close);
    const lowerWick = Math.min(open, close) - low;
    const totalWick = upperWick + lowerWick;
    const wickBalance = totalWick > 0 ? 1 - Math.abs(upperWick - lowerWick) / totalWick : 0.5;

    // ── 4. Reversal oscillation amplitude ───────────────────────────
    const rangePct = range / (open || 1);
    const rangeScore = rangePct > 0 ? Math.min(1, rangePct * 200) : 0;

    // ── Composite score ─────────────────────────────────────────────
    const score = Math.min(100, Math.round(
        flipRate             * 30 +   // frequent direction flips
        Math.max(0, 1 - avgRun / 3) * 25 +  // short tick runs
        (1 - bodyRatio)      * 25 +   // small body = indecision
        wickBalance          * 10 +   // balanced wicks = stalemate
        rangeScore           * 10     // wide range relative to price = noise
    ));

    return {
        symbol: '', label: '',
        choppinessScore: score,
        bodyRatio: Math.round(bodyRatio * 100),
        directionChanges: flips,
        trendStrength: Math.round(avgRun * 10),
        recentBodyRatio: Math.round(rangeScore * 100),
        qualifies: score >= 55,
        detail: `Score: ${score}% | Flips: ${flips}/${totalDir} | Run: ${avgRun.toFixed(1)}t | Body: ${(bodyRatio * 100).toFixed(0)}%`,
    };
}

// ─── Global POC listener (survives WS reconnect via onNewSystemMessage) ──
// Flags ONLY when a real (non-virtual) contract settles as a WIN, so the
// auto-switcher only changes volatility after a real-trade win — never on
// losses and never on virtual-hook wins/losses.
(window as any).__makoti_lastContractSettled = false;

let _pocUnsub: (() => void) | null = null;

function startPocListener() {
    if (_pocUnsub) return;
    _pocUnsub = onNewSystemMessage((event: MessageEvent) => {
        try {
            const d = JSON.parse(event.data);
            const c = d?.proposal_open_contract;
            if (d?.msg_type === 'proposal_open_contract' && c?.is_sold && !c.is_virtual && Number(c.profit) > 0) {
                (window as any).__makoti_lastContractSettled = true;
            }
        } catch (_) {}
    });
}

function stopPocListener() {
    if (_pocUnsub) {
        _pocUnsub();
        _pocUnsub = null;
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Scanner Component
═══════════════════════════════════════════════════════════════════════════ */
export const Scanner: React.FC = () => {
    const [bot, setBot] = useState<BotId>('pvty_kill');
    const [scanning, setScanning] = useState(false);
    const [progress, setProgress] = useState('');
    const [results, setResults] = useState<ScanResult[]>([]);
    const [bestSymbols, setBestSymbols] = useState<string[]>([]);
    const [autoSwitch, setAutoSwitch] = useState(false);
    const [autoSwitcherActive, setAutoSwitcherActive] = useState(false);
    const [pendingSymbol, setPendingSymbol] = useState('');
    const [notification, setNotification] = useState<{ msg: string; type: 'info' | 'success' | 'warn' } | null>(null);

    // Single vs all volatilities
    const [singleVol, setSingleVol] = useState(false);
    const [singleVolSymbol, setSingleVolSymbol] = useState(ALL_SYMBOLS[0]);
    const singleVolRef = useRef(false);
    const singleVolSymbolRef = useRef(ALL_SYMBOLS[0]);
    const symbolsToScanRef = useRef<string[]>(ALL_SYMBOLS);

    // Sync refs
    useEffect(() => { singleVolRef.current = singleVol; }, [singleVol]);
    useEffect(() => { singleVolSymbolRef.current = singleVolSymbol; }, [singleVolSymbol]);

    // Refs for logic (avoid stale closures)
    const wsRef = useRef<MakotiWS | null>(null);
    const pendingRef = useRef<Set<string>>(new Set());
    const collectedRef = useRef<Map<string, any>>(new Map());
    const botRef = useRef<BotId>('pvty_kill');
    const autoSwitchRef = useRef(false);
    const scanningRef = useRef(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const currentBestRef = useRef<string>('');
    const pendingSymbolRef = useRef<string>('');
    const msgHandlerRef = useRef<(data: any) => void>(() => {});
    const cancelScanRef = useRef<(() => void) | null>(null);

    const showNotify = useCallback((msg: string, type: 'info' | 'success' | 'warn' = 'info') => {
        setNotification({ msg, type });
        setTimeout(() => setNotification(null), 3500);
    }, []);

    const setPending = useCallback((sym: string) => {
        setPendingSymbol(sym);
        pendingSymbolRef.current = sym;
    }, []);

    const clearPending = useCallback(() => {
        setPendingSymbol('');
        pendingSymbolRef.current = '';
    }, []);

    const applySwitch = useCallback((sym: string) => {
        currentBestRef.current = sym;
        clearPending();
        // 1. Runtime override — used by Purchase.js applyAlternateMarketsToCurrentTradeOptions
        try { window.DBot = window.DBot || {}; (window.DBot as any).__force_symbol = sym; } catch (_) {}
        // 2. QuickStrategy store — may or may not exist depending on the active tab
        try { const rs = (window as any).__store_instance; if (rs?.quick_strategy) rs.quick_strategy.setValue('symbol', sym); } catch (_) {}
        // 3. Blockly workspace — updates the trade_definition_market SYMBOL_LIST field.
        //    The block's onchange handler will call DBotStore.instance.dashboard.setBotBuilderSymbol automatically.
        try {
            const ws = (window as any).Blockly?.derivWorkspace;
            if (ws) {
                const b = ws.getAllBlocks().find((bl: any) => bl.type === 'trade_definition_market');
                if (b) b.setFieldValue('SYMBOL_LIST', sym);
            }
        } catch (_) {}
        // 4. Dashboard store — update directly via DBotStore.instance (the canonical access pattern).
        try {
            const store = DBotStore.instance;
            if (store?.dashboard?.setBotBuilderSymbol) store.dashboard.setBotBuilderSymbol(sym);
        } catch (_) {}
        (window as any).__makoti_lastContractSettled = false;
        showNotify(`Volatility Updated: ${SYMBOL_LABELS[sym]}`, 'success');
    }, [showNotify, clearPending]);

    const cleanup = useCallback(() => {
        try { wsRef.current?.close(); } catch (_) {}
        wsRef.current = null;
    }, []);

    /* ── Create persistent WS (reused across auto-scan cycles) ──────────── */
    const ensureWs = useCallback(() => {
        if (wsRef.current && wsRef.current.isOpen()) return wsRef.current;
        cleanup();
        const sendTicksRequest = () => {
            if (!window._newSystemWS || window._newSystemWS.readyState !== WebSocket.OPEN) return;
            const bot = botRef.current;
            const count = bot === 'pvty_kill' ? 1000 : 60;
            const syms = symbolsToScanRef.current;
            setProgress(`Fetching ${count} ticks from ${syms.length === 1 ? SYMBOL_LABELS[syms[0]] : `${syms.length} volatilities`}…`);
            syms.forEach(sym => {
                window._newSystemWS.send(JSON.stringify({ ticks_history: sym, count, end: 'latest', style: 'ticks' }));
            });
        };
        const mws = openMakotiWS(
            (data) => msgHandlerRef.current(data),
            () => { if (scanningRef.current) sendTicksRequest(); },
            () => { cancelScanRef.current?.(); },
            { skipAuth: true }
        );
        wsRef.current = mws;
        return mws;
    }, [cleanup]);

    /* ── Perform a single scan ──────────────────────────────────────────── */
    const performScan = useCallback((initial = false) => {
        if (scanningRef.current) return;
        const currentBot = botRef.current;
        cancelScanRef.current = null;
        scanningRef.current = true;
        setScanning(true);
        setProgress('Connecting to Deriv API…');
        if (initial) { setResults([]); setBestSymbols([]); setTopPrediction(null); }

        let finalized = false;
        symbolsToScanRef.current = singleVolRef.current ? [singleVolSymbolRef.current] : ALL_SYMBOLS;
        const symbolsToScan = symbolsToScanRef.current;
        pendingRef.current = new Set(symbolsToScan);
        collectedRef.current = new Map();
        const timeoutMs = currentBot === 'pvty_kill' ? 20000 : 10000;
        const scanTimeout = setTimeout(() => {
            if (!finalized) finalize();
        }, timeoutMs);

        msgHandlerRef.current = (data: any) => {
            if (data.error) {
                if (data.msg_type === 'history') {
                    const sym: string = data.echo_req?.ticks_history;
                if (sym && pendingRef.current.has(sym)) {
                    pendingRef.current.delete(sym);
                    setProgress(`Fetched ${symbolsToScan.length - pendingRef.current.size} / ${symbolsToScan.length}…`);
                    if (pendingRef.current.size === 0 && !finalized) { clearTimeout(scanTimeout); finalize(); }
                }
            }
            return;
        }
        if (data.msg_type === 'history' && data.history?.prices) {
            const sym: string = data.echo_req?.ticks_history;
            if (!sym || !pendingRef.current.has(sym)) return;
            pendingRef.current.delete(sym);
            collectedRef.current.set(sym, data.history.prices.map(Number));
            setProgress(`Fetched ${symbolsToScan.length - pendingRef.current.size} / ${symbolsToScan.length}…`);
            if (pendingRef.current.size === 0 && !finalized) { clearTimeout(scanTimeout); finalize(); }
            }
        };

        const finalize = () => {
            if (finalized) return;
            finalized = true;
            cancelScanRef.current = null;
            clearTimeout(scanTimeout);

            let best: string[] = [];
            let bestScore = 0;
            if (currentBot === 'pvty_kill') {
                const scanResults: SymbolDigitResult[] = [];
                collectedRef.current.forEach((prices: number[], sym) => {
                    if (!prices || prices.length < 100) return;
                    const pipSize = PIP_SIZES[sym] || 2;
                    const digits = prices.map(p => Number(Number(p).toFixed(pipSize).slice(-1)));
                    const pcts = calcDigitPcts(digits);
                    const qualifies = pcts[7] < 10 && pcts[8] < 10 && pcts[9] < 10;
                    scanResults.push({
                        symbol: sym, label: SYMBOL_LABELS[sym],
                        pcts, totalTicks: prices.length,
                        qualifies,
                        detail: qualifies ? '✅ 7,8,9 below 10%' : `7:${pcts[7].toFixed(1)}% 8:${pcts[8].toFixed(1)}% 9:${pcts[9].toFixed(1)}%`,
                    });
                });
                scanResults.sort((a, b) => {
                    /* First: qualifying volatilities (all three below 10%) come first */
                    if (a.qualifies && !b.qualifies) return -1;
                    if (!a.qualifies && b.qualifies) return 1;
                    /* Then: lowest sum of 7+8+9 wins */
                    return (a.pcts[7] + a.pcts[8] + a.pcts[9]) - (b.pcts[7] + b.pcts[8] + b.pcts[9]);
                });
                best = scanResults.map(r => r.symbol);
                bestScore = Math.round(Math.max(scanResults[0]?.pcts[7] ?? 0, scanResults[0]?.pcts[8] ?? 0, scanResults[0]?.pcts[9] ?? 0));
                setResults(scanResults);
                setBestSymbols(best.slice(0, 3));
            } else {
                const scanResults: SymbolDirectionResult[] = [];
                collectedRef.current.forEach((prices: number[], sym) => {
                    if (!prices || prices.length < 5) return;
                    const a = calcMicroChoppiness(prices);
                    a.symbol = sym; a.label = SYMBOL_LABELS[sym];
                    scanResults.push(a);
                });
                scanResults.sort((a, b) => b.choppinessScore - a.choppinessScore);
                best = scanResults.map(r => r.symbol);
                bestScore = scanResults[0]?.choppinessScore ?? 0;
                setResults(scanResults);
                setBestSymbols(best.slice(0, 3));
            }

            setScanning(false);
            scanningRef.current = false;

            const bestSym = best[0] || '';
            const bestLabel = bestSym ? SYMBOL_LABELS[bestSym] : '—';

            if (currentBot === 'rf_v4') {
                if (bestSym && bestSym !== currentBestRef.current && autoSwitchRef.current) {
                    if ((window as any).__makoti_lastContractSettled) {
                        applySwitch(bestSym);
                    } else {
                        setPending(bestSym);
                        showNotify(`Waiting for contract settlement to switch to ${bestLabel}…`, 'warn');
                    }
                }

                const ps = pendingSymbolRef.current;
                if (ps && (window as any).__makoti_lastContractSettled && autoSwitchRef.current) {
                    if (best.indexOf(ps) >= 0) applySwitch(ps);
                    else clearPending();
                }

                if (autoSwitchRef.current) {
                    const p = pendingSymbolRef.current;
                    setProgress(p ? `Auto: Pending ${SYMBOL_LABELS[p]} (wait settle)` : `Auto: Best ${bestLabel} (${bestScore}%)`);
                } else {
                    setProgress(`Top: ${bestLabel} (${bestScore}%)`);
                    cleanup();
                }
            } else {
                setProgress(`Top: ${bestLabel} (max 7/8/9: ${bestScore}%)`);
                cleanup();
            }
        };
        cancelScanRef.current = finalize;

        const mws = ensureWs();
        if (mws.isOpen()) {
            if (currentBot === 'pvty_kill') {
                setProgress(`Fetching 1000 ticks from ${symbolsToScan.length === 1 ? SYMBOL_LABELS[symbolsToScan[0]] : `${symbolsToScan.length} volatilities`}…`);
                symbolsToScan.forEach(sym => mws.send({ ticks_history: sym, count: 1000, end: 'latest', style: 'ticks' }));
            } else {
                setProgress(`Fetching 60 ticks from ${symbolsToScan.length === 1 ? SYMBOL_LABELS[symbolsToScan[0]] : `${symbolsToScan.length} volatilities`}…`);
                symbolsToScan.forEach(sym => mws.send({ ticks_history: sym, count: 60, end: 'latest', style: 'ticks' }));
            }
        }
        // If not open yet, ensureWs will trigger onReady → which fires the requests
    }, [cleanup, ensureWs, showNotify, applySwitch, setPending, clearPending]);

    /* ── Manual analyze button ──────────────────────────────────────────── */
    const analyze = useCallback(() => {
        if (scanningRef.current) return;
        botRef.current = bot;

        if (autoSwitch && bot === 'rf_v4') {
            currentBestRef.current = '';
            clearPending();
            autoSwitchRef.current = true;
            setAutoSwitcherActive(true);
            startPocListener();
            if (intervalRef.current) clearInterval(intervalRef.current);
            intervalRef.current = setInterval(() => performScan(false), 3000);
            performScan(true); // initial scan with results cleared
        } else {
            autoSwitchRef.current = false;
            setAutoSwitcherActive(false);
            stopPocListener();
            if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
            performScan(true);
        }
    }, [bot, autoSwitch, performScan, clearPending]);

    /* ── Toggle auto-switcher ───────────────────────────────────────────── */
    const toggleAutoSwitch = useCallback(() => {
        setAutoSwitch(prev => {
            if (prev) {
                autoSwitchRef.current = false;
                setAutoSwitcherActive(false);
                clearPending();
                currentBestRef.current = '';
                stopPocListener();
                if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
            }
            return !prev;
        });
    }, [clearPending]);

    useEffect(() => {
        return () => {
            autoSwitchRef.current = false;
            stopPocListener();
            if (intervalRef.current) clearInterval(intervalRef.current);
            try { wsRef.current?.close(); } catch (_) {}
        };
    }, []);

    return (
        <div className='mw-scanner scanner-theme'>
            {notification && (
                <div className={`mw-scanner__notif mw-scanner__notif--${notification.type}`}>{notification.msg}</div>
            )}
            <div className='mw-scanner__controls'>
                <div className='mw-field'>
                    <label className='mw-label'>Bot Selection</label>
                    <MwSelect value={bot} options={[
                        { value: 'pvty_kill', label: 'Poverty Killer' },
                        { value: 'rf_v4', label: 'Rise/Fall V4' },
                    ]}
                        onChange={v => setBot(v as BotId)} disabled={scanning} />
                </div>
                <div className='mw-scanner__desc'>
                    {bot === 'pvty_kill'
                        ? 'Scans 1 000 ticks per volatility. Finds markets where digits 7, 8 and 9 each stay below 10%.'
                        : 'Analyses 60 recent ticks per volatility (current candle). Finds choppy micro-markets — auto-switches every 3s.'}
                </div>
                {bot === 'rf_v4' && (
                    <label className='mw-switch-row'>
                        <span className='mw-switch-label'>Auto Switcher</span>
                        <div className='mw-toggle' onClick={toggleAutoSwitch}>
                            <div className={`mw-toggle__track${autoSwitch ? ' mw-toggle__track--on' : ''}`}>
                                <div className={`mw-toggle__thumb${autoSwitch ? ' mw-toggle__thumb--on' : ''}`} />
                            </div>
                        </div>
                        {autoSwitcherActive && <span className='mw-switch-active'>ACTIVE</span>}
                        {pendingSymbol && <span className='mw-switch-pending'>⏳ WIN REQUIRED</span>}
                    </label>
                )}
                <label className='mw-switch-row'>
                    <span className='mw-switch-label'>Single Volatility</span>
                    <div className='mw-toggle' onClick={() => { if (!scanning) setSingleVol(v => !v); }}>
                        <div className={`mw-toggle__track${singleVol ? ' mw-toggle__track--on' : ''}`}>
                            <div className={`mw-toggle__thumb${singleVol ? ' mw-toggle__thumb--on' : ''}`} />
                        </div>
                    </div>
                </label>
                {singleVol && (
                    <div className='mw-field' style={{ marginBottom: 6 }}>
                        <label className='mw-label'>Volatility</label>
                        <MwSelect value={singleVolSymbol}
                            options={ALL_SYMBOLS.map(s => ({ value: s, label: SYMBOL_LABELS[s] }))}
                            onChange={v => setSingleVolSymbol(v)} disabled={scanning} />
                    </div>
                )}
                <button className={`mw-btn mw-btn--scan${scanning ? ' mw-btn--busy' : ''}`} onClick={analyze} disabled={scanning}>
                    {scanning ? <><span className='mw-spin' /> Analyzing…</> : 'Analyze'}
                </button>
                {progress && (
                    <div className='mw-scanner__progress' style={progress.startsWith('PREDICTION') ? {
                        background: '#1a3d1a', border: '1px solid #4caf50', borderRadius: 4,
                        padding: 8, marginTop: 6, fontSize: 12, color: '#fff', fontWeight: 'bold',
                    } : {}}>
                        {progress.startsWith('PREDICTION') ? (() => {
                            const parts = progress.replace('PREDICTION → ', '').split(' | ');
                            return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {parts.map((p, i) => <span key={i}>{p}</span>)}
                                </div>
                            );
                        })() : progress}
                    </div>
                )}
            </div>
            {results.length > 0 && (
                <div className='mw-scanner__results'>
                    <div className='mw-scanner__results-head'>
                        {bot === 'pvty_kill'
                            ? 'Digit 7 / 8 / 9 Distribution (1 000 ticks)'
                            : `Micro-Choppiness (current candle, 60 ticks) ${autoSwitcherActive ? '— Auto-switching ON' : ''}`}
                    </div>
                    {bestSymbols.length > 0 && (
                        <div className='mw-scanner__best'>
                            <span className='mw-scanner__best-lbl'>Best:</span>
                            {bestSymbols.map(s => <span key={s} className='mw-scanner__badge'>{SYMBOL_LABELS[s]}</span>)}
                        </div>
                    )}
                    <div className='mw-scanner__list'>
                        {results.map((r, idx) => (
                            <div key={r.symbol} className={`mw-scanner__row${idx === 0 ? ' mw-scanner__row--match' : ''}`}>
                                <div className='mw-scanner__row-head'>
                                    <span className='mw-scanner__sym'>{r.label}</span>
                                    <span className='mw-scanner__row-detail'>{r.detail}</span>
                                    {idx === 0 && <span className='mw-scanner__tag'>BEST</span>}
                                </div>
                                {isDigitResult(r) && (
                                    <div className='mw-scanner__bars'>
                                        {r.pcts.map((p, i) => (
                                            <div key={i} className={`mw-scanner__bar-wrap${[7, 8, 9].includes(i) ? ' mw-scanner__bar-wrap--hi' : ''}`} title={`Digit ${i}: ${p.toFixed(2)}%`}>
                                                <div className='mw-scanner__bar-fill' style={{ height: `${Math.min(100, p * 4)}%` }} />
                                                <span className='mw-scanner__bar-pct'>{p.toFixed(1)}%</span>
                                                <span className='mw-scanner__bar-lbl'>{i}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {!isDigitResult(r) && (() => {
                                    const dr = r as SymbolDirectionResult;
                                    return (
                                        <div className='mw-scanner__dir-bar'>
                                            <div className='mw-scanner__dir-fill' style={{
                                                width: `${dr.choppinessScore}%`,
                                                background: dr.choppinessScore >= 70 ? 'linear-gradient(90deg, #22c55e, #16a34a)' : dr.choppinessScore >= 55 ? 'linear-gradient(90deg, #eab308, #ca8a04)' : 'linear-gradient(90deg, #ef4444, #dc2626)',
                                            }} />
                                        </div>
                                    );
                                })()}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
