// ==UserScript==
// @name                Boosteroid Optimizer Plus
// @namespace           https://github.com/Derfogd
// @version             6.1.0
// @description         Advanced optimizations for Boosteroid: 4K resolution, AV1/HEVC codec, tuned bitrate, WebGPU zero-copy upscaling
// @description:fr      Optimisations avancées pour Boosteroid : résolution 4K/8K, codec AV1/HEVC, bitrate optimisé, WebGPU zéro copie
// @author              Derfog
// @match               https://*.boosteroid.com/*
// @match               https://boosteroid.com/*
// @grant               none
// @run-at              document-start
// @updateURL           https://raw.githubusercontent.com/optimizerplus/optimizer-plus/main/Boosteroid-Optimizer-Plus.user.js
// @downloadURL         https://raw.githubusercontent.com/optimizerplus/optimizer-plus/main/Boosteroid-Optimizer-Plus.user.js
// @noframes
// ==/UserScript==

(function () {
    'use strict';

// === GLOBALS & DEBUG CONSOLE ===

    // warn/error always pass through. Debug: localStorage.setItem('optimizer_debug','1') + reload.
    const DEBUG_LOGS = (() => {
        try { return localStorage.getItem('optimizer_debug') === '1'; } catch (e) { return false; }
    })();
    // Two copies of the script (prod + dev) must never hook the page twice
    if (window.__optimizerPlusLoaded) return;
    window.__optimizerPlusLoaded = true;

    // Flipped to true by build.js for the dev build: prints the [Stats] report in the console.
    const DEV_BUILD = false;

    const _realConsole = window.console;
    const console = DEBUG_LOGS ? _realConsole : {
        log: () => {},
        warn: _realConsole.warn.bind(_realConsole),
        error: _realConsole.error.bind(_realConsole)
    };

    // Single source of truth for the version; keep in sync with @version.
    const SCRIPT_VERSION = '6.1.0';

    // ENVIRONMENT DETECTION & PROFILING

    const ENV_PROFILE = (function () {
        const safeGet = (fn, fallback) => {
            try { return fn() ?? fallback; } catch (e) { return fallback; }
        };

        const ua = navigator.userAgent || '';
        const cores = safeGet(() => navigator.hardwareConcurrency, 4);
        const memory = safeGet(() => navigator.deviceMemory, null); // GB; null when unsupported (Firefox/Safari)

        let isTouch = false;
        try {
            isTouch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
        } catch (e) {
            isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        }

        const width = safeGet(() => window.innerWidth || document.documentElement.clientWidth, 1920);
        const height = safeGet(() => window.innerHeight || document.documentElement.clientHeight, 1080);
        const dpr = safeGet(() => window.devicePixelRatio, 1);

        let connection = null;
        let effectiveType = '4g';
        let downlink = null;
        let saveData = false;

        try {
            connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            if (connection) {
                effectiveType = connection.effectiveType || '4g';
                downlink = connection.downlink || null;
                saveData = connection.saveData || false;
            }
        } catch (e) {
            console.log('[Optimizer+] Network API non disponible, utilisation des valeurs par défaut');
        }

        const isMobile = /Android|iPhone|iPad|iPod|Windows Phone/i.test(ua);
        const isTablet = /iPad|Android(?!.*Mobile)/i.test(ua);
        const isTVByUA = /SmartTV|Tizen|WebOS|NetCast|HbbTV|BRAVIA|AFT|Fire TV|Hisense|VIDAA|Roku|PlayStation|Xbox|Steam Link|SHIELD|Chromecast|Android TV|tvOS|GoogleTV|Apple TV/i.test(ua);
        // Heuristic: large screen + DPR 1.0 + not mobile/tablet is probably a TV
        const isTVByHeuristic = (width > 1920 && height > 1080 && dpr === 1.0 && !isMobile && !isTablet);
        const isTV = isTVByUA || isTVByHeuristic;
        const isFirefox = /Firefox/i.test(ua);
        const isChrome = /Chrome|Chromium|CriOS/i.test(ua);
        const isSafari = /Safari/i.test(ua) && !/Chrome/i.test(ua);
        const isEdge = /Edg/i.test(ua);
        const isOldBrowser = /MSIE|Trident|Edge\/\d+\./i.test(ua); // Legacy non-Chromium Edge

        // effectiveType is unreliable on desktop (false '4g'), so it only counts on mobile
        const isSlowByNetwork = isMobile && (effectiveType === '3g' || effectiveType === '2g');
        const isLowEnd = cores <= 4 || (memory !== null && memory <= 4) || isSlowByNetwork || isOldBrowser;
        const isHighEnd = cores > 8 && (memory === null || memory > 8) && !isMobile && !isTablet;
        const isMidRange = !isLowEnd && !isHighEnd;

        const isSmallScreen = width < 1280 || height < 720;
        const isMediumScreen = width >= 1280 && width < 1920;
        const isLargeScreen = width >= 1920 && height >= 1080;

        return {
            isMobile, isTablet, isTV, isSmallScreen, isMediumScreen, isLargeScreen,
            cores, memory, isLowEnd, isMidRange, isHighEnd, isOldBrowser,
            isFirefox, isChrome, isSafari, isEdge,
            effectiveType, downlink, saveData,
            // Network API downlink is unreliable on desktop, so slow-network only applies to mobile
            isSlowNetwork: isMobile && ((downlink !== null && downlink > 0 && downlink < 5) || (effectiveType === '3g' || effectiveType === '2g')),
            isFastNetwork: (downlink !== null && downlink >= 15) || (!isMobile && effectiveType === '4g'),
            width, height, dpr,
            isTouch,
            summary() {
                const device = this.isTV ? 'TV' : (this.isMobile ? 'Mobile' : (this.isTablet ? 'Tablet' : 'Desktop'));
                const perf = this.isLowEnd ? 'Low-End' : (this.isHighEnd ? 'High-End' : 'Mid-Range');
                const net = this.isSlowNetwork ? 'Slow' : (this.isFastNetwork ? 'Fast' : 'Normal');
                return `${device} | ${perf} (${this.cores}c/${this.memory}GB) | ${net} | ${this.width}x${this.height}`;
            }
        };
    })();

    console.log('[Optimizer+] =======================================');
    console.log('[Optimizer+] Device Profile:', ENV_PROFILE.summary());

    // SIGNATURE & PROTECTION

    const SCRIPT_SIGNATURE = {
        version: SCRIPT_VERSION,
        verify: () => {
            // document.head can be null at document-start (Firefox/GM)
            try {
                const head = document.head || document.getElementsByTagName('head')[0];
                if (!head) {
                    document.addEventListener('DOMContentLoaded', SCRIPT_SIGNATURE.verify, { once: true });
                    return false;
                }
                if (!document.querySelector('meta[name="optimizer-author"]')) {
                    const m = document.createElement('meta');
                    m.name = 'optimizer-author';
                    m.content = 'Derfog';
                    head.appendChild(m);
                }
                return true;
            } catch (e) {
                return false;
            }
        }
    };
    SCRIPT_SIGNATURE.verify();

    // BASE CONFIGURATION (High-End defaults)

    const CONFIG = {
        // isAuto=true uses the native screen resolution
        resolution: {
            width: 3840,
            height: 2160,
            pixelRatio: 2,
            isAuto: true
        },

        codecs: {
            forceHEVC: true,
        },

        streaming: {
            maxBitrate: 100000000,
        },

        performance: {
            lowLatencyMode: true,
            jitterBufferMax: 80,
            playoutDelayHintMs: 30, // Receive buffer target (ms): mouse latency vs stutter. Competitive: 20, comfort: 50
        },

        enhancer: {
            enabled: true,
            sharpness: 0.45,
            contrast: 1.08,
            saturation: 1.05,
            brightness: 1.02
        },

        filters: {
            enabled: false, // Off by default: the user opts in
            preset: null,
            performanceMode: true, // Lighter shader path (fast denoise, no clarity pass)
            usm: { enabled: false, amount: 0.35, radius: 0.9, threshold: 0.04 },
            cas: { enabled: false, sharpness: 0.45 },
            clarity: { enabled: false, amount: 0.2 },
            denoise: { enabled: false, strength: 0.2 },
            vibrance: { enabled: false, amount: 0.2 },
            gamma: { enabled: false, value: 1.0 },
            exposure: { enabled: false, value: 0 },
            deband: { enabled: false, strength: 0.3 }
        },

        drm: {
            forceDolbyVision: false,
            forceHDCP: false,
            forceUHD: true,
            forceALL: false
        },

        display: {
            stretchMode: false,         // Stretch the video to remove black bars
        },

        language: 'auto'
    };

    // Real screen values, captured before any resolution hook
    const _realDprDescriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    const _realScreen = {
        width: window.screen?.width || 1920,
        height: window.screen?.height || 1080,
        availWidth: window.screen?.availWidth || 1920,
        availHeight: window.screen?.availHeight || 1080,
        pixelRatio: window.devicePixelRatio || 1
    };

    // SDR STREAM — the page is told the display is SDR, on every screen.
    // WebGPU converts PQ / BT.2020 frames without Chrome's HDR tone mapping: measured
    // against the native video path, a saturated red comes out at 234 instead of 164.
    // SDR frames match the native path exactly, so an SDR stream is the only one this
    // pipeline reproduces faithfully.
    (function requestSdrStream() {
        const originalMatchMedia = window.matchMedia;
        window.matchMedia = function (query) {
            if (typeof query === 'string') {
                const clean = query.replace(/\s+/g, '').toLowerCase();
                if (clean.includes('dynamic-range:high') || clean.includes('color-gamut:p3') || clean.includes('color-gamut:rec2020')) {
                    return {
                        matches: false,
                        media: query,
                        onchange: null,
                        addListener: () => {},
                        removeListener: () => {},
                        addEventListener: () => {},
                        removeEventListener: () => {},
                        dispatchEvent: () => false
                    };
                }
            }
            return originalMatchMedia.call(this, query);
        };
    })();

    // Defaults used by the Reset button
    const DEFAULT_CONFIG = {
        resolution: { width: 3840, height: 2160, pixelRatio: 2, isAuto: true },
        enhancer: { enabled: true, sharpness: 0.45, contrast: 1.08, saturation: 1.05, brightness: 1.02 },
        filters: {
            enabled: true, preset: 'default',
            usm: { enabled: true, amount: 0.3, radius: 0.9, threshold: 0.04 },
            cas: { enabled: true, sharpness: 0.6 },
            clarity: { enabled: false, amount: 0.3 },
            denoise: { enabled: false, strength: 0.15 },
            vibrance: { enabled: false, amount: 0.15 },
            gamma: { enabled: false, value: 1.0 },
            exposure: { enabled: false, value: 0 },
            deband: { enabled: false, strength: 0.3 }
        },
        language: 'auto'
    };

    // ADAPTIVE CONFIG BUILDER

    function buildAdaptiveConfig(baseConfig, envProfile) {
        const cfg = JSON.parse(JSON.stringify(baseConfig));

        // Tier 1 : Low-End / Slow Network
        // Network API false positives must not downgrade high-end desktops
        if (envProfile.isLowEnd || (envProfile.isSlowNetwork && !envProfile.isHighEnd)) {
            console.log('[Optimizer+] Adapting to Low-End/Slow profile');
            cfg.resolution = { width: 1920, height: 1080, pixelRatio: 1, isAuto: true };
            cfg.streaming = {
                maxBitrate: 100000000,
            };
            cfg.filters.usm.amount = 0.25;
            cfg.filters.cas.sharpness = 0.35;
            cfg.filters.clarity.enabled = false;
            cfg.filters.denoise.enabled = false;
            cfg.filters.vibrance.enabled = false;
            cfg.filters.deband.enabled = false;
        }
        // Tier 2 : Mid-Range
        else if (envProfile.isMidRange) {
            console.log('[Optimizer+] Adapting to Mid-Range profile');
            cfg.resolution = { width: 2560, height: 1440, pixelRatio: 1, isAuto: false };
            cfg.streaming = {
                maxBitrate: 100000000,
            };
            cfg.filters.usm.amount = 0.35;
            cfg.filters.cas.sharpness = 0.45;
            cfg.filters.clarity.enabled = true;
            cfg.filters.deband.enabled = true;
        }
        // Tier 3 : High-End = default config

        // Device-specific overrides
        if (envProfile.isSmallScreen) {
            cfg.resolution.width = Math.min(cfg.resolution.width, 1920);
            cfg.resolution.height = Math.min(cfg.resolution.height, 1080);
        }

        if (envProfile.saveData) {
            cfg.filters.enabled = false;
        }

        return cfg;
    }

    const EFFECTIVE_CONFIG = buildAdaptiveConfig(CONFIG, ENV_PROFILE);
    Object.assign(CONFIG, EFFECTIVE_CONFIG);
    console.log('[Optimizer+] Adaptive config applied:',
        `${CONFIG.resolution.width}x${CONFIG.resolution.height}`,
        `@ ${Math.round(CONFIG.streaming.maxBitrate / 1000000)}Mbps`
    );

    // STREAM INTERCEPTOR - Force HW decode on the session config (Better xCloud pattern)

    const StreamInterceptor = {
        originalFetch: null,
        enabled: false,

        enable() {
            if (this.enabled) return;
            this.enabled = true;

            this.originalFetch = window.fetch;
            const self = this;
            window.fetch = async function (...args) {
                const request = args[0];
                const url = typeof request === 'string' ? request : request?.url;

                // Only intercept Boosteroid API config endpoints, never /streaming (the page URL itself)
                // Restricted to boosteroid.com hosts: third-party URLs containing /configuration are left alone
                let isBoosteroidApi = false;
                if (url && (url.includes('/configuration') || url.includes('/session/config'))) {
                    try {
                        const h = new URL(url, location.href).hostname;
                        isBoosteroidApi = h === 'boosteroid.com' || h.endsWith('.boosteroid.com');
                    } catch (e) {}
                }
                if (isBoosteroidApi) {
                    try {
                        const response = await self.originalFetch.apply(window, args);

                        if (response.ok) {
                            const clonedResponse = response.clone();
                            try {
                                const config = await clonedResponse.json();

                                if (config && typeof config === 'object') {
                                    if (!config.clientStreamingConfigOverrides) {
                                        config.clientStreamingConfigOverrides = '{}';
                                    }

                                    let overrides = {};
                                    try {
                                        overrides = JSON.parse(config.clientStreamingConfigOverrides);
                                    } catch (e) {
                                        overrides = {};
                                    }

                                    // Hardware decoding hints
                                    overrides.videoConfiguration = overrides.videoConfiguration || {};
                                    overrides.videoConfiguration.enableHardwareDecoding = true;
                                    overrides.videoConfiguration.hardwareDecoderProfile = 'high';
                                    overrides.videoConfiguration.enableRtcStatsCollection = true;

                                    config.clientStreamingConfigOverrides = JSON.stringify(overrides);

                                    // Rebuild the Response with correct headers
                                    const newBody = JSON.stringify(config);
                                    const newHeaders = new Headers(response.headers);
                                    newHeaders.set('Content-Length', new Blob([newBody]).size.toString());
                                    newHeaders.set('Content-Type', 'application/json');

                                    console.log('[Optimizer+] [OK] StreamInterceptor: config enriched (HW decode)');

                                    return new Response(newBody, {
                                        status: response.status,
                                        statusText: response.statusText,
                                        headers: newHeaders
                                    });
                                }
                            } catch (parseError) {
                                // Not JSON — return original response untouched
                            }
                        }
                        return response;
                    } catch (e) {
                        console.warn('[Optimizer+] StreamInterceptor fetch error:', e);
                        return self.originalFetch.apply(window, args);
                    }
                }

                return self.originalFetch.apply(window, args);
            };

            console.log('[Optimizer+] [OK] StreamInterceptor enabled (HW decode + GPU accel)');
        },

        disable() {
            if (!this.enabled) return;
            this.enabled = false;
            if (this.originalFetch) {
                window.fetch = this.originalFetch;
                this.originalFetch = null;
            }
            console.log('[Optimizer+] StreamInterceptor disabled');
        }
    };

    // Security helpers (XSS + prototype pollution hardening)
    const BLOCKED_MERGE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

    function isPlainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => {
            switch (char) {
                case '&': return '&amp;';
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                case '\'': return '&#39;';
                default: return char;
            }
        });
    }

    // SMART RESOLUTION DETECTOR - Screen detection and matching resolutions

    const SmartResolutionDetector = {
        _cache: null,
        _cacheTime: 0,
        CACHE_TTL: 5000,

        getScreenDimensions() {
            // _realScreen is captured at startup, before any hook
            const windowW = window.innerWidth;
            const windowH = window.innerHeight;

            let width = _realScreen.width;
            let height = _realScreen.height;

            // Window larger than the screen: probably on an external display
            if (windowW > _realScreen.width * 1.1 || windowH > _realScreen.height * 1.1) {
                console.log('[Optimizer+] Heuristique: fenêtre sur écran externe détectée');
                width = windowW;
                height = windowH;
            }

            return {
                width: width,
                height: height,
                availWidth: _realScreen.availWidth,
                availHeight: _realScreen.availHeight,
                devicePixelRatio: _realScreen.pixelRatio,
                isMultiMonitor: false,
                screenLabel: 'Default'
            };
        },

        detectAspectRatio() {
            const screen = this.getScreenDimensions();
            const ratio = screen.width / screen.height;

            let ratioType, ratioName;

            if (ratio >= 3.45) {
                ratioType = '32:9';
                ratioName = 'Super Ultrawide';
            }
            else if (ratio >= 2.25 && ratio < 2.5) {
                ratioType = '21:9';
                ratioName = 'Ultrawide';
            }
            else if (ratio >= 2.1 && ratio < 2.25) {
                ratioType = '19.5:9';
                ratioName = 'Mobile Tall';
            }
            else if (ratio >= 1.95 && ratio < 2.1) {
                ratioType = '18:9';
                ratioName = 'Mobile Wide';
            }
            else if (ratio >= 1.74 && ratio < 1.82) {
                ratioType = '16:9';
                ratioName = 'Standard';
            }
            else if (ratio >= 1.55 && ratio < 1.65) {
                ratioType = '16:10';
                ratioName = 'Widescreen';
            }
            else if (ratio >= 1.45 && ratio < 1.55) {
                ratioType = '3:2';
                ratioName = 'Classic';
            }
            else if (ratio >= 1.28 && ratio < 1.38) {
                ratioType = '4:3';
                ratioName = 'Legacy';
            }
            else {
                ratioType = 'custom';
                if (ratio > 2.5) ratioName = 'Super Wide Custom';
                else if (ratio > 1.82) ratioName = 'Wide Custom';
                else if (ratio < 1.28) ratioName = 'Tall Custom';
                else ratioName = 'Custom';
            }

            return {
                ratio: ratio,
                ratioExact: ratio.toFixed(4),
                ratioType,
                ratioName,
                width: screen.width,
                height: screen.height,
                isUltrawide: ratio >= 2.0,
            };
        },

        GAMING_RESOLUTIONS: {
            // 4:3
            '4:3': [
                { w: 800, h: 600 },
                { w: 1024, h: 768 },
                { w: 1152, h: 864 },
                { w: 1280, h: 960 },
                { w: 1400, h: 1050 },
                { w: 1440, h: 1152 },
                { w: 1600, h: 1200 },
                { w: 1800, h: 1350 },
                { w: 1920, h: 1536 },
                { w: 2048, h: 1536 }
            ],
            // 5:4
            '5:4': [
                { w: 1280, h: 1024 },
                { w: 1600, h: 1024 },
                { w: 2560, h: 2048 }
            ],
            // 16:9 Standard
            '16:9': [
                { w: 1280, h: 720 },
                { w: 1360, h: 768 },
                { w: 1366, h: 768 },
                { w: 1600, h: 900 },
                { w: 1920, h: 1080 },
                { w: 2048, h: 1152 },
                { w: 2560, h: 1440 },
                { w: 3200, h: 1440 },
                { w: 3200, h: 1800 },
                { w: 3840, h: 2160 }
            ],
            // 16:10 Widescreen
            '16:10': [
                { w: 1280, h: 800 },
                { w: 1440, h: 900 },
                { w: 1680, h: 1050 },
                { w: 1920, h: 1200 },
                { w: 2048, h: 1152 },
                { w: 2048, h: 1330 },
                { w: 2160, h: 1350 },
                { w: 2560, h: 1600 },
                { w: 2732, h: 2048 },
                { w: 2940, h: 1912 },
                { w: 3320, h: 2160 },
                { w: 3360, h: 2100 }
            ],
            // 21:9 Ultrawide
            '21:9': [
                { w: 1600, h: 720 },
                { w: 1920, h: 864 },
                { w: 2400, h: 1080 },
                { w: 2560, h: 1080 },
                { w: 3440, h: 1440 }
            ],
            // 2.37:1
            '2.37:1': [
                { w: 1920, h: 810 }
            ],
            // 32:9 Super Ultrawide
            '32:9': [
                { w: 3840, h: 1080 }
            ]
        },

        getClosestRatioGroup(screenRatio) {
            const ratioGroups = {
                '4:3': 1.333,
                '5:4': 1.25,
                '16:9': 1.778,
                '16:10': 1.6,
                '21:9': 2.37,
                '2.37:1': 2.37,
                '32:9': 3.556
            };

            let closest = '16:9';
            let minDiff = Infinity;

            for (const [name, refRatio] of Object.entries(ratioGroups)) {
                const diff = Math.abs(screenRatio - refRatio);
                if (diff < minDiff) {
                    minDiff = diff;
                    closest = name;
                }
            }

            return closest;
        },

        // Resolutions whitelisted by the Boosteroid server
        SUPPORTED_RESOLUTIONS: [
            // 4:3
            [800, 600], [1024, 768], [1152, 864], [1280, 960], [1400, 1050],
            [1440, 1152], [1600, 1200], [1800, 1350], [1920, 1536], [2048, 1536],
            // 5:4
            [1280, 1024], [1600, 1024], [2560, 2048],
            // 16:9
            [1280, 720], [1360, 768], [1366, 768], [1600, 900], [1920, 1080],
            [2048, 1152], [2560, 1440], [3200, 1440], [3200, 1800], [3840, 2160],
            // 16:10
            [1280, 800], [1440, 900], [1680, 1050], [1920, 1200], [2048, 1152],
            [2048, 1330], [2160, 1350], [2560, 1600], [2732, 2048], [2940, 1912],
            [3320, 2160], [3360, 2100],
            // 21:9
            [1600, 720], [1920, 864], [2400, 1080], [2560, 1080], [3440, 1440],
            // 2.37:1
            [1920, 810],
            // 32:9
            [3840, 1080]
        ],

        isResolutionSupported(width, height) {
            return this.SUPPORTED_RESOLUTIONS.some(([w, h]) => w === width && h === height);
        },

        findBestMatch(screenWidth, screenHeight) {
            const screenRatio = screenWidth / screenHeight;
            const screenPixels = screenWidth * screenHeight;
            let bestMatch = null;
            let bestScore = Infinity;

            for (const [w, h] of this.SUPPORTED_RESOLUTIONS) {
                const resRatio = w / h;
                const resPixels = w * h;
                // Score = ratio gap (weighted x10) + normalised pixel gap
                const ratioDiff = Math.abs(resRatio - screenRatio) * 10;
                const pixelDiff = Math.abs(resPixels - screenPixels) / screenPixels;
                const score = ratioDiff + pixelDiff;

                // Prefer resolutions >= native (upscale)
                const isUpscale = resPixels >= screenPixels * 0.95;
                const adjustedScore = isUpscale ? score : score + 5; // Penalise downscaling

                if (adjustedScore < bestScore) {
                    bestScore = adjustedScore;
                    bestMatch = { w, h, score: adjustedScore, ratioDiff, isUpscale };
                }
            }
            return bestMatch;
        },

        getSelectableResolutions(screenWidth, screenHeight) {
            const screenRatio = screenWidth / screenHeight;
            const ratioGroup = this.getClosestRatioGroup(screenRatio);
            const screenPixels = screenWidth * screenHeight;

            const resolutions = [];
            const seen = new Set();

            resolutions.push({
                w: screenWidth,
                h: screenHeight,
                label: 'Native',
                tier: 'native',
                isNative: true,
                ratioGroup: ratioGroup
            });
            seen.add(`${screenWidth}x${screenHeight}`);

            const scored = [];
            for (const [w, h] of this.SUPPORTED_RESOLUTIONS) {
                const key = `${w}x${h}`;
                if (seen.has(key)) continue;
                // Skip resolutions within 8 px of native (codec rounding)
                if (Math.abs(w - screenWidth) <= 8 && Math.abs(h - screenHeight) <= 8) continue;

                const resRatio = w / h;
                const ratioDiff = Math.abs(resRatio - screenRatio);
                const resPixels = w * h;
                const isUpscale = resPixels >= screenPixels * 0.95;

                scored.push({ w, h, ratioDiff, isUpscale, pixels: resPixels });
                seen.add(key);
            }

            scored.sort((a, b) => {
                const aClose = a.ratioDiff < 0.15 ? 0 : 1;
                const bClose = b.ratioDiff < 0.15 ? 0 : 1;
                if (aClose !== bClose) return aClose - bClose;
                return a.pixels - b.pixels;
            });

            scored.forEach(res => {
                resolutions.push({
                    w: res.w,
                    h: res.h,
                    tier: res.w >= 3840 ? 'ultra' : (res.w >= 2560 ? 'mid' : 'low'),
                    isNative: false,
                    ratioGroup: this.getClosestRatioGroup(res.w / res.h),
                    isSupported: true,
                    ratioDiff: res.ratioDiff
                });
            });

            // Recommended = smallest upscale with a near-identical ratio (< 5% gap)
            const recommended = resolutions.find(r =>
                !r.isNative &&
                (r.w * r.h) >= screenPixels * 0.95 &&
                r.ratioDiff !== undefined && r.ratioDiff < 0.05
            ) || resolutions.find(r =>
                !r.isNative &&
                (r.w * r.h) >= screenPixels * 0.95
            );

            if (recommended) {
                recommended.isRecommended = true;
            } else if (resolutions.length > 0) {
                resolutions[0].isRecommended = true;
            }

            return resolutions;
        },

        generateUpscaleResolutions(screenInfo) {
            const { width, height } = screenInfo;
            return this.getSelectableResolutions(width, height);
        },

        getScreenAnalysis() {
            const now = Date.now();
            if (this._cache && (now - this._cacheTime) < this.CACHE_TTL) {
                return this._cache;
            }

            const screenInfo = this.detectAspectRatio();
            const upscaleOptions = this.generateUpscaleResolutions(screenInfo);

            let recommended = upscaleOptions.find(r => r.isRecommended);
            if (!recommended) {
                recommended = upscaleOptions.find(r => r.isNative) || upscaleOptions[0];
            }

            const result = {
                screen: screenInfo,
                resolutions: upscaleOptions,
                recommended: recommended,
                native: upscaleOptions.find(r => r.isNative),
                summary: `${screenInfo.width}x${screenInfo.height} (${screenInfo.ratioType} - ratio ${screenInfo.ratioExact})`
            };

            this._cache = result;
            this._cacheTime = now;

            return result;
        },

        generateResolutionOptionsHTML(currentWidth, currentHeight, isAutoMode = false) {
            const analysis = this.getScreenAnalysis();
            const { screen } = analysis;
            const detectedRatio = this.getClosestRatioGroup(screen.ratio);

            let html = '';

            const nativeRes = analysis.native || { w: screen.width, h: screen.height, label: 'Native' };
            const isAutoSelected = isAutoMode || !currentWidth || currentWidth === 'auto';
            html += `<optgroup label="[AUTO]">`;
            html += `<option value="auto" ${isAutoSelected ? 'selected' : ''}>`;
            html += `Auto -> ${escapeHtml(nativeRes.w)}x${escapeHtml(nativeRes.h)} (Native)`;
            html += `</option>`;
            html += `</optgroup>`;

            html += `<optgroup label="Native (${escapeHtml(screen.width)}x${escapeHtml(screen.height)})">`;
            const isNativeSelected = !isAutoSelected && currentWidth === screen.width && currentHeight === screen.height;
            html += `<option value="${escapeHtml(`${screen.width}x${screen.height}`)}" ${isNativeSelected ? 'selected' : ''}>`;
            html += `${escapeHtml(screen.width)}x${escapeHtml(screen.height)} (Native)`;
            html += `</option>`;
            html += `</optgroup>`;

            const ratioLabels = {
                '4:3': '4:3',
                '5:4': '5:4',
                '16:9': '16:9',
                '16:10': '16:10',
                '21:9': '21:9 Ultrawide',
                '2.37:1': '2.37:1 Cinematic',
                '32:9': '32:9 Super Ultrawide'
            };

            for (const [ratio, label] of Object.entries(ratioLabels)) {
                const gamingRes = this.GAMING_RESOLUTIONS[ratio];
                if (!gamingRes) continue;

                const isDetected = ratio === detectedRatio ? ' [OK]' : '';
                html += `<optgroup label="${escapeHtml(`${label}${isDetected}`)}">`;

                gamingRes.forEach(res => {
                    const isSelected = !isAutoSelected && currentWidth === res.w && currentHeight === res.h;
                    const optionValue = `${res.w}x${res.h}`;
                    let optionLabel = optionValue;

                    if (res.w === 3840 && res.h === 2160) optionLabel += ' (4K)';
                    if (res.w === 2560 && res.h === 1440) optionLabel += ' (1440p)';
                    if (res.w === 1920 && res.h === 1080) optionLabel += ' (1080p)';

                    html += `<option value="${escapeHtml(optionValue)}" ${isSelected ? 'selected' : ''}>${escapeHtml(optionLabel)}</option>`;
                });

                html += `</optgroup>`;
            }

            return html;
        },

        setResolutionSafely(newWidth, newHeight, label = '') {

            const isSupported = this.isResolutionSupported(newWidth, newHeight);

            if (!isSupported) {
                console.warn(`[Optimizer+] [!] R\u00E9solution ${newWidth}x${newHeight} non dans la whitelist serveur`);
                // Applied anyway; the stream check below reverts it if the server refuses
            }

            CONFIG.resolution.width = newWidth;
            CONFIG.resolution.height = newHeight;
            CONFIG.resolution.pixelRatio = newWidth >= 3840 ? 2 : (newWidth >= 2560 ? 1.5 : 1);

            console.log(`[Optimizer+] R\u00E9solution demand\u00E9e: ${newWidth}x${newHeight} ${label ? `(${label})` : ''}`);

            // Validate against the real stream once it has settled
            setTimeout(() => {
                const video = document.querySelector('video');
                if (video && video.videoWidth && video.videoHeight) {
                    const actualWidth = video.videoWidth;
                    const actualHeight = video.videoHeight;
                    const tolerance = 0.9;

                    if (actualWidth < newWidth * tolerance || actualHeight < newHeight * tolerance) {
                        console.warn(`[Optimizer+] [!] R\u00E9solution ${newWidth}x${newHeight} refus\u00E9e par Boosteroid`);
                        console.warn(`[Optimizer+] Fallback r\u00E9el: ${actualWidth}x${actualHeight}`);

                        CONFIG.resolution.width = actualWidth;
                        CONFIG.resolution.height = actualHeight;

                        if (typeof showNotification === 'function') {
                            showNotification(`[!] R\u00E9solution refus\u00E9e -> ${actualWidth}x${actualHeight}`);
                        }
                    } else {
                        console.log(`[Optimizer+] [OK] R\u00E9solution ${newWidth}x${newHeight} confirm\u00E9e par le stream`);
                    }
                }
            }, 2500);

            return {
                requested: { width: newWidth, height: newHeight },
                isSupported: isSupported,
                label: label
            };
        },

        applyAutoResolution() {
            const screen = this.getScreenDimensions();
            const screenW = screen.width;
            const screenH = screen.height;

            const bestMatch = this.findBestMatch(screenW, screenH);

            if (bestMatch) {
                const label = `Auto (${bestMatch.w}x${bestMatch.h})`;
                this.setResolutionSafely(bestMatch.w, bestMatch.h, label);
                console.log(`[Optimizer+] Auto-r\u00E9solution: \u00E9cran ${screenW}x${screenH} \u2192 Boosteroid ${bestMatch.w}x${bestMatch.h} (ratio diff: ${bestMatch.ratioDiff.toFixed(4)})`);
                return { w: bestMatch.w, h: bestMatch.h, label: label };
            }

            this.setResolutionSafely(screenW, screenH, 'Native (fallback)');
            console.log(`[Optimizer+] Auto-r\u00E9solution (native fallback): ${screenW}x${screenH}`);
            return { w: screenW, h: screenH, label: 'Native' };
        },
    };

    console.log('[Optimizer+] Smart Resolution Detector:', SmartResolutionDetector.getScreenAnalysis().summary);

    // SMART CODEC SELECTOR - Pick the best hardware-decoded codec

    // Captured before any hook: the real answer, for the WebRTC pipeline
    const realDecodingInfo = navigator.mediaCapabilities?.decodingInfo?.bind(navigator.mediaCapabilities);

    const SmartCodecSelector = {
        hardware: null,

        // Hardware decode at the target resolution and 120 FPS, per codec. 'smooth' also
        // carries Chrome's own history of dropped frames for that codec and resolution.
        async probe() {
            if (this.hardware || !realDecodingInfo) return;
            const hardware = {};
            const video = { width: CONFIG.resolution.width, height: CONFIG.resolution.height, bitrate: 30000000, framerate: 120 };
            for (const mime of ['video/AV1', 'video/H265', 'video/H264']) {
                try {
                    const r = await realDecodingInfo({ type: 'webrtc', video: { ...video, contentType: mime } });
                    hardware[mime] = !!(r.supported && r.powerEfficient && r.smooth);
                } catch (e) {
                    hardware[mime] = false;
                }
            }
            this.hardware = hardware;
        },

        describe() {
            if (!this.hardware) return 'hw decode ?';
            const flags = Object.entries(this.hardware).map(([mime, ok]) => `${mime.slice(6)} ${ok ? 'yes' : 'NO'}`).join(', ');
            return `hw decode ${CONFIG.resolution.width}x${CONFIG.resolution.height}@120: ${flags}`;
        }
    };

    // STREAMING STATE & LAZY HOOKS

    const StreamingEnhancements = {
        active: false,
        cleanupHandlers: [],

        enable() {
            if (this.active) return;
            this.active = true;
            console.log('[Optimizer+] Enabling streaming enhancements...');

            try {
                StreamInterceptor.enable();
                this.cleanupHandlers.push(() => StreamInterceptor.disable());

                StreamMonitor.enable();
                this.cleanupHandlers.push(() => StreamMonitor.disable());

                this.initSessionCloseDetection();

                console.log('[Optimizer+] [OK] Streaming enhancements active');
            } catch (e) {
                console.error('[Optimizer+] Error enabling enhancements:', e);
                this.disable();
            }
        },

        disable() {
            if (!this.active) return;
            this.active = false;
            console.log('[Optimizer+] Disabling enhancements...');

            this.cleanupHandlers.forEach((fn, idx) => {
                try { fn(); } catch (e) { console.warn(`[Optimizer+] Cleanup ${idx} failed:`, e); }
            });
            this.cleanupHandlers = [];

            console.log('[Optimizer+] [OK] Cleanup complete');
        },

        initSessionCloseDetection() {
            const handleUrlChange = () => {
                if (!isStreamingPage()) {
                    console.log('[Optimizer+] Session ended (URL change)');
                    this.disable();
                    SessionState.isUIInjected = false;
                }
            };

            window.addEventListener('popstate', handleUrlChange);
            this.cleanupHandlers.push(() => window.removeEventListener('popstate', handleUrlChange));

            // pushState override for SPA navigation
            const originalPushState = window.history.pushState;
            window.history.pushState = function (...args) {
                originalPushState.apply(this, args);
                handleUrlChange();
            };
            this.cleanupHandlers.push(() => {
                window.history.pushState = originalPushState;
            });
        }
    };

    // INTERNATIONALISATION (i18n)

    const I18N = {
        languages: {
            en: 'English',
            fr: 'Fran\u00E7ais',
            de: 'Deutsch',
            es: 'Espa\u00F1ol',
            it: 'Italiano',
            pt: 'Portugu\u00EAs',
            ru: '\u0420\u0443\u0441\u0441\u043A\u0438\u0439',
            pl: 'Polski',
            uk: 'Українська',
            tr: 'Türkçe',
            cs: 'Čeština',
            hu: 'Magyar',
            ro: 'Română',
            sk: 'Slovenčina',
            sv: 'Svenska'
        },

        translations: {
            en: {
                title: 'Optimizer Plus',
                status: 'Status',
                active: 'Active',
                inactive: 'Inactive',
                resolution: 'Resolution',
                forcedResolution: 'Forced Resolution',
                targetResolution: 'Target Resolution',
                videoEnhancement: 'Video Enhancement',
                enableEnhancer: 'Enable Enhancer',
                sharpness: 'Sharpness',
                contrast: 'Contrast',
                saturation: 'Saturation',
                advancedFilters: 'Advanced Video Filters',
                quickPresets: 'Quick Presets',
                enableAdvanced: 'Enable Advanced Filters',
                performanceMode: 'Performance Mode',
                performanceModeDesc: 'Lighter GPU filters for maximum FPS (fast denoise, skip clarity on GPU) — quality settings stay intact',
                options: 'Options',
                perfModeNotifOn: 'Performance Mode: maximum FPS',
                perfModeNotifOff: 'Performance Mode off (max quality)',
                upscaleOffNotif: 'Upscaling turned off: GPU overloaded',
                decoderOverloadNotif: 'Video decoder overloaded: lower the resolution or the FPS',
                resAppliedNotif: 'Stream is now {res}',
                resReloadNotif: 'Stream still {res}: reload the page to apply',
                presetDefault: 'Default',
                presetCinematic: 'Cinematic',
                presetGame: 'Competitive',
                presetComfort: 'Comfort',
                presetPerfect: 'Perfect Quality',
                presetCustom: 'Custom',
                noiseReduction: 'Noise Reduction',
                vibrance: 'Vibrance',
                clarity: 'Clarity',
                apply: 'Apply',
                reset: 'Reset',
                settingsSaved: '[OK] Settings saved!',
                settingsReset: '[<<] Settings reset to defaults.',
                presetApplied: '[*] Preset "{name}" applied!',
                language: 'Language',
                autoDetect: 'Auto-detect',
                deviceProfile: 'Device',
                filterTier: 'Quality Tier',
                adaptiveMode: 'Adaptive Mode',
                streamInterceptor: 'Stream Interceptor (HW Decode)',
                bitrateEnforcer: 'Aggressive Bitrate Forcer (V4)',
                ultrawideMode: 'Ultrawide Mode (21:9, 32:9)',
                ultrawideAutoDetect: 'Auto-detect 21:9+',
                performanceMode: 'Performance Mode',
                performanceModeHint: 'Disables heavy filters to maximize FPS',
                displaySettings: 'Display & Ultrawide',
                screenInfo: 'Screen Info',
                fitMode: 'Display Mode',
                hwProfile: 'Profile',
                stretchMode: 'Stretch to Fill (No Borders)'
            },
            fr: {
                title: 'Optimizer Plus',
                status: 'Status',
                active: 'Actif',
                inactive: 'Inactif',
                resolution: 'Résolution',
                forcedResolution: 'Résolution forcée',
                targetResolution: 'Résolution cible',
                videoEnhancement: 'Amélioration vidéo',
                enableEnhancer: 'Activer l\'enhancer',
                sharpness: 'Netteté',
                contrast: 'Contraste',
                saturation: 'Saturation',
                advancedFilters: 'Filtres Vidéo Avancés',
                quickPresets: 'Présets rapides',
                enableAdvanced: 'Activer filtres avancés',
                performanceMode: 'Mode Performance',
                performanceModeDesc: 'Filtres GPU plus légers pour FPS max (fast denoise, skip clarity GPU) — les réglages de qualité restent intacts',
                options: 'Options',
                perfModeNotifOn: 'Mode Performance: FPS maximisés',
                perfModeNotifOff: 'Mode Performance désactivé (qualité max)',
                upscaleOffNotif: 'Upscale désactivé : GPU surchargé',
                decoderOverloadNotif: 'Décodeur vidéo surchargé : baisse la résolution ou les FPS',
                resAppliedNotif: 'Flux maintenant en {res}',
                resReloadNotif: 'Flux toujours en {res} : recharge la page pour appliquer',
                presetDefault: 'Défaut',
                presetCinematic: 'Cinématique',
                presetGame: 'Compétitif',
                presetComfort: 'Confort',
                presetPerfect: 'Qualité Parfaite',
                presetCustom: 'Personnalisé',
                noiseReduction: 'Réduction de bruit',
                vibrance: 'Vibrance',
                clarity: 'Clarté',
                apply: 'Appliquer',
                reset: 'Reset',
                settingsSaved: '[OK] Paramètres sauvegardés!',
                settingsReset: '[<<] Paramètres réinitialisés.',
                presetApplied: '[*] Préset "{name}" appliqué!',
                language: 'Langue',
                autoDetect: 'Auto-détection',
                streamInterceptor: 'Interception Stream (Déco. HW)',
                bitrateEnforcer: 'Forçage Bitrate Agressif (V4)',
                ultrawideMode: 'Mode Ultrawide (21:9, 32:9)',
                ultrawideAutoDetect: 'Auto-détection 21:9+',
                performanceMode: 'Mode Performance',
                performanceModeHint: 'Désactive les filtres lourds pour maximiser les FPS',
                displaySettings: 'Affichage & Ultrawide',
                screenInfo: 'Info écran',
                fitMode: 'Mode d\'affichage',
                hwProfile: 'Profil',
                stretchMode: 'Étirement Complet (Sans Bordures)'
            },
            de: {
                title: 'Optimizer Plus',
                status: 'Status',
                active: 'Aktiv',
                inactive: 'Inaktiv',
                resolution: 'Auflösung',
                forcedResolution: 'Erzwungene Auflösung',
                targetResolution: 'Zielauflösung',
                videoEnhancement: 'Videoverbesserung',
                enableEnhancer: 'Enhancer aktivieren',
                sharpness: 'Schärfe',
                contrast: 'Kontrast',
                saturation: 'Sättigung',
                advancedFilters: 'Erweiterte Videofilter',
                quickPresets: 'Schnellvorlagen',
                enableAdvanced: 'Erweiterte Filter aktivieren',
                presetDefault: 'Standard',
                presetCinematic: 'Filmisch',
                presetGame: 'Kompetitiv',
                presetComfort: 'Komfort',
                presetPerfect: 'Perfekte Qualität',
                presetCustom: 'Benutzerdefiniert',
                noiseReduction: 'Rauschunterdrückung',
                vibrance: 'Lebendigkeit',
                clarity: 'Klarheit',
                apply: 'Anwenden',
                reset: 'Zurücksetzen',
                settingsSaved: '[OK] Einstellungen gespeichert!',
                settingsReset: '[<<] Einstellungen zurückgesetzt.',
                presetApplied: '[*] Vorlage "{name}" angewendet!',
                language: 'Sprache',
                autoDetect: 'Automatisch',
                streamInterceptor: 'Stream-Abfangjäger (HW-Dekodierung)',
                bitrateEnforcer: 'Aggressiver Bitraten-Erzwinger (V4)',
                ultrawideMode: 'Ultrawide-Modus (21:9, 32:9)',
                ultrawideAutoDetect: 'Auto-Erkennung 21:9+',
                performanceMode: 'Leistungsmodus',
                performanceModeHint: 'Deaktiviert schwere Filter für maximale FPS',
                displaySettings: 'Anzeige & Ultrawide',
                screenInfo: 'Bildschirminfo',
                fitMode: 'Anzeigemodus',
                hwProfile: 'Profil',
                stretchMode: 'Strecken (Keine Ränder)'
            },
            es: {
                title: 'Optimizer Plus',
                status: 'Estado',
                active: 'Activo',
                inactive: 'Inactivo',
                resolution: 'Resolución',
                forcedResolution: 'Resolución forzada',
                targetResolution: 'Resolución objetivo',
                videoEnhancement: 'Mejora de video',
                enableEnhancer: 'Activar mejora',
                sharpness: 'Nitidez',
                contrast: 'Contraste',
                saturation: 'Saturación',
                advancedFilters: 'Filtros de Video Avanzados',
                quickPresets: 'Presets rápidos',
                enableAdvanced: 'Activar filtros avanzados',
                presetDefault: 'Predeterminado',
                presetCinematic: 'Cinematográfico',
                presetGame: 'Competitivo',
                presetComfort: 'Confort',
                presetPerfect: 'Calidad Perfecta',
                presetCustom: 'Personalizado',
                noiseReduction: 'Reducción de ruido',
                vibrance: 'Vibración',
                clarity: 'Claridad',
                streamInterceptor: 'Interceptor Stream (Dec. HW)',
                apply: 'Aplicar',
                reset: 'Restablecer',
                settingsSaved: '[OK] ¡Configuración guardada!',
                settingsReset: '[<<] Configuración restablecida.',
                presetApplied: '[*] Preset "{name}" aplicado!',
                language: 'Idioma',
                autoDetect: 'Auto-detectar',
                ultrawideMode: 'Modo Ultrawide (21:9, 32:9)',
                performanceMode: 'Modo Rendimiento',
                performanceModeHint: 'Desactiva filtros pesados para maximizar FPS',
                displaySettings: 'Pantalla y Ultrawide',
                screenInfo: 'Información de pantalla',
                fitMode: 'Modo de visualización',
                hwProfile: 'Perfil',
                stretchMode: 'Estirar para llenar (Sin bordes)'
            },
            it: {
                title: 'Optimizer Plus',
                status: 'Stato',
                active: 'Attivo',
                inactive: 'Inattivo',
                resolution: 'Risoluzione',
                forcedResolution: 'Risoluzione forzata',
                targetResolution: 'Risoluzione target',
                videoEnhancement: 'Miglioramento video',
                enableEnhancer: 'Attiva miglioramento',
                sharpness: 'Nitidezza',
                contrast: 'Contrasto',
                saturation: 'Saturazione',
                advancedFilters: 'Filtri Video Avanzati',
                quickPresets: 'Preset rapidi',
                enableAdvanced: 'Attiva filtri avanzi',
                presetDefault: 'Predefinito',
                presetCinematic: 'Cinematico',
                presetGame: 'Competitivo',
                presetComfort: 'Comfort',
                presetPerfect: 'Qualità Perfetta',
                presetCustom: 'Personalizzato',
                noiseReduction: 'Riduzione rumore',
                vibrance: 'Vivacità',
                clarity: 'Chiarezza',
                streamInterceptor: 'Intercettore Stream (Dec. HW)',
                apply: 'Applica',
                reset: 'Ripristina',
                settingsSaved: '[OK] Impostazioni salvate!',
                settingsReset: '[<<] Impostazioni ripristinate.',
                presetApplied: '[*] Preset "{name}" applicato!',
                language: 'Lingua',
                autoDetect: 'Auto-rileva',
                ultrawideMode: 'Modalità Ultrawide (21:9, 32:9)',
                performanceMode: 'Modalità Prestazioni',
                performanceModeHint: 'Disattiva i filtri pesanti per massimizzare i FPS',
                displaySettings: 'Display & Ultrawide',
                screenInfo: 'Info schermo',
                fitMode: 'Modalità display',
                stretchMode: 'Allunga per riempire (Senza bordi)'
            },
            pt: {
                title: 'Optimizer Plus',
                status: 'Status',
                active: 'Ativo',
                inactive: 'Inativo',
                resolution: 'Resolução',
                forcedResolution: 'Resolução forçada',
                targetResolution: 'Resolução alvo',
                videoEnhancement: 'Melhoria de vídeo',
                enableEnhancer: 'Ativar melhoria',
                sharpness: 'Nitidez',
                contrast: 'Contraste',
                saturation: 'Saturação',
                advancedFilters: 'Filtros de Vídeo Avançados',
                quickPresets: 'Presets rápidos',
                enableAdvanced: 'Ativar - filtros avançados',
                presetDefault: 'Padrão',
                presetCinematic: 'Cinematográfico',
                presetGame: 'Competitivo',
                presetComfort: 'Conforto',
                presetPerfect: 'Qualidade Perfeita',
                presetCustom: 'Personalizado',
                noiseReduction: 'Redução de ruído',
                vibrance: 'Vibração',
                clarity: 'Clareza',
                streamInterceptor: 'Interceptor Stream (Dec. HW)',
                apply: 'Aplicar',
                reset: 'Redefinir',
                settingsSaved: '[OK] Configurações salvas!',
                settingsReset: '[<<] Configurações redefinidas.',
                presetApplied: '[*] Preset "{name}" aplicado!',
                language: 'Idioma',
                autoDetect: 'Auto-detectar',
                ultrawideMode: 'Modo Ultrawide (21:9, 32:9)',
                performanceMode: 'Modo de Desempenho',
                performanceModeHint: 'Desativa filtros pesados para maximizar FPS',
                displaySettings: 'Tela & Ultrawide',
                screenInfo: 'Info tela',
                fitMode: 'Modo de exibição',
                stretchMode: 'Esticar (Sem bordas)'
            },
            ru: {
                title: 'Optimizer Plus',
                status: 'Статус',
                active: 'Активен',
                inactive: 'Неактивен',
                resolution: 'Разрешение',
                forcedResolution: 'Принудительное разрешение',
                targetResolution: 'Целевое разрешение',
                videoEnhancement: 'Улучшение видео',
                enableEnhancer: 'Включить улучшение',
                sharpness: 'Резкость',
                contrast: 'Контраст',
                saturation: 'Насыщенность',
                advancedFilters: 'Расширенные видеофильтры',
                quickPresets: 'Быстрые пресеты',
                enableAdvanced: 'Включить расширенные фильтры',
                presetDefault: 'По умолчанию',
                presetCinematic: 'Кинематограф',
                presetGame: 'Соревновательный',
                presetComfort: 'Комфорт',
                presetPerfect: 'Идеальное качество',
                presetCustom: 'Пользовательский',
                noiseReduction: 'Шумоподавление',
                vibrance: 'Сочность',
                clarity: 'Четкость',
                streamInterceptor: 'Перехват потока (HW декод.)',
                apply: 'Применить',
                reset: 'Сброс',
                settingsSaved: '[OK] Настройки сохранены!',
                settingsReset: '[<<] Настройки сброшены.',
                presetApplied: '[*] Пресет "{name}" применен!',
                language: 'Язык',
                autoDetect: 'Авто-определение',
                ultrawideMode: 'Режим Ultrawide (21:9, 32:9)',
                performanceMode: 'Режим производительности',
                performanceModeHint: 'Отключает тяжелые фильтры для максимизации FPS',
                displaySettings: 'Экран & Ultrawide',
                screenInfo: 'Инфо экрана',
                fitMode: 'Режим отображения',
                hwProfile: 'Профиль',
                stretchMode: 'Растянуть на весь экран'
            },
            pl: {
                title: 'Optimizer Plus',
                status: 'Status',
                active: 'Aktywny',
                inactive: 'Nieaktywny',
                resolution: 'Rozdzielczość',
                forcedResolution: 'Wymuszona rozdzielczość',
                targetResolution: 'Docelowa rozdzielczość',
                videoEnhancement: 'Ulepszanie wideo',
                enableEnhancer: 'Włącz ulepszanie',
                sharpness: 'Ostrość',
                contrast: 'Kontrast',
                saturation: 'Nasycenie',
                advancedFilters: 'Zaawansowane filtry wideo',
                quickPresets: 'Szybkie presety',
                enableAdvanced: 'Włącz zaawansowane filtry',
                presetDefault: 'Domyślny',
                presetCinematic: 'Kinowy',
                presetGame: 'Rywalizacja',
                presetComfort: 'Komfort',
                presetPerfect: 'Perfekcyjna Jakość',
                presetCustom: 'Niestandardowy',
                noiseReduction: 'Redukcja szumu',
                vibrance: 'Żywość',
                clarity: 'Klarowność',
                streamInterceptor: 'Przechwyt Stream (Dek. HW)',
                apply: 'Zastosuj',
                reset: 'Resetuj',
                settingsSaved: '[OK] Ustawienia zapisane!',
                settingsReset: '[<<] Ustawienia zresetowane.',
                presetApplied: '[*] Preset "{name}" zastosowany!',
                language: 'Język',
                autoDetect: 'Auto-wykrywanie',
                ultrawideMode: 'Tryb Ultrawide (21:9, 32:9)',
                performanceMode: 'Tryb wydajności',
                performanceModeHint: 'Wyłącza ciężkie filtry, aby zmaksymalizować FPS',
                displaySettings: 'Ekran i Ultrawide',
                screenInfo: 'Informacje o ekranie',
                fitMode: 'Tryb wyświetlania',
                hwProfile: 'Profil',
                stretchMode: 'Rozciągnij (Bez ramek)'
            },
            uk: {
                title: 'Optimizer Plus',
                status: 'Статус',
                active: 'Активний',
                inactive: 'Неактивний',
                resolution: 'Роздільна здатність',
                forcedResolution: 'Примусова роздільна здатність',
                targetResolution: 'Цільова роздільна здатність',
                videoEnhancement: 'Покращення відео',
                enableEnhancer: 'Увімкнути покращення',
                sharpness: 'Різкість',
                contrast: 'Контраст',
                saturation: 'Насиченість',
                advancedFilters: 'Розширені відеофільтри',
                quickPresets: 'Швидкі пресети',
                enableAdvanced: 'Увімкнути розширені фільтри',
                presetDefault: 'За замовчуванням',
                presetCinematic: 'Кінематограф',
                presetGame: 'Змагальний',
                presetComfort: 'Комфорт',
                presetPerfect: 'Ідеальна якість',
                presetCustom: 'Користувацький',
                noiseReduction: 'Зменшення шуму',
                vibrance: 'Жвавість',
                clarity: 'Чіткість',
                streamInterceptor: 'Перехоплення потоку (апаратне декод.)',
                apply: 'Застосувати',
                reset: 'Скинути',
                settingsSaved: '[OK] Налаштування збережено!',
                settingsReset: '[<<] Налаштування скинуто.',
                presetApplied: '[*] Пресет "{name}" застосовано!',
                language: 'Мова',
                autoDetect: 'Авто-визначення',
                streamQuality: 'Якість стриму',
                bitrateEnforcer: 'Примусовий бітрейт (V4)',
                ultrawideMode: 'Режим Ultrawide (21:9, 32:9)',
                displaySettings: 'Екран та Ultrawide',
                screenInfo: 'Інформація про екран',
                fitMode: 'Режим лідображення',
                hwProfile: 'Профіль',
                stretchMode: 'Розтягнути (Без окраїв)',
                performanceMode: 'Режим продуктивності',
                performanceModeHint: 'Вимкнення  важких фільтрів для максимізації FPS'
            },
            tr: {
                title: 'Optimizer Plus',
                status: 'Durum',
                active: 'Aktif',
                inactive: 'Pasif',
                resolution: 'Çözünürlük',
                forcedResolution: 'Zorlanmış çözünürlük',
                targetResolution: 'Hedef çözünürlük',
                videoEnhancement: 'Video iyileştirme',
                enableEnhancer: 'İyileştiriciyi etkinleştir',
                sharpness: 'Keskinlik',
                contrast: 'Kontrast',
                saturation: 'Doygunluk',
                advancedFilters: 'Gelişmiş Video Filtreleri',
                quickPresets: 'Hızlı presetler',
                enableAdvanced: 'Gelişmiş filtreleri etkinleştir',
                presetDefault: 'Varsayılan',
                presetCinematic: 'Sinematik',
                presetGame: 'Rekabetçi',
                presetComfort: 'Konfor',
                presetPerfect: 'Mükemmel Kalite',
                presetCustom: 'Özel',
                noiseReduction: 'Gürültü azaltma',
                vibrance: 'Canlılık',
                clarity: 'Netlik',
                streamInterceptor: 'Akış Yakalayıcı (HW Çözücü)',
                apply: 'Uygula',
                reset: 'Sıfırla',
                settingsSaved: '[OK] Ayarlar kaydedildi!',
                settingsReset: '[<<] Ayarlar sıfırlandı.',
                presetApplied: '[*] Preset "{name}" uygulandı!',
                language: 'Dil',
                autoDetect: 'Otomatik algıla',
                performanceMode: 'Performans Modu',
                performanceModeHint: 'FPS\'yi en üst düzeye çıkarmak için ağır filtreleri devre dışı bırakır',
                stretchMode: 'Ekrana Sığdır (Kenarlıksız)'
            },
            cs: {
                title: 'Optimizer Plus',
                status: 'Stav',
                active: 'Aktivní',
                inactive: 'Neaktivní',
                resolution: 'Rozlišení',
                forcedResolution: 'Vynucené rozlišení',
                targetResolution: 'Cílové rozlišení',
                videoEnhancement: 'Vylepšení videa',
                enableEnhancer: 'Povolit vylepšení',
                sharpness: 'Ostrost',
                contrast: 'Kontrast',
                saturation: 'Sytost',
                advancedFilters: 'Pokročilé video filtry',
                quickPresets: 'Rychlé presety',
                enableAdvanced: 'Povolit pokročilé filtry',
                presetDefault: 'Výchozí',
                presetCinematic: 'Filmový',
                presetGame: 'Soutěžní',
                presetComfort: 'Komfort',
                presetPerfect: 'Dokonalá Kvalita',
                presetCustom: 'Vlastné',
                noiseReduction: 'Redukce šumu',
                vibrance: 'Živost',
                clarity: 'Čistota',
                streamInterceptor: 'Zachytávač Streamu (HW Dek.)',
                apply: 'Použít',
                reset: 'Obnovit',
                settingsSaved: '[OK] Nastavení uloženo! Obnovte stránku.',
                settingsReset: '[<<] Nastavení obnoveno. Obnovte stránku.',
                presetApplied: '[*] Preset "{name}" použit!',
                language: 'Jazyk',
                autoDetect: 'Automaticky',
                performanceMode: 'Režim výkonu',
                performanceModeHint: 'Deaktivuje těžké filtry pro maximalizaci FPS',
                stretchMode: 'Roztáhnout na celou obrazovku'
            },
            hu: {
                title: 'Optimizer Plus',
                status: 'Állapot',
                active: 'Aktív',
                inactive: 'Inaktív',
                resolution: 'Felbontás',
                forcedResolution: 'Kényszerített felbontás',
                targetResolution: 'Cél felbontás',
                videoEnhancement: 'Videó javítás',
                enableEnhancer: 'Javító engedélyezése',
                sharpness: 'Élesség',
                contrast: 'Kontraszt',
                saturation: 'Telítettség',
                advancedFilters: 'Haladó videó szűrők',
                quickPresets: 'Gyors presetek',
                enableAdvanced: 'Haladó szűrők engedélyezése',
                presetDefault: 'Alapértelmezett',
                presetCinematic: 'Filmes',
                presetGame: 'Verseny',
                presetComfort: 'Kényelem',
                presetPerfect: 'Tökéletes Minőség',
                presetCustom: 'Egyéni',
                noiseReduction: 'Zajcsökkentés',
                vibrance: 'Élénkség',
                clarity: 'Tisztaság',
                streamInterceptor: 'Folyam Elfogó (HW Dek.)',
                apply: 'Alkalmaz',
                reset: 'Visszaállítás',
                settingsSaved: '[OK] Beállítások mentve! Töltse újra az oldalt.',
                settingsReset: '[<<] Beállítások visszaállítva. Töltse újra az oldalt.',
                presetApplied: '[*] Preset "{name}" alkalmazva!',
                language: 'Nyelv',
                autoDetect: 'Automatikus',
                performanceMode: 'Teljesítmény mód',
                performanceModeHint: 'Kikapcsolja a nehéz szűrőket az FPS maximalizálása érdekében',
                stretchMode: 'Kitöltés a képernyőn (Keret nélkül)'
            },
            ro: {
                title: 'Optimizer Plus',
                status: 'Stare',
                active: 'Activ',
                inactive: 'Inactiv',
                resolution: 'Rezoluție',
                forcedResolution: 'Rezoluție forțată',
                targetResolution: 'Rezoluție țintă',
                videoEnhancement: 'Îmbunătățire video',
                enableEnhancer: 'Activare îmbunătățire',
                sharpness: 'Claritate',
                contrast: 'Contrast',
                saturation: 'Saturație',
                advancedFilters: 'Filtre Video Avansate',
                quickPresets: 'Preseturi rapide',
                enableAdvanced: 'Activare filtre avansate',
                presetDefault: 'Implicit',
                presetCinematic: 'Cinematic',
                presetGame: 'Competitiv',
                presetComfort: 'Confort',
                presetPerfect: 'Calitate Perfectă',
                presetCustom: 'Personalizat',
                noiseReduction: 'Reducere zgomot',
                vibrance: 'Vivacitate',
                clarity: 'Limpezime',
                streamInterceptor: 'Interceptor Stream (Dec. HW)',
                apply: 'Aplică',
                reset: 'Resetare',
                settingsSaved: '[OK] Setări salvate! Reîncarcați pagina.',
                settingsReset: '[<<] Setări resetate. Reîncarcați pagina.',
                presetApplied: '[*] Preset "{name}" aplicat!',
                language: 'Limbă',
                autoDetect: 'Auto-detectare',
                performanceMode: 'Mod Performanță',
                performanceModeHint: 'Dezactivează filtrele grele pentru a maximiza FPS',
                stretchMode: 'Întinde pe tot ecranul'
            },
            sk: {
                title: 'Optimizer Plus',
                status: 'Stav',
                active: 'Aktívny',
                inactive: 'Neaktívny',
                resolution: 'Rozlíšenie',
                forcedResolution: 'Vynútené rozlíšenie',
                targetResolution: 'Cieľové rozlíšenie',
                videoEnhancement: 'Vylepšenie videa',
                enableEnhancer: 'Povoliť vylepšenie',
                sharpness: 'Ostrosť',
                contrast: 'Kontrast',
                saturation: 'Sýtosť',
                advancedFilters: 'Pokročilé video filtre',
                quickPresets: 'Rýchle presety',
                enableAdvanced: 'Povoliť pokročilé filtre',
                presetDefault: 'Predvolené',
                presetCinematic: 'Filmový',
                presetGame: 'Súťažný',
                presetComfort: 'Komfort',
                presetPerfect: 'Dokonalá Kvalita',
                presetCustom: 'Vlastné',
                noiseReduction: 'Redukcia šumu',
                vibrance: 'Živosť',
                clarity: 'Čistota',
                streamInterceptor: 'Zachytávač Streamu (HW Dek.)',
                apply: 'Použiť',
                reset: 'Obnoviť',
                settingsSaved: '[OK] Nastavenia uložené! Obnovte stránku.',
                settingsReset: '[<<] Nastavenia obnovené. Obnovte stránku.',
                presetApplied: '[*] Preset "{name}" použitý!',
                language: 'Jazyk',
                autoDetect: 'Automaticky',
                performanceMode: 'Režim výkonu',
                performanceModeHint: 'Deaktivuje ťažké filtre pre maximalizáciu FPS',
                stretchMode: 'Roztiahnuť (Bez okrajov)'
            },
            sv: {
                title: 'Optimizer Plus',
                status: 'Status',
                active: 'Aktiv',
                inactive: 'Inaktiv',
                resolution: 'Upplösning',
                forcedResolution: 'Tvingad upplösning',
                targetResolution: 'Målupplösning',
                videoEnhancement: 'Videoförbättring',
                enableEnhancer: 'Aktivera förbättring',
                sharpness: 'Skärpa',
                contrast: 'Kontrast',
                saturation: 'Mättnad',
                advancedFilters: 'Avancerade videofilter',
                quickPresets: 'Snabbförinställningar',
                enableAdvanced: 'Aktivera avancerade filter',
                presetDefault: 'Standard',
                presetCinematic: 'Filmisk',
                presetGame: 'Tävling',
                presetComfort: 'Komfort',
                presetPerfect: 'Perfekt Kvalitet',
                presetCustom: 'Anpassad',
                noiseReduction: 'Brusreducering',
                vibrance: 'Livfullhet',
                clarity: 'Klarhet',
                streamInterceptor: 'Stream Interceptor (HW Avk.)',
                apply: 'Tillämpa',
                reset: 'Återställ',
                settingsSaved: '[OK] Inställningar sparade!',
                settingsReset: '[<<] Inställningar återställda.',
                presetApplied: '[*] Förinställning "{name}" tillämpad!',
                language: 'Språk',
                autoDetect: 'Automatisk',
                deviceProfile: 'Enhet',
                filterTier: 'Kvalitetsnivå',
                adaptiveMode: 'Adaptivt läge',
                bitrateEnforcer: 'Aggressiv bitratetvingare (V4)',
                ultrawideMode: 'Ultrawide-läge (21:9, 32:9)',
                ultrawideAutoDetect: 'Auto-detektera 21:9+',
                performanceMode: 'Prestandaläge',
                performanceModeHint: 'Inaktiverar tunga filter för att maximera FPS',
                displaySettings: 'Skärm och Ultrawide',
                screenInfo: 'Skärminfo',
                fitMode: 'Visningsläge',
                hwProfile: 'Profil',
                stretchMode: 'Sträck ut (Utan kanter)'
            }
        }
    };

    let currentLang = 'en';

    function detectLanguage() {
        if (CONFIG.language && CONFIG.language !== 'auto') {
            return CONFIG.language;
        }

        const browserLang = (navigator.language || navigator.userLanguage || 'en').substring(0, 2).toLowerCase();
        return I18N.translations[browserLang] ? browserLang : 'en';
    }

    function t(key, params = {}) {
        const translation = I18N.translations[currentLang]?.[key] || I18N.translations['en'][key] || key;

        return translation.replace(/\{(\w+)\}/g, (match, param) => params[param] || match);
    }

    currentLang = detectLanguage();

    // SVG ICONS

    const ICONS = {
        settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
        monitor: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
        film: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>`,
        sliders: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`,
        eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
        target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
        cpu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>`,
        activity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
        contrast: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20z"/></svg>`,
        sparkles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M5 19l.5 1.5L7 21l-1.5.5L5 23l-.5-1.5L3 21l1.5-.5L5 19z"/><path d="M19 5l.5 1.5L21 7l-1.5.5L19 9l-.5-1.5L17 7l1.5-.5L19 5z"/></svg>`,
        check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
        x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
        refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
        crosshair: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`,
    };

    // UI STYLES - BOOSTEROID THEME

    const OPTIMIZER_STYLES = `
        /* OPTIMIZER+ CSS - Native Boosteroid Typography & Layout                     */

        /* Mobile/PWA Fix for .m_lan_wrapper scrollability (iOS Landscape) */
        .m_lan_wrapper.menu-open,
        .m_lan_wrapper {
            overflow-y: auto !important;
            overflow-x: hidden !important;
            max-height: 100vh !important;
            max-height: 100dvh !important;
            padding-bottom: 80px !important;
            -webkit-overflow-scrolling: touch !important;
            overscroll-behavior: contain !important;
        }

        /* Stretch Mode (No Borders) - Bypass Boosteroid Containers */
        html.optimizer-stretch-mode,
        html.optimizer-stretch-mode body,
        html.optimizer-stretch-mode #root,
        html.optimizer-stretch-mode #app {
            width: 100% !important;
            height: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            transform: none !important; 
        }

        html.optimizer-stretch-mode #app div:not([id*="optimizer"]):not([class*="optimizer"]) {
            transform: none !important;
        }

        html.optimizer-stretch-mode [class*="video"],
        html.optimizer-stretch-mode [class*="stream"],
        html.optimizer-stretch-mode [class*="player"],
        html.optimizer-stretch-mode video,
        html.optimizer-stretch-mode canvas {
            width: 100% !important;
            height: 100% !important;
            min-width: 100% !important;
            min-height: 100% !important;
            max-width: 100% !important;
            max-height: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            object-fit: fill !important; 
            object-position: center !important;
            transform: none !important; 
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            box-sizing: border-box !important;
        }

        .optimizer-injected {
            color: #fff;
            margin-top: 0;
        }

        /* Prevent Boosteroid's responsive CSS from hiding our injected sections */
        div.menu_block.optimizer-injected {
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            height: auto !important;
        }

        div.menu_title.optimizer-injected {
            visibility: visible !important;
            opacity: 1 !important;
            height: auto !important;
        }

        /* Menu Title - inherit native Boosteroid styles, no overrides */
        .optimizer-injected .menu_title {
        }

        /* Menu Switch Block - Row Container */
        .optimizer-injected .menu_switch_block {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 0;
            gap: 10px;
            min-height: 32px;
            flex-wrap: wrap;
        }

        .optimizer-injected .menu_switch_block.top_20 {
            margin-top: 0;
        }

        /* Menu Title Group - Labels */
        .optimizer-injected .menu_title_group {
            display: flex;
            align-items: center;
            gap: 6px;
            flex: 1;
            min-width: 80px;
            overflow: visible;
        }

        .optimizer-injected .menu_title_group p {
            font-size: 12px;
            font-weight: 400;
            color: rgba(255, 255, 255, 0.85);
            margin: 0;
            white-space: nowrap;
            overflow: visible;
        }

        .optimizer-injected .menu_title_group span {
            white-space: nowrap;
            overflow: visible;
        }

        .optimizer-injected .menu_title_group svg {
            width: 14px;
            height: 14px;
            opacity: 0.7;
            flex-shrink: 0;
        }

        /* Badge Version */
        .optimizer-injected .optimizer-badge {
            font-size: 10px;
            font-weight: 500;
            background: #00a3ff;
            color: #fff;
            padding: 2px 6px;
            border-radius: 3px;
            margin-left: 6px;
            vertical-align: middle;
        }

        .optimizer-injected .optimizer-slider {
            position: relative;
            width: 100%;
            height: 20px;
            display: flex;
            align-items: center;
            cursor: pointer;
            user-select: none;
            -webkit-user-select: none;
        }

        .optimizer-injected .optimizer-slider-track {
            position: absolute;
            width: 100%;
            height: 4px;
            background: rgba(255, 255, 255, 0.15);
            border-radius: 2px;
        }

        .optimizer-injected .optimizer-slider-fill {
            position: absolute;
            height: 4px;
            background: #22c55e;
            border-radius: 2px;
            pointer-events: none;
        }

        .optimizer-injected .optimizer-slider-thumb {
            position: absolute;
            width: 14px;
            height: 14px;
            background: #22c55e;
            border-radius: 50%;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
            transform: translateX(-50%);
            pointer-events: none;
            transition: transform 0.1s ease;
        }

        .optimizer-injected .optimizer-slider:hover .optimizer-slider-thumb {
            transform: translateX(-50%) scale(1.15);
        }

        .optimizer-injected .optimizer-slider:active .optimizer-slider-thumb {
            transform: translateX(-50%) scale(1.2);
            box-shadow: 0 2px 8px rgba(34, 197, 94, 0.5);
        }

        .optimizer-injected input[type="range"] {
            position: absolute;
            width: 100%;
            height: 20px;
            opacity: 0;
            cursor: pointer;
            margin: 0;
            z-index: 2;
        }

        /* Legacy track styling (hidden) */
        .optimizer-injected input[type="range"]::-webkit-slider-runnable-track {
            height: 4px;
            border-radius: 2px;
            background: rgba(255, 255, 255, 0.15);
        }

        .optimizer-injected input[type="range"]::-moz-range-track {
            height: 4px;
            border-radius: 2px;
            background: rgba(255, 255, 255, 0.15);
        }

        .optimizer-injected input[type="range"]::-moz-range-progress {
            background: #22c55e;
            height: 4px;
            border-radius: 2px;
        }

        /* Toggle Switch — Inherits native Boosteroid .switch.toggle-switch styles */

        /* Gray out disabled elements (Performance Mode active) */
        .optimizer-injected input[disabled],
        .optimizer-injected select[disabled],
        .optimizer-injected .switch input[disabled] + .slider.round {
            opacity: 0.4 !important;
            pointer-events: none !important;
            cursor: not-allowed !important;
        }

        .optimizer-injected .optimizer-slider:has(input[disabled]) {
            opacity: 0.4 !important;
            pointer-events: none !important;
            cursor: not-allowed !important;
        }

        .optimizer-injected .menu_switch_block:has(input[disabled]) {
            opacity: 0.5 !important;
            pointer-events: none !important;
        }

        /* SELECT - Dropdowns                                                         */

        .optimizer-injected select,
        .optimizer-injected .optimizer-select {
            font-size: 12px;
            font-family: inherit;
            padding: 6px 10px;
            background: rgba(6, 9, 18, 0.9);
            color: #fff;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 4px;
            cursor: pointer;
            outline: none;
            flex-shrink: 0;
            max-width: 180px;
        }

        #optimizer-res-select {
            min-width: 140px;
            max-width: 160px;
        }

        .optimizer-injected select:focus,
        .optimizer-injected .optimizer-select:focus {
            border-color: #00a3ff;
        }

        .optimizer-injected select option,
        .optimizer-injected .optimizer-select option {
            background: #131721;
            color: #fff;
        }

        /* PRESETS - Button Grid                                                      */

        .optimizer-injected .optimizer-presets {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            width: 100%;
        }

        .optimizer-injected .optimizer-preset-btn {
            font-family: inherit;
            font-size: 11px;
            font-weight: 500;
            padding: 6px 10px;
            min-height: 28px;
            border-radius: 4px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            background: rgba(255, 255, 255, 0.03);
            color: #fff;
            cursor: pointer;
            transition: all 0.15s ease;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .optimizer-injected .optimizer-preset-btn svg {
            width: 12px;
            height: 12px;
            flex-shrink: 0;
        }

        .optimizer-injected .optimizer-preset-btn:hover {
            border-color: rgba(0, 163, 255, 0.5);
            background: rgba(0, 163, 255, 0.1);
        }

        .optimizer-injected .optimizer-preset-btn.active {
            background: #00a3ff;
            border-color: #00a3ff;
            color: #fff;
        }

        .optimizer-injected .optimizer-preset-perfect {
            border-color: rgba(0, 136, 204, 0.6);
        }

        .optimizer-injected .optimizer-preset-perfect:hover {
            background: linear-gradient(135deg, rgba(0, 163, 255, 0.2), rgba(0, 102, 204, 0.2));
            border-color: #00a3ff;
        }

        .optimizer-injected .optimizer-preset-perfect.active {
            background: linear-gradient(135deg, #00a3ff, #0066cc);
            border-color: #00a3ff;
        }

        /* STATUS INDICATOR                                                           */

        .optimizer-injected .optimizer-status {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.85);
        }

        .optimizer-injected .optimizer-status-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #22c55e;
            animation: optimizer-pulse 2s infinite;
        }

        .optimizer-injected .optimizer-status-dot.warning {
            background: #f59e0b;
        }

        .optimizer-injected .optimizer-status-dot.error {
            background: #ef4444;
        }

        @keyframes optimizer-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        /* BUTTONS                                                                    */

        .optimizer-injected .optimizer-btn {
            font-family: inherit;
            font-size: 12px;
            font-weight: 500;
            padding: 6px 12px;
            min-height: 28px;
            border-radius: 4px;
            border: none;
            background: #00a3ff;
            color: #fff;
            cursor: pointer;
            transition: all 0.15s ease;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }

        .optimizer-injected .optimizer-btn:hover {
            background: #0082cc;
        }

        .optimizer-injected .optimizer-btn.secondary {
            background: transparent;
            border: 1px solid rgba(255, 255, 255, 0.18);
            color: rgba(255, 255, 255, 0.85);
        }

        .optimizer-injected .optimizer-btn.secondary:hover {
            background: rgba(255, 255, 255, 0.08);
        }

        .optimizer-injected .optimizer-btn svg {
            width: 14px;
            height: 14px;
            flex-shrink: 0;
        }

        /* NOTIFICATION                                                               */

        #optimizer-notification {
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(15, 15, 25, 0.95);
            border: 1px solid rgba(0, 163, 255, 0.3);
            color: #fff;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 13px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
            z-index: 100000;
            backdrop-filter: blur(10px);
        }

        /* RESPONSIVE                                                                 */

        @media (max-width: 767px) {
            .optimizer-injected .menu_title_group p {
                font-size: 11px;
            }

            .optimizer-injected .optimizer-preset-btn {
                font-size: 10px;
                padding: 5px 8px;
                min-height: 32px;
            }

            .optimizer-injected input[type="range"]::-webkit-slider-thumb {
                width: 18px;
                height: 18px;
            }

            .optimizer-injected input[type="range"]::-moz-range-thumb {
                width: 18px;
                height: 18px;
            }
        }

        @media (pointer: coarse) {
            .optimizer-injected .optimizer-preset-btn {
                min-height: 36px;
                padding: 8px 12px;
            }

            .optimizer-injected input[type="range"]::-webkit-slider-thumb {
                width: 20px;
                height: 20px;
            }

            .optimizer-injected input[type="range"]::-moz-range-thumb {
                width: 20px;
                height: 20px;
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .optimizer-injected *,
            #optimizer-notification {
                animation: none !important;
                transition: none !important;
            }
        }

        /* SCREEN INFO & HW BADGE */

        /* Screen info display in-game */
        .optimizer-injected .optimizer-screen-info {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px;
            margin: 8px 0;
            background: rgba(0, 163, 255, 0.08);
            border: 1px solid rgba(0, 163, 255, 0.15);
            border-radius: 6px;
            font-size: 11px;
        }

        .optimizer-injected .optimizer-screen-info svg {
            width: 14px;
            height: 14px;
            color: #00a3ff;
            flex-shrink: 0;
        }

        .optimizer-injected .optimizer-screen-info .screen-detected {
            color: #00a3ff;
            font-weight: 600;
            font-family: 'SF Mono', 'Consolas', monospace;
        }

        .optimizer-injected .optimizer-screen-info .screen-ratio {
            color: rgba(255, 255, 255, 0.5);
            font-size: 10px;
            padding: 2px 6px;
            background: rgba(255, 255, 255, 0.08);
            border-radius: 4px;
            margin-left: auto;
        }

        .optimizer-injected .optimizer-hw-badge {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
        }

        .optimizer-injected .optimizer-hw-badge svg {
            width: 14px;
            height: 14px;
            color: rgba(255, 255, 255, 0.5);
        }

        /* DASHBOARD FLOATING WIDGET */

        #optimizer-dashboard-widget {
            position: fixed;
            right: 20px;
            bottom: 180px;
            z-index: 9999999 !important;
            pointer-events: auto !important;
            font-family: 'Sofia Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        #optimizer-dashboard-widget .opt-widget-btn {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            background: linear-gradient(135deg, #00a3ff 0%, #0066cc 100%);
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 20px rgba(0, 163, 255, 0.4), 0 2px 8px rgba(0, 0, 0, 0.3);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            z-index: 9999999 !important;
            pointer-events: auto !important;
        }

        #optimizer-dashboard-widget .opt-widget-btn:hover {
            transform: scale(1.1);
            box-shadow: 0 6px 28px rgba(0, 163, 255, 0.5), 0 4px 12px rgba(0, 0, 0, 0.4);
        }

        #optimizer-dashboard-widget .opt-widget-btn:active {
            transform: scale(0.95);
        }

        #optimizer-dashboard-widget .opt-widget-btn svg {
            width: 28px;
            height: 28px;
            color: white;
            stroke: white;
            fill: none;
            pointer-events: none;
        }

        /* Status dot */
        #optimizer-dashboard-widget .opt-status-dot {
            position: absolute;
            top: 2px;
            right: 2px;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: #22c55e;
            border: 2px solid #fff;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            animation: opt-status-pulse 2s infinite;
            pointer-events: none;
        }

        @keyframes opt-status-pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.5); }
            50% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
        }

        #optimizer-dashboard-widget .opt-widget-panel {
            position: absolute;
            bottom: 70px;
            right: 0;
            width: 280px;
            background: rgba(19, 23, 33, 0.98);
            border: 1px solid rgba(0, 163, 255, 0.3);
            border-radius: 12px;
            padding: 16px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), 0 0 20px rgba(0, 163, 255, 0.1);
            backdrop-filter: blur(20px);
            opacity: 0;
            visibility: hidden;
            transform: translateY(10px) scale(0.95);
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 9999999 !important;
            pointer-events: auto !important;
        }

        #optimizer-dashboard-widget .opt-widget-panel.open {
            opacity: 1;
            visibility: visible;
            transform: translateY(0) scale(1);
        }

        #optimizer-dashboard-widget .opt-widget-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 14px;
            padding-bottom: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        #optimizer-dashboard-widget .opt-widget-title {
            font-size: 14px;
            font-weight: 600;
            color: #fff;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        #optimizer-dashboard-widget .opt-widget-version {
            font-size: 10px;
            background: #00a3ff;
            color: #fff;
            padding: 2px 6px;
            border-radius: 4px;
        }

        #optimizer-dashboard-widget .opt-widget-row {
            margin-bottom: 12px;
        }

        #optimizer-dashboard-widget .opt-widget-label {
            font-size: 11px;
            color: rgba(255, 255, 255, 0.6);
            margin-bottom: 6px;
            display: block;
        }

        #optimizer-dashboard-widget .opt-widget-select {
            width: 100%;
            padding: 10px 12px;
            background: rgba(6, 9, 18, 0.9);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 8px;
            color: #fff;
            font-size: 13px;
            cursor: pointer;
            outline: none;
            transition: border-color 0.2s;
        }

        #optimizer-dashboard-widget .opt-widget-select:hover,
        #optimizer-dashboard-widget .opt-widget-select:focus {
            border-color: #00a3ff;
        }

        #optimizer-dashboard-widget .opt-widget-select option {
            background: #131721;
            color: #fff;
            padding: 8px;
        }

        #optimizer-dashboard-widget .opt-widget-select optgroup {
            background: #0a0d14;
            color: #00a3ff;
            font-weight: 600;
        }

        #optimizer-dashboard-widget .opt-widget-status {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            background: rgba(34, 197, 94, 0.1);
            border: 1px solid rgba(34, 197, 94, 0.3);
            border-radius: 8px;
            margin-bottom: 12px;
        }

        #optimizer-dashboard-widget .opt-widget-status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #22c55e;
            animation: opt-status-pulse 2s infinite;
        }

        #optimizer-dashboard-widget .opt-widget-status-text {
            font-size: 12px;
            color: #22c55e;
            font-weight: 500;
        }

        #optimizer-dashboard-widget .opt-widget-actions {
            display: flex;
            gap: 8px;
        }

        #optimizer-dashboard-widget .opt-widget-action-btn {
            flex: 1;
            padding: 10px 14px;
            border-radius: 8px;
            border: none;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.2s;
        }

        #optimizer-dashboard-widget .opt-widget-action-btn.primary {
            background: #00a3ff;
            color: #fff;
        }

        #optimizer-dashboard-widget .opt-widget-action-btn.primary:hover {
            background: #0082cc;
        }

        #optimizer-dashboard-widget .opt-widget-action-btn.secondary {
            background: rgba(255, 255, 255, 0.08);
            color: rgba(255, 255, 255, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.15);
        }

        #optimizer-dashboard-widget .opt-widget-action-btn.secondary:hover {
            background: rgba(255, 255, 255, 0.12);
        }

        #optimizer-dashboard-widget .opt-widget-action-btn svg {
            width: 14px;
            height: 14px;
        }

        #optimizer-dashboard-widget .opt-widget-footer {
            margin-top: 12px;
            padding-top: 10px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            text-align: center;
        }

        #optimizer-dashboard-widget .opt-widget-credit {
            font-size: 10px;
            color: rgba(255, 255, 255, 0.4);
        }

        #optimizer-dashboard-widget .opt-widget-screen-info {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 6px;
            padding: 8px 10px;
            margin-bottom: 12px;
            background: rgba(0, 163, 255, 0.1);
            border: 1px solid rgba(0, 163, 255, 0.2);
            border-radius: 8px;
            font-size: 11px;
        }

        #optimizer-dashboard-widget .opt-screen-label {
            color: rgba(255, 255, 255, 0.7);
            flex-shrink: 0;
        }

        #optimizer-dashboard-widget .opt-screen-value {
            color: #00a3ff;
            font-weight: 600;
            font-family: 'SF Mono', 'Consolas', monospace;
        }

        #optimizer-dashboard-widget .opt-screen-value.auto-active {
            color: #22c55e;
            animation: opt-glow-green 2s ease-in-out infinite;
        }

        @keyframes opt-glow-green {
            0%, 100% { text-shadow: 0 0 4px rgba(34, 197, 94, 0.4); }
            50% { text-shadow: 0 0 8px rgba(34, 197, 94, 0.6); }
        }

        #optimizer-dashboard-widget .opt-screen-ratio {
            color: rgba(255, 255, 255, 0.5);
            font-size: 10px;
            padding: 2px 6px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            margin-left: auto;
        }

        #optimizer-dashboard-widget .opt-widget-select option[value="auto"] {
            font-weight: bold;
            background: rgba(0, 163, 255, 0.15);
        }

        /* Hide Boosteroid's "Brighter image" option */

        .menu_switch_block:has(input[id*="brighter"]),
        .menu_switch_block:has(input[name*="brighter"]),
        .menu_switch_block:has([data-setting*="brighter"]),
        [class*="brighter-image-toggle"],
        [class*="brighter-option"] {
            display: none !important;
            visibility: hidden !important;
            pointer-events: none !important;
        }
    `;

    function ensureOptimizerTypography() {
        if (document.getElementById('optimizer-typography-styles')) {
            return;
        }
        const styleElement = document.createElement('style');
        styleElement.id = 'optimizer-typography-styles';
        styleElement.textContent = OPTIMIZER_STYLES;
        document.head.appendChild(styleElement);
        console.log('[Optimizer+] CSS injected with Boosteroid-native typography');
    }

    // WINDOW CONTEXT

    // @grant none: window is the page window, no sandbox
    let windowCtx = window;

    // SESSION STATE

    const SessionState = {
        isGameActive: false,
        isMenuOpen: false,
        isUIInjected: false,
        videoElement: null,
        lastSessionId: null,
        lastCheckTime: 0,
        retryCount: 0,
        maxRetries: 5,

        reset() {
            this.isGameActive = false;
            this.isMenuOpen = false;
            this.isUIInjected = false;
            this.videoElement = null;
            this.lastSessionId = null;
            this.retryCount = 0;
            document.querySelectorAll('.optimizer-injected').forEach(el => el.remove());
        },

        hasSessionChanged() {
            const currentSessionId = this.extractSessionId();
            if (currentSessionId && this.lastSessionId && currentSessionId !== this.lastSessionId) {
                console.log(`[Optimizer+] Changement de session détecté: ${this.lastSessionId} -> ${currentSessionId}`);
                return true;
            }
            if (currentSessionId) {
                this.lastSessionId = currentSessionId;
            }
            return false;
        },

        extractSessionId() {
            try {
                const url = new URL(window.location.href);
                return url.searchParams.get('sessionId') ||
                    url.searchParams.get('sessionid') ||
                    url.searchParams.get('session') ||
                    null;
            } catch (e) {
                return null;
            }
        },

        forceReinject() {
            console.log('[Optimizer+] Réinjection forcée de l\'UI');

            const oldUI = document.querySelectorAll('.optimizer-injected');
            oldUI.forEach(el => el.remove());

            this.isUIInjected = false;
            this.retryCount = 0;

            return true;
        },

        selfHeal() {
            const now = Date.now();

            if (now - this.lastCheckTime < 2000) {
                return false;
            }
            this.lastCheckTime = now;

            if (this.hasSessionChanged()) {
                this.forceReinject();
                return true;
            }

            const activeMenu = findOpenOptionsMenu();

            // Inconsistent state: UI flagged as injected but missing or incomplete in the active menu
            if (this.isUIInjected && (!activeMenu || !isUIFullyInjected(activeMenu))) {
                console.log('[Optimizer+] Self-heal: UI marquée présente mais absente ou incomplète dans le menu actif');
                this.isUIInjected = false;
                this.retryCount++;

                if (this.retryCount > this.maxRetries) {
                    console.warn('[Optimizer+] Max retries atteint, reset complet');
                    this.reset();
                }
                return true;
            }

            // UI present in the DOM but not flagged
            if (!this.isUIInjected && document.querySelector('.optimizer-injected')) {
                console.log('[Optimizer+] Self-heal: UI présente mais pas marquée');
                this.isUIInjected = true;
                return true;
            }

            return false;
        }
    };

    // STORAGE

    const Storage = {
        get: function (key, defaultValue) {
            try {
                const stored = localStorage.getItem('optimizer_' + key);
                return stored !== null ? JSON.parse(stored) : defaultValue;
            } catch (e) {
                return defaultValue;
            }
        },

        set: function (key, value) {
            try {
                localStorage.setItem('optimizer_' + key, JSON.stringify(value));
            } catch (e) {
                console.warn('[Optimizer+] Erreur sauvegarde:', e);
            }
        }
    };

    // Persist and reload only what the UI controls. streaming/performance are internal
    // tuning versioned with the script: reloading them from an old save would override
    // new defaults.
    const PERSISTED_KEYS = ['filters', 'enhancer', 'resolution', 'display', 'drm', 'language'];
    function pickPersisted(config) {
        const out = {};
        if (!isPlainObject(config)) return out;
        for (const k of PERSISTED_KEYS) {
            if (config[k] !== undefined) out[k] = config[k];
        }
        return out;
    }

    let saveTimeout = null;
    function saveConfig(debounced = false) {
        if (debounced) {
            if (saveTimeout) clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                Storage.set('config', pickPersisted(CONFIG));
                saveTimeout = null;
            }, 1000);
        } else {
            if (saveTimeout) {
                clearTimeout(saveTimeout);
                saveTimeout = null;
            }
            Storage.set('config', pickPersisted(CONFIG));
        }
    }

    // New session (different sessionId) resets presets and filters
    function getCurrentSessionId() {
        const url = window.location.href;
        const match = url.match(/sessionId=([a-f0-9-]+)/i);
        return match ? match[1] : null;
    }

    const currentSessionId = getCurrentSessionId();
    const savedSessionId = Storage.get('lastSessionId', null);
    const isNewSession = currentSessionId && currentSessionId !== savedSessionId;

    const savedConfig = Storage.get('config', null);
    if (savedConfig) {
        if (isNewSession) {
            console.log('[Optimizer+] Nouvelle session d\u00E9tect\u00E9e, reset des presets');
            savedConfig.filters = {
                enabled: false,
                preset: null,
                usm: { enabled: false, amount: 0.35, radius: 0.9, threshold: 0.04 },
                cas: { enabled: false, sharpness: 0.45 },
                clarity: { enabled: false, amount: 0.2 },
                denoise: { enabled: false, strength: 0.2 },
                vibrance: { enabled: false, amount: 0.2 },
                gamma: { enabled: false, value: 1.0 },
                exposure: { enabled: false, value: 0 },
                deband: { enabled: false, strength: 0.3 }
            };
            savedConfig.enhancer = {
                enabled: true,
                sharpness: 0.45,
                contrast: 1.08,
                saturation: 1.05,
                brightness: 1.02
            };
            Storage.set('lastSessionId', currentSessionId);
        }
        // Deep merge so saved configs do not wipe newly added default keys
        function deepMerge(target, source) {
            if (!isPlainObject(target) || !isPlainObject(source)) return;

            for (const key of Object.keys(source)) {
                if (BLOCKED_MERGE_KEYS.has(key)) continue;

                const sourceValue = source[key];
                if (isPlainObject(sourceValue)) {
                    if (!isPlainObject(target[key])) target[key] = {};
                    deepMerge(target[key], sourceValue);
                } else {
                    target[key] = sourceValue;
                }
            }
        }
        deepMerge(CONFIG, pickPersisted(savedConfig));

        // The enhancer is always on; neutral saved values (1.0) fall back to the defaults
        CONFIG.enhancer.enabled = true;
        if (CONFIG.enhancer.contrast === 1.0) CONFIG.enhancer.contrast = 1.08;
        if (CONFIG.enhancer.saturation === 1.0) CONFIG.enhancer.saturation = 1.05;
        if (CONFIG.enhancer.brightness === 1.0) CONFIG.enhancer.brightness = 1.02;

        // Stretch mode never persists across page loads
        if (CONFIG.display) {
            CONFIG.display.stretchMode = false;
        }
        document.documentElement.classList.remove('optimizer-stretch-mode');

    } else if (currentSessionId) {
        Storage.set('lastSessionId', currentSessionId);
    }

    if (!savedConfig || !savedConfig.resolution || savedConfig.resolution.isAuto === true) {
        const nativeScreen = SmartResolutionDetector.getScreenDimensions();
        const bestMatch = SmartResolutionDetector.findBestMatch(nativeScreen.width, nativeScreen.height);

        if (bestMatch) {
            CONFIG.resolution.width = bestMatch.w;
            CONFIG.resolution.height = bestMatch.h;
        } else {
            CONFIG.resolution.width = nativeScreen.width;
            CONFIG.resolution.height = nativeScreen.height;
        }
        CONFIG.resolution.pixelRatio = nativeScreen.devicePixelRatio || 1;
        CONFIG.resolution.isAuto = true;
        console.log(`[Optimizer+] Auto-resolution au d\u00E9marrage: ${CONFIG.resolution.width}x${CONFIG.resolution.height}`);
    }

    // detectLanguage() first ran before the saved config was loaded
    currentLang = detectLanguage();
    console.log(`[Optimizer+] Langue active: ${currentLang} (config: ${CONFIG.language})`);

    // HOOK RESOLUTION

    // Boosteroid may apply a new resolution live or only at the next page load: report
    // what the stream actually does instead of assuming.
    let confirmTimer = null;
    function confirmResolution(width, height) {
        clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => {
            const video = videoEnhancer.videoElement;
            if (!video || !video.videoWidth) return;
            const applied = Math.abs(video.videoWidth - width) <= width * 0.1 && Math.abs(video.videoHeight - height) <= height * 0.1;
            showNotification(t(applied ? 'resAppliedNotif' : 'resReloadNotif', { res: `${video.videoWidth}x${video.videoHeight}` }), applied ? 'success' : 'info');
        }, 6000);
    }

    function hookResolution() {
        // Auto mode never spoofs above native: a 4K spoof on a 1080p screen offsets the
        // mouse, wastes bandwidth and decodes 4K for nothing.

        if (CONFIG.resolution.isAuto) {
            // Undo a manual choice made earlier in this page
            for (const prop of ['width', 'height', 'availWidth', 'availHeight']) delete window.screen[prop];
            if (_realDprDescriptor) Object.defineProperty(windowCtx, 'devicePixelRatio', _realDprDescriptor);
            console.log(`[Optimizer+] Résolution auto (native): ${_realScreen.width}x${_realScreen.height} @${_realScreen.pixelRatio}x`);
            CONFIG.resolution.width = _realScreen.width;
            CONFIG.resolution.height = _realScreen.height;
            CONFIG.resolution.pixelRatio = _realScreen.pixelRatio;
            return;
        }

        // Manual mode: honour the chosen resolution (even above native) and scale
        // pixelRatio so mouse coordinates stay aligned
        const width = CONFIG.resolution.width;
        const height = CONFIG.resolution.height;
        const pixelRatio = Math.max(1, Math.round((width / _realScreen.width) * 10) / 10);

        try {
            // Redefine only the dimensions on the real Screen object so orientation, lock()
            // and identity stay intact
            const spoofedDims = { width, height, availWidth: width, availHeight: height };
            for (const [prop, value] of Object.entries(spoofedDims)) {
                try {
                    Object.defineProperty(window.screen, prop, { get: () => value, configurable: true });
                } catch (e) { /* not redefinable in this browser */ }
            }

            Object.defineProperty(windowCtx, 'devicePixelRatio', {
                get: () => pixelRatio,
                configurable: true
            });

            // innerWidth/innerHeight are not hooked: doing so breaks mouse events

            console.log(`[Optimizer+] Résolution forcée: ${width}x${height} @${pixelRatio}x (cappée à natif ${_realScreen.width}x${_realScreen.height})`);
        } catch (e) {
            console.error('[Optimizer+] Erreur hook résolution:', e);
        }
    }

    // HOOK CODECS

    let _hookCodecsInstalled = false;
    function hookCodecs() {
        if (_hookCodecsInstalled) return;
        _hookCodecsInstalled = true;

        // Codec support is never faked: lying causes software decoding.

        if (windowCtx.MediaCapabilities && windowCtx.MediaCapabilities.prototype.decodingInfo) {
            const originalDecodingInfo = windowCtx.MediaCapabilities.prototype.decodingInfo;

            windowCtx.MediaCapabilities.prototype.decodingInfo = function (config) {
                return originalDecodingInfo.call(this, config).then(result => {
                    if (config.video) {
                        // HDR queries are answered "unsupported": see SDR STREAM
                        const isHDRQuery = config.video.transferFunction === 'pq' ||
                                           config.video.transferFunction === 'hlg' ||
                                           config.video.colorGamut === 'p3' ||
                                           config.video.colorGamut === 'rec2020';

                        if (isHDRQuery) {
                            result.supported = result.smooth = result.powerEfficient = false;
                        }
                    }

                    return result;
                });
            };
        }

        console.log('[Optimizer+] Hooks codecs install\u00E9s (AV1, HEVC, VP9)');
    }

    // HOOK BITRATE
    const activePeerConnections = new Set();
    let streamMonitorInterval = null;

    // Calibration knob, tuned in a real session: localStorage.setItem('optimizer_playout_ms', '10') + reload
    const PLAYOUT_MS = (() => {
        try {
            const v = parseFloat(localStorage.getItem('optimizer_playout_ms'));
            if (v >= 0 && v <= 200) return v;
        } catch (e) {}
        return CONFIG.performance.playoutDelayHintMs;
    })();

    function optimizeReceiverLatency(receiver) {
        if (!receiver || !CONFIG.performance.lowLatencyMode) return;
        try {
            const trackKind = receiver.track?.kind;

            // playoutDelayHint trade-off: 0 stutters on any jitter, unset lets Chrome grow the
            // buffer (mouse lag). ~30 ms absorbs micro-jitter. Tune via
            // CONFIG.performance.playoutDelayHintMs.
            if ('playoutDelayHint' in receiver && trackKind === 'video') {
                const hint = receiver.playoutDelayHint;
                if (hint != null && Math.abs(hint - PLAYOUT_MS / 1000) > 1e-6) siteDelay = Math.round(hint * 1000) + 'ms';
                receiver.playoutDelayHint = PLAYOUT_MS / 1000;
            } else if ('playoutDelayHint' in receiver && trackKind === 'audio') {
                // Audio: 10 ms keeps it in sync with the video
                receiver.playoutDelayHint = 0.01;
            }

            // Soft cap: bounds the buffer but lets the browser adapt below it
            if (receiver.jitterBufferTarget !== undefined && trackKind === 'video') {
                const cap = Math.max(60, CONFIG.performance.jitterBufferMax || 80);
                if (typeof receiver.jitterBufferTarget === 'number' && receiver.jitterBufferTarget > cap) {
                    receiver.jitterBufferTarget = cap;
                }
            }
        } catch (e) {}
    }

    // Passive SDP munging: the script never dictates the bitrate (a floor above real
    // bandwidth means packet loss). It only raises the advertised receive ceiling
    // (b=AS/TIAS) so the server is never capped client-side.
    function applyBitrateSdpMunging(sdp, isAnswer = false) {
        const newline = sdp.includes('\r\n') ? '\r\n' : '\n';
        const asKbps = Math.floor(CONFIG.streaming.maxBitrate / 1000);

        // Boosteroid's SDP carries no b=AS/b=TIAS, so both are inserted when absent

        // b=AS (kbps)
        if (sdp.includes('b=AS:')) {
            sdp = sdp.replace(/b=AS:\d+/g, `b=AS:${asKbps}`);
        } else {
            sdp = sdp.replace(
                /(m=video[^\r\n]*(?:\r?\n))/g,
                `$1b=AS:${asKbps}${newline}`
            );
        }

        if (DEBUG_LOGS && sdp.includes('b=AS:')) console.log(`[Optimizer+] [SDP] b=AS injecté/remplacé → ${asKbps} kbps (${isAnswer ? 'answer' : 'offer'})`);

        // b=TIAS (bps)
        if (sdp.includes('b=TIAS:')) {
            sdp = sdp.replace(/b=TIAS:\d+/g, `b=TIAS:${CONFIG.streaming.maxBitrate}`);
        } else {
            sdp = sdp.replace(
                /(m=video[^\r\n]*(?:\r?\n)(?:b=AS:[^\r\n]*(?:\r?\n))?)/g,
                `$1b=TIAS:${CONFIG.streaming.maxBitrate}${newline}`
            );
        }

        if (DEBUG_LOGS && sdp.includes('b=TIAS:')) console.log(`[Optimizer+] [SDP] b=TIAS présent → ${CONFIG.streaming.maxBitrate} bps (${isAnswer ? 'answer' : 'offer'})`);

        if (DEBUG_LOGS) {
            const vm = sdp.match(/m=video[^\r\n]*/);
            if (vm) console.log(`[Optimizer+] [SDP] ligne vidéo résultante: ${vm[0].slice(0, 80)}`);
        }

        return sdp;
    }

    // SDP fixes based on Boosteroid's real negotiation:
    //   1) the server strips the Opus stereo params
    //   2) the answer has no fmtp for AV1
    //   3) the client offer lists H264 before AV1
    function enhanceSdpFromRealData(sdp, direction) {
        const newline = sdp.includes('\r\n') ? '\r\n' : '\n';

        // 1) Audio: restore stereo + high bitrate
        sdp = sdp.replace(
            /a=fmtp:111 ([^\r\n]*)/g,
            (match, params) => {
                let p = params;
                if (!p.includes('stereo=')) p += ';stereo=1';
                if (!p.includes('sprop-stereo=')) p += ';sprop-stereo=1';
                if (!p.includes('maxaveragebitrate=')) p += ';maxaveragebitrate=510000';
                if (!p.includes('maxplaybackrate=')) p += ';maxplaybackrate=48000';
                return `a=fmtp:111 ${p}`;
            }
        );

        // 2) AV1: inject fmtp when the answer lacks it (decoder defaults may cap resolution or framerate)
        if (sdp.includes('a=rtpmap:45 AV1') && !sdp.includes('a=fmtp:45 ')) {
            sdp = sdp.replace(
                /(a=rtpmap:45 AV1\/90000)/g,
                `$1${newline}a=fmtp:45 level-idx=13;profile=0;tier=0`
            );
        }

        // 3) Offer: put AV1 first, only when the hardware really decodes it
        if (direction === 'offer' && SmartCodecSelector.hardware?.['video/AV1']) {
            sdp = sdp.replace(
                /(m=video \d+ [A-Z/]+ )(\d[\d ]*)/g,
                (match, prefix, payloads) => {
                    const pts = payloads.trim().split(/\s+/);
                    // AV1 (45) and its RTX (46) first
                    const av1 = pts.filter(p => p === '45' || p === '46');
                    const rest = pts.filter(p => p !== '45' && p !== '46');
                    if (av1.length > 0) {
                        return prefix + [...av1, ...rest].join(' ');
                    }
                    return match;
                }
            );
        }

        return sdp;
    }

    // Dev build diagnostics: open F12 and copy. Every 5 s for the first 30 s, then once a
    // minute, plus whenever the stream changes or degrades.
    const report = _realConsole.log.bind(_realConsole);
    let siteDelay = null;

    // Dev report only: highest requestAnimationFrame rate seen over one second = display refresh rate
    let displayHz = 0;
    function sampleDisplayHz() {
        if (document.visibilityState !== 'visible') return;
        let frames = 0;
        const start = performance.now();
        const tick = (now) => {
            if (now - start < 1000) { frames++; requestAnimationFrame(tick); } else displayHz = Math.max(displayHz, frames);
        };
        requestAnimationFrame(tick);
    }

    function reportStreamStats(pc) {
        pc.getStats().then((stats) => {
            let rtt = '?', v = null;
            stats.forEach((s) => {
                if (s.type === 'candidate-pair' && s.state === 'succeeded' && typeof s.currentRoundTripTime === 'number') rtt = Math.round(s.currentRoundTripTime * 1000);
                if (s.type === 'inbound-rtp' && s.kind === 'video') v = s;
            });
            if (!v) return;
            const p = pc._optPrev;
            pc._optPrev = v;
            if (!p || v.timestamp <= p.timestamp) return;

            const dt = (v.timestamp - p.timestamp) / 1000;
            const d = (key) => (v[key] || 0) - (p[key] || 0);
            const decoded = d('framesDecoded');
            const n = pc._optReports = (pc._optReports || 0) + 1;
            const changed = v.frameHeight !== p.frameHeight || Math.abs((v.framesPerSecond || 0) - (p.framesPerSecond || 0)) > 15;
            const degraded = d('framesDropped') > decoded * 0.05 || d('freezeCount') > 0 || d('packetsLost') > 50;
            // Decoding slower than the frame rate, three samples in a row: tell the user why it stutters
            const decodeMs = decoded > 0 ? d('totalDecodeTime') / decoded * 1000 : 0;
            pc._optSlowDecode = decodeMs > 1000 / Math.max(v.framesPerSecond || 60, 30) ? (pc._optSlowDecode || 0) + 1 : 0;
            if (pc._optSlowDecode === 3) showNotification(t('decoderOverloadNotif'));

            if (DEV_BUILD && n <= 3) sampleDisplayHz();

            if (!DEV_BUILD || (n > 6 && n % 12 !== 0 && !changed && !degraded)) return;

            if (n === 1) {
                report(`[Optimizer+] v${SCRIPT_VERSION} | ${ENV_PROFILE.summary()} | screen ${_realScreen.width}x${_realScreen.height}@${+_realScreen.pixelRatio.toFixed(2)} | worker ${WORKER_RENDERER ? 'on' : 'off'} | upscale ${UPSCALE ? 'on' : 'off'} | playout ${PLAYOUT_MS}ms | ${SmartCodecSelector.describe()}`);
            }
            const codec = stats.get(v.codecId)?.mimeType?.replace('video/', '') || '?';
            const hw = v.powerEfficientDecoder === undefined ? '' : (v.powerEfficientDecoder ? ' hw' : ' SOFTWARE');
            const emitted = d('jitterBufferEmittedCount');

            report(`[Optimizer+] [Stats] ${(d('bytesReceived') * 8 / dt / 1e6).toFixed(1)} Mbps` +
                ` | recv ${Math.round(d('framesReceived') / dt)} decoded ${Math.round(decoded / dt)} fps` +
                ` | ${v.frameWidth}x${v.frameHeight}` +
                ` | ${codec} ${v.decoderImplementation || '?'}${hw}` +
                ` | decode ${decoded > 0 ? decodeMs.toFixed(1) : '?'}ms` +
                ` | dropped +${d('framesDropped')}` +
                ` | lost +${d('packetsLost')} nack +${d('nackCount')}` +
                ` | freezes +${d('freezeCount')}${v.qpSum !== undefined && decoded > 0 ? ` | qp ${Math.round(d('qpSum') / decoded)}` : ''}` +
                ` | jitterBuf ${emitted > 0 ? Math.round(d('jitterBufferDelay') / emitted * 1000) : '?'}ms${siteDelay ? ` (site asked ${siteDelay})` : ''}` +
                ` | rtt ${rtt}ms | display ${displayHz || '?'}Hz` +
                ` | ${videoEnhancer.describe()}`);
        }).catch(() => {});
    }

    const StreamMonitor = {
        enabled: false,

        enable() {
            if (this.enabled) return;
            this.enabled = true;
            console.log('[Optimizer+] StreamMonitor enabled');
            this.startLoop();
        },

        disable() {
            if (!this.enabled) return;
            this.enabled = false;
            console.log('[Optimizer+] StreamMonitor disabled');
            this.stopLoop();
        },

        startLoop() {
            if (streamMonitorInterval) return;
            streamMonitorInterval = setInterval(() => {
                if (!this.enabled) return;
                activePeerConnections.forEach(pc => {
                    try {
                        if (pc.connectionState === 'closed' || pc.connectionState === 'failed' || pc.signalingState === 'closed') {
                            activePeerConnections.delete(pc);
                            return;
                        }
                        if (pc.connectionState !== 'connected') return;

                        // Periodic re-cap: covers receivers added via addEventListener('track') and mid-session resets
                        pc.getReceivers().forEach(optimizeReceiverLatency);
                        reportStreamStats(pc);
                    } catch (e) {
                    }
                });
            }, 5000);
            console.log('[Optimizer+] [OK] Stream monitor loop started');
        },

        stopLoop() {
            if (streamMonitorInterval) {
                clearInterval(streamMonitorInterval);
                streamMonitorInterval = null;
            }
        }
    };

    let _hookBitrateInstalled = false;
    function hookBitrate() {
        if (_hookBitrateInstalled) return;
        _hookBitrateInstalled = true;

        // HOOK RTCPeerConnection

        if (windowCtx.RTCPeerConnection) {
            const OriginalRTCPeerConnection = windowCtx.RTCPeerConnection;

            const createWrappedPC = function (config, constraints) {
                if (config) {
                    config.iceCandidatePoolSize = config.iceCandidatePoolSize || 10;
                    config.bundlePolicy = 'max-bundle';
                    config.rtcpMuxPolicy = 'require';
                }

                const pc = new OriginalRTCPeerConnection(config, constraints);

                activePeerConnections.add(pc);

                pc.addEventListener('connectionstatechange', () => {
                    if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
                        activePeerConnections.delete(pc);
                    }
                });

                const originalSetRemoteDescription = pc.setRemoteDescription.bind(pc);
                pc.setRemoteDescription = function (description) {
                    if (description && description.sdp) {
                        let modifiedSdp = applyBitrateSdpMunging(description.sdp);
                        modifiedSdp = enhanceSdpFromRealData(modifiedSdp, description.type);
                        const newline = modifiedSdp.includes('\r\n') ? '\r\n' : '\n';

                        // NACK + PLI + transport-cc: retransmission recovers lost packets, so congestion
                        // control does not cut the bitrate on a one-off loss
                        modifiedSdp = modifiedSdp.replace(
                            /(m=video[\s\S]*?)(?=m=|$)/g,
                            (videoSection) => {
                                const ptMatch = videoSection.match(/m=video \d+ [A-Z/]+ (\d+)/);
                                if (ptMatch) {
                                    const pt = ptMatch[1];
                                    let additions = '';
                                    if (!videoSection.includes(`a=rtcp-fb:${pt} nack${newline}`) && !videoSection.includes(`a=rtcp-fb:${pt} nack `)) {
                                        additions += `a=rtcp-fb:${pt} nack${newline}`;
                                    }
                                    if (!videoSection.includes(`a=rtcp-fb:${pt} nack pli`)) {
                                        additions += `a=rtcp-fb:${pt} nack pli${newline}`;
                                    }
                                    if (!videoSection.includes(`a=rtcp-fb:${pt} transport-cc`)) {
                                        additions += `a=rtcp-fb:${pt} transport-cc${newline}`;
                                    }
                                    if (additions) {
                                        videoSection = videoSection.replace(
                                            /(m=video[^\r\n]*(?:\r?\n))/,
                                            `$1${additions}`
                                        );
                                    }
                                }
                                return videoSection;
                            }
                        );

                        description = new RTCSessionDescription({
                            type: description.type,
                            sdp: modifiedSdp
                        });
                    }
                    return originalSetRemoteDescription(description);
                };

                const originalSetLocalDescription = pc.setLocalDescription.bind(pc);
                pc.setLocalDescription = function (description) {
                    if (description && description.sdp) {
                        description = new RTCSessionDescription({
                            type: description.type,
                            sdp: enhanceSdpFromRealData(applyBitrateSdpMunging(description.sdp), description.type)
                        });
                    }
                    return originalSetLocalDescription(description);
                };

                // Boosteroid sends the answer over WebSocket using the value returned by createAnswer(),
                // not pc.localDescription, so the returned value itself must be munged.
                const originalCreateAnswer = pc.createAnswer.bind(pc);
                pc.createAnswer = async function (...args) {
                    const answer = await originalCreateAnswer(...args);
                    if (answer && answer.sdp) {
                        // New object: RTCSessionDescription attributes are read-only
                        return { type: answer.type, sdp: enhanceSdpFromRealData(applyBitrateSdpMunging(answer.sdp, true), 'answer') };
                    }
                    return answer;
                };

                const originalAddTransceiver = pc.addTransceiver ? pc.addTransceiver.bind(pc) : null;
                if (originalAddTransceiver) {
                    pc.addTransceiver = function (trackOrKind, init) {
                        const transceiver = originalAddTransceiver(trackOrKind, init);
                        if (transceiver && transceiver.receiver) {
                            optimizeReceiverLatency(transceiver.receiver);
                        }
                        return transceiver;
                    };
                }

                const originalOntrack = Object.getOwnPropertyDescriptor(OriginalRTCPeerConnection.prototype, 'ontrack');
                if (originalOntrack && originalOntrack.set) {
                    let userOntrack = null;
                    Object.defineProperty(pc, 'ontrack', {
                        get: () => userOntrack,
                        set: (handler) => {
                            userOntrack = handler;
                            const wrapped = function (event) {
                                if (event.receiver) {
                                    optimizeReceiverLatency(event.receiver);
                                }
                                if (handler) handler.call(this, event);
                            };
                            originalOntrack.set.call(pc, handler ? wrapped : null);
                        },
                        configurable: true
                    });
                }

                // DataChannel bridge (debug only): logs Boosteroid's signalling in both directions.
                // Never installed outside optimizer_debug=1: input packets travel on these channels,
                // so any work here runs once per mouse event.
                const hookDataChannel = (ch) => {
                    try {
                        if (!ch || ch._optHooked) return;
                        ch._optHooked = true;
                        const label = ch.label || 'remote';
                        console.log(`[Optimizer+] [DC] bridge actif (${label}) — commandes serveur visibles avec localStorage optimizer_debug=1`);
                        const parsePayload = (raw) => {
                            let txt = raw;
                            if (txt instanceof ArrayBuffer) txt = new TextDecoder().decode(txt);
                            else if (ArrayBuffer.isView(txt)) return null; // binary payload
                            else txt = String(txt);
                            if (!txt || txt.length > 512) return null; // large blobs are not signalling
                            let obj = null;
                            const m = txt.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
                            if (m) { try { obj = JSON.parse(m[1]); } catch (e) { obj = null; } }
                            return { txt, obj };
                        };
                        ch.addEventListener('message', (ev) => {
                            const pkt = parsePayload(ev.data);
                            if (!pkt) return;
                            let summary = null;
                            if (pkt.obj) {
                                const o = pkt.obj;
                                const fields = [];
                                const grab = (key, unit) => { const v = o[key] ?? o[`${key}Value`]; if (v !== undefined && v !== null) fields.push(`${key}=${v}${unit || ''}`); };
                                grab('bitrate', 'kbps'); grab('bitRate', 'kbps'); grab('fps', ''); grab('resolution');
                                grab('width'); grab('height'); grab('quality'); grab('requestedQuality');
                                grab('maxBitrate', 'kbps'); grab('targetBitrate', 'kbps');
                                if (!fields.length) {
                                    const keys = Object.keys(o).slice(0, 8).join(',');
                                    fields.push(`keys={${keys}}`);
                                }
                                summary = fields.join(' ');
                            } else if (pkt.txt.trim()) {
                                summary = pkt.txt.trim().slice(0, 120);
                            }
                            if (summary && DEBUG_LOGS) console.log(`[Optimizer+] [DC] ${label} ⇐ ${summary}`);
                        });
                        const origSend = ch.send ? ch.send.bind(ch) : null;
                        if (origSend) {
                            ch.send = (data) => {
                                try {
                                    let txt = data;
                                    if (txt instanceof ArrayBuffer) txt = new TextDecoder().decode(txt);
                                    else if (ArrayBuffer.isView(txt)) txt = null;
                                    else txt = String(txt || '');
                                    if (txt && txt.length <= 512) {
                                        const m = txt.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
                                        const o = m ? (() => { try { return JSON.parse(m[1]); } catch (e) { return null; } })() : null;
                                        const keys = o ? Object.keys(o).slice(0, 8).join(',') : '';
                                        if (DEBUG_LOGS && (keys || txt.trim())) console.log(`[Optimizer+] [DC] ${label} ⇒ (clt→srv) ${keys ? `{${keys}}` : txt.slice(0, 120)}`);
                                        if (o) {
                                            const req = {};
                                            ['quality', 'requestedQuality', 'maxBitrate', 'targetBitrate', 'fps', 'resolution'].forEach(k => { if (o[k] !== undefined && o[k] !== null) req[k] = o[k]; });
                                            if (Object.keys(req).length && DEBUG_LOGS) console.log(`[Optimizer+] [DC] ${label} ⇒ requete client ${JSON.stringify(req)}`);
                                        }
                                    }
                                } catch (e) { /* never blocking */ }
                                return origSend(data);
                            };
                        }
                        const stateChange = () => {
                            if (DEBUG_LOGS && ch.readyState && ch.readyState !== 'open') {
                                console.log(`[Optimizer+] [DC] ${label} → ${ch.readyState}`);
                            }
                        };
                        ch.addEventListener('open', () => {});
                        ch.addEventListener('close', stateChange);
                        ch.addEventListener('error', stateChange);
                    } catch (e) { /* never blocking */ }
                };
                if (DEBUG_LOGS) pc.addEventListener('datachannel', (ev) => { if (ev.channel) hookDataChannel(ev.channel); });
                const origCreateDC = pc.createDataChannel ? pc.createDataChannel.bind(pc) : null;
                if (DEBUG_LOGS && origCreateDC) {
                    pc.createDataChannel = (label, init) => {
                        const ch = origCreateDC(label, init);
                        if (ch) hookDataChannel(ch);
                        return ch;
                    };
                }

                return pc;
            };

            // Proxy keeps statics, prototype, instanceof and .constructor intact
            windowCtx.RTCPeerConnection = new Proxy(OriginalRTCPeerConnection, {
                construct(target, args) {
                    return createWrappedPC(args[0], args[1]);
                }
            });

            // WebSocket bridge (debug only): logs Boosteroid's control channel
            {
                if (DEBUG_LOGS && !windowCtx._optWsHooked) {
                    windowCtx._optWsHooked = true;
                    const OriginalWebSocket = windowCtx.WebSocket;
                    if (OriginalWebSocket && typeof OriginalWebSocket === 'function') {
                        const WsBridge = function (url, protocols) {
                            const ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
                            try {
                                ws.addEventListener('open', () => {
                                    const u = String(url || '').replace(/^(wss?:\/\/)/, '').slice(0, 60);
                                    if (!ws._optAnnounced) {
                                        ws._optAnnounced = true;
                                        console.log(`[Optimizer+] [WS] contrôle actif (${u}) — commandes serveur visibles avec localStorage optimizer_debug=1`);
                                    }
                                });
                                ws.addEventListener('message', (ev) => {
                                    let txt = ev.data;
                                    if (txt instanceof ArrayBuffer) txt = new TextDecoder().decode(txt);
                                    else if (ArrayBuffer.isView(txt)) return;
                                    else txt = String(txt || '');
                                    if (!txt || txt.length > 512) return;
                                    const m = txt.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
                                    if (!m) { if (DEBUG_LOGS) console.log(`[Optimizer+] [WS] ${txt.slice(0, 120)}`); return; }
                                    try {
                                        const o = JSON.parse(m[1]);
                                        if (DEBUG_LOGS) {
                                            const keys = Object.keys(o).slice(0, 10).join(',');
                                            const vals = Object.keys(o).slice(0, 6).map(k => `${k}=${JSON.stringify(o[k]).slice(0, 30)}`).join(' ');
                                            console.log(`[Optimizer+] [WS] ⇐ {${keys}} ${vals}`);
                                        }
                                    } catch (e) { /* not JSON */ }
                                });
                                // Proves the munged answer really leaves the client
                                const origWsSend = ws.send.bind(ws);
                                ws.send = (data) => {
                                    try {
                                        let txt = data;
                                        if (txt instanceof ArrayBuffer) txt = new TextDecoder().decode(txt);
                                        else if (ArrayBuffer.isView(txt)) txt = null;
                                        else txt = String(txt || '');
                                        if (txt && txt.length <= 512) {
                                            if (DEBUG_LOGS && /sdp|message|answer|offer|convertt|video|quality/i.test(txt)) {
                                                console.log(`[Optimizer+] [WS] ⇒ (envoyé) ${txt.slice(0, 200)}`);
                                            }
                                            if (/b=AS|b=TIAS|x-google-min/i.test(txt)) {
                                                console.log('[Optimizer+] [WS] ⇒ *** ANSWER MUNGÉE DÉTECTÉE DANS L\'ENVOI (b=AS retenu) — munging quitte le client ✓ ***');
                                            }
                                        }
                                    } catch (e) { /* never blocking */ }
                                    return origWsSend(data);
                                };
                            } catch (e) { /* never blocking */ }
                            return ws;
                        };
                        WsBridge.prototype = OriginalWebSocket.prototype;
                        ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(k => { if (k in OriginalWebSocket) WsBridge[k] = OriginalWebSocket[k]; });
                        windowCtx.WebSocket = WsBridge;
                        console.log('[Optimizer+] Hook WebSocket installé');
                    }
                }
            }
            console.log('[Optimizer+] Hook RTCPeerConnection installé');
        }

    }

    // HOOK PERFORMANCE

    function hookPerformance() {
        // AudioContext latency
        const OriginalAudioContext = windowCtx.AudioContext || windowCtx.webkitAudioContext;
        if (OriginalAudioContext) {
            const WrappedAudioContext = new Proxy(OriginalAudioContext, {
                construct(target, args) {
                    let opt = args[0] || {};
                    if (typeof opt === 'object') {
                        opt.latencyHint = 'interactive';
                    }
                    return new target(opt);
                }
            });
            windowCtx.AudioContext = WrappedAudioContext;
            if (windowCtx.webkitAudioContext) windowCtx.webkitAudioContext = WrappedAudioContext;
            console.log('[Optimizer+] AudioContext latency optimization active (latencyHint: interactive)');
        }

        console.log('[Optimizer+] Hooks performance install\u00E9s');
    }

    // VIDEO ENHANCER - Filter presets

    const FILTER_PRESETS = {
        'default': {
            nameKey: 'presetDefault',
            get name() { return t(this.nameKey); },
            enhancer: { sharpness: 0.45, contrast: 1.04, saturation: 1.01, brightness: 1.0 },
            filters: {
                usm: { enabled: true, amount: 0.35, radius: 0.9, threshold: 0.04 },
                cas: { enabled: true, sharpness: 0.45 },
                clarity: { enabled: false, amount: 0.2 },
                denoise: { enabled: false, strength: 0.2 },
                vibrance: { enabled: false, amount: 0.15 },
                gamma: { enabled: false, value: 1.0 },
                exposure: { enabled: false, value: 0 },
                deband: { enabled: false, strength: 0.3 }
            }
        },
        'cinematic': {
            nameKey: 'presetCinematic',
            get name() { return t(this.nameKey); },
            enhancer: { sharpness: 0.35, contrast: 1.08, saturation: 0.95, brightness: 0.98 },
            filters: {
                usm: { enabled: true, amount: 0.3, radius: 1.2, threshold: 0.06 },
                cas: { enabled: true, sharpness: 0.35 },
                clarity: { enabled: true, amount: 0.25 },
                denoise: { enabled: false, strength: 0.15 },
                vibrance: { enabled: false, amount: 0.1 },
                gamma: { enabled: true, value: 0.95 },
                exposure: { enabled: false, value: -0.05 },
                deband: { enabled: true, strength: 0.2 }
            }
        },
        'game': {
            nameKey: 'presetGame',
            get name() { return t(this.nameKey); },
            enhancer: { sharpness: 0.45, contrast: 1.06, saturation: 1.01, brightness: 1.02 },
            filters: {
                usm: { enabled: true, amount: 0.35, radius: 0.5, threshold: 0.03 },
                cas: { enabled: true, sharpness: 0.45 },
                clarity: { enabled: false, amount: 0 },
                denoise: { enabled: false, strength: 0.12 },
                vibrance: { enabled: true, amount: 0.15 },
                gamma: { enabled: true, value: 1.03 },
                exposure: { enabled: false, value: 0 },
                deband: { enabled: false, strength: 0.3 }
            }
        },
        'comfort': {
            // Comfort preset: reduces eye strain in long sessions
            nameKey: 'presetComfort',
            get name() { return t(this.nameKey); },
            enhancer: { sharpness: 0.25, contrast: 0.98, saturation: 0.95, brightness: 1.02 },
            filters: {
                usm: { enabled: true, amount: 0.15, radius: 1.2, threshold: 0.08 },
                cas: { enabled: true, sharpness: 0.30 },
                clarity: { enabled: false, amount: 0 },
                denoise: { enabled: true, strength: 0.25 },
                vibrance: { enabled: false, amount: 0 },
                gamma: { enabled: true, value: 1.15 },
                exposure: { enabled: true, value: 0.1 },
                deband: { enabled: true, strength: 0.3 }
            }
        },
        // Perfect quality preset: no visible artifacts
        'perfect': {
            nameKey: 'presetPerfect',
            get name() { return t(this.nameKey); },
            enhancer: { sharpness: 0.45, contrast: 1.02, saturation: 1.0, brightness: 1.0 },
            filters: {
                usm: { enabled: true, amount: 0.3, radius: 1.1, threshold: 0.05 },
                cas: { enabled: true, sharpness: 0.4 },
                clarity: { enabled: false, amount: 0 },
                denoise: { enabled: false, strength: 0 },
                vibrance: { enabled: false, amount: 0 },
                gamma: { enabled: false, value: 1.0 },
                exposure: { enabled: false, value: 0 },
                deband: { enabled: true, strength: 0.15 }
            },
        },

        'custom': {
            nameKey: 'presetCustom',
            get name() { return t(this.nameKey); },
            enhancer: null,
            filters: null
        }
    };

    // WebGPU SHADER ENGINE — Zero-Copy Pipeline
    // GPU pipeline via importExternalTexture() (Chrome/Edge 113+), WebGL2 fallback elsewhere

    const WGSL_SHADER = `
struct Uniforms {
    resolution: vec2f,
    contrast: f32,
    saturation: f32,
    brightness: f32,
    gamma: f32,
    exposure: f32,
    vibrance: f32,
    sharpness: f32,
    denoise: f32,
    clarity: f32,
    deband: f32,
    enhancerEnabled: f32,
    filtersEnabled: f32,
    upscale: f32,
    time: f32,
    qualityMode: f32,
    performanceMode: f32,
    _p0: f32,
    _p1: f32,
    _p2: f32,
};

@group(0) @binding(0) var videoSampler: sampler;
@group(0) @binding(1) var videoTexture: texture_external;
@group(0) @binding(2) var<uniform> u: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) texCoord: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
    var pos = array<vec2f, 6>(
        vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
        vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
    );
    var uv = array<vec2f, 6>(
        vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
        vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0),
    );
    var out: VertexOutput;
    out.position = vec4f(pos[vi], 0.0, 1.0);
    out.texCoord = uv[vi];
    return out;
}

fn adjustContrast(color: vec3f, c: f32) -> vec3f {
    return mix(vec3f(0.5), color, c);
}

fn adjustVibrance(color: vec3f, v: f32) -> vec3f {
    let lum = dot(color, vec3f(0.2126, 0.7152, 0.0722));
    let maxC = max(color.r, max(color.g, color.b));
    let minC = min(color.r, min(color.g, color.b));
    let sat = maxC - minC;
    let boost = v * (1.0 - sat) * 0.35;
    return mix(vec3f(lum), color, 1.0 + boost);
}

// Exposure, brightness and saturation run in linear light; contrast and gamma stay perceptual.
fn toLinear(c: vec3f) -> vec3f { return pow(max(c, vec3f(0.0)), vec3f(2.2)); }
fn toGamma(c: vec3f) -> vec3f { return pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.2)); }

// CAS (AMD FidelityFX). 5 taps; 9 taps when qualityMode = 1.
fn sharpen(uv: vec2f, res: vec2f, amount: f32) -> vec3f {
    let px = vec2f(1.0) / res;
    let b = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(0.0, -px.y)).rgb;
    let d = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(-px.x, 0.0)).rgb;
    let e = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv).rgb;
    let f = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(px.x, 0.0)).rgb;
    let h = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(0.0, px.y)).rgb;

    var mnRGB = min(min(min(d, e), min(f, b)), h);
    var mxRGB = max(max(max(d, e), max(f, b)), h);

    if (u.qualityMode > 0.5) {
        let a = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(-px.x, -px.y)).rgb;
        let c = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(px.x, -px.y)).rgb;
        let g = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(-px.x, px.y)).rgb;
        let i = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(px.x, px.y)).rgb;
        mnRGB = min(mnRGB, min(min(a, c), min(g, i)));
        mxRGB = max(mxRGB, max(max(a, c), max(g, i)));
    }

    let peak = 5.6;
    let rcpMx = vec3f(1.0) / (mxRGB + vec3f(0.0001));
    let ampRGB = clamp(min(mnRGB, vec3f(2.0) - mxRGB) * rcpMx, vec3f(0.0), vec3f(1.0));
    let w = vec3f(-1.0) / (inverseSqrt(ampRGB + vec3f(0.000001)) * peak + vec3f(0.0001));
    let rcpW = vec3f(1.0) / (4.0 * w + vec3f(1.0));
    let window = b + d + f + h;
    return clamp((window * w + e) * rcpW, vec3f(0.0), vec3f(1.0));
}

fn fastDenoise(uv: vec2f, res: vec2f, strength: f32) -> vec3f {
    let px = vec2f(1.0) / res;
    let center = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv).rgb;
    
    let left = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(-1.0, 0.0) * px).rgb;
    let right = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(1.0, 0.0) * px).rgb;
    let top = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(0.0, -1.0) * px).rgb;
    let bottom = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(0.0, 1.0) * px).rgb;
    
    let denoised = (center * 0.4 + left * 0.15 + right * 0.15 + top * 0.15 + bottom * 0.15);
    return mix(center, denoised, strength * 0.8);
}

fn bilateralDenoise(uv: vec2f, res: vec2f, strength: f32) -> vec3f {
    let px = vec2f(1.0) / res;
    let center = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv).rgb;
    
    var sum = center;
    var wSum = 1.0;
    
    let lCenter = dot(center, vec3f(0.299, 0.587, 0.114));
    let sigmaColor = 0.04 + strength * 0.04;
    
    let offsets = array<vec2f, 8>(
        vec2f(-2.0, 0.0), vec2f(2.0, 0.0),
        vec2f(0.0, -2.0), vec2f(0.0, 2.0),
        vec2f(-1.0, -1.0), vec2f(1.0, -1.0),
        vec2f(-1.0, 1.0), vec2f(1.0, 1.0)
    );
    
    for (var i = 0; i < 8; i++) {
        let s = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + offsets[i] * px).rgb;
        let lS = dot(s, vec3f(0.299, 0.587, 0.114));
        let lumDist = abs(lS - lCenter);
        let colorDist = length(s - center);
        let w = exp(-colorDist * colorDist / (2.0 * sigmaColor * sigmaColor)) * 
                  exp(-lumDist * lumDist / 0.02);
        sum += s * w;
        wSum += w;
    }
    
    let denoised = sum / wSum;
    return mix(center, denoised, strength);
}

fn clarityPass(uv: vec2f, res: vec2f, amount: f32, centerColor: vec3f) -> vec3f {
    let px = vec2f(1.0) / res;
    var blur = centerColor;
    blur += textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(-2.0, -2.0) * px).rgb;
    blur += textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(2.0, -2.0) * px).rgb;
    blur += textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(-2.0, 2.0) * px).rgb;
    blur += textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(2.0, 2.0) * px).rgb;
    blur += textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(0.0, -2.0) * px).rgb;
    blur += textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(0.0, 2.0) * px).rgb;
    blur += textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(-2.0, 0.0) * px).rgb;
    blur += textureSampleBaseClampToEdge(videoTexture, videoSampler, uv + vec2f(2.0, 0.0) * px).rgb;
    blur /= 9.0;

    let highpass = centerColor - blur;
    let result = centerColor + highpass * (amount * 2.5);
    return clamp(result, vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
    var color = textureSampleBaseClampToEdge(videoTexture, videoSampler, input.texCoord).rgb;
    // Stream larger than the canvas: four taps cover the footprint a single one would skip
    if (u.upscale < -0.5) {
        let o = vec2f(0.25) / u.resolution;
        color = (textureSampleBaseClampToEdge(videoTexture, videoSampler, input.texCoord + vec2f(-o.x, -o.y)).rgb
            + textureSampleBaseClampToEdge(videoTexture, videoSampler, input.texCoord + vec2f(o.x, -o.y)).rgb
            + textureSampleBaseClampToEdge(videoTexture, videoSampler, input.texCoord + vec2f(-o.x, o.y)).rgb
            + textureSampleBaseClampToEdge(videoTexture, videoSampler, input.texCoord + vec2f(o.x, o.y)).rgb) * 0.25;
    }

    if (u.enhancerEnabled < 0.5 && u.filtersEnabled < 0.5) {
        return vec4f(color, 1.0);
    }

    if (u.filtersEnabled > 0.5) {
        if (u.denoise > 0.01) {
            if (u.performanceMode > 0.5) {
                color = fastDenoise(input.texCoord, u.resolution, u.denoise);
            } else {
                color = bilateralDenoise(input.texCoord, u.resolution, u.denoise);
            }
        }
        if (u.clarity > 0.01 && u.performanceMode < 0.5) {
            color = clarityPass(input.texCoord, u.resolution, u.clarity, color);
        }
    }
    // Sharpen: always applied additively (CAS on current pixel vs neighbors)
    if ((u.filtersEnabled > 0.5 || u.enhancerEnabled > 0.5) && u.sharpness > 0.01 && u.upscale < 0.5) {
        let sharp = sharpen(input.texCoord, u.resolution, u.sharpness);
        color = mix(color, sharp, u.sharpness);
    }

    if (u.enhancerEnabled > 0.5) {
        if (abs(u.exposure) > 0.001 || abs(u.brightness - 1.0) > 0.001 || abs(u.saturation - 1.0) > 0.001) {
            var lin = toLinear(color);
            if (abs(u.exposure) > 0.001) {
                lin = lin * pow(2.0, u.exposure * 0.5);
            }
            if (abs(u.brightness - 1.0) > 0.001) {
                lin = lin * u.brightness;
            }
            if (abs(u.saturation - 1.0) > 0.001) {
                let lLum = dot(lin, vec3f(0.2126, 0.7152, 0.0722));
                lin = mix(vec3f(lLum), lin, u.saturation);
            }
            color = toGamma(max(lin, vec3f(0.0)));
        }
        if (abs(u.gamma - 1.0) > 0.001) {
            color = pow(max(color, vec3f(0.0)), vec3f(1.0 / u.gamma));
        }
        if (abs(u.contrast - 1.0) > 0.001) {
            color = adjustContrast(color, u.contrast);
        }
    }

    // --- Vibrance (selective saturation) ---
    if (u.filtersEnabled > 0.5 && abs(u.vibrance) > 0.01) {
        color = adjustVibrance(color, u.vibrance);
    }

    // Deband: smooth flat areas only (the banding), plus a stable ~1 LSB dither.
    if (u.filtersEnabled > 0.5 && u.deband > 0.01) {
        let dpx = vec2f(1.0) / u.resolution;
        let n1 = textureSampleBaseClampToEdge(videoTexture, videoSampler, input.texCoord + vec2f(2.0 * dpx.x, 0.0)).rgb;
        let n2 = textureSampleBaseClampToEdge(videoTexture, videoSampler, input.texCoord + vec2f(-2.0 * dpx.x, 0.0)).rgb;
        let n3 = textureSampleBaseClampToEdge(videoTexture, videoSampler, input.texCoord + vec2f(0.0, 2.0 * dpx.y)).rgb;
        let n4 = textureSampleBaseClampToEdge(videoTexture, videoSampler, input.texCoord + vec2f(0.0, -2.0 * dpx.y)).rgb;
        let avg = (n1 + n2 + n3 + n4) * 0.25;
        let dd = abs(color - avg);
        let md = max(dd.r, max(dd.g, dd.b));
        let flat = 1.0 - smoothstep(0.0, 0.025, md);
        color = mix(color, avg, flat * u.deband);
        let dither = fract(sin(dot(input.texCoord * u.resolution, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
        color += vec3f(dither * u.deband * 0.012);
    }

    return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

    // WebGL2 FALLBACK — GLSL ES 3.0 shaders (Firefox, Safari, Chrome < 113)

    const VERTEX_SHADER = `#version 300 es
    in vec2 a_position;
    in vec2 a_texCoord;
    out vec2 v_texCoord;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
    }`;

    const FRAGMENT_SHADER = `#version 300 es
    precision highp float;
    in vec2 v_texCoord;
    out vec4 fragColor;

    uniform sampler2D u_video;
    uniform vec2 u_resolution;

    uniform float u_contrast;
    uniform float u_saturation;
    uniform float u_brightness;
    uniform float u_gamma;
    uniform float u_exposure;
    uniform float u_vibrance;
    uniform float u_sharpness;
    uniform float u_denoise;
    uniform float u_clarity;
    uniform float u_deband;

    uniform float u_enhancerEnabled;
    uniform float u_filtersEnabled;
    uniform float u_qualityMode;
    uniform float u_performanceMode;

    vec3 adjustContrast(vec3 color, float c) {
        return mix(vec3(0.5), color, c);
    }

    vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
    vec3 toGamma(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }

    vec3 adjustVibrance(vec3 color, float v) {
        float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
        float maxC = max(color.r, max(color.g, color.b));
        float minC = min(color.r, min(color.g, color.b));
        float sat = maxC - minC;
        float boost = v * (1.0 - sat) * 0.35;
        return mix(vec3(lum), color, 1.0 + boost);
    }

    vec3 sharpen(sampler2D tex, vec2 uv, vec2 res, float amount) {
        vec2 px = vec2(1.0) / res;
        vec3 b = texture(tex, uv + vec2(0.0, -px.y)).rgb;
        vec3 d = texture(tex, uv + vec2(-px.x, 0.0)).rgb;
        vec3 e = texture(tex, uv).rgb;
        vec3 f = texture(tex, uv + vec2(px.x, 0.0)).rgb;
        vec3 h = texture(tex, uv + vec2(0.0, px.y)).rgb;

        vec3 mnRGB = min(min(min(d, e), min(f, b)), h);
        vec3 mxRGB = max(max(max(d, e), max(f, b)), h);

        if (u_qualityMode > 0.5) {
            vec3 a = texture(tex, uv + vec2(-px.x, -px.y)).rgb;
            vec3 c = texture(tex, uv + vec2(px.x, -px.y)).rgb;
            vec3 g = texture(tex, uv + vec2(-px.x, px.y)).rgb;
            vec3 i = texture(tex, uv + vec2(px.x, px.y)).rgb;
            mnRGB = min(mnRGB, min(min(a, c), min(g, i)));
            mxRGB = max(mxRGB, max(max(a, c), max(g, i)));
        }

        float peak = 5.6;
        vec3 rcpMx = vec3(1.0) / (mxRGB + vec3(0.0001));
        vec3 ampRGB = clamp(min(mnRGB, vec3(1.0) * 2.0 - mxRGB) * rcpMx, 0.0, 1.0);
        vec3 w = vec3(-1.0) / (inversesqrt(ampRGB + vec3(0.000001)) * peak + vec3(0.0001));
        vec3 rcpW = vec3(1.0) / (4.0 * w + vec3(1.0));
        vec3 window = b + d + f + h;
        return clamp((window * w + e) * rcpW, 0.0, 1.0);
    }

    vec3 fastDenoise(sampler2D tex, vec2 uv, vec2 res, float strength) {
        vec2 px = vec2(1.0) / res;
        vec3 center = texture(tex, uv).rgb;
        
        vec3 left = texture(tex, uv + vec2(-1.0, 0.0) * px).rgb;
        vec3 right = texture(tex, uv + vec2(1.0, 0.0) * px).rgb;
        vec3 top = texture(tex, uv + vec2(0.0, -1.0) * px).rgb;
        vec3 bottom = texture(tex, uv + vec2(0.0, 1.0) * px).rgb;
        
        vec3 denoised = (center * 0.4 + left * 0.15 + right * 0.15 + top * 0.15 + bottom * 0.15);
        return mix(center, denoised, strength * 0.8);
    }
    
    vec3 bilateralDenoise(sampler2D tex, vec2 uv, vec2 res, float strength) {
        vec2 px = vec2(1.0) / res;
        vec3 center = texture(tex, uv).rgb;
        
        vec3 sum = center;
        float wSum = 1.0;
        
        float lCenter = dot(center, vec3(0.299, 0.587, 0.114));
        float sigmaColor = 0.04 + strength * 0.04;
        
        vec2 offsets[8];
        offsets[0] = vec2(-2.0, 0.0);
        offsets[1] = vec2(2.0, 0.0);
        offsets[2] = vec2(0.0, -2.0);
        offsets[3] = vec2(0.0, 2.0);
        offsets[4] = vec2(-1.0, -1.0);
        offsets[5] = vec2(1.0, -1.0);
        offsets[6] = vec2(-1.0, 1.0);
        offsets[7] = vec2(1.0, 1.0);
        
        for (int i = 0; i < 8; i++) {
            vec3 s = texture(tex, uv + offsets[i] * px).rgb;
            float lS = dot(s, vec3(0.299, 0.587, 0.114));
            float lumDist = abs(lS - lCenter);
            float colorDist = length(s - center);
            float w = exp(-colorDist * colorDist / (2.0 * sigmaColor * sigmaColor)) * 
                      exp(-lumDist * lumDist / 0.02);
            sum += s * w;
            wSum += w;
        }
        vec3 denoised = sum / wSum;
        return mix(center, denoised, strength);
    }

    vec3 clarityPass(sampler2D tex, vec2 uv, vec2 res, float amount, vec3 centerColor) {
        vec2 px = vec2(1.0) / res;
        vec3 blur = centerColor;
        blur += texture(tex, uv + vec2(-2.0, -2.0) * px).rgb;
        blur += texture(tex, uv + vec2(2.0, -2.0) * px).rgb;
        blur += texture(tex, uv + vec2(-2.0, 2.0) * px).rgb;
        blur += texture(tex, uv + vec2(2.0, 2.0) * px).rgb;
        blur += texture(tex, uv + vec2(0.0, -2.0) * px).rgb;
        blur += texture(tex, uv + vec2(0.0, 2.0) * px).rgb;
        blur += texture(tex, uv + vec2(-2.0, 0.0) * px).rgb;
        blur += texture(tex, uv + vec2(2.0, 0.0) * px).rgb;
        blur /= 9.0;

        vec3 highpass = centerColor - blur;
        vec3 result = centerColor + highpass * (amount * 2.5);
        return clamp(result, 0.0, 1.0);
    }

    void main() {
        vec3 color = texture(u_video, v_texCoord).rgb;

        if (u_enhancerEnabled < 0.5 && u_filtersEnabled < 0.5) {
            fragColor = vec4(color, 1.0);
            return;
        }

        // Performance mode: fast denoise, skip clarity
        if (u_filtersEnabled > 0.5) {
            if (u_denoise > 0.01) {
                if (u_performanceMode > 0.5) {
                    color = fastDenoise(u_video, v_texCoord, u_resolution, u_denoise);
                } else {
                    color = bilateralDenoise(u_video, v_texCoord, u_resolution, u_denoise);
                }
            }
            if (u_clarity > 0.01 && u_performanceMode < 0.5) {
                color = clarityPass(u_video, v_texCoord, u_resolution, u_clarity, color);
            }
        }
        // Sharpen: always applied additively (CAS on current pixel vs neighbors)
        if ((u_filtersEnabled > 0.5 || u_enhancerEnabled > 0.5) && u_sharpness > 0.01) {
            vec3 sharp = sharpen(u_video, v_texCoord, u_resolution, u_sharpness);
            color = mix(color, sharp, u_sharpness);
        }

        if (u_enhancerEnabled > 0.5) {
            if (abs(u_exposure) > 0.001 || abs(u_brightness - 1.0) > 0.001 || abs(u_saturation - 1.0) > 0.001) {
                vec3 lin = toLinear(color);
                if (abs(u_exposure) > 0.001) {
                    lin *= pow(2.0, u_exposure * 0.5);
                }
                if (abs(u_brightness - 1.0) > 0.001) {
                    lin *= u_brightness;
                }
                if (abs(u_saturation - 1.0) > 0.001) {
                    float lLum = dot(lin, vec3(0.2126, 0.7152, 0.0722));
                    lin = mix(vec3(lLum), lin, u_saturation);
                }
                color = toGamma(max(lin, vec3(0.0)));
            }
            if (abs(u_gamma - 1.0) > 0.001) {
                color = pow(max(color, vec3(0.0)), vec3(1.0 / u_gamma));
            }
            if (abs(u_contrast - 1.0) > 0.001) {
                color = adjustContrast(color, u_contrast);
            }
        }

        // --- Vibrance (selective saturation) ---
        if (u_filtersEnabled > 0.5 && abs(u_vibrance) > 0.01) {
            color = adjustVibrance(color, u_vibrance);
        }

        if (u_filtersEnabled > 0.5 && u_deband > 0.01) {
            vec2 dpx = vec2(1.0) / u_resolution;
            vec3 n1 = texture(u_video, v_texCoord + vec2(2.0 * dpx.x, 0.0)).rgb;
            vec3 n2 = texture(u_video, v_texCoord + vec2(-2.0 * dpx.x, 0.0)).rgb;
            vec3 n3 = texture(u_video, v_texCoord + vec2(0.0, 2.0 * dpx.y)).rgb;
            vec3 n4 = texture(u_video, v_texCoord + vec2(0.0, -2.0 * dpx.y)).rgb;
            vec3 avg = (n1 + n2 + n3 + n4) * 0.25;
            vec3 dd = abs(color - avg);
            float md = max(dd.r, max(dd.g, dd.b));
            float flatness = 1.0 - smoothstep(0.0, 0.025, md);
            color = mix(color, avg, flatness * u_deband);
            float dither = fract(sin(dot(v_texCoord * u_resolution, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
            color += vec3(dither * u_deband * 0.012);
        }

        fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }`;

    // WebGLVideoRenderer — WebGL2 fallback (same API as WebGPUVideoRenderer)
    class WebGLVideoRenderer {
        constructor() {
            this.canvas = null;
            this.gl = null;
            this.program = null;
            this.texture = null;
            this.videoElement = null;
            this.animationId = null;
            this.uniforms = {};
            this.isActive = false;
            this._attached = false;
            this._lastConfig = null;
            this._lastVideoTime = 0;
            this._useRVFC = typeof HTMLVideoElement !== 'undefined' &&
                            'requestVideoFrameCallback' in HTMLVideoElement.prototype;
        }

        init(videoElement) {
            if (!videoElement || this._attached) return false;
            this.videoElement = videoElement;

            this.canvas = document.createElement('canvas');
            this.canvas.id = 'optimizer-webgl-canvas';
            this.canvas.style.cssText = `
                position: absolute; top: 0; left: 0;
                width: 100%; height: 100%;
                pointer-events: none;
                object-fit: contain;
                will-change: transform;
                contain: strict;
            `;

            const parent = videoElement.parentElement;
            if (parent) {
                parent.style.position = parent.style.position || 'relative';
                parent.insertBefore(this.canvas, videoElement.nextSibling);
            }

            this.gl = this.canvas.getContext('webgl2', {
                alpha: false,
                antialias: false,
                premultipliedAlpha: false,
                preserveDrawingBuffer: false,
                powerPreference: 'high-performance',
                // Bypasses the compositor queue where supported
                desynchronized: true
            });

            if (!this.gl) {
                console.warn('[Optimizer+] WebGL2 unavailable');
                return false;
            }

            this.canvas.addEventListener('webglcontextlost', (e) => {
                e.preventDefault();
                console.warn('[Optimizer+] WebGL context lost');
                this.stopRenderLoop();
                if (this.videoElement) this.videoElement.style.opacity = '1';
                if (this.canvas) this.canvas.style.display = 'none';
            }, false);

            this.canvas.addEventListener('webglcontextrestored', () => {
                console.log('[Optimizer+] WebGL context restored');
                if (this._initShaders()) {
                    this._initGeometry();
                    this._initTexture();
                    if (this._lastConfig) this.updateUniforms(this._lastConfig);
                    this.startRenderLoop();
                }
            }, false);

            if (!this._initShaders()) {
                console.error('[Optimizer+] WebGL2 shader initialization failed');
                this.destroy();
                return false;
            }
            this._initGeometry();
            this._initTexture();
            this._attached = true;

            console.log('[Optimizer+] WebGL2 fallback pipeline initialized');
            return true;
        }

        _initShaders() {
            const gl = this.gl;
            const vs = this._compile(gl.VERTEX_SHADER, VERTEX_SHADER);
            const fs = this._compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
            if (!vs || !fs) return false;

            this.program = gl.createProgram();
            gl.attachShader(this.program, vs);
            gl.attachShader(this.program, fs);
            gl.linkProgram(this.program);

            if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
                console.error('[Optimizer+] Shader link error:', gl.getProgramInfoLog(this.program));
                return false;
            }

            gl.useProgram(this.program);

            const names = [
                'u_video', 'u_resolution',
                'u_contrast', 'u_saturation', 'u_brightness',
                'u_gamma', 'u_exposure', 'u_vibrance',
                'u_sharpness', 'u_denoise', 'u_clarity', 'u_deband',
                'u_enhancerEnabled', 'u_filtersEnabled', 'u_qualityMode', 'u_performanceMode'
            ];
            for (const n of names) {
                this.uniforms[n] = gl.getUniformLocation(this.program, n);
            }
            return true;
        }

        _compile(type, source) {
            const gl = this.gl;
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error('[Optimizer+] Shader compile error:', gl.getShaderInfoLog(shader));
                return null;
            }
            return shader;
        }

        _initGeometry() {
            const gl = this.gl;
            const verts = new Float32Array([
                -1, -1,  0, 1,
                 1, -1,  1, 1,
                -1,  1,  0, 0,
                 1,  1,  1, 0,
            ]);
            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

            const aPos = gl.getAttribLocation(this.program, 'a_position');
            const aTex = gl.getAttribLocation(this.program, 'a_texCoord');
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
            gl.enableVertexAttribArray(aTex);
            gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 16, 8);
        }

        _initTexture() {
            const gl = this.gl;
            this.texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.texture);

            // Avoid the browser's own colour conversion on upload
            gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        }

        updateUniforms(config) {
            this._lastConfig = config;
            const gl = this.gl;
            if (!gl || !this.program || gl.isContextLost()) return;

            gl.useProgram(this.program);

            const e = config.enhancer;
            const f = config.filters;

            const wasActive = this.isActive;
            this.isActive = e.enabled || f.enabled;
            if (this.canvas) {
                const targetDisplay = this.isActive ? 'block' : 'none';
                if (this.canvas.style.display !== targetDisplay) {
                    this.canvas.style.display = targetDisplay;
                }
            }
            if (!this.isActive && this.videoElement) {
                this.videoElement.style.opacity = '1';
            }
            if (this.isActive && !wasActive && !this.animationId) {
                this.startRenderLoop();
            }

            gl.uniform1f(this.uniforms.u_enhancerEnabled, e.enabled ? 1.0 : 0.0);
            gl.uniform1f(this.uniforms.u_filtersEnabled, f.enabled ? 1.0 : 0.0);
            gl.uniform1f(this.uniforms.u_contrast, e.contrast || 1.0);
            gl.uniform1f(this.uniforms.u_saturation, e.saturation || 1.0);
            gl.uniform1f(this.uniforms.u_brightness, e.brightness || 1.0);
            // Sharpness: combine enhancer base slider + CAS/USM advanced filters
            const casUsm = f.enabled ? ((f.cas?.enabled ? f.cas.sharpness : 0) + (f.usm?.enabled ? f.usm.amount : 0)) : 0;
            const baseSharp = e.enabled ? (e.sharpness || 0) : 0;
            // Clamp to [0,1]: used as a mix() factor, >1 overshoots into halos
            gl.uniform1f(this.uniforms.u_sharpness, Math.min(1.0, casUsm + baseSharp));
            gl.uniform1f(this.uniforms.u_gamma, f.gamma?.enabled ? f.gamma.value : 1.0);
            gl.uniform1f(this.uniforms.u_exposure, f.exposure?.enabled ? f.exposure.value : 0.0);
            gl.uniform1f(this.uniforms.u_vibrance, f.vibrance?.enabled ? f.vibrance.amount : 0.0);
            gl.uniform1f(this.uniforms.u_denoise, f.denoise?.enabled ? f.denoise.strength : 0.0);
            gl.uniform1f(this.uniforms.u_clarity, f.clarity?.enabled ? f.clarity.amount : 0.0);
            gl.uniform1f(this.uniforms.u_deband, f.deband?.enabled ? (f.deband.strength || 0.3) : 0.0);
            gl.uniform1f(this.uniforms.u_qualityMode, ENV_PROFILE.isHighEnd ? 1.0 : 0.0);
            gl.uniform1f(this.uniforms.u_performanceMode, f.performanceMode ? 1.0 : 0.0);
        }

        render() {
            if (!this.isActive) return;
            const gl = this.gl;
            const video = this.videoElement;
            if (!gl || !video || video.readyState < 2 || gl.isContextLost()) return;

            if (!this._useRVFC) {
                if (video.currentTime === this._lastVideoTime) return;
                this._lastVideoTime = video.currentTime;
            }

            const texW = video.videoWidth || 1920;
            const texH = video.videoHeight || 1080;
            if (!texW || !texH) return;

            if (this.canvas.width !== texW || this.canvas.height !== texH) {
                this.canvas.width = texW;
                this.canvas.height = texH;
                gl.viewport(0, 0, texW, texH);
                gl.useProgram(this.program);
                gl.uniform2f(this.uniforms.u_resolution, texW, texH);
            }

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
            gl.uniform1i(this.uniforms.u_video, 0);

            if (video.style.opacity !== '0.01') {
                video.style.opacity = '0.01';
            }

            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        startRenderLoop() {
            if (this.animationId) return;

            const loop = () => {
                this.render();
                if (!this.isActive) {
                    this.animationId = null;
                    return;
                }
                if (this._useRVFC && this.videoElement) {
                    this.animationId = this.videoElement.requestVideoFrameCallback(loop);
                } else {
                    this.animationId = requestAnimationFrame(loop);
                }
            };

            if (this._useRVFC && this.videoElement) {
                this.animationId = this.videoElement.requestVideoFrameCallback(loop);
            } else {
                this.animationId = requestAnimationFrame(loop);
            }

            console.log('[Optimizer+] WebGL2 render loop started' +
                (this._useRVFC ? ' (rVFC sync)' : ' (rAF fallback)'));
        }

        stopRenderLoop() {
            if (this.animationId) {
                if (this._useRVFC && this.videoElement) {
                    this.videoElement.cancelVideoFrameCallback(this.animationId);
                } else {
                    cancelAnimationFrame(this.animationId);
                }
                this.animationId = null;
            }
        }

        destroy() {
            this.stopRenderLoop();
            if (this.videoElement) {
                this.videoElement.style.opacity = '1';
            }
            if (this.canvas && this.canvas.parentElement) {
                this.canvas.parentElement.removeChild(this.canvas);
            }
            if (this.gl) {
                if (this.program) {
                    this.gl.deleteProgram(this.program);
                    this.program = null;
                }
                if (this.texture) {
                    this.gl.deleteTexture(this.texture);
                    this.texture = null;
                }
                this.gl.getExtension('WEBGL_lose_context')?.loseContext();
            }
            this._attached = false;
            this.gl = null;
            this.canvas = null;
            this.videoElement = null;
        }
    }

    // Upscale: AMD FSR 1 (MIT). EASU resamples along edges, RCAS sharpens at display
    // resolution with its noise limiter (keeps compression artifacts from being amplified).
    const WGSL_UPSCALE = `
struct Uniforms {
    resolution: vec2f,
    pad0: vec2f,
    pad1: vec4f,
    sharpness: f32,
};

@group(0) @binding(0) var frame: texture_2d<f32>;
@group(0) @binding(1) var<uniform> u: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) texCoord: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
    var pos = array<vec2f, 6>(
        vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
        vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
    );
    var uv = array<vec2f, 6>(
        vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
        vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0),
    );
    var out: VertexOutput;
    out.position = vec4f(pos[vi], 0.0, 1.0);
    out.texCoord = uv[vi];
    return out;
}

fn px(p: vec2i) -> vec3f {
    return textureLoad(frame, clamp(p, vec2i(0), vec2i(textureDimensions(frame)) - 1), 0).rgb;
}

fn luma(c: vec3f) -> f32 {
    return c.r * 0.5 + c.g + c.b * 0.5;
}

fn easuSet(w: f32, lA: f32, lB: f32, lC: f32, lD: f32, lE: f32) -> vec3f {
    let dirX = lD - lB;
    let lenX = saturate(abs(dirX) / max(max(abs(lD - lC), abs(lC - lB)), 0.00001));
    let dirY = lE - lA;
    let lenY = saturate(abs(dirY) / max(max(abs(lE - lC), abs(lC - lA)), 0.00001));
    return vec3f(dirX, dirY, lenX * lenX + lenY * lenY) * w;
}

fn easuTap(off: vec2f, dir: vec2f, len: vec2f, lob: f32, clp: f32, c: vec3f) -> vec4f {
    let v = vec2f(off.x * dir.x + off.y * dir.y, off.y * dir.x - off.x * dir.y) * len;
    let d2 = min(dot(v, v), clp);
    let wB = 0.4 * d2 - 1.0;
    let wA = lob * d2 - 1.0;
    let w = (1.5625 * wB * wB - 0.5625) * wA * wA;
    return vec4f(c * w, w);
}

//    b c
//  e f g h
//  i j k l
//    n o
@fragment
fn fs_easu(input: VertexOutput) -> @location(0) vec4f {
    let p = input.texCoord * vec2f(textureDimensions(frame)) - 0.5;
    let fp = floor(p);
    let pp = p - fp;
    let ip = vec2i(fp);

    let b = px(ip + vec2i(0, -1));
    let c = px(ip + vec2i(1, -1));
    let e = px(ip + vec2i(-1, 0));
    let f = px(ip);
    let g = px(ip + vec2i(1, 0));
    let h = px(ip + vec2i(2, 0));
    let i = px(ip + vec2i(-1, 1));
    let j = px(ip + vec2i(0, 1));
    let k = px(ip + vec2i(1, 1));
    let l = px(ip + vec2i(2, 1));
    let n = px(ip + vec2i(0, 2));
    let o = px(ip + vec2i(1, 2));

    let bL = luma(b); let cL = luma(c); let eL = luma(e); let fL = luma(f);
    let gL = luma(g); let hL = luma(h); let iL = luma(i); let jL = luma(j);
    let kL = luma(k); let lL = luma(l); let nL = luma(n); let oL = luma(o);

    var acc = easuSet((1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
    acc += easuSet(pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
    acc += easuSet((1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
    acc += easuSet(pp.x * pp.y, gL, jL, kL, lL, oL);

    let dirR = dot(acc.xy, acc.xy);
    let dir = select(acc.xy * inverseSqrt(dirR), vec2f(1.0, 0.0), dirR < 1.0 / 32768.0);
    let len = acc.z * acc.z * 0.25;
    let stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
    let len2 = vec2f(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
    let lob = 0.5 - 0.29 * len;
    let clp = 1.0 / lob;

    var a = easuTap(vec2f(0.0, -1.0) - pp, dir, len2, lob, clp, b);
    a += easuTap(vec2f(1.0, -1.0) - pp, dir, len2, lob, clp, c);
    a += easuTap(vec2f(-1.0, 1.0) - pp, dir, len2, lob, clp, i);
    a += easuTap(vec2f(0.0, 1.0) - pp, dir, len2, lob, clp, j);
    a += easuTap(-pp, dir, len2, lob, clp, f);
    a += easuTap(vec2f(-1.0, 0.0) - pp, dir, len2, lob, clp, e);
    a += easuTap(vec2f(1.0, 1.0) - pp, dir, len2, lob, clp, k);
    a += easuTap(vec2f(2.0, 1.0) - pp, dir, len2, lob, clp, l);
    a += easuTap(vec2f(2.0, 0.0) - pp, dir, len2, lob, clp, h);
    a += easuTap(vec2f(1.0, 0.0) - pp, dir, len2, lob, clp, g);
    a += easuTap(vec2f(1.0, 2.0) - pp, dir, len2, lob, clp, o);
    a += easuTap(vec2f(0.0, 2.0) - pp, dir, len2, lob, clp, n);

    let lo = min(min(f, g), min(j, k));
    let hi = max(max(f, g), max(j, k));
    return vec4f(clamp(a.rgb / a.a, lo, hi), 1.0);
}

@fragment
fn fs_rcas(input: VertexOutput) -> @location(0) vec4f {
    let ip = vec2i(input.position.xy);
    let e = px(ip);
    let b = px(ip + vec2i(0, -1));
    let d = px(ip + vec2i(-1, 0));
    let f = px(ip + vec2i(1, 0));
    let h = px(ip + vec2i(0, 1));

    let mn = min(min(b, d), min(f, h));
    let mx = max(max(b, d), max(f, h));
    let hitMin = min(mn, e) / (4.0 * mx + 0.00001);
    let hitMax = (1.0 - max(mx, e)) / (4.0 * mn - 4.00001);
    let lobeRGB = max(-hitMin, hitMax);
    // Slider 0.45 (default) lands on FSR's own default strength (~0.87)
    var lobe = max(-0.1875, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * min(u.sharpness * 2.0, 1.0);

    let bL = luma(b); let dL = luma(d); let eL = luma(e); let fL = luma(f); let hL = luma(h);
    let range = max(max(max(bL, dL), max(eL, fL)), hL) - min(min(min(bL, dL), min(eL, fL)), hL);
    lobe *= 1.0 - 0.5 * saturate(abs(0.25 * (bL + dL + fL + hL) - eL) / max(range, 0.00001));

    return vec4f(clamp((lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0), vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

    // Off for low-end devices. Kill switch: localStorage.setItem('optimizer_upscale', '0') + reload.
    const UPSCALE = !ENV_PROFILE.isLowEnd && (() => {
        try { return localStorage.getItem('optimizer_upscale') !== '0'; } catch (e) { return true; }
    })();

    // Reports the canvas box in device pixels (0x0 while hidden).
    function observeDeviceBox(canvas, onBox) {
        if (typeof ResizeObserver !== 'function') return null;
        const observer = new ResizeObserver(([entry]) => {
            const dp = entry.devicePixelContentBoxSize?.[0];
            if (dp) onBox(dp.inlineSize, dp.blockSize);
            else onBox(Math.round(entry.contentRect.width * _realScreen.pixelRatio), Math.round(entry.contentRect.height * _realScreen.pixelRatio));
        });
        try { observer.observe(canvas, { box: 'device-pixel-content-box' }); } catch (e) { observer.observe(canvas); }
        return observer;
    }

    // Shared WebGPU helpers. gpuCreatePipeline, gpuDrawFrame, gpuTargetSize and
    // workerRendererMain are serialised with toString into the render worker: they
    // must not reference anything from the outer scope.
    function gpuCreatePipeline(device, code, format, upscaleCode) {
        const module = device.createShaderModule({ code });
        const upscaleModule = device.createShaderModule({ code: upscaleCode });
        const layout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
            ],
        });
        const filterLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
        const pipeline = (mod, entryPoint, target, pipelineLayout) => device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: { module: mod, entryPoint: 'vs_main' },
            fragment: { module: mod, entryPoint, targets: [{ format: target }] },
            primitive: { topology: 'triangle-list' },
        });
        const timed = device.features.has('timestamp-query');
        return {
            querySet: timed ? device.createQuerySet({ type: 'timestamp', count: 2 }) : null,
            resolveBuffer: timed ? device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null,
            readBuffer: timed ? device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) : null,
            layout,
            sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }),
            pipeline: pipeline(module, 'fs_main', format, filterLayout),
            midPipeline: pipeline(module, 'fs_main', 'rgb10a2unorm', filterLayout),
            easuPipeline: pipeline(upscaleModule, 'fs_easu', 'rgb10a2unorm', 'auto'),
            rcasPipeline: pipeline(upscaleModule, 'fs_rcas', format, 'auto'),
            uniformBuffer: device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
            dirty: true,
            mid: null, midView: null, easuGroup: null,
            up: null, upView: null, rcasGroup: null,
            last: 0, interval: 16.7, tick: 0, slow: 0, gpuMs: 0, upscaleOff: false,
        };
    }

    // Canvas buffer size = on-screen size in device pixels, so the shader does the scaling
    // (both ways) instead of the compositor. fill: stretch mode, each axis scales on its own.
    function gpuTargetSize(srcW, srcH, boxW, boxH, allowUp, fill) {
        if (!boxW || !boxH) return [srcW, srcH];
        let sx = Math.min(boxW / srcW, 4096 / srcW), sy = Math.min(boxH / srcH, 4096 / srcH);
        if (!fill) sx = sy = Math.min(sx, sy);
        const up = Math.max(sx, sy) > 1.02;
        if (up ? !allowUp : Math.min(sx, sy) > 0.98) return [srcW, srcH];
        return [Math.round(srcW * sx), Math.round(srcH * sy)];
    }

    // source: HTMLVideoElement or VideoFrame (srcW x srcH). One pass when the canvas is the
    // source size or smaller; filter -> EASU -> RCAS when it is larger. Owns uniform slots
    // 0, 1 (the resolution the filter pass works at) and 14.
    function gpuDrawFrame(device, context, g, source, srcW, srcH, uniforms) {
        const target = context.getCurrentTexture();
        const upscale = target.width > srcW || target.height > srcH;
        const resW = upscale ? srcW : target.width, resH = upscale ? srcH : target.height;
        // Slot 14: 1 = upscaling (RCAS sharpens), -1 = minifying (box taps), 0 = 1:1
        const mode = upscale ? 1 : (target.width < srcW * 0.75 ? -1 : 0);
        if (g.dirty || uniforms[0] !== resW || uniforms[1] !== resH || uniforms[14] !== mode) {
            uniforms[0] = resW;
            uniforms[1] = resH;
            uniforms[14] = mode;
            device.queue.writeBuffer(g.uniformBuffer, 0, uniforms);
            g.dirty = false;
        }
        // An external texture expires after use: this bind group is rebuilt every frame
        const bindGroup = device.createBindGroup({
            layout: g.layout,
            entries: [
                { binding: 0, resource: g.sampler },
                { binding: 1, resource: device.importExternalTexture({ source }) },
                { binding: 2, resource: { buffer: g.uniformBuffer } },
            ],
        });
        const sized = (texture, w, h) => {
            if (texture && texture.width === w && texture.height === h) return texture;
            if (texture) texture.destroy();
            return device.createTexture({
                size: [w, h],
                format: 'rgb10a2unorm',
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            });
        };
        if (upscale) {
            const mid = sized(g.mid, srcW, srcH);
            if (mid !== g.mid) {
                g.mid = mid;
                g.midView = mid.createView();
                g.easuGroup = device.createBindGroup({
                    layout: g.easuPipeline.getBindGroupLayout(0),
                    entries: [{ binding: 0, resource: g.midView }],
                });
            }
            const up = sized(g.up, target.width, target.height);
            if (up !== g.up) {
                g.up = up;
                g.upView = up.createView();
                g.rcasGroup = device.createBindGroup({
                    layout: g.rcasPipeline.getBindGroupLayout(0),
                    entries: [{ binding: 0, resource: g.upView }, { binding: 1, resource: { buffer: g.uniformBuffer } }],
                });
            }
        }
        // Every 30th upscaled frame is timed on the GPU itself
        const timed = upscale && g.querySet && ++g.tick % 30 === 0 && g.readBuffer.mapState === 'unmapped';
        const encoder = device.createCommandEncoder();
        const run = (view, pipeline, group, timestampWrites) => {
            const pass = encoder.beginRenderPass({
                colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
                timestampWrites,
            });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, group);
            pass.draw(6);
            pass.end();
        };
        if (upscale) {
            run(g.midView, g.midPipeline, bindGroup, timed ? { querySet: g.querySet, beginningOfPassWriteIndex: 0 } : undefined);
            run(g.upView, g.easuPipeline, g.easuGroup);
            run(target.createView(), g.rcasPipeline, g.rcasGroup, timed ? { querySet: g.querySet, endOfPassWriteIndex: 1 } : undefined);
        } else {
            run(target.createView(), g.pipeline, bindGroup);
        }
        if (timed) {
            encoder.resolveQuerySet(g.querySet, 0, 2, g.resolveBuffer, 0);
            encoder.copyBufferToBuffer(g.resolveBuffer, 0, g.readBuffer, 0, 16);
        }
        device.queue.submit([encoder.finish()]);

        const now = performance.now();
        if (g.last) g.interval += (Math.min(now - g.last, 50) - g.interval) * 0.1;
        g.last = now;
        // Guard: the three passes eating over half the frame interval, ten samples in a row,
        // stops upscaling for the session. One-way.
        if (timed) {
            g.readBuffer.mapAsync(GPUMapMode.READ).then(() => {
                const t = new BigInt64Array(g.readBuffer.getMappedRange());
                const ms = Number(t[1] - t[0]) / 1e6;
                g.readBuffer.unmap();
                if (ms < 0 || ms > 1000) return;
                g.gpuMs = ms;
                g.slow = ms > g.interval * 0.5 ? g.slow + 1 : 0;
                if (g.slow >= 10) g.upscaleOff = true;
            }).catch(() => {});
        }
    }

    // Fills the settings slots of the uniform block.
    function packUniforms(config, data) {
        const e = config.enhancer;
        const f = config.filters;
        data[2] = e.contrast || 1.0;
        data[3] = e.saturation || 1.0;
        data[4] = e.brightness || 1.0;
        data[5] = f.gamma?.enabled ? f.gamma.value : 1.0;
        data[6] = f.exposure?.enabled ? f.exposure.value : 0.0;
        data[7] = f.vibrance?.enabled ? f.vibrance.amount : 0.0;
        // Sharpness: combine enhancer base slider + CAS/USM advanced filters additively
        const casUsm = f.enabled ? ((f.cas?.enabled ? f.cas.sharpness : 0) + (f.usm?.enabled ? f.usm.amount : 0)) : 0;
        const baseSharp = e.enabled ? (e.sharpness || 0) : 0;
        // Clamp to [0,1]: used as a mix() factor, >1 overshoots into halos
        data[8] = Math.min(1.0, casUsm + baseSharp);
        data[9] = f.denoise?.enabled ? f.denoise.strength : 0.0;
        data[10] = f.clarity?.enabled ? f.clarity.amount : 0.0;
        data[11] = f.deband?.enabled ? (f.deband.strength || 0.3) : 0.0;
        data[12] = e.enabled ? 1.0 : 0.0;
        data[13] = f.enabled ? 1.0 : 0.0;
        data[15] = 0.0; // time (unused by the shader)
        data[16] = ENV_PROFILE.isHighEnd ? 1.0 : 0.0;  // qualityMode
        data[17] = f.performanceMode ? 1.0 : 0.0;  // performanceMode
    }

    // Worker renderer — WebGPU off the main thread.
    // Frames go decoder -> MediaStreamTrackProcessor -> worker -> OffscreenCanvas, so
    // frame pacing no longer depends on the page's main thread (which is busy with
    // input events during mouse play). Chrome/Edge only; anything else, or any
    // failure, falls back to the main-thread renderers below.
    // Kill switch: localStorage.setItem('optimizer_worker', '0') + reload.
    const WORKER_RENDERER = (() => {
        try { return localStorage.getItem('optimizer_worker') !== '0'; } catch (e) { return true; }
    })();

    function workerRendererMain() {
        let device, context, gpu, canvas, format;
        let active = false, generation = 0, frames = 0, maxGap = 0, lastDraw = 0, boxW = 0, boxH = 0, warned = false, statsAt = 0, allowUp = false, fill = false, frameColor = null, frameFormat = null, pending = 0;
        const uniforms = new Float32Array(28);
        const fail = (e) => postMessage({ type: 'fail', message: String((e && e.message) || e) });
        const configure = () => context.configure({ device, format, colorSpace: 'srgb', alphaMode: 'opaque' });

        function draw(frame) {
            const w = frame.displayWidth, h = frame.displayHeight;
            const off = gpu.upscaleOff;
            const [targetW, targetH] = gpuTargetSize(w, h, boxW, boxH, allowUp && !off, fill);
            if (canvas.width !== targetW || canvas.height !== targetH) {
                canvas.width = targetW;
                canvas.height = targetH;
                configure();
            }
            gpuDrawFrame(device, context, gpu, frame, w, h, uniforms);
            if (frames % 64 === 0) {
                frameColor = frame.colorSpace;
                frameFormat = frame.format;
            }
            if (off && !warned) {
                warned = true;
                postMessage({ type: 'upscale-off' });
            }
        }

        async function pump(readable, mine) {
            const reader = readable.getReader();
            let errors = 0, first = true;
            try {
                for (;;) {
                    const { value: frame, done } = await reader.read();
                    if (done) break;
                    let error = null, drawn = false;
                    if (active && mine === generation) {
                        try {
                            draw(frame);
                            drawn = true;
                            const now = performance.now();
                            if (lastDraw) maxGap = Math.max(maxGap, now - lastDraw);
                            lastDraw = now;
                            frames++;
                            errors = 0;
                            if (first) { first = false; postMessage({ type: 'frame' }); }
                        } catch (e) { error = e; }
                    }
                    // The decoder reuses a frame's surface as soon as the frame is closed, so a drawn
                    // frame stays open until the GPU has read it: closing early shows up as green
                    // garbage. Never more than 4 held, or the decoder's frame pool would stall.
                    if (drawn && pending < 4) {
                        pending++;
                        const release = () => { pending--; frame.close(); };
                        device.queue.onSubmittedWorkDone().then(release, release);
                    } else {
                        frame.close();
                    }
                    if (mine !== generation) { reader.cancel().catch(() => {}); return; }
                    // Transient GPU errors skip a frame; ~90 in a row is a dead pipeline
                    if (error && ++errors >= 90) throw error;
                }
                if (mine === generation) postMessage({ type: 'ended' });
            } catch (e) { fail(e); }
        }

        onmessage = async ({ data: m }) => {
            try {
                if (m.type === 'init') {
                    canvas = m.canvas;
                    allowUp = m.upscale;
                    const adapter = await navigator.gpu.requestAdapter(m.adapterOptions);
                    if (!adapter) throw new Error('no WebGPU adapter');
                    device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [] });
                    device.lost.then((info) => fail('device lost: ' + info.message));
                    context = canvas.getContext('webgpu');
                    format = navigator.gpu.getPreferredCanvasFormat();
                    configure();
                    gpu = gpuCreatePipeline(device, m.shader, format, m.upscaleShader);
                    postMessage({ type: 'ready' });
                } else if (m.type === 'uniforms') {
                    uniforms.set(m.data);
                    gpu.dirty = true;
                    active = m.active;
                    if (!active) lastDraw = 0;
                } else if (m.type === 'box') {
                    boxW = m.w;
                    boxH = m.h;
                    fill = m.fill;
                } else if (m.type === 'stream') {
                    pump(m.readable, ++generation);
                } else if (m.type === 'stats') {
                    const now = performance.now();
                    postMessage({ type: 'stats', frames, maxGap, gpuMs: gpu.gpuMs, ms: now - statsAt, upscaleOff: gpu.upscaleOff,
                        color: frameColor ? [frameColor.primaries, frameColor.transfer, frameColor.matrix, frameColor.fullRange ? 'full' : 'limited', frameFormat].join('/') : '?' });
                    statsAt = now;
                    frames = 0;
                    maxGap = 0;
                }
            } catch (e) { fail(e); }
        };
    }

    class WorkerVideoRenderer {
        constructor() {
            this.canvas = null;
            this.videoElement = null;
            this.worker = null;
            this.isActive = false;
            this.onFail = null;
            this._running = false;
            this._hasFrame = false;
            this._track = null;
            this._data = new Float32Array(28);
            this._rebind = () => { try { this._bind(); } catch (e) { this._fail(e.message); } };
        }

        static supported(video) {
            return WORKER_RENDERER && !!navigator.gpu &&
                typeof MediaStreamTrackProcessor === 'function' &&
                typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function' &&
                !!video.srcObject?.getVideoTracks?.()[0];
        }

        // Resolves true once the worker owns a working GPU pipeline and the stream.
        init(videoElement) {
            return new Promise((resolve) => {
                let settled = false;
                const done = (ok) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    if (!ok) this.destroy();
                    resolve(ok);
                };
                const timer = setTimeout(() => done(false), 4000);
                try {
                    this.videoElement = videoElement;
                    const source = `${gpuCreatePipeline}\n${gpuTargetSize}\n${gpuDrawFrame}\n(${workerRendererMain})()`;
                    this.worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
                    this.worker.onerror = (e) => (settled ? this._fail(e.message) : done(false));
                    this.worker.onmessage = ({ data: m }) => {
                        if (m.type === 'ready') {
                            try { this._bind(); done(true); } catch (e) { done(false); }
                        } else if (m.type === 'frame') {
                            this._hasFrame = true;
                            this._sync();
                        } else if (m.type === 'ended') {
                            // Track ended: show the raw video until a new track is bound
                            this._track = null;
                            this._hasFrame = false;
                            this._sync();
                            this._rebind();
                        } else if (m.type === 'stats') {
                            this._stats = m;
                        } else if (m.type === 'upscale-off') {
                            showNotification(t('upscaleOffNotif'));
                        } else if (m.type === 'fail') {
                            if (settled) this._fail(m.message); else done(false);
                        }
                    };

                    this.canvas = document.createElement('canvas');
                    this.canvas.id = 'optimizer-webgpu-canvas';
                    this.canvas.style.cssText = `
                        position: absolute; top: 0; left: 0;
                        width: 100%; height: 100%;
                        pointer-events: none;
                        object-fit: contain;
                        will-change: transform;
                        contain: strict;
                        display: none;
                    `;
                    const parent = videoElement.parentElement;
                    if (parent) {
                        parent.style.position = parent.style.position || 'relative';
                        parent.insertBefore(this.canvas, videoElement.nextSibling);
                    }
                    const offscreen = this.canvas.transferControlToOffscreen();
                    this.worker.postMessage({
                        type: 'init',
                        canvas: offscreen,
                        shader: WGSL_SHADER,
                        upscaleShader: WGSL_UPSCALE,
                        upscale: UPSCALE,
                        // Chrome on Windows ignores powerPreference and logs a warning (crbug.com/369219127)
                        adapterOptions: /Win/i.test(navigator.platform) ? {} : { powerPreference: 'high-performance' },
                    }, [offscreen]);
                    // A new srcObject (reconnect, 60<->120 FPS switch) carries a new track
                    videoElement.addEventListener('loadedmetadata', this._rebind);
                    this._boxObserver = observeDeviceBox(this.canvas, (w, h) => {
                        this._boxW = w;
                        this._boxH = h;
                        this.refreshBox();
                    });
                } catch (e) {
                    done(false);
                }
            });
        }

        _bind() {
            const track = this.videoElement?.srcObject?.getVideoTracks?.()[0];
            if (!this.worker || !track || track === this._track || track.readyState !== 'live') return;
            this._track = track;
            this._hasFrame = false;
            this._sync();
            // maxBufferSize 1: a late worker gets the newest frame, never a backlog
            const { readable } = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 });
            this.worker.postMessage({ type: 'stream', readable }, [readable]);
        }

        refreshBox() {
            if (this.worker) this.worker.postMessage({ type: 'box', w: this._boxW || 0, h: this._boxH || 0, fill: CONFIG.display.stretchMode });
        }

        // Returns the last sample and requests the next one
        poll() {
            const s = this._stats;
            if (this.worker) this.worker.postMessage({ type: 'stats' });
            if (!s) return 'starting';
            return `${Math.round(s.frames * 1000 / s.ms)} fps, max gap ${Math.round(s.maxGap)}ms, gpu ${s.gpuMs.toFixed(1)}ms${s.upscaleOff ? ', upscale stopped' : ''}, color ${s.color}`;
        }

        _fail(message) {
            console.warn('[Optimizer+] Worker renderer failed, falling back to main thread:', message);
            const onFail = this.onFail;
            this.destroy();
            if (onFail) onFail();
        }

        // The canvas replaces the video only while it actually has frames to show
        _sync() {
            if (!this.canvas || !this.videoElement) return;
            const show = this.isActive && this._running && this._hasFrame;
            const display = show ? 'block' : 'none';
            const opacity = show ? '0.01' : '1';
            if (this.canvas.style.display !== display) this.canvas.style.display = display;
            if (this.videoElement.style.opacity !== opacity) this.videoElement.style.opacity = opacity;
        }

        _post() {
            if (this.worker) this.worker.postMessage({ type: 'uniforms', data: this._data, active: this.isActive && this._running });
            this._sync();
        }

        updateUniforms(config) {
            this.isActive = config.enhancer.enabled || config.filters.enabled;
            packUniforms(config, this._data);
            this._post();
        }

        startRenderLoop() {
            this._running = true;
            this._post();
        }

        stopRenderLoop() {
            this._running = false;
            this._post();
        }

        destroy() {
            if (this.videoElement) {
                this.videoElement.removeEventListener('loadedmetadata', this._rebind);
                this.videoElement.style.opacity = '1';
            }
            if (this._boxObserver) this._boxObserver.disconnect();
            if (this.worker) this.worker.terminate();
            if (this.canvas && this.canvas.parentElement) this.canvas.parentElement.removeChild(this.canvas);
            this.worker = null;
            this.canvas = null;
            this.videoElement = null;
            this._track = null;
            this.onFail = null;
        }
    }

    // WebGPUVideoRenderer — main-thread WebGPU (fallback when the worker path is unavailable)
    class WebGPUVideoRenderer {
        constructor() {
            this.device = null;
            this.context = null;
            this.videoElement = null;
            this.canvas = null;
            this.animationId = null;
            this.isActive = false;
            this._attached = false;
            this._lastConfig = null;
            this._canvasFormat = null;
            this._useRVFC = typeof HTMLVideoElement !== 'undefined' &&
                            'requestVideoFrameCallback' in HTMLVideoElement.prototype;
            this._lastVideoTime = 0;
            // True once GPU rendering has failed continuously; the raw video is shown instead
            this._failOpen = false;
            // Pre-allocated to avoid GC pressure in the render loop
            this._uniformData = new Float32Array(28);  // 112 bytes (WGSL-aligned struct)
        }

        async init(videoElement) {
            if (!videoElement || this._attached) return false;
            if (!navigator.gpu) {
                console.error('[Optimizer+] WebGPU not available — Chrome 113+ / Edge 113+ required');
                return false;
            }

            this.videoElement = videoElement;

            try {
                // Chrome on Windows ignores powerPreference and logs a warning (crbug.com/369219127)
                const adapter = await navigator.gpu.requestAdapter(/Win/i.test(navigator.platform)
                    ? {} : { powerPreference: 'high-performance' });
                if (!adapter) {
                    console.error('[Optimizer+] No WebGPU adapter found');
                    return false;
                }
                this.device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [] });

                this.device.lost.then((info) => {
                    console.warn('[Optimizer+] WebGPU device lost:', info.message);
                    this.stopRenderLoop();
                    if (this.videoElement) this.videoElement.style.opacity = '1';
                    if (this.canvas) this.canvas.style.display = 'none';
                    this._attached = false;
                });

                this.canvas = document.createElement('canvas');
                this.canvas.id = 'optimizer-webgpu-canvas';
                this.canvas.style.cssText = `
                    position: absolute; top: 0; left: 0;
                    width: 100%; height: 100%;
                    pointer-events: none;
                    object-fit: contain;
                    will-change: transform;
                    contain: strict;
                `;

                // Set initial size to match the streaming video to prevent low-resolution swap chain
                const initialW = videoElement.videoWidth || 1920;
                const initialH = videoElement.videoHeight || 1080;
                this.canvas.width = initialW;
                this.canvas.height = initialH;

                const parent = videoElement.parentElement;
                if (parent) {
                    parent.style.position = parent.style.position || 'relative';
                    parent.insertBefore(this.canvas, videoElement.nextSibling);
                }

                this.context = this.canvas.getContext('webgpu');
                this._canvasFormat = navigator.gpu.getPreferredCanvasFormat();
                this.context.configure({
                    device: this.device,
                    format: this._canvasFormat,
                    colorSpace: 'srgb',
                    alphaMode: 'opaque',
                });

                this._gpu = gpuCreatePipeline(this.device, WGSL_SHADER, this._canvasFormat, WGSL_UPSCALE);
                this._boxObserver = observeDeviceBox(this.canvas, (w, h) => { this._boxW = w; this._boxH = h; });
                this._attached = true;

                console.log('[Optimizer+] WebGPU pipeline initialized (true zero-copy mode)');
                return true;
            } catch (e) {
                console.error('[Optimizer+] WebGPU initialization failed, falling back to WebGL2:', e);
                this.destroy();
                return false;
            }
        }

        updateUniforms(config) {
            this._lastConfig = config;
            if (!this.device) return;

            const e = config.enhancer;
            const f = config.filters;

            const wasActive = this.isActive;
            this.isActive = e.enabled || f.enabled;

            // Guard style writes to avoid needless style recalculation
            if (this.canvas) {
                const targetDisplay = this.isActive ? 'block' : 'none';
                if (this.canvas.style.display !== targetDisplay) {
                    this.canvas.style.display = targetDisplay;
                }
            }
            if (!this.isActive && this.videoElement && this.videoElement.style.opacity !== '1') {
                this.videoElement.style.opacity = '1';
            }
            if (this.isActive && !wasActive && !this.animationId) {
                this.startRenderLoop();
            }

            const data = this._uniformData;
            packUniforms(config, data);
            if (this._gpu) this._gpu.dirty = true;
        }

        render() {
            if (!this.isActive) return;
            const video = this.videoElement;
            if (!video || video.readyState < 2) return;

            if (!this._useRVFC) {
                if (video.currentTime === this._lastVideoTime) return;
                this._lastVideoTime = video.currentTime;
            }

            const texW = video.videoWidth || 1920;
            const texH = video.videoHeight || 1080;
            if (!texW || !texH) return;

            try {
                const off = this._gpu.upscaleOff;
                const [targetW, targetH] = gpuTargetSize(texW, texH, this._boxW, this._boxH, UPSCALE && !off, CONFIG.display.stretchMode);
                if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
                    this.canvas.width = targetW;
                    this.canvas.height = targetH;
                    this.context.configure({
                        device: this.device,
                        format: this._canvasFormat,
                        colorSpace: 'srgb',
                        alphaMode: 'opaque'
                    });
                }

                gpuDrawFrame(this.device, this.context, this._gpu, video, texW, texH, this._uniformData);
                if (off && !this._upscaleWarned) {
                    this._upscaleWarned = true;
                    showNotification(t('upscaleOffNotif'));
                }
                this._failStreak = 0;

                if (video.style.opacity !== '0.01') {
                    video.style.opacity = '0.01';
                }
            } catch (e) {
                // Skip frame on error — don't kill the loop
                if (!this._errorLogged) {
                    console.warn('[Optimizer+] WebGPU render frame skipped:', e.message);
                    this._errorLogged = true;
                    setTimeout(() => { this._errorLogged = false; }, 5000);
                }
                // Fail-open: if rendering keeps failing (~90 frames) the canvas would freeze on the last
                // frame while the hidden video keeps playing. Show the raw video, hide the canvas
                // and stop the loop.
                this._failStreak = (this._failStreak || 0) + 1;
                if (this._failStreak >= 90) {
                    console.warn('[Optimizer+] WebGPU fail-open: rendu défaillant ~1.5s → vidéo brute affichée (filtres désactivés)');
                    this._failOpen = true;
                    this.stopRenderLoop();
                    if (this.videoElement) this.videoElement.style.opacity = '1';
                    if (this.canvas) this.canvas.style.display = 'none';
                    this._attached = false;
                }
            }
        }

        startRenderLoop() {
            if (this.animationId) return;
            // Never restart the loop after fail-open
            if (this._failOpen) return;

            const loop = () => {
                this.render();
                if (!this.isActive) {
                    this.animationId = null;
                    return;
                }
                if (this._useRVFC && this.videoElement) {
                    this.animationId = this.videoElement.requestVideoFrameCallback(loop);
                } else {
                    this.animationId = requestAnimationFrame(loop);
                }
            };

            if (this._useRVFC && this.videoElement) {
                this.animationId = this.videoElement.requestVideoFrameCallback(loop);
            } else {
                this.animationId = requestAnimationFrame(loop);
            }

            console.log('[Optimizer+] WebGPU render loop started' +
                (this._useRVFC ? ' (requestVideoFrameCallback sync)' : ' (VSync-aligned rAF)'));
        }

        stopRenderLoop() {
            if (this.animationId) {
                if (this._useRVFC && this.videoElement) {
                    this.videoElement.cancelVideoFrameCallback(this.animationId);
                } else {
                    cancelAnimationFrame(this.animationId);
                }
                this.animationId = null;
            }
        }

        destroy() {
            this.stopRenderLoop();
            if (this.videoElement) {
                this.videoElement.style.opacity = '1';
            }
            if (this.canvas && this.canvas.parentElement) {
                this.canvas.parentElement.removeChild(this.canvas);
            }
            if (this._boxObserver) this._boxObserver.disconnect();
            if (this.device) {
                this.device.destroy();
            }
            this._attached = false;
            this.device = null;
            this.context = null;
            this.canvas = null;
            this.videoElement = null;
        }
    }

    // VideoEnhancer — picks and drives the active renderer
    class VideoEnhancer {
        constructor() {
            this.enabled = CONFIG.enhancer.enabled;
            this.filtersEnabled = CONFIG.filters.enabled;
            this.videoElement = null;

            // Renderer order: worker WebGPU, main-thread WebGPU, WebGL2
            this._workerRenderer = null;
            this._workerFailed = false;
            this._gpuRenderer = new WebGPUVideoRenderer();
            this._glRenderer = new WebGLVideoRenderer();
            this._webgpuActive = false;
            this._webglActive = false;
            this._initInProgress = null; // Guards against a concurrent WebGPU init (async)
        }

        refreshBox() {
            if (this._workerRenderer) this._workerRenderer.refreshBox();
        }

        describe() {
            const r = this._getActiveRenderer();
            if (!r) return 'render none';
            const size = r.canvas ? `canvas ${r.canvas.width}x${r.canvas.height}` : 'no canvas';
            if (r === this._workerRenderer) return `render worker ${r.poll()}, ${size}`;
            return `render ${r === this._gpuRenderer ? 'webgpu-main' : 'webgl2'}, ${size}`;
        }

        _getActiveRenderer() {
            if (this._workerRenderer) return this._workerRenderer;
            if (this._webgpuActive) return this._gpuRenderer;
            if (this._webglActive) return this._glRenderer;
            return null;
        }

        applyToVideo(videoElement) {
            if (!videoElement) return;
            this.videoElement = videoElement;

            const activeRenderer = this._getActiveRenderer();

            // Handle video element replacement (e.g., stream reconnect)
            if (activeRenderer && activeRenderer.videoElement !== videoElement) {
                console.log('[Optimizer+] Video element changed. Rebinding renderer...');
                activeRenderer.destroy();
                this._workerRenderer = null;
                this._webgpuActive = false;
                this._webglActive = false;
            }

            if (this._getActiveRenderer()) {
                this._getActiveRenderer().updateUniforms(CONFIG);
                this._getActiveRenderer().startRenderLoop();
                return;
            }

            // The video observer can call applyToVideo twice before the async WebGPU init
            // resolves: a second init would leak a canvas and a GPU device
            if (this._initInProgress === videoElement) return;

            if (!this._workerFailed && WorkerVideoRenderer.supported(videoElement)) {
                this._initInProgress = videoElement;
                const renderer = new WorkerVideoRenderer();
                const fallBack = () => {
                    this._workerRenderer = null;
                    this._workerFailed = true;
                    this.applyToVideo(videoElement);
                };
                renderer.onFail = fallBack;
                renderer.init(videoElement).then((ok) => {
                    this._initInProgress = null;
                    if (!ok) return fallBack();
                    this._workerRenderer = renderer;
                    renderer.updateUniforms(CONFIG);
                    renderer.startRenderLoop();
                    console.log('[Optimizer+] Worker renderer active (off-main-thread WebGPU)');
                });
                return;
            }

            if (navigator.gpu) {
                this._initInProgress = videoElement;
                this._gpuRenderer.init(videoElement)
                    .then((success) => {
                        this._initInProgress = null;
                        if (success) {
                            this._webgpuActive = true;
                            this._gpuRenderer.updateUniforms(CONFIG);
                            this._gpuRenderer.startRenderLoop();
                            console.log('[Optimizer+] WebGPU shaders active (true zero-copy)');
                        } else {
                            this._tryWebGL2Fallback(videoElement);
                        }
                    })
                    .catch((err) => {
                        this._initInProgress = null;
                        console.error('[Optimizer+] WebGPU init promise rejected, falling back to WebGL2:', err);
                        this._tryWebGL2Fallback(videoElement);
                    });
            } else {
                this._tryWebGL2Fallback(videoElement);
            }
        }

        _tryWebGL2Fallback(videoElement) {
            const ok = this._glRenderer.init(videoElement);
            if (ok) {
                this._webglActive = true;
                this._glRenderer.updateUniforms(CONFIG);
                this._glRenderer.startRenderLoop();
                console.log('[Optimizer+] WebGL2 fallback active');
            } else {
                console.warn('[Optimizer+] No GPU renderer available — filters disabled');
            }
        }

        updateFilterString() {
            const r = this._getActiveRenderer();
            if (r) r.updateUniforms(CONFIG);
        }

        applyFiltersToAllVideos() {
            const r = this._getActiveRenderer();
            if (r) r.updateUniforms(CONFIG);
        }

        removeFiltersFromAllVideos() {
            const r = this._getActiveRenderer();
            if (r) {
                r.stopRenderLoop();
                if (r.videoElement) r.videoElement.style.opacity = '1';
                if (r.canvas) r.canvas.style.display = 'none';
            }
        }

        ensureActive() {
            const r = this._getActiveRenderer();
            if (r && r.canvas && r.videoElement) {
                r.isActive = true;
                r.canvas.style.display = 'block';
                if (r.videoElement.style.opacity !== '0.01') {
                    r.videoElement.style.opacity = '0.01';
                }
                r.startRenderLoop();
            }
        }

        updateSettings(settings) {
            Object.assign(CONFIG.enhancer, settings);
            this.updateFilterString();
            saveConfig(true);
        }

        updateFilterSettings(filterName, settings) {
            if (CONFIG.filters[filterName]) {
                Object.assign(CONFIG.filters[filterName], settings);
                // Moving a filter slider enables that filter; otherwise the slider appears to do nothing
                if (!CONFIG.filters[filterName].enabled) {
                    CONFIG.filters[filterName].enabled = true;
                    const cb = document.querySelector(`.optimizer-filter-checkbox[data-filter="${filterName}"]`);
                    if (cb) cb.checked = true;
                }
                this.updateFilterString();
                saveConfig(true);
            }
        }

        applyPreset(presetName) {
            const preset = FILTER_PRESETS[presetName];
            if (!preset) return;
            CONFIG.filters.preset = presetName;

            // Automatically turn on advanced filters when a preset is applied
            if (presetName !== 'custom') {
                CONFIG.filters.enabled = true;
                this.filtersEnabled = true;
            }

            if (preset.enhancer) Object.assign(CONFIG.enhancer, preset.enhancer);
            if (preset.filters) {
                Object.keys(preset.filters).forEach(key => {
                    if (CONFIG.filters[key]) Object.assign(CONFIG.filters[key], preset.filters[key]);
                });
            }
            this.updateFilterString();
            saveConfig(true);
            console.log('[Optimizer+] Preset "' + (preset.name || presetName) + '" applied');
        }

        toggle(enabled) {
            this.enabled = enabled;
            CONFIG.enhancer.enabled = enabled;
            this.updateFilterString();
            saveConfig(true);
        }

        toggleFilters(enabled) {
            this.filtersEnabled = enabled;
            CONFIG.filters.enabled = enabled;
            this.updateFilterString();
            saveConfig(true);
        }

        toggleFilter(filterName, enabled) {
            if (CONFIG.filters[filterName]) {
                CONFIG.filters[filterName].enabled = enabled;
                this.updateFilterString();
                saveConfig(true);
            }
        }
    }

    const videoEnhancer = new VideoEnhancer();

    // DRM HOOKS

    function hookDRM() {
        // Originals stay in closures (never exposed on globals); the flag prevents double hooking
        if (windowCtx.MSMediaKeys && !windowCtx.MSMediaKeys.__optimizerHooked) {
            windowCtx.MSMediaKeys.__optimizerHooked = true;

            if (typeof windowCtx.MSMediaKeys.isTypeSupportedWithFeatures === 'function') {
                const originalFn = windowCtx.MSMediaKeys.isTypeSupportedWithFeatures.bind(windowCtx.MSMediaKeys);
                windowCtx.MSMediaKeys.isTypeSupportedWithFeatures = function (keySystem, targetMediaCodec) {
                    if (typeof targetMediaCodec !== 'string') {
                        return originalFn(keySystem, targetMediaCodec);
                    }
                    const reg = /,display-res-[xy]=\d+,display-res-[xy]=\d+/;
                    targetMediaCodec = targetMediaCodec.replace(reg, "");

                    if (CONFIG.drm.forceDolbyVision && targetMediaCodec.indexOf("ext-profile=dvh") !== -1) {
                        keySystem = keySystem.replace("com.microsoft.playready.hardware", "com.microsoft.playready");
                    }
                    if (CONFIG.codecs.forceHEVC && targetMediaCodec.indexOf("ext-profile=dvh") === -1 &&
                        (targetMediaCodec.indexOf("hvc1") !== -1 || targetMediaCodec.indexOf("hev1") !== -1)) {
                        keySystem = keySystem.replace("com.microsoft.playready.hardware", "com.microsoft.playready");
                    }
                    if (CONFIG.drm.forceHDCP && targetMediaCodec.indexOf("hdcp=") !== -1) {
                        targetMediaCodec = targetMediaCodec.replace(/hdcp=[12],?/g, "");
                    }
                    if (CONFIG.drm.forceUHD && targetMediaCodec.indexOf("decode-res-") !== -1) {
                        targetMediaCodec = targetMediaCodec.replace(/decode-res-[xy]=\d+,?/g, "");
                    }
                    if (CONFIG.drm.forceALL) return "probably";
                    return originalFn(keySystem, targetMediaCodec);
                };
            }

            if (typeof windowCtx.MSMediaKeys.isTypeSupported === 'function') {
                const originalFn = windowCtx.MSMediaKeys.isTypeSupported.bind(windowCtx.MSMediaKeys);
                windowCtx.MSMediaKeys.isTypeSupported = function (keySystem) {
                    if (typeof keySystem === 'string') {
                        keySystem = keySystem.replace("com.microsoft.playready.hardware", "com.microsoft.playready");
                    }
                    return originalFn(keySystem);
                };
            }
        }

        // Navigator MediaKeySystemAccess (Standard EME)
        if (windowCtx.navigator.requestMediaKeySystemAccess && !windowCtx.navigator.__optimizerEMEHooked) {
            const original = windowCtx.navigator.requestMediaKeySystemAccess.bind(windowCtx.navigator);
            Object.defineProperty(windowCtx.navigator, '__optimizerEMEHooked', { value: true, writable: false });

            windowCtx.navigator.requestMediaKeySystemAccess = async function (keySystem, options) {
                if (typeof keySystem === 'string' && keySystem.indexOf("playready") !== -1) {
                    try {
                        return await original(keySystem, options);
                    } catch (e) {
                        console.warn("[Optimizer+] Fallback PlayReady hardware -> software");
                        return await original("com.microsoft.playready", options);
                    }
                }
                return await original(keySystem, options);
            };
        }

        console.log('[Optimizer+] Hooks DRM install\u00E9s');
    }

    // UI INJECTION - Adds the panel to the Boosteroid menu

    // Hide Boosteroid's own "Brighter image" option: it conflicts with the script's filters
    function hideBoosteroidBrighterOption() {
        // Only rows that hold a toggle, not the stats panels
        const switchBlocks = document.querySelectorAll('.menu_switch_block');

        switchBlocks.forEach(block => {
            const hasToggle = block.querySelector('input[type="checkbox"], .switch, .toggle');
            if (!hasToggle) return;

            if (block.closest('.optimizer-injected')) return;

            const text = block.textContent?.toLowerCase() || '';

            // Label of the "Brighter image" option in each language
            const brighterKeywords = [
                'brighter image', 'image plus lumineuse', 'helleres bild',
                'imagen m\u00E1s brillante', 'immagine pi\u00F9 luminosa', 'imagem mais brilhante',
                '\u044F\u0440\u0447\u0435 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435', 'ja\u015Bniejszy obraz', '\u044F\u0441\u043A\u0440\u0430\u0432\u0456\u0448\u0435 \u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u043D\u044F',
                'daha parlak', 'sv\u011Btlej\u0161\u00ED obraz', 'f\u00E9nyesebb k\u00E9p', 'imagine mai luminoas\u0103'
            ];

            const isBrighterOption = brighterKeywords.some(kw => text.includes(kw.toLowerCase()));

            if (isBrighterOption) {
                block.style.display = 'none';
                block.style.visibility = 'hidden';
                block.style.pointerEvents = 'none';
                console.log('[Optimizer+] Masqu\u00E9: option "Image plus lumineuse" de Boosteroid');
            }
        });
    }

    function findInsertionPoint(menu) {
        const menuBlocks = menu.querySelectorAll('.menu_block');
        if (menuBlocks.length > 0) {
            return menuBlocks[menuBlocks.length - 1];
        }

        const menuTitles = menu.querySelectorAll('.menu_title');
        if (menuTitles.length > 0) {
            return menuTitles[menuTitles.length - 1];
        }

        return null;
    }

    // GAME SESSION DETECTION

    function isDashboardPage() {
        const path = window.location.pathname.toLowerCase();

        if (path.includes('streaming.html') || path.includes('/streaming/')) {
            return false;
        }

        const dashboardPatterns = [
            '/dashboard',
            '/library',
            '/store',
            '/settings',
            '/profile',
            '/subscription',
            '/support'
        ];

        if (path === '/' || path === '') {
            return true;
        }

        return dashboardPatterns.some(pattern => path.includes(pattern));
    }

    function isStreamingPage() {
        const path = window.location.pathname.toLowerCase();
        const href = window.location.href.toLowerCase();

        if (path.includes('streaming.html') || href.includes('sessionid=')) {
            return true;
        }

        const gamePatterns = ['/play/', '/game/', '/stream/', '/session/', '/run/'];
        return gamePatterns.some(pattern => path.includes(pattern));
    }

    // Returns the open Boosteroid options menu, or null. Desktop: #menu.menu_desktop, mobile: .m_lan_wrapper, both shown with display:block
    function findOpenOptionsMenu() {
        const mobileMenus = document.querySelectorAll('.m_lan_wrapper');
        for (const mobileMenu of mobileMenus) {
            const style = window.getComputedStyle(mobileMenu);
            if (style.display !== 'none' && mobileMenu.offsetParent !== null) {
                console.log('[Optimizer+] Menu Mobile Boosteroid trouvé (.m_lan_wrapper visible)');
                return mobileMenu;
            }
        }

        const boosteroidMenu = document.querySelector('#menu.menu_desktop');
        if (boosteroidMenu) {
            const style = window.getComputedStyle(boosteroidMenu);
            if (style.display !== 'none' && boosteroidMenu.offsetParent !== null) {
                console.log('[Optimizer+] Menu Boosteroid trouvé (#menu.menu_desktop)');
                return boosteroidMenu;
            }
        }

        const menuById = document.getElementById('menu');
        if (menuById && menuById.classList.contains('menu_desktop')) {
            const style = window.getComputedStyle(menuById);
            if (style.display !== 'none') {
                return menuById;
            }
        }

        // Fallback: search by structure (menu_title inside a menu container)
        const menuTitles = document.querySelectorAll('.menu_title');
        for (const title of menuTitles) {
            let parent = title.parentElement;
            while (parent && parent !== document.body) {
                if (parent.id === 'menu' || parent.classList.contains('menu_desktop') ||
                    parent.classList.contains('m_lan_wrapper')) {
                    const style = window.getComputedStyle(parent);
                    if (style.display !== 'none' && parent.offsetParent !== null) {
                        return parent;
                    }
                }
                parent = parent.parentElement;
            }
        }

        return null;
    }

    function cleanupUI() {
        const elementsToRemove = [
            '.optimizer-injected',
            '#optimizer-notification',
            '#optimizer-dashboard-widget',
            '.optimizer-overlay',
            '#opt-notification-style'
        ];

        elementsToRemove.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => el.remove());
        });

        // Also detach the dashboard widget's document handlers
        if (typeof detachWidgetEvents === 'function') {
            try { detachWidgetEvents(); } catch (_) { }
        }

        // WebGPU: stop render loop when leaving game
        if (!SessionState.isGameActive && typeof videoEnhancer !== 'undefined') {
            videoEnhancer.removeFiltersFromAllVideos();
        }

        SessionState.isUIInjected = false;

        console.log('[Optimizer+] UI nettoy\u00E9e');
    }

    // Injects the UI only during a game session and while the options menu is open
    function injectUI() {
        // INITIAL CHECK

        const onStreaming = isStreamingPage();
        console.log('[Optimizer+] Page de streaming:', onStreaming);
        console.log('[Optimizer+] URL:', window.location.href);

        if (isDashboardPage() && !onStreaming) {
            console.log('[Optimizer+] Dashboard détecté - UI désactivée');
            return;
        }

// MAIN OBSERVER - Tracks game and menu state

        let lastUrl = window.location.href;
        let isInjecting = false; // Mutex against double injection
        let _lastCheckTime = 0; // Throttle: keeps this off the main thread during play
        let throttleTimer = null;

        // Style/class changes are observed on the menu containers only, so in-game DOM
        // churn (cursor, overlays) never reaches a script callback.
        const watchedMenus = new WeakSet();
        const menuObserver = new MutationObserver(() => setTimeout(checkAndInject, 50));
        const watchMenus = () => {
            document.querySelectorAll('#menu, .m_lan_wrapper').forEach((el) => {
                if (watchedMenus.has(el)) return;
                watchedMenus.add(el);
                menuObserver.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
            });
        };

        const checkAndInject = () => {
            const now = Date.now();
            const timeSinceLast = now - _lastCheckTime;

            if (timeSinceLast < 500) {
                // Throttled: schedule one check at the end of the window
                if (throttleTimer) clearTimeout(throttleTimer);
                throttleTimer = setTimeout(() => {
                    throttleTimer = null;
                    checkAndInject();
                }, 500 - timeSinceLast);
                return;
            }

            _lastCheckTime = now;
            if (throttleTimer) {
                clearTimeout(throttleTimer);
                throttleTimer = null;
            }

            watchMenus();
            if (isInjecting) return;
            isInjecting = true;

            try {
                SessionState.selfHeal();

                const onStreaming = isStreamingPage();

                if (!onStreaming && isDashboardPage()) {
                    if (SessionState.isUIInjected) {
                        cleanupUI();
                    }
                    return;
                }

                // Streaming enhancements start with the streaming page, before the menu exists
                if (onStreaming && !StreamingEnhancements.active) {
                    StreamingEnhancements.enable();
                }

                const menu = findOpenOptionsMenu();

                if (menu && !SessionState.isUIInjected) {
                    if (!isUIFullyInjected(menu)) {
                        if (document.querySelector('.optimizer-injected')) {
                            cleanupUI();
                        }
                        createOptimizerUI(menu);
                        hideBoosteroidBrighterOption();
                        SessionState.isUIInjected = true;
                        SessionState.isMenuOpen = true;
                        SessionState.isGameActive = true;
                        SessionState.retryCount = 0;
                        console.log('[Optimizer+] [OK] UI injectée dans le menu Boosteroid');
                    }
                } else if (menu && SessionState.isUIInjected) {
                    // Boosteroid may have partially destroyed the UI
                    if (!isUIFullyInjected(menu)) {
                        console.log('[Optimizer+] UI partiellement détruite détectée lors du check, réinjection...');
                        cleanupUI();
                        createOptimizerUI(menu);
                    }
                    hideBoosteroidBrighterOption();
                    SessionState.isUIInjected = true;
                    SessionState.isMenuOpen = true;
                    SessionState.retryCount = 0;
                } else if (!menu && SessionState.isUIInjected) {
                    // Menu closed: clean up to avoid orphans
                    cleanupUI();
                    SessionState.isMenuOpen = false;
                }
            } finally {
                isInjecting = false;
            }
        };

        const handleUrlChange = () => {
            if (window.location.href !== lastUrl) {
                lastUrl = window.location.href;
                console.log('[Optimizer+] Navigation d\u00E9tect\u00E9e:', window.location.pathname);

                if (SessionState.hasSessionChanged()) {
                    console.log('[Optimizer+] Nouveau jeu d\u00E9tect\u00E9 - r\u00E9initialisation');
                    SessionState.forceReinject();
                    setTimeout(checkAndInject, 500);
                    return;
                }

                if (isDashboardPage()) {
                    cleanupUI();
                    SessionState.reset();
                } else {
                    setTimeout(checkAndInject, 500);
                }
            }
        };

        // OBSERVERS

        const domObserver = new MutationObserver((mutations) => {
            handleUrlChange();

            let shouldCheck = false;
            const len = mutations.length;
            for (let i = 0; i < len; i++) {
                const mutation = mutations[i];
                if (mutation.type === 'childList') {
                    const added = mutation.addedNodes;
                    const addedLen = added.length;
                    for (let j = 0; j < addedLen; j++) {
                        const node = added[j];
                        if (node.nodeType === 1) { // Node.ELEMENT_NODE
                            const id = node.id;
                            const classList = node.classList;
                            const name = node.nodeName;
                            if (id === 'menu' ||
                                name === 'VIDEO' ||
                                (classList && (
                                    classList.contains('menu_desktop') ||
                                    classList.contains('menu_block') ||
                                    classList.contains('m_lan_wrapper') ||
                                    classList.contains('menu_title') ||
                                    classList.contains('menu_switch_block')
                                ))) {
                                shouldCheck = true;
                                break;
                            }
                        }
                    }
                    if (shouldCheck) break;
                }
            }

            if (shouldCheck) {
                // Let the DOM settle
                setTimeout(checkAndInject, 50);
            }
        });

        domObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Clicks and taps may open the menu
        const clickHandler = () => {
            if (document.pointerLockElement) return; // in-game click: the menu cannot open
            setTimeout(checkAndInject, 300);
        };
        document.addEventListener('click', clickHandler, { passive: true });
        document.addEventListener('touchend', clickHandler, { passive: true });

        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                setTimeout(checkAndInject, 100);
            }
        };
        document.addEventListener('keydown', keyHandler);

        const popstateHandler = () => {
            setTimeout(() => {
                handleUrlChange();
                checkAndInject();
            }, 100);
        };
        window.addEventListener('popstate', popstateHandler);

        // Tab visible again (alt-tab): make sure the renderer is running
        const visibilityHandler = () => {
            if (document.visibilityState === 'visible' && isStreamingPage()) {
                console.log('[Optimizer+] Onglet redevenu visible - réactivation et vérification des filtres');
                if (typeof videoEnhancer !== 'undefined' && videoEnhancer.ensureActive) {
                    videoEnhancer.ensureActive();
                }
                setTimeout(() => {
                    SessionState.selfHeal();
                    checkAndInject();
                }, 300);
            }
        };
        document.addEventListener('visibilitychange', visibilityHandler);

        const focusHandler = () => {
            if (isStreamingPage()) {
                if (typeof videoEnhancer !== 'undefined' && videoEnhancer.ensureActive) {
                    videoEnhancer.ensureActive();
                }
                setTimeout(checkAndInject, 200);
            }
        };
        window.addEventListener('focus', focusHandler);

        const fullscreenHandler = () => {
            console.log('[Optimizer+] Changement de plein écran détecté');
            setTimeout(checkAndInject, 200);
            setTimeout(checkAndInject, 800);
        };
        document.addEventListener('fullscreenchange', fullscreenHandler);

        const resizeHandler = () => {
            setTimeout(checkAndInject, 200);
            setTimeout(checkAndInject, 800);
        };
        window.addEventListener('resize', resizeHandler);

        // isStreamingPage() is re-read every iteration: it changes on dashboard/game navigation
        // Poll rarely once the UI is injected: the observers handle detection
        const scheduleNextCheck = () => {
            const streamingNow = isStreamingPage();
            const delay = streamingNow
                ? (SessionState.isUIInjected ? 10000 : 2000)
                : 5000;
            setTimeout(() => {
                if (isStreamingPage()) checkAndInject();
                scheduleNextCheck();
            }, delay);
        };
        scheduleNextCheck();

        // These observers and listeners intentionally live for the whole page lifetime

        if (onStreaming) {
            console.log('[Optimizer+] Page streaming d\u00E9tect\u00E9e - activation imm\u00E9diate');
            [100, 500, 1000, 2000].forEach(delay => setTimeout(checkAndInject, delay));
        } else {
            setTimeout(checkAndInject, 500);
        }

        console.log('[Optimizer+] Syst\u00E8me d\'injection intelligent activ\u00E9');
    }

    function showNotification(message, type = 'info') {
        const existing = document.getElementById('optimizer-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.id = 'optimizer-notification';

        const icons = {
            success: ICONS.check,
            error: ICONS.x,
            info: ICONS.activity
        };

        const colors = {
            success: '#22c55e',
            error: '#ef4444',
            info: '#00a3ff'
        };

        // message goes into a text node, never innerHTML (XSS)
        const iconSpan = document.createElement('span');
        iconSpan.style.cssText = `display: flex; align-items: center; color: ${colors[type] || colors.info};`;
        iconSpan.innerHTML = icons[type] || icons.info; // hard-coded SVG, safe
        const textSpan = document.createElement('span');
        textSpan.textContent = message;
        notification.appendChild(iconSpan);
        notification.appendChild(textSpan);

        notification.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(15, 15, 25, 0.95);
            border: 1px solid ${colors[type]}40;
            border-radius: 12px;
            padding: 12px 20px;
            display: flex;
            align-items: center;
            gap: 10px;
            color: #fff;
            font-size: 13px;
            z-index: 9999999;
            backdrop-filter: blur(10px);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
            animation: opt-slide-up 0.3s ease;
        `;

        if (!document.getElementById('opt-notification-style')) {
            const style = document.createElement('style');
            style.id = 'opt-notification-style';
            style.textContent = `
                @keyframes opt-slide-up {
                    from { opacity: 0; transform: translateX(-50%) translateY(20px); }
                    to { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(-50%) translateY(20px)';
            notification.style.transition = 'all 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    function isUIFullyInjected(menuElement) {
        const root = menuElement || document;
        return root.querySelector('#optimizer-reset') !== null &&
               root.querySelector('#optimizer-res-select') !== null &&
               root.querySelector('#optimizer-enhancer') !== null &&
               root.querySelector('#optimizer-filters-toggle') !== null;
    }

    function createOptimizerUI(menuElement) {
        if (isUIFullyInjected(menuElement)) {
            console.log('[Optimizer+] UI déjà présente et complète');
            return;
        }

        if (document.querySelector('.optimizer-injected')) {
            console.log('[Optimizer+] UI incomplète détectée, nettoyage avant réinjection');
            cleanupUI();
        }

        if (!StreamingEnhancements.active) {
            StreamingEnhancements.enable();
        }

        const insertAfter = findInsertionPoint(menuElement);

        const sectionScreenAnalysis = SmartResolutionDetector.getScreenAnalysis();

        const temp = document.createElement('div');
        temp.innerHTML = `
            <!-- HEADER: Boosteroid Optimizer Plus -->
            <div class="menu_title optimizer-injected" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
                <span>Boosteroid Optimizer Plus <span class="optimizer-badge">v${SCRIPT_VERSION}</span> <span style="font-size: 11px; color: #9b99ad; font-weight: normal;">by Derfog</span></span>
                <select class="optimizer-select" id="optimizer-lang-select" style="width: auto; min-width: 65px; max-width: 90px; padding: 4px 6px; font-size: 11px; flex-shrink: 0;">
                    <option value="auto" ${CONFIG.language === 'auto' ? 'selected' : ''}>Auto</option>
                    <option value="en" ${CONFIG.language === 'en' ? 'selected' : ''}>EN</option>
                    <option value="fr" ${CONFIG.language === 'fr' ? 'selected' : ''}>FR</option>
                    <option value="de" ${CONFIG.language === 'de' ? 'selected' : ''}>DE</option>
                    <option value="es" ${CONFIG.language === 'es' ? 'selected' : ''}>ES</option>
                    <option value="it" ${CONFIG.language === 'it' ? 'selected' : ''}>IT</option>
                    <option value="pt" ${CONFIG.language === 'pt' ? 'selected' : ''}>PT</option>
                    <option value="ru" ${CONFIG.language === 'ru' ? 'selected' : ''}>RU</option>
                    <option value="pl" ${CONFIG.language === 'pl' ? 'selected' : ''}>PL</option>
                    <option value="uk" ${CONFIG.language === 'uk' ? 'selected' : ''}>UK</option>
                    <option value="tr" ${CONFIG.language === 'tr' ? 'selected' : ''}>TR</option>
                    <option value="cs" ${CONFIG.language === 'cs' ? 'selected' : ''}>CS</option>
                    <option value="hu" ${CONFIG.language === 'hu' ? 'selected' : ''}>HU</option>
                    <option value="ro" ${CONFIG.language === 'ro' ? 'selected' : ''}>RO</option>
                    <option value="sk" ${CONFIG.language === 'sk' ? 'selected' : ''}>SK</option>
                    <option value="sv" ${CONFIG.language === 'sv' ? 'selected' : ''}>SV</option>
                </select>
            </div>

            <!-- SECTION 1: RESOLUTION -->
            <div class="menu_title optimizer-injected">${escapeHtml(t('targetResolution'))}</div>
            <div class="menu_block optimizer-injected">
                <!-- Status compact -->
                <div class="menu_switch_block top_20">
                    <div class="menu_title_group">
                        <div class="optimizer-status-dot" id="optimizer-status-dot"></div>
                        <span style="margin-left: 6px;">${escapeHtml(t('active'))} - <span id="optimizer-resolution">${escapeHtml(CONFIG.resolution.width)}x${escapeHtml(CONFIG.resolution.height)}</span></span>
                    </div>
                    <span class="optimizer-hw-badge">${ICONS.cpu}</span>
                </div>

                <div class="optimizer-screen-info">
                    ${ICONS.monitor}
                    <span class="screen-detected">${escapeHtml(sectionScreenAnalysis.screen.width)}x${escapeHtml(sectionScreenAnalysis.screen.height)}</span>
                    <span class="screen-ratio">${escapeHtml(sectionScreenAnalysis.screen.ratioType)}</span>
                </div>

                <div class="menu_switch_block top_20">
                    <div class="menu_title_group">
                        ${ICONS.monitor} <span>${escapeHtml(t('resolution'))}</span>
                    </div>
                    <select class="optimizer-select" id="optimizer-res-select">
                        ${SmartResolutionDetector.generateResolutionOptionsHTML(CONFIG.resolution.width, CONFIG.resolution.height, CONFIG.resolution.isAuto)}
                    </select>
                </div>
            </div>

            <!-- SECTION 2: VIDEO ENHANCEMENT -->
            <div class="menu_title optimizer-injected">${escapeHtml(t('videoEnhancement'))}</div>
            <div class="menu_block optimizer-injected">
                <div class="menu_switch_block top_20">
                    <div class="menu_title_group">
                        <p>${escapeHtml(t('enableEnhancer'))}</p>
                    </div>
                    <label class="switch toggle-switch">
                        <input type="checkbox" id="optimizer-enhancer" ${CONFIG.enhancer.enabled ? 'checked' : ''}>
                        <span class="slider round"></span>
                    </label>
                </div>
                <div class="menu_switch_block top_20">
                    <div class="menu_title_group"><p>${escapeHtml(t('sharpness'))}</p></div>
                    <div class="menu_title_group" id="optimizer-sharp-value">${Math.round(CONFIG.enhancer.sharpness * 100)}%</div>
                    <input type="range" id="optimizer-sharpness" name="sharpness" min="0" max="100" value="${CONFIG.enhancer.sharpness * 100}">
                </div>
                <div class="menu_switch_block top_20">
                    <div class="menu_title_group"><p>${escapeHtml(t('contrast'))}</p></div>
                    <div class="menu_title_group" id="optimizer-contrast-value">${Math.round(CONFIG.enhancer.contrast * 100)}%</div>
                    <input type="range" id="optimizer-contrast" name="contrast" min="80" max="120" value="${CONFIG.enhancer.contrast * 100}">
                </div>
                <div class="menu_switch_block top_20">
                    <div class="menu_title_group"><p>${escapeHtml(t('saturation'))}</p></div>
                    <div class="menu_title_group" id="optimizer-sat-value">${Math.round(CONFIG.enhancer.saturation * 100)}%</div>
                    <input type="range" id="optimizer-saturation" name="saturation" min="80" max="120" value="${CONFIG.enhancer.saturation * 100}">
                </div>
            </div>

            <!-- SECTION 3: QUICK PRESETS -->
            <div class="menu_title optimizer-injected">${escapeHtml(t('quickPresets'))}</div>
            <div class="menu_block optimizer-injected">
                <div class="menu_switch_block top_20" style="flex-direction: column; align-items: flex-start; padding: 4px 0;">
                    <div class="optimizer-presets" id="optimizer-presets">
                        <button class="optimizer-preset-btn ${CONFIG.filters.preset === 'perfect' ? 'active' : ''}" data-preset="perfect">${ICONS.sparkles} Perfect</button>
                        <button class="optimizer-preset-btn ${CONFIG.filters.preset === 'default' ? 'active' : ''}" data-preset="default">${ICONS.target} ${escapeHtml(t('presetDefault'))}</button>
                        <button class="optimizer-preset-btn ${CONFIG.filters.preset === 'cinematic' ? 'active' : ''}" data-preset="cinematic">${ICONS.film} ${escapeHtml(t('presetCinematic'))}</button>
                        <button class="optimizer-preset-btn ${CONFIG.filters.preset === 'game' ? 'active' : ''}" data-preset="game">${ICONS.crosshair} ${escapeHtml(t('presetGame'))}</button>
                        <button class="optimizer-preset-btn ${CONFIG.filters.preset === 'comfort' ? 'active' : ''}" data-preset="comfort">${ICONS.eye} ${escapeHtml(t('presetComfort'))}</button>
                    </div>
                </div>
            </div>

            <!-- SECTION 4: ADVANCED FILTERS -->
            <div class="menu_title optimizer-injected">${escapeHtml(t('advancedFilters'))}</div>
            <div class="menu_block optimizer-injected">
                <div class="menu_switch_block top_20">
                    <div class="menu_title_group">
                        <p>${escapeHtml(t('enableAdvanced') || 'Activer filtres avancés')}</p>
                    </div>
                    <label class="switch toggle-switch">
                        <input type="checkbox" id="optimizer-filters-toggle" ${CONFIG.filters.enabled ? 'checked' : ''}>
                        <span class="slider round"></span>
                    </label>
                </div>

                <!-- Performance Mode Toggle -->
                <div class="menu_switch_block top_20">
                    <div class="menu_title_group">
                        <p>${escapeHtml(t('performanceMode') || 'Mode Performance')}</p>
                        <span class="menu_setting_info" title="${escapeHtml(t('performanceModeDesc') || 'Filtres optimisés pour FPS max (désactive deband lourd et clarity)')}">ⓘ</span>
                    </div>
                    <label class="switch toggle-switch">
                        <input type="checkbox" id="optimizer-filters-performance-toggle" ${CONFIG.filters.performanceMode ? 'checked' : ''}>
                        <span class="slider round"></span>
                    </label>
                </div>

                <div id="optimizer-filters-details" style="display: ${CONFIG.filters.enabled ? 'block' : 'none'};">
                    <!-- USM Filter -->
                    <div class="menu_switch_block top_20">
                        <div class="menu_title_group">
                            <p>USM</p>
                        </div>
                        <label class="switch toggle-switch">
                            <input type="checkbox" class="optimizer-filter-checkbox" data-filter="usm" ${CONFIG.filters.usm.enabled ? 'checked' : ''}>
                            <span class="slider round"></span>
                        </label>
                    </div>
                    <div class="menu_switch_block top_20">
                        <div class="menu_title_group" id="usm-title">${Math.round(CONFIG.filters.usm.amount * 100)}%</div>
                        <input type="range" id="usm-amount" name="usm-amount" min="0" max="100" value="${CONFIG.filters.usm.amount * 100}">
                    </div>

                    <!-- CAS Filter -->
                    <div class="menu_switch_block top_20">
                        <div class="menu_title_group">
                            <p>CAS</p>
                        </div>
                        <label class="switch toggle-switch">
                            <input type="checkbox" class="optimizer-filter-checkbox" data-filter="cas" ${CONFIG.filters.cas.enabled ? 'checked' : ''}>
                            <span class="slider round"></span>
                        </label>
                    </div>
                    <div class="menu_switch_block top_20">
                        <div class="menu_title_group" id="cas-title">${Math.round(CONFIG.filters.cas.sharpness * 100)}%</div>
                        <input type="range" id="cas-sharpness" name="cas-sharpness" min="0" max="100" value="${CONFIG.filters.cas.sharpness * 100}">
                    </div>

                    <!-- Clarity Filter -->
                    <div class="menu_switch_block top_20">
                        <div class="menu_title_group">
                            <p>${escapeHtml(t('clarity') || 'Clarity')}</p>
                        </div>
                        <label class="switch toggle-switch">
                            <input type="checkbox" class="optimizer-filter-checkbox" data-filter="clarity" ${CONFIG.filters.clarity.enabled ? 'checked' : ''}>
                            <span class="slider round"></span>
                        </label>
                    </div>
                    <div class="menu_switch_block top_20">
                        <div class="menu_title_group" id="clarity-title">${Math.round(CONFIG.filters.clarity.amount * 100)}%</div>
                        <input type="range" id="clarity-amount" name="clarity-amount" min="0" max="100" value="${CONFIG.filters.clarity.amount * 100}">
                    </div>

                    <!-- Denoise Filter -->
                    <div class="menu_switch_block top_20">
                        <div class="menu_title_group">
                            <p>${escapeHtml(t('denoise') || 'Denoise')}</p>
                        </div>
                        <label class="switch toggle-switch">
                            <input type="checkbox" class="optimizer-filter-checkbox" data-filter="denoise" ${CONFIG.filters.denoise.enabled ? 'checked' : ''}>
                            <span class="slider round"></span>
                        </label>
                    </div>
                    <div class="menu_switch_block top_20">
                        <div class="menu_title_group" id="denoise-title">${Math.round(CONFIG.filters.denoise.strength * 100)}%</div>
                        <input type="range" id="denoise-strength" name="denoise-strength" min="0" max="100" value="${CONFIG.filters.denoise.strength * 100}">
                    </div>

                    <!-- Vibrance Filter -->
                    <div class="menu_switch_block top_20">
                        <div class="menu_title_group">
                            <p>${escapeHtml(t('vibrance') || 'Vibrance')}</p>
                        </div>
                        <label class="switch toggle-switch">
                            <input type="checkbox" class="optimizer-filter-checkbox" data-filter="vibrance" ${CONFIG.filters.vibrance.enabled ? 'checked' : ''}>
                            <span class="slider round"></span>
                        </label>
                    </div>
                    <div class="menu_switch_block top_20">
                        <div class="menu_title_group" id="vibrance-title">${Math.round(CONFIG.filters.vibrance.amount * 100)}%</div>
                        <input type="range" id="vibrance-amount" name="vibrance-amount" min="0" max="100" value="${CONFIG.filters.vibrance.amount * 100}">
                    </div>

                    <!-- Deband Filter -->
                    <div class="menu_switch_block top_20">
                        <div class="menu_title_group">
                            <p>${escapeHtml(t('deband') || 'Deband')}</p>
                        </div>
                        <label class="switch toggle-switch">
                            <input type="checkbox" class="optimizer-filter-checkbox" data-filter="deband" ${CONFIG.filters.deband.enabled ? 'checked' : ''}>
                            <span class="slider round"></span>
                        </label>
                    </div>
                    <div class="menu_switch_block top_20">
                        <div class="menu_title_group" id="deband-title">${Math.round(CONFIG.filters.deband.strength * 100)}%</div>
                        <input type="range" id="deband-strength" name="deband-strength" min="0" max="100" value="${CONFIG.filters.deband.strength * 100}">
                    </div>
                </div>
            </div>

            <!-- SECTION 5: OPTIONS -->
            <div class="menu_title optimizer-injected">${escapeHtml(t('options') || 'Options')}</div>
            <div class="menu_block optimizer-injected">
                <!-- Stretch Mode (No Borders) -->
                <div class="menu_switch_block top_20" style="margin-top: 15px;">
                    <div class="menu_title_group">
                        ${ICONS.monitor} <span style="margin-left: 4px;">${escapeHtml(t('stretchMode'))}</span>
                    </div>
                    <label class="switch toggle-switch">
                        <input type="checkbox" id="optimizer-stretch-mode">
                        <span class="slider round"></span>
                    </label>
                </div>

                <!-- Reset Button -->
                <div class="menu_switch_block top_20" style="margin-top: 15px;">
                    <button class="optimizer-btn secondary" id="optimizer-reset" style="width: 100%;">
                        ${ICONS.refresh} ${escapeHtml(t('reset'))}
                    </button>
                </div>
            </div>
        `;

        const children = Array.from(temp.children);
        if (insertAfter && insertAfter.parentNode) {
            let current = insertAfter;
            children.forEach(child => {
                current.parentNode.insertBefore(child, current.nextSibling);
                current = child;
            });
            console.log('[Optimizer+] UI injectée directement après la section Streaming');
        } else {
            children.forEach(child => {
                menuElement.appendChild(child);
            });
            console.log('[Optimizer+] UI ajoutée à la fin du menu');
        }

        attachUIEvents();

        initSliderStyles();

        console.log('[Optimizer+] Interface injectée avec succès');
    }

    function createCustomSlider(inputElement) {
        const wrapper = document.createElement('div');
        wrapper.className = 'optimizer-slider';

        const track = document.createElement('div');
        track.className = 'optimizer-slider-track';

        const fill = document.createElement('div');
        fill.className = 'optimizer-slider-fill';

        const thumb = document.createElement('div');
        thumb.className = 'optimizer-slider-thumb';

        wrapper.appendChild(track);
        wrapper.appendChild(fill);
        wrapper.appendChild(thumb);

        inputElement.parentNode.insertBefore(wrapper, inputElement);
        wrapper.appendChild(inputElement);

        const updateVisual = () => {
            const min = parseFloat(inputElement.min) || 0;
            const max = parseFloat(inputElement.max) || 100;
            const value = parseFloat(inputElement.value) || 0;
            const percentage = ((value - min) / (max - min)) * 100;

            fill.style.width = `${percentage}%`;
            thumb.style.left = `${percentage}%`;
        };

        updateVisual();

        inputElement.addEventListener('input', updateVisual);

        return wrapper;
    }

    function initSliderStyles() {
        const sliders = document.querySelectorAll('.optimizer-injected input[type="range"]');

        sliders.forEach(slider => {
            if (!slider.parentElement.classList.contains('optimizer-slider')) {
                createCustomSlider(slider);
            }
        });
    }

    function attachUIEvents() {
        const autoSave = () => {
            saveConfig(true);
        };

        const resSelect = document.getElementById('optimizer-res-select');
        if (resSelect) {
            resSelect.addEventListener('change', (e) => {
                const value = e.target.value;
                let width, height;
                let isAutoMode = false;

                if (value === 'auto') {
                    isAutoMode = true;
                    const autoRes = SmartResolutionDetector.applyAutoResolution();
                    if (autoRes) {
                        width = autoRes.w;
                        height = autoRes.h;
                    } else {
                        const screen = SmartResolutionDetector.getScreenDimensions();
                        width = screen.width;
                        height = screen.height;
                    }
                } else {
                    [width, height] = value.split('x').map(Number);
                }

                CONFIG.resolution.width = width;
                CONFIG.resolution.height = height;
                CONFIG.resolution.isAuto = isAutoMode;
                CONFIG.resolution.pixelRatio = width >= 3840 ? 2 : (width >= 2560 ? 1.5 : 1);

                const resDisplay = document.getElementById('optimizer-resolution');
                if (resDisplay) {
                    resDisplay.textContent = isAutoMode ? `Auto: ${width}x${height}` : `${width}x${height}`;
                }

                hookResolution();

                // Make Boosteroid recompute the video size (avoids the zoomed-corner bug)
                setTimeout(() => {
                    window.dispatchEvent(new Event('resize'));
                    const video = document.querySelector('video');
                    if (video && !CONFIG.display.stretchMode) {
                        video.style.transform = '';
                    }
                }, 100);

                // aspectRatio must be a number (toFixed returns a string)
                const aspectRatio = width / height;
                let ratioName = '16:9';
                if (aspectRatio >= 3.4) ratioName = '32:9';
                else if (aspectRatio >= 2.2) ratioName = '21:9';
                else if (aspectRatio >= 1.75) ratioName = '16:9';
                else if (aspectRatio >= 1.55) ratioName = '16:10';

                const modeText = isAutoMode ? 'Auto' : '';
                showNotification(`${modeText} Resolution: ${width}x${height} (${ratioName})`);
                autoSave();
                confirmResolution(width, height);
            });
        }

        const enhancerToggle = document.getElementById('optimizer-enhancer');
        if (enhancerToggle) {
            enhancerToggle.addEventListener('change', (e) => {
                videoEnhancer.toggle(e.target.checked);
                autoSave();
            });
        }

        const filtersToggle = document.getElementById('optimizer-filters-toggle');
        if (filtersToggle) {
            filtersToggle.addEventListener('change', (e) => {
                videoEnhancer.toggleFilters(e.target.checked);
                const detailsSection = document.getElementById('optimizer-filters-details');
                if (detailsSection) {
                    detailsSection.style.display = e.target.checked ? 'block' : 'none';
                }
                if (!e.target.checked) {
                    CONFIG.filters.preset = null;
                    document.querySelectorAll('.optimizer-preset-btn').forEach(btn => btn.classList.remove('active'));
                }
                autoSave();
            });
        }

        // Performance mode: lighter shader path, the user's filter config is untouched
        const filtersPerfToggle = document.getElementById('optimizer-filters-performance-toggle');
        if (filtersPerfToggle) {
            filtersPerfToggle.addEventListener('change', (e) => {
                CONFIG.filters.performanceMode = e.target.checked;
                console.log(`[Optimizer+] Performance Mode: ${e.target.checked ? 'ON (filtres légers)' : 'OFF (qualité max)'}`);
                videoEnhancer.updateFilterString();
                videoEnhancer.applyFiltersToAllVideos();
                if (typeof showNotification === 'function') {
                    showNotification(e.target.checked
                        ? t('perfModeNotifOn' ) || 'Mode Performance: FPS maximisés'
                        : t('perfModeNotifOff') || 'Mode Performance désactivé (qualité max)');
                }
                autoSave();
            });
        }

        const stretchModeToggle = document.getElementById('optimizer-stretch-mode');
        if (stretchModeToggle) {
            stretchModeToggle.addEventListener('change', (e) => {
                CONFIG.display.stretchMode = e.target.checked;
                // No autoSave(): stretch does not persist across sessions
                if (e.target.checked) {
                    document.documentElement.classList.add('optimizer-stretch-mode');
                    // WebGPU: stretch the canvas too
                    const glCanvas = document.getElementById('optimizer-webgpu-canvas') || document.getElementById('optimizer-webgl-canvas');
                    if (glCanvas) glCanvas.style.objectFit = 'fill';
                    showNotification('Stretch Mode ON (Borders Removed)');
                } else {
                    document.documentElement.classList.remove('optimizer-stretch-mode');
                    const glCanvas = document.getElementById('optimizer-webgpu-canvas') || document.getElementById('optimizer-webgl-canvas');
                    if (glCanvas) glCanvas.style.objectFit = 'contain';
                    showNotification('Stretch Mode OFF');
                }
                videoEnhancer.refreshBox();
            });
        }

        const sharpSlider = document.getElementById('optimizer-sharpness');
        if (sharpSlider) {
            sharpSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value) / 100;
                document.getElementById('optimizer-sharp-value').textContent = `${e.target.value}%`;
                videoEnhancer.updateSettings({ sharpness: value });
                autoSave();
            });
        }

        const contrastSlider = document.getElementById('optimizer-contrast');
        if (contrastSlider) {
            contrastSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value) / 100;
                document.getElementById('optimizer-contrast-value').textContent = `${e.target.value}%`;
                videoEnhancer.updateSettings({ contrast: value });
                autoSave();
            });
        }

        const satSlider = document.getElementById('optimizer-saturation');
        if (satSlider) {
            satSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value) / 100;
                document.getElementById('optimizer-sat-value').textContent = `${e.target.value}%`;
                videoEnhancer.updateSettings({ saturation: value });
                autoSave();
            });
        }

        const resetBtn = document.getElementById('optimizer-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                CONFIG.resolution = { ...DEFAULT_CONFIG.resolution };
                CONFIG.enhancer = { ...DEFAULT_CONFIG.enhancer };
                CONFIG.enhancer.enabled = true;
                CONFIG.filters = JSON.parse(JSON.stringify(DEFAULT_CONFIG.filters));
                CONFIG.language = DEFAULT_CONFIG.language;

                if (CONFIG.display) CONFIG.display.stretchMode = false;
                document.documentElement.classList.remove('optimizer-stretch-mode');
                const glCanvas = document.getElementById('optimizer-webgpu-canvas') || document.getElementById('optimizer-webgl-canvas');
                if (glCanvas) glCanvas.style.objectFit = 'contain';

                localStorage.removeItem('optimizer_config');
                saveConfig(false);

                videoEnhancer.enabled = CONFIG.enhancer.enabled;
                videoEnhancer.filtersEnabled = CONFIG.filters.enabled;
                videoEnhancer.updateFilterString();
                videoEnhancer.applyFiltersToAllVideos();

                updateAllUIValues();

                showNotification('[OK] ' + t('settingsReset').replace('[<<] ', ''));
                console.log('[Optimizer+] Reset effectu\u00E9 - valeurs par d\u00E9faut restaur\u00E9es');
            });
        }

        const langSelect = document.getElementById('optimizer-lang-select');
        if (langSelect) {
            langSelect.addEventListener('change', (e) => {
                const newLang = e.target.value;
                CONFIG.language = newLang;

                if (newLang === 'auto') {
                    const browserLang = (navigator.language || navigator.userLanguage || 'en').substring(0, 2).toLowerCase();
                    currentLang = I18N.translations[browserLang] ? browserLang : 'en';
                } else {
                    currentLang = newLang;
                }

                autoSave();
                showNotification(`${t('language')}: ${e.target.options[e.target.selectedIndex].text}`);

                // Rebuild the UI in the new language
                setTimeout(() => {
                    const injectedElements = document.querySelectorAll('.optimizer-injected');
                    if (injectedElements.length > 0) {
                        injectedElements.forEach(el => el.remove());
                        SessionState.isUIInjected = false;
                        const menu = findOpenOptionsMenu();
                        if (menu) {
                            createOptimizerUI(menu);
                            SessionState.isUIInjected = true;
                        }
                    }
                }, 500);
            });
        }

        // === ADVANCED FILTERS ===

        const presetBtns = document.querySelectorAll('.optimizer-preset-btn');
        presetBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const preset = e.currentTarget.dataset.preset;
                videoEnhancer.applyPreset(preset);

                presetBtns.forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');

                // Defer DOM updates to next frame to avoid reflow shake
                requestAnimationFrame(() => updateFiltersUI());

                autoSave();
                showNotification(t('presetApplied', { name: FILTER_PRESETS[preset]?.name || preset }));
            });
        });

        document.querySelectorAll('.optimizer-filter-checkbox').forEach(toggle => {
            toggle.addEventListener('change', (e) => {
                const filterName = e.target.dataset.filter;
                const isActive = e.target.checked;

                videoEnhancer.toggleFilter(filterName, isActive);

                setPresetToCustom();
                autoSave();
            });
        });

        const usmAmount = document.getElementById('usm-amount');
        if (usmAmount) {
            usmAmount.addEventListener('input', (e) => {
                const value = parseInt(e.target.value) / 100;
                document.getElementById('usm-title').textContent = `${e.target.value}%`;
                videoEnhancer.updateFilterSettings('usm', { amount: value });
                setPresetToCustom();
                autoSave();
            });
        }

        const casSharpness = document.getElementById('cas-sharpness');
        if (casSharpness) {
            casSharpness.addEventListener('input', (e) => {
                const value = parseInt(e.target.value) / 100;
                document.getElementById('cas-title').textContent = `${e.target.value}%`;
                videoEnhancer.updateFilterSettings('cas', { sharpness: value });
                setPresetToCustom();
                autoSave();
            });
        }

        const clarityAmount = document.getElementById('clarity-amount');
        if (clarityAmount) {
            clarityAmount.addEventListener('input', (e) => {
                const value = parseInt(e.target.value) / 100;
                document.getElementById('clarity-title').textContent = `${e.target.value}%`;
                videoEnhancer.updateFilterSettings('clarity', { amount: value });
                setPresetToCustom();
                autoSave();
            });
        }

        const denoiseStrength = document.getElementById('denoise-strength');
        if (denoiseStrength) {
            denoiseStrength.addEventListener('input', (e) => {
                const value = parseInt(e.target.value) / 100;
                document.getElementById('denoise-title').textContent = `${e.target.value}%`;
                videoEnhancer.updateFilterSettings('denoise', { strength: value });
                setPresetToCustom();
                autoSave();
            });
        }

        const vibranceAmount = document.getElementById('vibrance-amount');
        if (vibranceAmount) {
            vibranceAmount.addEventListener('input', (e) => {
                const value = parseInt(e.target.value) / 100;
                document.getElementById('vibrance-title').textContent = `${e.target.value}%`;
                videoEnhancer.updateFilterSettings('vibrance', { amount: value });
                setPresetToCustom();
                autoSave();
            });
        }

        const debandStrength = document.getElementById('deband-strength');
        if (debandStrength) {
            debandStrength.addEventListener('input', (e) => {
                const value = parseInt(e.target.value) / 100;
                document.getElementById('deband-title').textContent = `${e.target.value}%`;
                videoEnhancer.updateFilterSettings('deband', { strength: value });
                setPresetToCustom();
                autoSave();
            });
        }
    }

    // Refresh the whole UI from CONFIG
    function updateAllUIValues() {
        const resSelect = document.getElementById('optimizer-res-select');
        if (resSelect) {
            resSelect.value = `${CONFIG.resolution.width}x${CONFIG.resolution.height}`;
        }
        const resDisplay = document.getElementById('optimizer-resolution');
        if (resDisplay) {
            resDisplay.textContent = `${CONFIG.resolution.width}x${CONFIG.resolution.height}`;
        }

        const enhancerToggle = document.getElementById('optimizer-enhancer');
        if (enhancerToggle) {
            enhancerToggle.checked = CONFIG.enhancer.enabled;
        }

        const filtersToggle = document.getElementById('optimizer-filters-toggle');
        if (filtersToggle) {
            filtersToggle.checked = CONFIG.filters.enabled;
        }

        const stretchModeToggle = document.getElementById('optimizer-stretch-mode');
        if (stretchModeToggle && CONFIG.display) {
            stretchModeToggle.checked = CONFIG.display.stretchMode;
        }

        const filtersPerfToggle = document.getElementById('optimizer-filters-performance-toggle');
        if (filtersPerfToggle) {
            filtersPerfToggle.checked = CONFIG.filters.performanceMode;
        }

        const presetBtns = document.querySelectorAll('.optimizer-preset-btn');
        presetBtns.forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.preset === CONFIG.filters.preset) {
                btn.classList.add('active');
            }
        });

        const langSelect = document.getElementById('optimizer-lang-select');
        if (langSelect) {
            langSelect.value = CONFIG.language;
        }

        updateFiltersUI();

    }

    function updateFiltersUI() {
        // Sync advanced filters details drawer visibility
        const detailsSection = document.getElementById('optimizer-filters-details');
        if (detailsSection) {
            detailsSection.style.display = CONFIG.filters.enabled ? 'block' : 'none';
        }

        // Performance mode changes the shader, not the config: sliders always stay enabled

        const sharpSlider = document.getElementById('optimizer-sharpness');
        if (sharpSlider) {
            sharpSlider.value = CONFIG.enhancer.sharpness * 100;
            document.getElementById('optimizer-sharp-value').textContent = `${Math.round(CONFIG.enhancer.sharpness * 100)}%`;
        }

        const contrastSlider = document.getElementById('optimizer-contrast');
        if (contrastSlider) {
            contrastSlider.value = CONFIG.enhancer.contrast * 100;
            document.getElementById('optimizer-contrast-value').textContent = `${Math.round(CONFIG.enhancer.contrast * 100)}%`;
        }

        const satSlider = document.getElementById('optimizer-saturation');
        if (satSlider) {
            satSlider.value = CONFIG.enhancer.saturation * 100;
            document.getElementById('optimizer-sat-value').textContent = `${Math.round(CONFIG.enhancer.saturation * 100)}%`;
        }

        const filters = CONFIG.filters;

        const usmAmountEl = document.getElementById('usm-amount');
        if (usmAmountEl) {
            usmAmountEl.value = filters.usm.amount * 100;
            usmAmountEl.disabled = false;
            document.getElementById('usm-title').textContent = `${Math.round(filters.usm.amount * 100)}%`;
        }

        const casSharpnessEl = document.getElementById('cas-sharpness');
        if (casSharpnessEl) {
            casSharpnessEl.value = filters.cas.sharpness * 100;
            casSharpnessEl.disabled = false;
            document.getElementById('cas-title').textContent = `${Math.round(filters.cas.sharpness * 100)}%`;
        }

        const clarityAmountEl = document.getElementById('clarity-amount');
        if (clarityAmountEl) {
            clarityAmountEl.value = filters.clarity.amount * 100;
            clarityAmountEl.disabled = false;
            document.getElementById('clarity-title').textContent = `${Math.round(filters.clarity.amount * 100)}%`;
        }

        const denoiseStrengthEl = document.getElementById('denoise-strength');
        if (denoiseStrengthEl) {
            denoiseStrengthEl.value = filters.denoise.strength * 100;
            denoiseStrengthEl.disabled = false;
            document.getElementById('denoise-title').textContent = `${Math.round(filters.denoise.strength * 100)}%`;
        }

        const vibranceAmountEl = document.getElementById('vibrance-amount');
        if (vibranceAmountEl) {
            vibranceAmountEl.value = filters.vibrance.amount * 100;
            vibranceAmountEl.disabled = false;
            document.getElementById('vibrance-title').textContent = `${Math.round(filters.vibrance.amount * 100)}%`;
        }

        const debandStrengthEl = document.getElementById('deband-strength');
        if (debandStrengthEl) {
            debandStrengthEl.value = filters.deband.strength * 100;
            debandStrengthEl.disabled = false;
            document.getElementById('deband-title').textContent = `${Math.round(filters.deband.strength * 100)}%`;
        }

        ['usm', 'cas', 'clarity', 'denoise', 'vibrance', 'deband'].forEach(filterName => {
            const checkbox = document.querySelector(`.optimizer-filter-checkbox[data-filter="${filterName}"]`);
            if (checkbox) {
                checkbox.checked = filters[filterName].enabled;
                checkbox.disabled = false;
            }
        });

        const sliders = document.querySelectorAll('.optimizer-injected input[type="range"]');
        sliders.forEach(slider => updateSliderStyle(slider));
    }

    // Updates a custom slider's fill and thumb position
    function updateSliderStyle(slider) {
        if (!slider || !slider.parentElement) return;
        const wrapper = slider.closest('.optimizer-slider');
        if (!wrapper) return; // not wrapped yet

        const fill = wrapper.querySelector('.optimizer-slider-fill');
        const thumb = wrapper.querySelector('.optimizer-slider-thumb');
        if (!fill || !thumb) return;

        const min = parseFloat(slider.min) || 0;
        const max = parseFloat(slider.max) || 100;
        const value = parseFloat(slider.value) || 0;
        const percentage = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

        fill.style.width = `${percentage}%`;
        thumb.style.left = `${percentage}%`;
    }

    // Manual edits switch the preset to custom
    function setPresetToCustom() {
        CONFIG.filters.preset = 'custom';

        document.querySelectorAll('.optimizer-preset-btn').forEach(btn => {
            btn.classList.remove('active');
        });
    }

    // VIDEO OBSERVER

    function setupVideoObserver() {
        const observer = new MutationObserver((mutations) => {
            const mutationsLen = mutations.length;
            for (let i = 0; i < mutationsLen; i++) {
                const added = mutations[i].addedNodes;
                const addedLen = added.length;
                for (let j = 0; j < addedLen; j++) {
                    const node = added[j];
                    if (node.nodeName === 'VIDEO') {
                        handleVideoElement(node);
                    } else if (node.querySelectorAll) {
                        const videos = node.querySelectorAll('video');
                        const videosLen = videos.length;
                        for (let k = 0; k < videosLen; k++) {
                            handleVideoElement(videos[k]);
                        }
                    }
                }
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        document.querySelectorAll('video').forEach(handleVideoElement);
    }

    function handleVideoElement(video) {
        console.log('[Optimizer+] Vid\u00E9o d\u00E9tect\u00E9e');

        // Bind the renderer to the WebRTC stream only (srcObject). Videos with src= (dashboard
        // trailers) would otherwise steal the canvas from the stream.
        if (video.srcObject) {
            videoEnhancer.applyToVideo(video);
        } else {
            video.addEventListener('loadedmetadata', () => {
                if (video.srcObject) videoEnhancer.applyToVideo(video);
            }, { once: true });
        }

        video.setAttribute('playsinline', '');

    }

    // DASHBOARD FLOATING WIDGET - Sets the resolution before launching a game

    function createDashboardWidget() {
        if (document.getElementById('optimizer-dashboard-widget')) {
            return;
        }

        const injectWidget = () => {
            const widget = document.createElement('div');
            widget.id = 'optimizer-dashboard-widget';
            // Inline style avoids a white flash on load
            widget.style.cssText = 'position:fixed;right:20px;bottom:40px;z-index:9999999 !important;background:transparent;opacity:0;visibility:hidden;pointer-events:none;transition:opacity 0.25s ease 0.05s;';

            const screenAnalysis = SmartResolutionDetector.getScreenAnalysis();
            const resolutionOptions = SmartResolutionDetector.generateResolutionOptionsHTML(
                CONFIG.resolution.width,
                CONFIG.resolution.height,
                CONFIG.resolution.isAuto
            );

            const currentResText = CONFIG.resolution.isAuto
                ? `Auto: ${CONFIG.resolution.width}x${CONFIG.resolution.height}`
                : `${CONFIG.resolution.width}x${CONFIG.resolution.height}`;
            const safeCurrentResText = escapeHtml(currentResText);
            const safeScreenWidth = escapeHtml(screenAnalysis.screen.width);
            const safeScreenHeight = escapeHtml(screenAnalysis.screen.height);
            const safeScreenRatioType = escapeHtml(screenAnalysis.screen.ratioType);
            const safeScreenRatioName = escapeHtml(screenAnalysis.screen.ratioName);
            const hardwareTier = ENV_PROFILE.isHighEnd ? 'High-End' : (ENV_PROFILE.isMidRange ? 'Mid-Range' : 'Low-End');

            widget.innerHTML = `
                <!-- Bouton principal -->
                <button type="button" class="opt-widget-btn" id="opt-widget-toggle" title="Optimizer Plus - Settings" style="background:linear-gradient(135deg,#00a3ff 0%,#0066cc 100%);border:none;width:56px;height:56px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;pointer-events:auto !important;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:28px;height:28px;color:white;">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                    </svg>
                    <div class="opt-status-dot" title="Active: ${safeCurrentResText}" style="position:absolute;top:2px;right:2px;width:14px;height:14px;border-radius:50%;background:#22c55e;border:2px solid #fff;"></div>
                </button>

                <div class="opt-widget-panel" id="opt-widget-panel" style="position:absolute;bottom:70px;right:0;width:280px;background:rgba(19,23,33,0.98);color:#fff;border:1px solid rgba(0,163,255,0.3);border-radius:12px;padding:16px;opacity:0;visibility:hidden;transform:translateY(10px) scale(0.95);transition:all 0.25s cubic-bezier(0.4,0,0.2,1);pointer-events:auto !important;">
                    <div class="opt-widget-header">
                        <span class="opt-widget-title">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;vertical-align:middle;margin-right:4px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                            Optimizer Plus
                            <span class="opt-widget-version">v${SCRIPT_VERSION}</span>
                        </span>
                    </div>

                    <div class="opt-widget-screen-info">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                        <span class="opt-screen-label">Screen:</span>
                        <span class="opt-screen-value">${safeScreenWidth}x${safeScreenHeight}</span>
                        <span class="opt-screen-ratio">${safeScreenRatioType} ${safeScreenRatioName}</span>
                    </div>

                    <!-- Status actuel -->
                    <div class="opt-widget-status">
                        <div class="opt-widget-status-dot"></div>
                        <span class="opt-widget-status-text" id="opt-widget-status-text">
                            ${safeCurrentResText}
                        </span>
                    </div>

                    <div class="opt-widget-row">
                        <label class="opt-widget-label">Target Resolution</label>
                        <select class="opt-widget-select" id="opt-widget-resolution" style="background:rgba(6,9,18,0.9);color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:10px 12px;pointer-events:auto !important;">
                            ${resolutionOptions}
                        </select>
                    </div>

                    <!-- Boutons d'action -->
                    <div class="opt-widget-actions" style="display:flex;gap:8px;">
                        <button class="opt-widget-action-btn secondary" id="opt-widget-reload" title="Recharger la page" style="background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.85);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:10px 14px;cursor:pointer;flex:1;display:flex;align-items:center;justify-content:center;gap:6px;pointer-events:auto !important;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                                <polyline points="23 4 23 10 17 10"/>
                                <polyline points="1 20 1 14 7 14"/>
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                            </svg>
                            Recharger
                        </button>
                        <button class="opt-widget-action-btn primary" id="opt-widget-apply" title="Appliquer" style="background:#00a3ff;color:#fff;border:none;border-radius:8px;padding:10px 14px;cursor:pointer;flex:1;display:flex;align-items:center;justify-content:center;gap:6px;pointer-events:auto !important;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            Appliquer
                        </button>
                    </div>

                    <!-- Footer -->
                    <div class="opt-widget-footer" style="color:rgba(255,255,255,0.4);text-align:center;margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.1);">
                        <span class="opt-widget-credit" style="font-size:10px;">by Derfog - ${escapeHtml(hardwareTier)}</span>
                    </div>
                </div>
            `;

            document.body.appendChild(widget);

            // Reveal the widget only once styled (no white flash)
            const revealWidget = () => {
                widget.style.opacity = '1';
                widget.style.visibility = 'visible';
                widget.style.pointerEvents = 'auto';
                widget.style.zIndex = '9999999';
            };

            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => requestAnimationFrame(revealWidget));
            } else {
                setTimeout(revealWidget, 50);
            }

            console.log('[Optimizer+] [OK] Dashboard widget inject\u00E9 dans le DOM');

            const attachWithRetry = (attempt = 1) => {
                const btn = document.getElementById('opt-widget-toggle');
                if (btn) {
                    attachWidgetEvents();
                    console.log('[Optimizer+] [OK] \u00C9v\u00E9nements attach\u00E9s (tentative ' + attempt + ')');
                } else if (attempt < 5) {
                    console.log('[Optimizer+] Bouton non trouv\u00E9, nouvelle tentative dans 100ms...');
                    setTimeout(() => attachWithRetry(attempt + 1), 100);
                } else {
                    console.error('[Optimizer+] [X] Impossible de trouver le bouton apr\u00E8s 5 tentatives');
                }
            };

            setTimeout(() => attachWithRetry(), 50);

            console.log('[Optimizer+] [OK] Dashboard widget cr\u00E9\u00E9');
        };

        setTimeout(() => {
            injectWidget();
        }, 800);
    }

    // Document-level handlers are stored so they can be removed (leak on SPA navigation otherwise)
    let _widgetDocHandlers = null;
    function detachWidgetEvents() {
        if (!_widgetDocHandlers) return;
        document.removeEventListener('click', _widgetDocHandlers.click);
        document.removeEventListener('keydown', _widgetDocHandlers.keydown);
        _widgetDocHandlers = null;
    }
    function attachWidgetEvents() {
        // Rebinding: remove the previous handlers first
        detachWidgetEvents();

        const widget = document.getElementById('optimizer-dashboard-widget');
        const toggleBtn = document.getElementById('opt-widget-toggle');
        const panel = document.getElementById('opt-widget-panel');
        const resSelect = document.getElementById('opt-widget-resolution');
        const applyBtn = document.getElementById('opt-widget-apply');
        const statusText = document.getElementById('opt-widget-status-text');

        console.log('[Optimizer+] Attaching widget events...', {
            widget: !!widget,
            toggleBtn: !!toggleBtn,
            panel: !!panel,
            resSelect: !!resSelect
        });

        if (!widget) {
            console.error('[Optimizer+] Widget container not found!');
            return;
        }

        const handleToggle = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            if (panel) {
                const isOpen = panel.classList.contains('open');
                if (isOpen) {
                    panel.classList.remove('open');
                    panel.style.opacity = '0';
                    panel.style.visibility = 'hidden';
                    panel.style.transform = 'translateY(10px) scale(0.95)';
                } else {
                    panel.classList.add('open');
                    panel.style.opacity = '1';
                    panel.style.visibility = 'visible';
                    panel.style.transform = 'translateY(0) scale(1)';
                }
                console.log('[Optimizer+] Panel state:', panel.classList.contains('open') ? 'OPEN' : 'CLOSED');
            }
        };

        if (toggleBtn) {
            toggleBtn.style.pointerEvents = 'auto';
            toggleBtn.addEventListener('click', handleToggle);
        }

        widget.addEventListener('click', (e) => {
            const target = e.target;
            if (!target) return;
            const element = target.nodeType === 1 ? target : target.parentElement;
            if (!element || !element.closest) return;

            if (element.id === 'opt-widget-toggle' || element.closest('#opt-widget-toggle')) {
                handleToggle(e);
                return;
            }

            if (target.id === 'opt-widget-reload' || target.closest('#opt-widget-reload')) {
                e.preventDefault();
                console.log('[Optimizer+] Reload button clicked');
                location.reload();
                return;
            }

            if (target.id === 'opt-widget-apply' || target.closest('#opt-widget-apply')) {
                e.preventDefault();
                console.log('[Optimizer+] Apply button clicked');
                saveConfig(false);
                hookResolution();

                if (applyBtn) {
                    applyBtn.innerHTML = `
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Appliqu\u00E9!
                    `;
                    applyBtn.style.background = '#22c55e';

                    setTimeout(() => {
                        applyBtn.innerHTML = `
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            Appliquer
                        `;
                        applyBtn.style.background = '';

                        if (panel) {
                            panel.classList.remove('open');
                            panel.style.opacity = '0';
                            panel.style.visibility = 'hidden';
                            panel.style.transform = 'translateY(10px) scale(0.95)';
                        }
                    }, 1500);
                }
                console.log('[Optimizer+] [OK] Configuration sauvegard\u00E9e');
                return;
            }
        });

        if (resSelect) {
            resSelect.addEventListener('change', (e) => {
                const value = e.target.value;
                let width, height, displayText;
                let isAutoMode = false;

                if (value === 'auto') {
                    isAutoMode = true;
                    const autoRes = SmartResolutionDetector.applyAutoResolution();
                    if (autoRes) {
                        width = autoRes.w;
                        height = autoRes.h;
                        displayText = `Auto: ${width}x${height}`;
                    } else {
                        const screen = SmartResolutionDetector.getScreenDimensions();
                        width = screen.width;
                        height = screen.height;
                        displayText = `Auto: ${width}x${height}`;
                    }
                } else {
                    [width, height] = value.split('x').map(Number);
                    displayText = `${width}x${height}`;
                }

                CONFIG.resolution.width = width;
                CONFIG.resolution.height = height;
                CONFIG.resolution.pixelRatio = width >= 3840 ? 2 : (width >= 2560 ? 1.5 : 1);
                CONFIG.resolution.isAuto = isAutoMode;

                if (statusText) {
                    statusText.textContent = displayText;
                }

                const statusDot = document.querySelector('#optimizer-dashboard-widget .opt-status-dot');
                if (statusDot) {
                    statusDot.title = `Actif: ${displayText}`;
                }

                const screenValue = document.querySelector('.opt-screen-value');
                if (screenValue && value === 'auto') {
                    screenValue.classList.add('auto-active');
                } else if (screenValue) {
                    screenValue.classList.remove('auto-active');
                }

                saveConfig(false);

                hookResolution();

                console.log(`[Optimizer+] R\u00E9solution chang\u00E9e: ${displayText}`);
            });
        }

        const docClickHandler = (e) => {
            if (panel && widget && !widget.contains(e.target)) {
                panel.classList.remove('open');
                panel.style.opacity = '0';
                panel.style.visibility = 'hidden';
                panel.style.transform = 'translateY(10px) scale(0.95)';
            }
        };
        const docKeyHandler = (e) => {
            if (e.key === 'Escape' && panel) {
                panel.classList.remove('open');
                panel.style.opacity = '0';
                panel.style.visibility = 'hidden';
                panel.style.transform = 'translateY(10px) scale(0.95)';
            }
        };
        document.addEventListener('click', docClickHandler);
        document.addEventListener('keydown', docKeyHandler);
        _widgetDocHandlers = { click: docClickHandler, keydown: docKeyHandler };

        console.log('[Optimizer+] [OK] All widget events attached successfully');
    }

    // INITIALISATION

    function init() {
        console.log('[Optimizer+] =======================================');
        console.log(`[Optimizer+] Boosteroid Optimizer Plus v${SCRIPT_VERSION} by Derfog`);
        console.log('[Optimizer+] Device:', ENV_PROFILE.summary());
        console.log('[Optimizer+] Resolution:', `${CONFIG.resolution.width}x${CONFIG.resolution.height}`);
        console.log('[Optimizer+] Bitrate:', `${Math.round(CONFIG.streaming.maxBitrate / 1000000)}Mbps`);
        console.log('[Optimizer+] Low Latency:', CONFIG.performance.lowLatencyMode ? 'ON' : 'OFF');
        console.log('[Optimizer+] =======================================');

        // Technical hooks apply everywhere (dashboard included): they prepare the browser for streaming
        hookResolution();
        hookCodecs();
        hookDRM();
        hookPerformance();
        hookBitrate();
        SmartCodecSelector.probe();

        // The fetch interceptor must be installed before Boosteroid's /configuration request,
        // which can fire at page load
        StreamInterceptor.enable();

        console.log(`[Optimizer+] v${SCRIPT_VERSION} \u2014 WebGPU zero-copy mode active`);

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', onDOMReady);
        } else {
            onDOMReady();
        }
    }

    function onDOMReady() {
        ensureOptimizerTypography();

        const onStreaming = isStreamingPage();
        const onDashboard = isDashboardPage();

        console.log('[Optimizer+] Type de page - Streaming:', onStreaming, '| Dashboard:', onDashboard);

        // Dashboard: show the floating widget only
        if (onDashboard && !onStreaming) {
            console.log('[Optimizer+] Dashboard d\u00E9tect\u00E9 - Widget flottant activ\u00E9');
            console.log('[Optimizer+] L\'UI compl\u00E8te s\'activera automatiquement quand vous lancerez un jeu');
            createDashboardWidget();
            return;
        }

        injectUI();

        setupVideoObserver();

    }

    init();

})();
