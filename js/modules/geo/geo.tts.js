import { safeModuleRun } from '../../core/events.js?v=2.9.3-r239';
import { showToast } from '../../ui/components.js?v=2.9.3-r239';

export const VOICE_SCREEN_STORAGE_KEY = 'klev_pro_voice_screen_v1';
export const VOICE_BG_STORAGE_KEY = 'klev_pro_voice_bg_v1';

let _voiceGuidanceEnabled = true;
let _voiceGuidanceBgEnabled = true;
let _lastSpokenPhrase = '';
let _lastSpokenTs = 0;

safeModuleRun('geo:tts', () => {
  if (typeof localStorage !== 'undefined') {
    const savedScr = localStorage.getItem(VOICE_SCREEN_STORAGE_KEY);
    if (savedScr !== null) _voiceGuidanceEnabled = savedScr !== '0';
    const savedBg = localStorage.getItem(VOICE_BG_STORAGE_KEY);
    if (savedBg !== null) _voiceGuidanceBgEnabled = savedBg !== '0';
  }
  if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.setBgVoiceEnabled === 'function') {
    window.AndroidBridge.setBgVoiceEnabled(Boolean(_voiceGuidanceBgEnabled));
  }
});

export function isVoiceGuidanceScreenEnabled() {
  return _voiceGuidanceEnabled;
}

export function isVoiceGuidanceBackgroundEnabled() {
  return _voiceGuidanceBgEnabled;
}

export function setVoiceGuidanceScreenEnabled(enabled) {
  return safeModuleRun('geo:tts', () => {
    _voiceGuidanceEnabled = Boolean(enabled);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(VOICE_SCREEN_STORAGE_KEY, _voiceGuidanceEnabled ? '1' : '0');
    }
    return _voiceGuidanceEnabled;
  }, _voiceGuidanceEnabled);
}

export function setVoiceGuidanceBackgroundEnabled(enabled) {
  return safeModuleRun('geo:tts', () => {
    _voiceGuidanceBgEnabled = Boolean(enabled);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(VOICE_BG_STORAGE_KEY, _voiceGuidanceBgEnabled ? '1' : '0');
    }
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.setBgVoiceEnabled === 'function') {
      window.AndroidBridge.setBgVoiceEnabled(_voiceGuidanceBgEnabled);
    }
    return _voiceGuidanceBgEnabled;
  }, _voiceGuidanceBgEnabled);
}

export function bearingToSpokenDirectionRu(deg) {
  const dirs = ['север', 'северо-восток', 'восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад'];
  return dirs[Math.round(((Number(deg) || 0) % 360) / 45) % 8];
}

export function _pluralizeRu(n, one, few, many) {
  const abs = Math.abs(Math.round(n)) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}

export function numberToRussianWordsNominal(n) {
  const num = Math.max(0, Math.round(Number(n) || 0));
  if (num === 0) return 'ноль';
  const ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const onesFem = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const teens = [
    'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
    'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'
  ];
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

  const spellTriplet = (val, feminine = false) => {
    const parts = [];
    const h = Math.floor(val / 100);
    const rem = val % 100;
    const t = Math.floor(rem / 10);
    const u = rem % 10;
    if (h > 0) parts.push(hundreds[h]);
    if (t === 1) {
      parts.push(teens[u]);
    } else {
      if (t > 1) parts.push(tens[t]);
      if (u > 0) parts.push(feminine ? onesFem[u] : ones[u]);
    }
    return parts.join(' ');
  };

  const parts = [];
  const thousands = Math.floor(num / 1000);
  const rest = num % 1000;
  if (thousands > 0) {
    parts.push(spellTriplet(thousands, true));
    parts.push(_pluralizeRu(thousands, 'тысяча', 'тысячи', 'тысяч'));
  }
  if (rest > 0) {
    parts.push(spellTriplet(rest, false));
  }
  return parts.join(' ').trim();
}

export function formatSpokenRouteDistanceRu(distKm, useWords = true) {
  const rawMeters = Math.max(0, Math.round((Number(distKm) || 0) * 1000));
  const fmt = (v) => useWords ? numberToRussianWordsNominal(v) : String(v);
  if (rawMeters < 1000) {
    return `${fmt(rawMeters)} ${_pluralizeRu(rawMeters, 'метр', 'метра', 'метров')}`;
  }
  const tenthsKm = Math.round(rawMeters / 100);
  const wholeKm = Math.floor(tenthsKm / 10);
  const hundredsMeters = (tenthsKm % 10) * 100;
  const kmWord = _pluralizeRu(wholeKm, 'километр', 'километра', 'километров');
  if (hundredsMeters === 0) {
    return `примерно ${fmt(wholeKm)} ${kmWord}`;
  }
  return `примерно ${fmt(wholeKm)} ${kmWord} ${fmt(hundredsMeters)} метров`;
}

export function _normalizeDistanceTokensForSpeechRu(rawPhrase) {
  let text = String(rawPhrase || '');
  text = text.replace(/,\s*до старта\s+примерно/gi, '. Расстояние до точки старта составляет примерно');
  text = text.replace(/(\d+)[.,](\d+)\s*(?:километр(?:а|ов)?|км)(?![а-яёa-z])/gi, (_m, kmPart, decPart) => {
    const kmVal = parseInt(kmPart, 10) + parseInt(String(decPart).slice(0, 1), 10) * 0.1;
    return formatSpokenRouteDistanceRu(kmVal, true);
  });
  text = text.replace(/(\d[\d\s\u00A0]*)\s*(?:километр(?:а|ов)?|км)(?![а-яёa-z])/gi, (match, numStr) => {
    const cleanNum = parseInt(String(numStr).replace(/[\s\u00A0]/g, ''), 10);
    if (!Number.isFinite(cleanNum)) return match;
    return `${numberToRussianWordsNominal(cleanNum)} ${_pluralizeRu(cleanNum, 'километр', 'километра', 'километров')}`;
  });
  text = text.replace(/(\d[\d\s\u00A0]*)\s*(?:метр(?:а|ов)?|м)(?![а-яёa-z])\s*(?:\(\s*[\d.,]+\s*км\s*\))?/gi, (match, numStr) => {
    const cleanNum = parseInt(String(numStr).replace(/[\s\u00A0]/g, ''), 10);
    if (!Number.isFinite(cleanNum)) return match;
    if (cleanNum >= 1000) {
      return formatSpokenRouteDistanceRu(cleanNum / 1000, true);
    }
    return `${numberToRussianWordsNominal(cleanNum)} ${_pluralizeRu(cleanNum, 'метр', 'метра', 'метров')}`;
  });
  return text;
}

export function speakRouteGuidanceRu(phrase, forceImmediate = false) {
  return safeModuleRun('geo:tts', () => {
    if (!phrase) return;
    const displayPhrase = phrase;
    phrase = _normalizeDistanceTokensForSpeechRu(phrase);
    const spokenPhrase = phrase;
    const now = Date.now();
    if (!forceImmediate && spokenPhrase === _lastSpokenPhrase && (now - _lastSpokenTs < 12000)) return;
    _lastSpokenPhrase = spokenPhrase;
    _lastSpokenTs = now;
    const isWarn = spokenPhrase.includes('отклонились') || spokenPhrase.includes('Внимание');
    showToast(displayPhrase, isWarn ? 'warn' : 'good');

    const isBgNow = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const allowVoiceNow = isBgNow ? _voiceGuidanceBgEnabled : _voiceGuidanceEnabled;
    if (!allowVoiceNow) return;

    // 1. Звуковой сигнал привлечения внимания (работает и в APK, и в браузере)
    safeModuleRun('geo:tts', () => {
      if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.playNavTone === 'function') {
        window.AndroidBridge.playNavTone(isWarn ? 'warn' : 'good');
      } else if (typeof window !== 'undefined' && typeof window.__KLEV_PLAY_SONAR_PING__ === 'function') {
        window.__KLEV_PLAY_SONAR_PING__(isWarn ? 'warn' : 'normal');
      }
    });

    // 2. Нативный синтезатор речи Android (TextToSpeech) в APK — работает и на экране, и в фоне
    let handledByAndroid = false;
    safeModuleRun('geo:tts', () => {
      if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.speakTts === 'function') {
        window.AndroidBridge.speakTts(String(phrase), Boolean(forceImmediate));
        handledByAndroid = true;
      }
    });
    if (handledByAndroid) return;

    // 3. Браузерный Web Speech API (для Web / PWA) с задержкой после cancel(), чтобы Chrome не сбрасывал фразу
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      if (forceImmediate) {
        try { window.speechSynthesis.cancel(); } catch (_e) {}
      }
      setTimeout(() => {
        safeModuleRun('geo:tts', () => {
          const u = new SpeechSynthesisUtterance(String(phrase));
          u.lang = 'ru-RU';
          u.rate = 0.98;
          u.pitch = 1.0;
          u.volume = 1.0;
          const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
          const ruVoice = voices.find(v => v && /^ru/i.test(v.lang));
          if (ruVoice) u.voice = ruVoice;
          window.speechSynthesis.speak(u);
        });
      }, forceImmediate ? 60 : 10);
    }
  });
}
