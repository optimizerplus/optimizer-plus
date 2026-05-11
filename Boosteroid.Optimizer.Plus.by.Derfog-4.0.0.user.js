// ==UserScript==
// @name                 Boosteroid Optimizer Plus by Derfog
// @name:fr              Boosteroid Optimizer Plus par Derfog
// @namespace            https://github.com/derfog
// @version              4.0.0
// @description          Ultimate Boosteroid optimizer: V2 Rust/WASM adaptive jitter buffer, 5 Presets, zero-latency WebRTC, max bitrate
// @description:fr       Optimiseur Boosteroid: V2 Rust/WASM jitter adaptatif, 5 Presets, WebRTC z\u00E9ro latence, bitrate max
// @author               Derfog
// @license              MIT
// @copyright            2024-2025, Derfog (https://github.com/derfog)
// @homepageURL          https://github.com/derfog/boosteroid-optimizer-plus
// @supportURL           https://github.com/derfog/boosteroid-optimizer-plus/issues
// @match                https://cloud.boosteroid.com/*
// @match                https://*.boosteroid.com/*
// @icon                 https://www.google.com/s2/favicons?sz=64&domain_url=https%3A%2F%2Fboosteroid.com
// @run-at               document-start
// @grant                unsafeWindow
// @grant                GM_registerMenuCommand
// @grant                GM_setValue
// @grant                GM_getValue
// @grant                GM_addStyle
// ==/UserScript==

/**
 * BOOSTEROID OPTIMIZER PLUS v4.0.0 "Production" by DERFOG
 * Copyright (c) 2024-2025 Derfog - MIT License
 *
 * v4.0.0: Production Release
 * - WASM Rust: Adaptive Jitter Buffer + Bandwidth Predictor
 * - Stretch to Fill (No Borders) with per-session reset
 * - Deep merge config (safe updates for existing users)
 * - iOS landscape scroll fix (dvh + webkit-overflow-scrolling)
 * - Full i18n for stretchMode across 14 languages
 * - Smart Resolution Auto-detect with Boosteroid whitelist
 */

(function () {
    'use strict';

    // ===============================================================================
    // v4.0.0: WASM Module REMOVED \u2014 was dead code (computed stats but never used them)
    // The AdaptiveJitter WASM used to force playoutDelayHint which added latency.
    // After disabling that, it was just burning CPU cycles for nothing.
    // ===============================================================================

    // (WASM blob, classes, and init function removed \u2014 see v3.9.0 for reference)

    // (All WASM code removed in v4.0.0 \uFFFD see comment block above)


    // ===============================================================================
    // AXE 1: ENVIRONMENT DETECTION & PROFILING (avec fallbacks robustes)
    // ===============================================================================

    const ENV_PROFILE = (function () {
        // Helpers pour acc\u00E8s s\u00E9curis\u00E9 aux APIs navigateur
        const safeGet = (fn, fallback) => {
            try { return fn() ?? fallback; } catch (e) { return fallback; }
        };

        const ua = navigator.userAgent || '';
        const cores = safeGet(() => navigator.hardwareConcurrency, 4);
        const memory = safeGet(() => navigator.deviceMemory, 4); // GB - non support\u00E9 sur Firefox/Safari

        // matchMedia peut \u00E9chouer sur certains navigateurs TV
        let isTouch = false;
        try {
            isTouch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
        } catch (e) {
            isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        }

        const width = safeGet(() => window.innerWidth || document.documentElement.clientWidth, 1920);
        const height = safeGet(() => window.innerHeight || document.documentElement.clientHeight, 1080);
        const dpr = safeGet(() => window.devicePixelRatio, 1);

        // Network Information API (non support\u00E9e partout)
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
            console.log('[Optimizer+] Network API non disponible, utilisation des valeurs par d\u00E9faut');
        }

        // D\u00E9tection UA
        const isMobile = /Android|iPhone|iPad|iPod|Windows Phone/i.test(ua);
        const isTablet = /iPad|Android(?!.*Mobile)/i.test(ua);
        // Fix: Ajout patterns TV modernes (Steam Link, Shield, Chromecast, Android TV, tvOS)
        const isTVByUA = /SmartTV|Tizen|WebOS|NetCast|HbbTV|BRAVIA|AFT|Fire TV|Hisense|VIDAA|Roku|PlayStation|Xbox|Steam Link|SHIELD|Chromecast|Android TV|tvOS|GoogleTV|Apple TV/i.test(ua);
        // Heuristique: Grand \u00E9cran (>1920) + DPR 1.0 + pas mobile/tablet = probablement TV
        const isTVByHeuristic = (width > 1920 && height > 1080 && dpr === 1.0 && !isMobile && !isTablet);
        const isTV = isTVByUA || isTVByHeuristic;
        const isFirefox = /Firefox/i.test(ua);
        const isChrome = /Chrome|Chromium|CriOS/i.test(ua);
        const isSafari = /Safari/i.test(ua) && !/Chrome/i.test(ua);
        const isEdge = /Edg/i.test(ua);
        const isOldBrowser = /MSIE|Trident|Edge\/\d+\./i.test(ua); // Ancien Edge non-Chromium

        // Fix: Ne pas utiliser effectiveType pour classifier Low-End sur desktop (faux positifs '4g')
        const isSlowByNetwork = isMobile && (effectiveType === '3g' || effectiveType === '2g');
        // Classification de puissance (avec logique am\u00E9lior\u00E9e)
        const isLowEnd = cores <= 4 || memory <= 4 || isSlowByNetwork || isOldBrowser;
        const isHighEnd = cores > 8 && memory > 8 && !isMobile && !isTablet;
        const isMidRange = !isLowEnd && !isHighEnd;

        // Classification d'\u00E9cran
        const isSmallScreen = width < 1280 || height < 720;
        const isMediumScreen = width >= 1280 && width < 1920;
        const isLargeScreen = width >= 1920 && height >= 1080;

        return {
            // Device type
            isMobile, isTablet, isTV, isSmallScreen, isMediumScreen, isLargeScreen,
            // Performance class
            cores, memory, isLowEnd, isMidRange, isHighEnd, isOldBrowser,
            // Browser & rendering
            isFirefox, isChrome, isSafari, isEdge,
            // Network
            effectiveType, downlink, saveData,
            // Fix: isSlowNetwork utilise downlink en priorit\u00E9, effectiveType seulement sur mobile
            isSlowNetwork: (downlink !== null && downlink > 0 && downlink < 5) || (isMobile && (effectiveType === '3g' || effectiveType === '2g')),
            isFastNetwork: (downlink !== null && downlink >= 15) || (!isMobile && effectiveType === '4g'),
            // Display
            width, height, dpr,
            // Input
            isTouch,
            // Summary string for logging
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

    // ===============================================================================
    // SIGNATURE & PROTECTION
    // ===============================================================================

    const SCRIPT_SIGNATURE = {
        version: '4.0.0',
        verify: () => {
            // Fix: \u00E0 @run-at document-start, document.head peut \u00EAtre null (Firefox/GM)
            try {
                const head = document.head || document.getElementsByTagName('head')[0];
                if (!head) {
                    // Re-tenter \u00E0 DOMContentLoaded
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

    // ===============================================================================
    // BASE CONFIGURATION (High-End defaults)
    // ===============================================================================

    const CONFIG = {
        // R\u00E9solution forc\u00E9e - v3.7.2: isAuto=true utilise la r\u00E9solution native de l'\u00E9cran
        resolution: {
            width: 3840,
            height: 2160,
            pixelRatio: 2,
            isAuto: true // v3.7.2: Mode auto par d\u00E9faut = r\u00E9solution native
        },

        // Codec pr\u00E9f\u00E9rences
        codecs: {
            forceAV1: true,
            forceHEVC: true,
            forceVP9: true,
            preferHardware: true
        },

        // Bitrate et qualit\u00E9
        streaming: {
            maxBitrate: 50000000,
            minBitrate: 15000000,
            targetBitrate: 35000000,
            bufferSize: 2000,
            forceHighQuality: true,
            interceptorEnabled: false  // Opt-in: Stream Interceptor d\u00E9sactiv\u00E9 par d\u00E9faut
        },

        // PERFORMANCE & LATENCE
        performance: {
            lowLatencyMode: true,
            targetLatency: 12,
            jitterBufferTarget: 40,
            jitterBufferMax: 80,
            decodeLatencyTarget: 4,
            prioritizeFramerate: true,
            gpuAcceleration: true,
            reducedFiltersInGame: true,
            // v3.6.1: maxFiltersActive dynamique selon profil mat\u00E9riel
            maxFiltersActive: ENV_PROFILE.isHighEnd ? 5 : (ENV_PROFILE.isMidRange ? 3 : 2),
            disableLogsInGame: true,
            adaptiveQuality: true,
            fpsThreshold: 55,
            streamInterceptor: true  // Opt-in: intercepte configs pour forcer HW decode
        },

        // Video Enhancer
        enhancer: {
            enabled: false, // v3.7.2: D\u00E9sactiv\u00E9 par d\u00E9faut - l'utilisateur choisit
            sharpness: 0.45,
            contrast: 1.0,   // Valeurs neutres
            saturation: 1.0,
            brightness: 1.0
        },

        // Filtres vid\u00E9o avanc\u00E9s
        filters: {
            enabled: false, // v3.7.2: D\u00E9sactiv\u00E9 par d\u00E9faut - l'utilisateur choisit
            preset: null,   // v3.7.2: Aucun preset actif par d\u00E9faut
            usm: { enabled: false, amount: 0.35, radius: 0.9, threshold: 0.04 },
            cas: { enabled: false, sharpness: 0.45 },
            clarity: { enabled: false, amount: 0.2 },
            denoise: { enabled: false, strength: 0.2 },
            vibrance: { enabled: false, amount: 0.2 },
            gamma: { enabled: false, value: 1.0 },
            exposure: { enabled: false, value: 0 },
            deband: { enabled: false, strength: 0.3 }
        },

        // DRM Bypass
        drm: {
            forceDolbyVision: false,
            forceHDCP: false,
            forceUHD: true,
            forceALL: false
        },

        // Display & Ultrawide (v3.6)
        display: {
            stretchMode: false,         // \u00C9tirer la vid\u00E9o (supprimer les bordures noires)
            ultrawideMode: false,       // Ultrawide stretch mode toggle
            autoDetect: true,           // Auto-activer ultrawide si \u00E9cran 21:9+
            performanceMode: false      // Mode performance: d\u00E9sactive les filtres lourds
        },

        // Langue (auto-d\u00E9tect\u00E9e ou choisie)
        language: 'auto'
    };

    // Valeurs par d\u00E9faut pour le Reset (copie immutable)
    const DEFAULT_CONFIG = {
        resolution: { width: 3840, height: 2160, pixelRatio: 2, isAuto: true },
        enhancer: { enabled: true, sharpness: 0.45, contrast: 1.04, saturation: 1.01, brightness: 1.0 },
        filters: {
            enabled: true, preset: 'default',
            usm: { enabled: true, amount: 0.35, radius: 0.9, threshold: 0.04 },
            cas: { enabled: true, sharpness: 0.45 },
            clarity: { enabled: false, amount: 0.2 },
            denoise: { enabled: false, strength: 0.2 },
            vibrance: { enabled: false, amount: 0.2 },
            gamma: { enabled: false, value: 1.0 },
            exposure: { enabled: false, value: 0 },
            deband: { enabled: false, strength: 0.3 }
        },
        language: 'auto'
    };

    // ===============================================================================
    // AXE 1: ADAPTIVE CONFIG BUILDER
    // ===============================================================================

    function buildAdaptiveConfig(baseConfig, envProfile) {
        const cfg = JSON.parse(JSON.stringify(baseConfig));

        // -------------------------------------------------------------------------
        // Tier 1 : Low-End / Slow Network
        // -------------------------------------------------------------------------
        if (envProfile.isLowEnd || envProfile.isSlowNetwork) {
            console.log('[Optimizer+] Adapting to Low-End/Slow profile');
            cfg.resolution = { width: 1920, height: 1080, pixelRatio: 1, isAuto: false };
            cfg.streaming = {
                maxBitrate: 15000000, minBitrate: 8000000, targetBitrate: 12000000,
                bufferSize: 3000, forceHighQuality: true
            };
            cfg.performance.maxFiltersActive = 2;
            cfg.performance.adaptiveQuality = true;
            cfg.filters.usm.amount = 0.25;
            cfg.filters.cas.sharpness = 0.35;
            cfg.filters.clarity.enabled = false;
            cfg.filters.denoise.enabled = false;
            cfg.filters.vibrance.enabled = false;
            cfg.filters.deband.enabled = false;
        }
        // -------------------------------------------------------------------------
        // Tier 2 : Mid-Range
        // -------------------------------------------------------------------------
        else if (envProfile.isMidRange) {
            console.log('[Optimizer+] Adapting to Mid-Range profile');
            cfg.resolution = { width: 2560, height: 1440, pixelRatio: 1, isAuto: false };
            cfg.streaming = {
                maxBitrate: 30000000, minBitrate: 12000000, targetBitrate: 25000000,
                bufferSize: 2500, forceHighQuality: true
            };
            cfg.performance.maxFiltersActive = 4;
            cfg.filters.usm.amount = 0.35;
            cfg.filters.cas.sharpness = 0.45;
            cfg.filters.clarity.enabled = true;
            cfg.filters.deband.enabled = true;
        }
        // Tier 3 : High-End = config par d\u00E9faut (isAuto: true)

        // -------------------------------------------------------------------------
        // Device-specific overrides
        // -------------------------------------------------------------------------
        if (envProfile.isMobile || envProfile.isTablet) {
            cfg.streaming.maxBitrate = Math.min(cfg.streaming.maxBitrate, 20000000);
            cfg.streaming.targetBitrate = Math.min(cfg.streaming.targetBitrate, 18000000);
            cfg.performance.maxFiltersActive = Math.min(cfg.performance.maxFiltersActive, 3);
        }

        if (envProfile.isTV) {
            cfg.performance.lowLatencyMode = true;
            cfg.performance.targetLatency = 10;
            cfg.performance.jitterBufferTarget = 30;
        }

        if (envProfile.isSmallScreen) {
            cfg.resolution.width = Math.min(cfg.resolution.width, 1920);
            cfg.resolution.height = Math.min(cfg.resolution.height, 1080);
        }

        if (envProfile.isSafari) {
            cfg.performance.preferHardware = false;
        }

        if (envProfile.saveData) {
            cfg.streaming.maxBitrate = Math.round(cfg.streaming.maxBitrate * 0.7);
            cfg.filters.enabled = false;
        }

        return cfg;
    }

    // Appliquer la configuration adaptative
    const EFFECTIVE_CONFIG = buildAdaptiveConfig(CONFIG, ENV_PROFILE);
    // Remplacer CONFIG par EFFECTIVE_CONFIG pour le reste du script
    Object.assign(CONFIG, EFFECTIVE_CONFIG);
    console.log('[Optimizer+] Adaptive config applied:',
        `${CONFIG.resolution.width}x${CONFIG.resolution.height}`,
        `@ ${Math.round(CONFIG.streaming.maxBitrate / 1000000)}Mbps`
    );

    // ===============================================================================
    // AXE 3: FILTER TIERING SYSTEM
    // ===============================================================================

    const FilterTiers = {
        // v3.7.2: OFF = aucun filtre activ\u00E9 par d\u00E9faut, l'utilisateur choisit
        OFF: {
            name: 'D\u00E9sactiv\u00E9',
            filters: {
                usm: { enabled: false }, cas: { enabled: false },
                clarity: { enabled: false }, denoise: { enabled: false },
                vibrance: { enabled: false }, gamma: { enabled: false },
                exposure: { enabled: false }, deband: { enabled: false }
            },
            enhancer: { contrast: 1.0, saturation: 1.0, brightness: 1.0 }
        },
        SAFE: {
            name: 'Safe Mode',
            filters: {
                usm: { enabled: false }, cas: { enabled: false },
                clarity: { enabled: false }, denoise: { enabled: false },
                vibrance: { enabled: false }, gamma: { enabled: false },
                exposure: { enabled: false }, deband: { enabled: false }
            },
            enhancer: { contrast: 1.02, saturation: 1.01, brightness: 1.0 }
        },
        LIGHT: {
            name: 'Light',
            filters: {
                usm: { enabled: true, amount: 0.25 }, cas: { enabled: true, sharpness: 0.35 },
                clarity: { enabled: false }, denoise: { enabled: false },
                vibrance: { enabled: false }, gamma: { enabled: false },
                exposure: { enabled: false }, deband: { enabled: false }
            },
            enhancer: { contrast: 1.04, saturation: 1.01, brightness: 1.0 }
        },
        NORMAL: {
            name: 'Balanced',
            filters: {
                usm: { enabled: true, amount: 0.35 }, cas: { enabled: true, sharpness: 0.45 },
                clarity: { enabled: true, amount: 0.2 }, denoise: { enabled: false },
                vibrance: { enabled: false }, gamma: { enabled: false },
                exposure: { enabled: false }, deband: { enabled: true, strength: 0.2 }
            },
            enhancer: { contrast: 1.04, saturation: 1.01, brightness: 1.0 }
        },
        ULTRA: {
            name: 'Ultra',
            filters: {
                usm: { enabled: true, amount: 0.45 }, cas: { enabled: true, sharpness: 0.55 },
                clarity: { enabled: true, amount: 0.3 }, denoise: { enabled: true, strength: 0.15 },
                vibrance: { enabled: true, amount: 0.15 }, gamma: { enabled: false },
                exposure: { enabled: false }, deband: { enabled: true, strength: 0.3 }
            },
            enhancer: { contrast: 1.05, saturation: 1.02, brightness: 1.0 }
        }
    };

    // v3.7.2: Par d\u00E9faut, aucun preset actif - l'utilisateur choisit
    function getInitialFilterTier(envProfile) {
        // Retourner OFF par d\u00E9faut - l'utilisateur active manuellement le preset souhait\u00E9
        return 'OFF';
    }

    const FilterState = {
        currentTier: getInitialFilterTier(ENV_PROFILE),
        adaptiveEnabled: CONFIG.performance.adaptiveQuality,
        fpsHistory: [],
        fpsThreshold: CONFIG.performance.fpsThreshold || 55,
        lastAutoChange: 0, // v3.6.2: Cooldown pour \u00E9viter boucle infinie

        updateTierBasedOnFps(currentFps) {
            // v4.0.0: D\u00C9SACTIV\u00C9 \u2014 Les filtres WebGL2 GPU co\u00FBtent ~0.1ms par frame,
            // ils ne peuvent PAS causer de baisse de FPS. L'ancien syst\u00E8me auto-d\u00E9gradait
            // les presets inutilement pendant les sc\u00E8nes intenses (boss fights, explosions)
            // et causait des pics de latence en plein combat. On garde juste l'historique FPS.
            this.fpsHistory.push(currentFps);
            if (this.fpsHistory.length > 20) this.fpsHistory.shift();
        },

        calculateOptimalTier(avgFps) {
            if (avgFps >= this.fpsThreshold) {
                if (this.currentTier === 'SAFE') return 'LIGHT';
                if (this.currentTier === 'LIGHT') return 'NORMAL';
                if (this.currentTier === 'NORMAL') return 'ULTRA';
            } else if (avgFps < this.fpsThreshold * 0.7) {
                if (this.currentTier === 'ULTRA') return 'NORMAL';
                if (this.currentTier === 'NORMAL') return 'LIGHT';
                if (this.currentTier === 'LIGHT') return 'SAFE';
            }
            return this.currentTier;
        },

        // v3.7.0: Pending tier pour retry si videoEnhancer n'existe pas encore
        _pendingTier: null,
        _retryCount: 0,
        _maxRetries: 50, // 50 * 100ms = 5 secondes max

        setFilterTier(tierName) {
            if (tierName === this.currentTier) return;
            const tier = FilterTiers[tierName];
            if (!tier) return;

            console.log(`[Optimizer+] Filter tier: ${this.currentTier} -> ${tierName}`);
            this.currentTier = tierName;

            // Si OFF, d\u00E9sactiver tous les filtres et ne rien appliquer
            if (tierName === 'OFF') {
                Object.keys(tier.filters).forEach(filterName => {
                    if (CONFIG.filters[filterName]) {
                        CONFIG.filters[filterName].enabled = false;
                    }
                });
                Object.assign(CONFIG.enhancer, tier.enhancer);
                // v4.0.0: D\u00E9sactiver aussi les master toggles pour arr\u00EAter la boucle WebGL
                CONFIG.enhancer.enabled = false;
                CONFIG.filters.enabled = false;

                // Retirer les filtres des vid\u00E9os existantes
                if (typeof videoEnhancer !== 'undefined' && videoEnhancer.removeFiltersFromAllVideos) {
                    videoEnhancer.removeFiltersFromAllVideos();
                }
                console.log('[Optimizer+] [OK] Tous les filtres d\u00E9sactiv\u00E9s');
                return;
            }

            // Appliquer les filtres du tier en m\u00E9moire
            Object.keys(tier.filters).forEach(filterName => {
                if (CONFIG.filters[filterName]) {
                    Object.assign(CONFIG.filters[filterName], tier.filters[filterName]);
                }
            });
            Object.assign(CONFIG.enhancer, tier.enhancer);
            // v4.0.0: R\u00E9activer les master toggles (d\u00E9sactiv\u00E9s par le tier OFF)
            CONFIG.enhancer.enabled = true;
            CONFIG.filters.enabled = true;

            // v3.7.0: Syst\u00E8me de retry robuste
            this._pendingTier = tierName;
            this._retryCount = 0;
            this._applyWithRetry();
        },

        // v3.7.0: Appliquer les filtres avec retry automatique
        _applyWithRetry() {
            if (!this._pendingTier) return;

            if (typeof videoEnhancer !== 'undefined' && videoEnhancer.updateFilterString) {
                // videoEnhancer existe, appliquer les filtres
                videoEnhancer.updateFilterString();
                videoEnhancer.applyFiltersToAllVideos();

                // Valider que les filtres sont appliqu\u00E9s
                setTimeout(() => this._validateFiltersApplied(), 200);

                this._pendingTier = null;
                this._retryCount = 0;
                console.log('[Optimizer+] [OK] Filters applied successfully');
            } else if (this._retryCount < this._maxRetries) {
                // Retry apr\u00E8s 100ms
                this._retryCount++;
                setTimeout(() => this._applyWithRetry(), 100);
                if (this._retryCount === 1) {
                    console.log('[Optimizer+] videoEnhancer not ready, retrying...');
                }
            } else {
                // Timeout apr\u00E8s 5 secondes
                console.warn('[Optimizer+] [!] Failed to apply filters after 5s - videoEnhancer not available');
                this._pendingTier = null;
                this._retryCount = 0;
            }
        },

        // v3.7.0: Valider que les filtres sont vraiment appliqu\u00E9s
        _validateFiltersApplied() {
            const videos = document.querySelectorAll('video');
            if (videos.length === 0) return;

            // WebGL2: validation is instant \u2014 uniforms are always applied
            if (typeof videoEnhancer !== 'undefined' && videoEnhancer._webglActive) {
                return; // WebGL2 pipeline is active, no validation needed
            }

            if (this._retryCount < 10) {
                this._retryCount++;
                if (typeof videoEnhancer !== 'undefined') {
                    videoEnhancer.applyFiltersToAllVideos();
                }
                setTimeout(() => this._validateFiltersApplied(), 300);
            }
        }
    };

    console.log('[Optimizer+] Initial filter tier:', FilterState.currentTier);


    // ===============================================================================
    // v3.5 AXE 1: STREAM INTERCEPTOR - Force HW Decode + GPU Acceleration
    // Inspir\u00E9 de BetterXCloud pattern pour intercepter les configs streaming
    // ===============================================================================

    const StreamInterceptor = {
        originalFetch: null,
        enabled: false,

        /**
         * Intercepter les r\u00E9ponses de configuration pour forcer HW decode
         */
        enable() {
            if (this.enabled) return;
            this.enabled = true;

            // Sauvegarder le fetch original
            this.originalFetch = window.fetch;
            const self = this;

            window.fetch = async function (...args) {
                const request = args[0];
                const url = typeof request === 'string' ? request : request?.url;

                // Intercepter /configuration pour forcer d\u00E9codage HW
                if (url && (url.includes('/configuration') || url.includes('/session') || url.includes('/streaming'))) {
                    try {
                        const response = await self.originalFetch.apply(window, args);

                        if (response.ok) {
                            const clonedResponse = response.clone();
                            try {
                                const config = await clonedResponse.json();

                                // Force HW decoding + GPU accel
                                if (config) {
                                    if (!config.clientStreamingConfigOverrides) {
                                        config.clientStreamingConfigOverrides = '{}';
                                    }

                                    let overrides = {};
                                    try {
                                        overrides = JSON.parse(config.clientStreamingConfigOverrides);
                                    } catch (e) {
                                        overrides = {};
                                    }

                                    // [*] Force codec le plus performant
                                    overrides.videoConfiguration = overrides.videoConfiguration || {};
                                    overrides.videoConfiguration.enableHardwareDecoding = true;
                                    overrides.videoConfiguration.hardwareDecoderProfile = 'high';
                                    overrides.videoConfiguration.enableRtcStatsCollection = true;
                                    overrides.videoConfiguration.preferredCodec = 'av1'; // AV1 par d\u00E9faut

                                    // Force high bitrate settings
                                    overrides.bitrateConfiguration = overrides.bitrateConfiguration || {};
                                    overrides.bitrateConfiguration.maxBitrate = CONFIG.streaming.maxBitrate;
                                    overrides.bitrateConfiguration.targetBitrate = CONFIG.streaming.targetBitrate;

                                    config.clientStreamingConfigOverrides = JSON.stringify(overrides);

                                    console.log('[Optimizer+] [OK] StreamInterceptor: Config enrichie avec HW decode + codec optimis\u00E9');

                                    return new Response(JSON.stringify(config), {
                                        status: response.status,
                                        statusText: response.statusText,
                                        headers: response.headers
                                    });
                                }
                            } catch (parseError) {
                                // Pas du JSON, retourner la r\u00E9ponse originale
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

    // ===============================================================================
    // v3.6 AXE 6: ULTRAWIDE & ASPECT RATIO EXPANSION
    // Full-screen support for 21:9, 32:9+ displays - Game-changing feature!
    // ===============================================================================

    const UltrawideSupport = {
        enabled: false,
        styleElement: null,
        resizeHandler: null,

        /**
         * Calculer l'aspect ratio de l'\u00E9cran
         */
        getScreenAspectRatio() {
            const width = window.innerWidth;
            const height = window.innerHeight;
            return (width / height).toFixed(2);
        },

        /**
         * D\u00E9terminer si l'\u00E9cran est "ultrawide" (> 1.7 ratio)
         */
        isUltrawideScreen() {
            const ratio = parseFloat(this.getScreenAspectRatio());
            return ratio > 1.7; // 16:9 = 1.78, 21:9 = 2.33, 32:9 = 3.56
        },

        /**
         * Obtenir les infos de l'\u00E9cran pour logging
         */
        getScreenInfo() {
            const ratio = parseFloat(this.getScreenAspectRatio());
            let screenType = '16:9 (Standard)';

            if (ratio >= 3.4) screenType = '32:9 (Super Ultrawide)';
            else if (ratio >= 2.2) screenType = '21:9 (Ultrawide)';
            else if (ratio >= 1.8) screenType = '16:10 (Widescreen)';
            else if (ratio <= 1.3) screenType = 'Tablet / Vertical';

            return {
                ratio: ratio.toFixed(2),
                type: screenType,
                width: window.innerWidth,
                height: window.innerHeight,
                isUltrawide: this.isUltrawideScreen()
            };
        },

        /**
         * CSS pour le mode ultrawide - \u00C9TIREMENT INTELLIGENT
         * Garde les filtres vid\u00E9o (sharpness, contrast, etc.) fonctionnels
         * PR\u00C9SERVE les fen\u00EAtres flottantes de Boosteroid
         */
        getUltrawideCSS() {
            return `
                /* =================================================================== */
                /* ULTRAWIDE MODE v3.6.0 - \u00C9TIREMENT (object-fit: fill)                */
                /* L'image 16:9 est \u00C9TIR\u00C9E horizontalement pour remplir le 21:9/32:9   */
                /* PAS de zoom, PAS de crop - juste un \u00E9tirement des c\u00F4t\u00E9s             */
                /* =================================================================== */

                html.optimizer-ultrawide-mode,
                html.optimizer-ultrawide-mode body {
                    overflow: hidden !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    background: #000 !important;
                }

                /* ================================================================ */
                /* VID\u00C9O: object-fit: fill = \u00C9TIRE pour remplir (pas de zoom)       */
                /* ================================================================ */
                html.optimizer-ultrawide-mode video {
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    max-width: 100vw !important;
                    max-height: 100vh !important;
                    object-fit: fill !important;
                    background: #000 !important;
                }

                /* Canvas (WebRTC) - m\u00EAme traitement */
                html.optimizer-ultrawide-mode canvas {
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    max-width: 100vw !important;
                    max-height: 100vh !important;
                }

                /* Conteneurs stream */
                html.optimizer-ultrawide-mode [class*="player"],
                html.optimizer-ultrawide-mode [class*="Player"],
                html.optimizer-ultrawide-mode [class*="stream"],
                html.optimizer-ultrawide-mode [class*="Stream"] {
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    overflow: visible !important;
                }

                /* Fen\u00EAtres flottantes Boosteroid - toujours au-dessus */
                html.optimizer-ultrawide-mode [class*="modal"],
                html.optimizer-ultrawide-mode [class*="Modal"],
                html.optimizer-ultrawide-mode [class*="popup"],
                html.optimizer-ultrawide-mode [class*="Popup"],
                html.optimizer-ultrawide-mode [class*="dialog"],
                html.optimizer-ultrawide-mode [class*="Dialog"],
                html.optimizer-ultrawide-mode [class*="menu"],
                html.optimizer-ultrawide-mode [class*="Menu"],
                html.optimizer-ultrawide-mode [class*="panel"],
                html.optimizer-ultrawide-mode [class*="Panel"],
                html.optimizer-ultrawide-mode [class*="settings"],
                html.optimizer-ultrawide-mode [class*="Settings"],
                html.optimizer-ultrawide-mode [role="dialog"],
                html.optimizer-ultrawide-mode [role="menu"] {
                    z-index: 100000 !important;
                }

                /* Optimizer UI */
                html.optimizer-ultrawide-mode #optimizer-section {
                    z-index: 100001 !important;
                }

                /* Indicateur */
                html.optimizer-ultrawide-mode::after {
                    content: 'ULTRAWIDE';
                    position: fixed;
                    top: 10px;
                    right: 10px;
                    background: rgba(0, 163, 255, 0.9);
                    color: white;
                    padding: 5px 10px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: bold;
                    z-index: 100002;
                    pointer-events: none;
                    animation: ultrawide-fade 3s ease-out forwards;
                }

                @keyframes ultrawide-fade {
                    0%, 70% { opacity: 1; }
                    100% { opacity: 0; }
                }
            `;
        },

        /**
         * Activer le mode ultrawide
         */
        enable() {
            if (this.enabled) return;

            console.log('[Optimizer+] Ultrawide mode: ENABLING');
            const screenInfo = this.getScreenInfo();

            this.enabled = true;
            CONFIG.display.ultrawideMode = true;

            // v3.6.1: "Cheap mode" - D\u00E9sactiver les filtres lourds si prioritizeFramerate
            if (CONFIG.performance.prioritizeFramerate || CONFIG.display.performanceMode) {
                console.log('[Optimizer+] Ultrawide: Mode performance - d\u00E9sactivation filtres lourds');
                CONFIG.filters.clarity.enabled = false;
                CONFIG.filters.denoise.enabled = false;
                CONFIG.filters.deband.enabled = false;
                if (typeof videoEnhancer !== 'undefined' && videoEnhancer.updateFilterString) {
                    videoEnhancer.updateFilterString();
                    videoEnhancer.applyFiltersToAllVideos();
                }
            }

            // Injecter le CSS ultrawide
            if (!this.styleElement) {
                this.styleElement = document.createElement('style');
                this.styleElement.id = 'optimizer-ultrawide-styles';
                this.styleElement.textContent = this.getUltrawideCSS();
                document.head.appendChild(this.styleElement);
            }

            // Ajouter la classe de base
            document.documentElement.classList.add('optimizer-ultrawide-mode');

            console.log('[Optimizer+] [OK] Ultrawide mode activated');
            console.log(`[Optimizer+] Screen: ${screenInfo.width}x${screenInfo.height} (${screenInfo.type})`);

            // Notifier
            if (typeof showNotification === 'function') {
                showNotification(`Ultrawide: ${screenInfo.type}`);
            }

            // \u00C9couter les changements de taille de fen\u00EAtre
            this.resizeHandler = () => this.onWindowResize();
            window.addEventListener('resize', this.resizeHandler);

            // Sauvegarder la config
            if (typeof Storage !== 'undefined' && Storage.set) {
                Storage.set('config', CONFIG);
            }
        },

        /**
         * D\u00E9sactiver le mode ultrawide
         */
        disable() {
            if (!this.enabled) return;

            console.log('[Optimizer+] Ultrawide mode: DISABLING');
            this.enabled = false;
            CONFIG.display.ultrawideMode = false;

            // Retirer la classe CSS
            document.documentElement.classList.remove('optimizer-ultrawide-mode');

            // Retirer le style element
            if (this.styleElement && this.styleElement.parentNode) {
                this.styleElement.parentNode.removeChild(this.styleElement);
                this.styleElement = null;
            }

            // Retirer le listener resize
            if (this.resizeHandler) {
                window.removeEventListener('resize', this.resizeHandler);
                this.resizeHandler = null;
            }

            console.log('[Optimizer+] [OK] Ultrawide mode deactivated');
            if (typeof showNotification === 'function') {
                showNotification('Ultrawide d\u00E9sactiv\u00E9');
            }

            // Sauvegarder la config
            if (typeof Storage !== 'undefined' && Storage.set) {
                Storage.set('config', CONFIG);
            }
        },

        /**
         * Handle window resize
         */
        onWindowResize() {
            // Rien \u00E0 faire, le CSS g\u00E8re tout
        },

        /**
         * Toggle ultrawide on/off
         */
        toggle() {
            if (this.enabled) {
                this.disable();
            } else {
                this.enable();
            }
            return this.enabled;
        }
    };

    // v3.6.4: Suppression de l'exposition globale pour raisons de s\u00E9curit\u00E9 (SEC-01)
    // UltrawideSupport reste accessible uniquement dans le scope de l'IIFE

    // =======================================================================
    // Security helpers (XSS + prototype pollution hardening)
    // =======================================================================
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

    // ===============================================================================
    // v3.7.1 SMART RESOLUTION DETECTOR - Auto-d\u00E9tection \u00E9cran et r\u00E9solutions adapt\u00E9es
    // UPSCALE ONLY: Ne propose que des r\u00E9solutions >= native
    // ===============================================================================

    const SmartResolutionDetector = {
        // Cache des r\u00E9sultats - invalid\u00E9 \u00E0 chaque nouvelle version
        _cache: null,
        _cacheTime: 0,
        _version: '4.0.0', // Incr\u00E9ment\u00E9 pour invalider le cache
        CACHE_TTL: 5000, // 5 secondes

        /**
         * Invalider le cache manuellement
         */
        invalidateCache() {
            this._cache = null;
            this._cacheTime = 0;
            console.log('[Optimizer+] Cache r\u00E9solution invalid\u00E9');
        },

        /**
         * Obtenir les dimensions de l'\u00E9cran actuel (support multi-moniteurs)
         * Utilise getScreenDetails API si disponible (Chrome 100+)
         * Fallback sur screen.width/height sinon
         * @returns {Promise<Object>} Dimensions de l'\u00E9cran
         */
        async getScreenDetailsAsync() {
            try {
                // Chrome 100+ : Window Management API
                if ('getScreenDetails' in window) {
                    const screenDetails = await window.getScreenDetails();
                    const currentScreen = screenDetails.currentScreen;

                    if (currentScreen) {
                        console.log(`[Optimizer+] Screen detection: ${screenDetails.screens.length} \u00E9cran(s) d\u00E9tect\u00E9(s)`);
                        return {
                            width: currentScreen.width,
                            height: currentScreen.height,
                            availWidth: currentScreen.availWidth || currentScreen.width,
                            availHeight: currentScreen.availHeight || currentScreen.height,
                            devicePixelRatio: currentScreen.devicePixelRatio || window.devicePixelRatio || 1,
                            isMultiMonitor: screenDetails.screens.length > 1,
                            screenLabel: currentScreen.label || 'Primary'
                        };
                    }
                }
            } catch (e) {
                // Permission refus\u00E9e ou API non support\u00E9e
                console.log('[Optimizer+] getScreenDetails non disponible, fallback screen.width');
            }

            // Fallback standard
            return this.getScreenDimensions();
        },

        /**
         * Obtenir les dimensions r\u00E9elles de l'\u00E9cran (hardware natif)
         * Fix: Utilise screen.width/height pour \u00E9viter les bugs de zoom navigateur
         */
        getScreenDimensions() {
            // Heuristique: Si window est tr\u00E8s diff\u00E9rent de screen, user peut \u00EAtre sur autre \u00E9cran
            const screenW = window.screen.width || window.screen.availWidth || window.innerWidth;
            const screenH = window.screen.height || window.screen.availHeight || window.innerHeight;
            const windowW = window.innerWidth;
            const windowH = window.innerHeight;

            // Si fen\u00EAtre plein \u00E9cran sur \u00E9cran diff\u00E9rent, innerWidth peut \u00EAtre plus fiable
            let width = screenW;
            let height = screenH;

            // D\u00E9tection heuristique: fen\u00EAtre plus grande que l'\u00E9cran d\u00E9tect\u00E9 = probablement autre \u00E9cran
            if (windowW > screenW * 1.1 || windowH > screenH * 1.1) {
                console.log('[Optimizer+] Heuristique: fen\u00EAtre sur \u00E9cran externe d\u00E9tect\u00E9e');
                width = windowW;
                height = windowH;
            }

            return {
                width: width,
                height: height,
                availWidth: window.screen.availWidth || width,
                availHeight: window.screen.availHeight || height,
                devicePixelRatio: window.devicePixelRatio || 1,
                isMultiMonitor: false,
                screenLabel: 'Default'
            };
        },

        /**
         * Calculer le ratio de l'\u00E9cran et le classifier
         * Fix: Utilise tol\u00E9rance de 5% pour \u00E9viter faux positifs
         */
        detectAspectRatio() {
            const screen = this.getScreenDimensions();
            const ratio = screen.width / screen.height;

            // Classification STRICTE bas\u00E9e sur des plages de tol\u00E9rance r\u00E9alistes
            // Chaque ratio standard a une tol\u00E9rance de \u00B13% maximum
            let ratioType, ratioName;

            // 32:9 = 3.556 (tol\u00E9rance: 3.45 - 3.7)
            if (ratio >= 3.45) {
                ratioType = '32:9';
                ratioName = 'Super Ultrawide';
            }
            // 21:9 = 2.333-2.388 (tol\u00E9rance: 2.25 - 2.5)
            else if (ratio >= 2.25 && ratio < 2.5) {
                ratioType = '21:9';
                ratioName = 'Ultrawide';
            }
            // 19.5:9 = 2.167 (iPhone ratio, tol\u00E9rance: 2.1 - 2.25)
            else if (ratio >= 2.1 && ratio < 2.25) {
                ratioType = '19.5:9';
                ratioName = 'Mobile Tall';
            }
            // 18:9 = 2.0 (tol\u00E9rance: 1.95 - 2.1)
            else if (ratio >= 1.95 && ratio < 2.1) {
                ratioType = '18:9';
                ratioName = 'Mobile Wide';
            }
            // 16:9 = 1.778 (tol\u00E9rance STRICTE: 1.74 - 1.82)
            else if (ratio >= 1.74 && ratio < 1.82) {
                ratioType = '16:9';
                ratioName = 'Standard';
            }
            // 16:10 = 1.6 (tol\u00E9rance: 1.55 - 1.65)
            else if (ratio >= 1.55 && ratio < 1.65) {
                ratioType = '16:10';
                ratioName = 'Widescreen';
            }
            // 3:2 = 1.5 (tol\u00E9rance: 1.45 - 1.55)
            else if (ratio >= 1.45 && ratio < 1.55) {
                ratioType = '3:2';
                ratioName = 'Classic';
            }
            // 4:3 = 1.333 (tol\u00E9rance: 1.28 - 1.38)
            else if (ratio >= 1.28 && ratio < 1.38) {
                ratioType = '4:3';
                ratioName = 'Legacy';
            }
            // Tout autre ratio = Custom (non-standard)
            else {
                ratioType = 'custom';
                // Donner un nom descriptif bas\u00E9 sur le ratio
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
                isSuperUltrawide: ratio >= 3.4,
                isNonStandard: !this.isStandardResolution(screen.width, screen.height)
            };
        },

        /**
         * V\u00E9rifie si c'est une r\u00E9solution standard connue
         */
        isStandardResolution(w, h) {
            const standardResolutions = [
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
            ];
            // Tol\u00E9rance de \u00B18 pixels pour l'arrondi codec
            return standardResolutions.some(([sw, sh]) =>
                Math.abs(sw - w) <= 8 && Math.abs(sh - h) <= 8
            );
        },

        /**
         * Arrondir \u00E0 un multiple de 8 (compatibilit\u00E9 codec vid\u00E9o)
         */
        roundToMultipleOf8(value) {
            return Math.round(value / 8) * 8;
        },

        /**
         * Liste des r\u00E9solutions gaming STANDARD \u00E0 partir de 2K
         * Bas\u00E9e sur les r\u00E9solutions utilis\u00E9es dans les jeux vid\u00E9o
         */
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

        /**
         * Obtenir le groupe de ratio le plus proche pour l'\u00E9cran
         */
        getClosestRatioGroup(screenRatio) {
            // Ratios de r\u00E9f\u00E9rence
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

        /**
         * R\u00E9solutions support\u00E9es par Boosteroid (whitelist serveur)
         * Ces r\u00E9solutions sont garanties de fonctionner c\u00F4t\u00E9 serveur
         */
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

        /**
         * V\u00E9rifier si une r\u00E9solution est support\u00E9e par Boosteroid
         */
        isResolutionSupported(width, height) {
            return this.SUPPORTED_RESOLUTIONS.some(([w, h]) => w === width && h === height);
        },

        /**
         * Trouver la MEILLEURE r\u00E9solution Boosteroid pour un \u00E9cran donn\u00E9
         * Scanne TOUTES les r\u00E9solutions support\u00E9es et score par proximit\u00E9 de ratio
         * @returns {Object} - La r\u00E9solution Boosteroid la plus proche
         */
        findBestMatch(screenWidth, screenHeight) {
            const screenRatio = screenWidth / screenHeight;
            const screenPixels = screenWidth * screenHeight;
            let bestMatch = null;
            let bestScore = Infinity;

            for (const [w, h] of this.SUPPORTED_RESOLUTIONS) {
                const resRatio = w / h;
                const resPixels = w * h;
                // Score = \u00E9cart de ratio (pond\u00E9r\u00E9 x10) + \u00E9cart de pixels normalis\u00E9
                const ratioDiff = Math.abs(resRatio - screenRatio) * 10;
                const pixelDiff = Math.abs(resPixels - screenPixels) / screenPixels;
                const score = ratioDiff + pixelDiff;

                // Pr\u00E9f\u00E9rer les r\u00E9solutions >= native (upscale) avec le meilleur ratio
                const isUpscale = resPixels >= screenPixels * 0.95; // 5% tol\u00E9rance
                const adjustedScore = isUpscale ? score : score + 5; // P\u00E9naliser le downscale

                if (adjustedScore < bestScore) {
                    bestScore = adjustedScore;
                    bestMatch = { w, h, score: adjustedScore, ratioDiff, isUpscale };
                }
            }
            return bestMatch;
        },

        /**
         * G\u00E9n\u00E9rer la liste des r\u00E9solutions s\u00E9lectionnables
         * Scanne TOUTES les r\u00E9solutions Boosteroid, tri\u00E9es par pertinence pour l'\u00E9cran
         */
        getSelectableResolutions(screenWidth, screenHeight) {
            const screenRatio = screenWidth / screenHeight;
            const ratioGroup = this.getClosestRatioGroup(screenRatio);
            const screenPixels = screenWidth * screenHeight;

            const resolutions = [];
            const seen = new Set();

            // 1. Ajouter la r\u00E9solution NATIVE de l'\u00E9cran en premier
            resolutions.push({
                w: screenWidth,
                h: screenHeight,
                label: 'Native',
                tier: 'native',
                isNative: true,
                ratioGroup: ratioGroup
            });
            seen.add(`${screenWidth}x${screenHeight}`);

            // 2. Scorer TOUTES les r\u00E9solutions support\u00E9es par proximit\u00E9 de ratio
            const scored = [];
            for (const [w, h] of this.SUPPORTED_RESOLUTIONS) {
                const key = `${w}x${h}`;
                if (seen.has(key)) continue;
                // Tol\u00E9rance: inclure m\u00EAme si \u00E9cart de pixels < 8 (arrondi codec)
                if (Math.abs(w - screenWidth) <= 8 && Math.abs(h - screenHeight) <= 8) continue;

                const resRatio = w / h;
                const ratioDiff = Math.abs(resRatio - screenRatio);
                const resPixels = w * h;
                const isUpscale = resPixels >= screenPixels * 0.95;

                scored.push({ w, h, ratioDiff, isUpscale, pixels: resPixels });
                seen.add(key);
            }

            // 3. Trier: d'abord par proximit\u00E9 de ratio (< 15% d'\u00E9cart), puis par pixels croissants
            scored.sort((a, b) => {
                // Les r\u00E9solutions proches du ratio de l'\u00E9cran en premier
                const aClose = a.ratioDiff < 0.15 ? 0 : 1;
                const bClose = b.ratioDiff < 0.15 ? 0 : 1;
                if (aClose !== bClose) return aClose - bClose;
                return a.pixels - b.pixels;
            });

            // 4. Ajouter les r\u00E9solutions tri\u00E9es
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

            // 5. Marquer la r\u00E9solution recommand\u00E9e:
            //    = la plus petite upscale avec un ratio tr\u00E8s proche (< 5% d'\u00E9cart)
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

        /**
         * G\u00E9n\u00E9rer les r\u00E9solutions sup\u00E9rieures bas\u00E9es sur le ratio d\u00E9tect\u00E9
         * Utilise maintenant la liste de r\u00E9solutions gaming standards
         */
        generateUpscaleResolutions(screenInfo) {
            const { width, height } = screenInfo;
            return this.getSelectableResolutions(width, height);
        },

        /**
         * Obtenir les infos compl\u00E8tes de l'\u00E9cran et les r\u00E9solutions recommand\u00E9es
         */
        getScreenAnalysis() {
            // V\u00E9rifier le cache (TTL court pour \u00E9viter les valeurs obsol\u00E8tes)
            const now = Date.now();
            if (this._cache && (now - this._cacheTime) < this.CACHE_TTL) {
                return this._cache;
            }

            const screenInfo = this.detectAspectRatio();
            const upscaleOptions = this.generateUpscaleResolutions(screenInfo);

            // Trouver la r\u00E9solution recommand\u00E9e (celle avec isRecommended = true)
            // ou fallback sur la native si disponible
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

            // Mettre en cache
            this._cache = result;
            this._cacheTime = now;

            return result;
        },

        /**
         * G\u00E9n\u00E9rer le HTML des options de r\u00E9solution pour un <select>
         * TOUS les aspect ratios avec leurs r\u00E9solutions gaming
         */
        generateResolutionOptionsHTML(currentWidth, currentHeight, isAutoMode = false) {
            const analysis = this.getScreenAnalysis();
            const { screen } = analysis;
            const detectedRatio = this.getClosestRatioGroup(screen.ratio);

            let html = '';

            // Option Auto-d\u00E9tection en premier - utilise la r\u00E9solution NATIVE de l'\u00E9cran
            const nativeRes = analysis.native || { w: screen.width, h: screen.height, label: 'Native' };
            // v3.7.2: S\u00E9lectionner auto si isAutoMode est true
            const isAutoSelected = isAutoMode || !currentWidth || currentWidth === 'auto';
            html += `<optgroup label="[AUTO]">`;
            html += `<option value="auto" ${isAutoSelected ? 'selected' : ''}>`;
            html += `Auto -> ${escapeHtml(nativeRes.w)}x${escapeHtml(nativeRes.h)} (Native)`;
            html += `</option>`;
            html += `</optgroup>`;

            // R\u00E9solution Native de l'\u00E9cran
            html += `<optgroup label="Native (${escapeHtml(screen.width)}x${escapeHtml(screen.height)})">`;
            const isNativeSelected = !isAutoSelected && currentWidth === screen.width && currentHeight === screen.height;
            html += `<option value="${escapeHtml(`${screen.width}x${screen.height}`)}" ${isNativeSelected ? 'selected' : ''}>`;
            html += `${escapeHtml(screen.width)}x${escapeHtml(screen.height)} (Native)`;
            html += `</option>`;
            html += `</optgroup>`;

            // TOUS les groupes de ratio avec leurs r\u00E9solutions
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

                // Marquer le ratio d\u00E9tect\u00E9 de l'\u00E9cran
                const isDetected = ratio === detectedRatio ? ' [OK]' : '';
                html += `<optgroup label="${escapeHtml(`${label}${isDetected}`)}">`;

                gamingRes.forEach(res => {
                    const isSelected = currentWidth === res.w && currentHeight === res.h;
                    const optionValue = `${res.w}x${res.h}`;
                    let optionLabel = optionValue;

                    // Ajouter des labels connus si n\u00E9cessaire
                    if (res.w === 3840 && res.h === 2160) optionLabel += ' (4K)';
                    if (res.w === 2560 && res.h === 1440) optionLabel += ' (1440p)';
                    if (res.w === 1920 && res.h === 1080) optionLabel += ' (1080p)';

                    html += `<option value="${escapeHtml(optionValue)}" ${isSelected ? 'selected' : ''}>${escapeHtml(optionLabel)}</option>`;
                });

                html += `</optgroup>`;
            }

            return html;
        },

        /**
         * Appliquer une r\u00E9solution de mani\u00E8re s\u00E9curis\u00E9e avec validation
         * V\u00E9rifie si Boosteroid accepte r\u00E9ellement la r\u00E9solution demand\u00E9e
         * @param {number} newWidth - Largeur demand\u00E9e
         * @param {number} newHeight - Hauteur demand\u00E9e
         * @param {string} label - Label de la r\u00E9solution (ex: "2K 1440p")
         * @returns {Object} - R\u00E9sultat avec statut et r\u00E9solution appliqu\u00E9e
         */
        setResolutionSafely(newWidth, newHeight, label = '') {
            const oldWidth = CONFIG.resolution.width;
            const oldHeight = CONFIG.resolution.height;

            // V\u00E9rifier si c'est dans la whitelist
            const isSupported = this.isResolutionSupported(newWidth, newHeight);

            if (!isSupported) {
                console.warn(`[Optimizer+] [!] R\u00E9solution ${newWidth}x${newHeight} non dans la whitelist serveur`);
                // On applique quand m\u00EAme mais on pr\u00E9vient
            }

            // Appliquer la nouvelle r\u00E9solution
            CONFIG.resolution.width = newWidth;
            CONFIG.resolution.height = newHeight;
            CONFIG.resolution.pixelRatio = newWidth >= 3840 ? 2 : (newWidth >= 2560 ? 1.5 : 1);

            console.log(`[Optimizer+] R\u00E9solution demand\u00E9e: ${newWidth}x${newHeight} ${label ? `(${label})` : ''}`);

            // Validation asynchrone apr\u00E8s 2 secondes
            setTimeout(() => {
                const video = document.querySelector('video');
                if (video && video.videoWidth && video.videoHeight) {
                    const actualWidth = video.videoWidth;
                    const actualHeight = video.videoHeight;
                    const tolerance = 0.9; // 10% de tol\u00E9rance

                    if (actualWidth < newWidth * tolerance || actualHeight < newHeight * tolerance) {
                        console.warn(`[Optimizer+] [!] R\u00E9solution ${newWidth}x${newHeight} refus\u00E9e par Boosteroid`);
                        console.warn(`[Optimizer+] Fallback r\u00E9el: ${actualWidth}x${actualHeight}`);

                        // Revert \u00E0 l'ancienne r\u00E9solution dans CONFIG
                        CONFIG.resolution.width = actualWidth;
                        CONFIG.resolution.height = actualHeight;

                        // Notification utilisateur
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

        /**
         * Appliquer la r\u00E9solution auto-d\u00E9tect\u00E9e
         * Trouve la MEILLEURE r\u00E9solution Boosteroid officielle pour l'\u00E9cran de l'utilisateur
         */
        applyAutoResolution() {
            const screen = this.getScreenDimensions();
            const screenW = screen.width;
            const screenH = screen.height;

            // Chercher la meilleure correspondance Boosteroid
            const bestMatch = this.findBestMatch(screenW, screenH);

            if (bestMatch) {
                const label = `Auto (${bestMatch.w}x${bestMatch.h})`;
                this.setResolutionSafely(bestMatch.w, bestMatch.h, label);
                console.log(`[Optimizer+] Auto-r\u00E9solution: \u00E9cran ${screenW}x${screenH} \u2192 Boosteroid ${bestMatch.w}x${bestMatch.h} (ratio diff: ${bestMatch.ratioDiff.toFixed(4)})`);
                return { w: bestMatch.w, h: bestMatch.h, label: label };
            }

            // Fallback: utiliser la native directement
            this.setResolutionSafely(screenW, screenH, 'Native (fallback)');
            console.log(`[Optimizer+] Auto-r\u00E9solution (native fallback): ${screenW}x${screenH}`);
            return { w: screenW, h: screenH, label: 'Native' };
        },

        /**
         * Obtenir l'\u00E9tat actuel de la r\u00E9solution active
         * @returns {Object} - R\u00E9solution actuelle et statut
         */
        getCurrentResolutionStatus() {
            const video = document.querySelector('video');
            const configRes = { width: CONFIG.resolution.width, height: CONFIG.resolution.height };
            const actualRes = video ? { width: video.videoWidth, height: video.videoHeight } : null;

            let status = 'unknown';
            if (actualRes && actualRes.width && actualRes.height) {
                const tolerance = 0.9;
                if (actualRes.width >= configRes.width * tolerance && actualRes.height >= configRes.height * tolerance) {
                    status = 'confirmed';
                } else {
                    status = 'fallback';
                }
            }

            return {
                requested: configRes,
                actual: actualRes,
                status: status,
                isSupported: this.isResolutionSupported(configRes.width, configRes.height)
            };
        }
    };

    // v3.7.2: Exposition globale supprim\u00E9e pour s\u00E9curit\u00E9 (XSS prevention)
    // SmartResolutionDetector reste accessible uniquement dans le scope IIFE
    // Pour debug: utiliser console.log(SmartResolutionDetector.getScreenAnalysis()) dans le script

    console.log('[Optimizer+] Smart Resolution Detector:', SmartResolutionDetector.getScreenAnalysis().summary);

    // ===============================================================================
    // v3.5 AXE 2: SMART CODEC SELECTOR - Auto-detect optimal codec avec HW support
    // ===============================================================================

    const SmartCodecSelector = {
        detectedCodec: null,
        codecCheckDone: false,
        // Fix: Timeout adaptatif - 5s pour machines lentes (TV, Low-End), 2s pour rapides
        getCodecTimeout() {
            return (ENV_PROFILE.isLowEnd || ENV_PROFILE.isTV) ? 5000 : 2000;
        },

        /**
         * Promise avec timeout pour \u00E9viter blocages sur machines lentes
         */
        withTimeout(promise, ms) {
            return Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
            ]);
        },

        /**
         * D\u00E9tecter les codecs support\u00E9s en HW et choisir le meilleur
         */
        async getOptimalCodec() {
            if (this.codecCheckDone) return this.detectedCodec;

            if (!navigator.mediaCapabilities || !navigator.mediaCapabilities.decodingInfo) {
                console.log('[Optimizer+] MediaCapabilities API non disponible, fallback H.264');
                this.detectedCodec = { codec: 'avc1.640028', name: 'H.264 High', hwAccel: 85, efficiency: 1.0 };
                this.codecCheckDone = true;
                return this.detectedCodec;
            }

            const codecs = [
                { codec: 'av01.0.08M.08', name: 'AV1 Main', hwAccel: 95, efficiency: 0.8 },     // AV1 = 20% meilleur ratio
                { codec: 'hev1.1.6.L93.B0', name: 'HEVC Main10', hwAccel: 90, efficiency: 0.85 }, // HEVC
                { codec: 'avc1.640028', name: 'H.264 High', hwAccel: 85, efficiency: 1.0 },       // H.264 fallback
            ];

            let bestCodec = codecs[codecs.length - 1]; // H.264 par d\u00E9faut

            for (const codecInfo of codecs) {
                try {
                    const config = {
                        type: 'media-source',
                        video: {
                            contentType: `video/mp4; codecs="${codecInfo.codec}"`,
                            width: EFFECTIVE_CONFIG.resolution?.width || 1920,
                            height: EFFECTIVE_CONFIG.resolution?.height || 1080,
                            bitrate: CONFIG.streaming.maxBitrate,
                            framerate: 60,
                        },
                    };

                    // Fix: Timeout adaptatif (5s Low-End/TV, 2s High-End)
                    const result = await this.withTimeout(
                        navigator.mediaCapabilities.decodingInfo(config),
                        this.getCodecTimeout()
                    );

                    if (result.supported && result.powerEfficient) {
                        console.log(`[Optimizer+] [OK] Codec ${codecInfo.name} support\u00E9 & power-efficient (HW decode)`);
                        bestCodec = codecInfo;
                        break; // Premier codec support\u00E9 = le meilleur
                    } else if (result.supported) {
                        console.log(`[Optimizer+] Codec ${codecInfo.name} support\u00E9 (SW decode)`);
                        // Continuer \u00E0 chercher un codec HW
                    }
                } catch (e) {
                    // Codec non support\u00E9, continuer
                }
            }

            this.detectedCodec = bestCodec;
            this.codecCheckDone = true;
            console.log(`[Optimizer+] Codec optimal d\u00E9tect\u00E9: ${bestCodec.name} (efficiency: ${bestCodec.efficiency})`);
            return bestCodec;
        },

        /**
         * Adapter le bitrate au codec + FPS r\u00E9els
         */
        calculateOptimalBitrate(fpsHistory) {
            if (!fpsHistory || fpsHistory.length === 0) return CONFIG.streaming.targetBitrate;

            const avgFps = fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length;
            let bitrate = CONFIG.streaming.targetBitrate;

            // Si FPS stable > 58: peut augmenter bitrate
            if (avgFps >= 58) {
                bitrate = Math.min(bitrate * 1.1, CONFIG.streaming.maxBitrate);
            }
            // Si FPS < 50: r\u00E9duire bitrate
            else if (avgFps < 50) {
                bitrate = Math.max(bitrate * 0.85, CONFIG.streaming.minBitrate);
            }

            // Codec-specific adjustments
            if (this.detectedCodec) {
                bitrate = Math.round(bitrate * this.detectedCodec.efficiency);
            }

            return Math.round(bitrate);
        }
    };



    // ===============================================================================
    // AXE 2: STREAMING STATE & LAZY HOOKS
    // ===============================================================================

    const StreamingEnhancements = {
        active: false,
        cleanupHandlers: [],
        originalApis: {},

        enable() {
            if (this.active) return;
            this.active = true;
            console.log('[Optimizer+] Enabling streaming enhancements...');

            try {
                // v3.5: Activer StreamInterceptor pour HW decode (opt-in)
                if (CONFIG.performance.streamInterceptor) {
                    StreamInterceptor.enable();
                    this.cleanupHandlers.push(() => StreamInterceptor.disable());
                } else {
                    console.log('[Optimizer+] StreamInterceptor d\u00E9sactiv\u00E9 (opt-in)');
                }

                // v3.5: D\u00E9tecter le codec optimal
                SmartCodecSelector.getOptimalCodec().then(codec => {
                    console.log(`[Optimizer+] Using codec: ${codec.name}`);
                });


                // D\u00E9tection de fermeture de session
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

            // Restaurer APIs originales
            Object.entries(this.originalApis).forEach(([key, value]) => {
                try {
                    const [obj, prop] = key.split('.');
                    if (obj === 'window') window[prop] = value;
                } catch (e) { }
            });
            this.originalApis = {};

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

            // \u00C9couter les changements d'URL
            window.addEventListener('popstate', handleUrlChange);
            this.cleanupHandlers.push(() => window.removeEventListener('popstate', handleUrlChange));

            // Override pushState pour SPA
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

    // ===============================================================================
    // SYST\u00C8ME D'INTERNATIONALISATION (i18n)
    // ===============================================================================

    const I18N = {
        // Langues disponibles
        languages: {
            en: 'English',
            fr: 'Fran\u00E7ais',
            de: 'Deutsch',
            es: 'Espa\u00F1ol',
            it: 'Italiano',
            pt: 'Portugu\u00EAs',
            ru: '\u0420\u0443\u0441\u0441\u043A\u0438\u0439',
            pl: 'Polski',
            uk: '\u0423\u043A\u0440\u0430\u0457\u043D\u0441\u044C\u043A\u0430',
            tr: 'T\u00FCrk\u00E7e',
            cs: '\u010Ce\u0161tina',
            hu: 'Magyar',
            ro: 'Rom\u00E2n\u0103',
            sk: 'Sloven\u010Dina',
            sv: 'Svenska'
        },

        // Traductions
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
                resolution: 'R\u00E9solution',
                forcedResolution: 'R\u00E9solution forc\u00E9e',
                targetResolution: 'R\u00E9solution cible',
                videoEnhancement: 'Am\u00E9lioration vid\u00E9o',
                enableEnhancer: 'Activer l\'enhancer',
                sharpness: 'Nettet\u00E9',
                contrast: 'Contraste',
                saturation: 'Saturation',
                advancedFilters: 'Filtres Vid\u00E9o Avanc\u00E9s',
                quickPresets: 'Pr\u00E9sets rapides',
                enableAdvanced: 'Activer filtres avanc\u00E9s',
                presetDefault: 'D\u00E9faut',
                presetCinematic: 'Cin\u00E9matique',
                presetGame: 'Comp\u00E9titif',
                presetComfort: 'Confort',
                presetPerfect: 'Qualit\u00E9 Parfaite',
                presetCustom: 'Personnalis\u00E9',

                noiseReduction: 'R\u00E9duction de bruit',
                vibrance: 'Vibrance',
                clarity: 'Clart\u00E9',
                apply: 'Appliquer',
                reset: 'Reset',
                settingsSaved: '[OK] Param\u00E8tres sauvegard\u00E9s!',
                settingsReset: '[<<] Param\u00E8tres r\u00E9initialis\u00E9s.',
                presetApplied: '[*] Pr\u00E9set "{name}" appliqu\u00E9!',
                language: 'Langue',
                autoDetect: 'Auto-d\u00E9tection',
                streamInterceptor: 'Interception Stream (D\u00E9co. HW)',
                ultrawideMode: 'Mode Ultrawide (21:9, 32:9)',
                ultrawideAutoDetect: 'Auto-d\u00E9tection 21:9+',
                performanceMode: 'Mode Performance',
                performanceModeHint: 'D\u00E9sactive les filtres lourds pour maximiser les FPS',
                displaySettings: 'Affichage & Ultrawide',
                screenInfo: 'Info \u00E9cran',
                fitMode: 'Mode d\'affichage',
                hwProfile: 'Profil',
                stretchMode: '\u00C9tirement Complet (Sans Bordures)'
            },
            de: {
                title: 'Optimizer Plus',
                status: 'Status',
                active: 'Aktiv',
                inactive: 'Inaktiv',
                resolution: 'Aufl\u00F6sung',
                forcedResolution: 'Erzwungene Aufl\u00F6sung',
                targetResolution: 'Zielaufl\u00F6sung',
                videoEnhancement: 'Videoverbesserung',
                enableEnhancer: 'Enhancer aktivieren',
                sharpness: 'Sch\u00E4rfe',
                contrast: 'Kontrast',
                saturation: 'S\u00E4ttigung',
                advancedFilters: 'Erweiterte Videofilter',
                quickPresets: 'Schnellvorlagen',
                enableAdvanced: 'Erweiterte Filter aktivieren',
                presetDefault: 'Standard',
                presetCinematic: 'Filmisch',
                presetGame: 'Kompetitiv',
                presetComfort: 'Komfort',
                presetPerfect: 'Perfekte Qualit\u00E4t',
                presetCustom: 'Benutzerdefiniert',
                noiseReduction: 'Rauschunterdr\u00FCckung',
                vibrance: 'Lebendigkeit',
                clarity: 'Klarheit',
                apply: 'Anwenden',
                reset: 'Zur\u00FCcksetzen',
                settingsSaved: '[OK] Einstellungen gespeichert!',
                settingsReset: '[<<] Einstellungen zur\u00FCckgesetzt.',
                presetApplied: '[*] Vorlage "{name}" angewendet!',
                language: 'Sprache',
                autoDetect: 'Automatisch',
                ultrawideMode: 'Ultrawide-Modus (21:9, 32:9)',
                ultrawideAutoDetect: 'Auto-Erkennung 21:9+',
                performanceMode: 'Leistungsmodus',
                performanceModeHint: 'Deaktiviert schwere Filter f\u00FCr maximale FPS',
                displaySettings: 'Anzeige & Ultrawide',
                screenInfo: 'Bildschirminfo',
                fitMode: 'Anzeigemodus',
                hwProfile: 'Profil',
                stretchMode: 'Strecken (Keine R\u00E4nder)'
            },
            es: {
                title: 'Optimizer Plus',
                status: 'Estado',
                active: 'Activo',
                inactive: 'Inactivo',
                resolution: 'Resoluci\u00F3n',
                forcedResolution: 'Resoluci\u00F3n forzada',
                targetResolution: 'Resoluci\u00F3n objetivo',
                videoEnhancement: 'Mejora de video',
                enableEnhancer: 'Activar mejora',
                sharpness: 'Nitidez',
                contrast: 'Contraste',
                saturation: 'Saturaci\u00F3n',
                advancedFilters: 'Filtros de Video Avanzados',
                quickPresets: 'Presets r\u00E1pidos',
                enableAdvanced: 'Activar filtros avanzados',
                presetDefault: 'Predeterminado',
                presetCinematic: 'Cinematogr\u00E1fico',
                presetGame: 'Competitivo',
                presetComfort: 'Confort',
                presetPerfect: 'Calidad Perfecta',
                presetCustom: 'Personalizado',
                noiseReduction: 'Reducci\u00F3n de ruido',
                vibrance: 'Vibraci\u00F3n',
                clarity: 'Claridad',
                streamInterceptor: 'Interceptor Stream (Dec. HW)',
                apply: 'Aplicar',
                reset: 'Restablecer',
                settingsSaved: '[OK] \u00A1Configuraci\u00F3n guardada!',
                settingsReset: '[<<] Configuraci\u00F3n restablecida.',
                presetApplied: '[*] Preset "{name}" aplicado!',
                language: 'Idioma',
                autoDetect: 'Auto-detectar',
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
                enableAdvanced: 'Attiva filtri avanzati',
                presetDefault: 'Predefinito',
                presetCinematic: 'Cinematico',
                presetGame: 'Competitivo',
                presetComfort: 'Comfort',
                presetPerfect: 'Qualit\u00E0 Perfetta',
                presetCustom: 'Personalizzato',
                noiseReduction: 'Riduzione rumore',
                vibrance: 'Vivacit\u00E0',
                clarity: 'Chiarezza',
                streamInterceptor: 'Intercettore Stream (Dec. HW)',
                apply: 'Applica',
                reset: 'Ripristina',
                settingsSaved: '[OK] Impostazioni salvate!',
                settingsReset: '[<<] Impostazioni ripristinate.',
                presetApplied: '[*] Preset "{name}" applicato!',
                language: 'Lingua',
                autoDetect: 'Auto-rileva',
                ultrawideMode: 'Modalit\u00E0 Ultrawide (21:9, 32:9)',
                displaySettings: 'Display & Ultrawide',
                screenInfo: 'Info schermo',
                fitMode: 'Modalit\u00E0 display',
                stretchMode: 'Allunga per riempire (Senza bordi)'
            },
            pt: {
                title: 'Optimizer Plus',
                status: 'Status',
                active: 'Ativo',
                inactive: 'Inativo',
                resolution: 'Resolu\u00E7\u00E3o',
                forcedResolution: 'Resolu\u00E7\u00E3o for\u00E7ada',
                targetResolution: 'Resolu\u00E7\u00E3o alvo',
                videoEnhancement: 'Melhoria de v\u00EDdeo',
                enableEnhancer: 'Ativar melhoria',
                sharpness: 'Nitidez',
                contrast: 'Contraste',
                saturation: 'Satura\u00E7\u00E3o',
                advancedFilters: 'Filtros de V\u00EDdeo Avan\u00E7ados',
                quickPresets: 'Presets r\u00E1pidos',
                enableAdvanced: 'Ativar filtros avan\u00E7ados',
                presetDefault: 'Padr\u00E3o',
                presetCinematic: 'Cinematogr\u00E1fico',
                presetGame: 'Competitivo',
                presetComfort: 'Conforto',
                presetPerfect: 'Qualidade Perfeita',
                presetCustom: 'Personalizado',
                noiseReduction: 'Redu\u00E7\u00E3o de ru\u00EDdo',
                vibrance: 'Vibra\u00E7\u00E3o',
                clarity: 'Clareza',
                streamInterceptor: 'Interceptor Stream (Dec. HW)',
                apply: 'Aplicar',
                reset: 'Redefinir',
                settingsSaved: '[OK] Configura\u00E7\u00F5es salvas!',
                settingsReset: '[<<] Configura\u00E7\u00F5es redefinidas.',
                presetApplied: '[*] Preset "{name}" aplicado!',
                language: 'Idioma',
                autoDetect: 'Auto-detectar',
                ultrawideMode: 'Modo Ultrawide (21:9, 32:9)',
                displaySettings: 'Tela & Ultrawide',
                screenInfo: 'Info tela',
                fitMode: 'Modo de exibi\u00E7\u00E3o',
                stretchMode: 'Esticar (Sem bordas)'
            },
            ru: {
                title: 'Optimizer Plus',
                status: '\u0421\u0442\u0430\u0442\u0443\u0441',
                active: '\u0410\u043A\u0442\u0438\u0432\u0435\u043D',
                inactive: '\u041D\u0435\u0430\u043A\u0442\u0438\u0432\u0435\u043D',
                resolution: '\u0420\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u0435',
                forcedResolution: '\u041F\u0440\u0438\u043D\u0443\u0434\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u0435',
                targetResolution: '\u0426\u0435\u043B\u0435\u0432\u043E\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u0435',
                videoEnhancement: '\u0423\u043B\u0443\u0447\u0448\u0435\u043D\u0438\u0435 \u0432\u0438\u0434\u0435\u043E',
                enableEnhancer: '\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0443\u043B\u0443\u0447\u0448\u0435\u043D\u0438\u0435',
                sharpness: '\u0420\u0435\u0437\u043A\u043E\u0441\u0442\u044C',
                contrast: '\u041A\u043E\u043D\u0442\u0440\u0430\u0441\u0442',
                saturation: '\u041D\u0430\u0441\u044B\u0449\u0435\u043D\u043D\u043E\u0441\u0442\u044C',
                advancedFilters: '\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u043D\u044B\u0435 \u0432\u0438\u0434\u0435\u043E\u0444\u0438\u043B\u044C\u0442\u0440\u044B',
                quickPresets: '\u0411\u044B\u0441\u0442\u0440\u044B\u0435 \u043F\u0440\u0435\u0441\u0435\u0442\u044B',
                enableAdvanced: '\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u043D\u044B\u0435 \u0444\u0438\u043B\u044C\u0442\u0440\u044B',
                presetDefault: '\u041F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E',
                presetCinematic: '\u041A\u0438\u043D\u0435\u043C\u0430\u0442\u043E\u0433\u0440\u0430\u0444',
                presetGame: '\u0421\u043E\u0440\u0435\u0432\u043D\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0439',
                presetComfort: '\u041A\u043E\u043C\u0444\u043E\u0440\u0442',
                presetPerfect: '\u0418\u0434\u0435\u0430\u043B\u044C\u043D\u043E\u0435 \u043A\u0430\u0447\u0435\u0441\u0442\u0432\u043E',
                presetCustom: '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u0441\u043A\u0438\u0439',
                noiseReduction: '\u0428\u0443\u043C\u043E\u043F\u043E\u0434\u0430\u0432\u043B\u0435\u043D\u0438\u0435',
                vibrance: '\u0421\u043E\u0447\u043D\u043E\u0441\u0442\u044C',
                clarity: '\u0427\u0435\u0442\u043A\u043E\u0441\u0442\u044C',
                streamInterceptor: '\u041F\u0435\u0440\u0435\u0445\u0432\u0430\u0442 \u043F\u043E\u0442\u043E\u043A\u0430 (HW \u0434\u0435\u043A\u043E\u0434.)',
                apply: '\u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C',
                reset: '\u0421\u0431\u0440\u043E\u0441',
                settingsSaved: '[OK] \u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B!',
                settingsReset: '[<<] \u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0441\u0431\u0440\u043E\u0448\u0435\u043D\u044B.',
                presetApplied: '[*] \u041F\u0440\u0435\u0441\u0435\u0442 "{name}" \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D!',
                language: '\u042F\u0437\u044B\u043A',
                autoDetect: '\u0410\u0432\u0442\u043E-\u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u0435',
                ultrawideMode: '\u0420\u0435\u0436\u0438\u043C Ultrawide (21:9, 32:9)',
                displaySettings: '\u042D\u043A\u0440\u0430\u043D & Ultrawide',
                screenInfo: '\u0418\u043D\u0444\u043E \u044D\u043A\u0440\u0430\u043D\u0430',
                fitMode: '\u0420\u0435\u0436\u0438\u043C \u043E\u0442\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u044F',
                stretchMode: '\u0420\u0430\u0441\u0442\u044F\u043D\u0443\u0442\u044C \u043D\u0430 \u0432\u0435\u0441\u044C \u044D\u043A\u0440\u0430\u043D'
            },
            pl: {
                title: 'Optimizer Plus',
                status: 'Status',
                active: 'Aktywny',
                inactive: 'Nieaktywny',
                resolution: 'Rozdzielczo\u015B\u0107',
                forcedResolution: 'Wymuszona rozdzielczo\u015B\u0107',
                targetResolution: 'Docelowa rozdzielczo\u015B\u0107',
                videoEnhancement: 'Ulepszanie wideo',
                enableEnhancer: 'W\u0142\u0105cz ulepszanie',
                sharpness: 'Ostro\u015B\u0107',
                contrast: 'Kontrast',
                saturation: 'Nasycenie',
                advancedFilters: 'Zaawansowane filtry wideo',
                quickPresets: 'Szybkie presety',
                enableAdvanced: 'W\u0142\u0105cz zaawansowane filtry',
                presetDefault: 'Domy\u015Blny',
                presetCinematic: 'Kinowy',
                presetGame: 'Rywalizacja',
                presetComfort: 'Komfort',
                presetPerfect: 'Perfekcyjna Jako\u015B\u0107',
                presetCustom: 'Niestandardowy',
                noiseReduction: 'Redukcja szumu',
                vibrance: '\u017Bywo\u015B\u0107',
                clarity: 'Klarowno\u015B\u0107',
                streamInterceptor: 'Przechwyt Stream (Dek. HW)',
                apply: 'Zastosuj',
                reset: 'Resetuj',
                settingsSaved: '[OK] Ustawienia zapisane!',
                settingsReset: '[<<] Ustawienia zresetowane.',
                presetApplied: '[*] Preset "{name}" zastosowany!',
                language: 'J\u0119zyk',
                autoDetect: 'Auto-wykrywanie',
                stretchMode: 'Rozci\u0105gnij (Bez ramek)'
            },
            uk: {
                title: 'Optimizer Plus',
                status: '\u0421\u0442\u0430\u0442\u0443\u0441',
                active: '\u0410\u043A\u0442\u0438\u0432\u043D\u0438\u0439',
                inactive: '\u041D\u0435\u0430\u043A\u0442\u0438\u0432\u043D\u0438\u0439',
                resolution: '\u0420\u043E\u0437\u0434\u0456\u043B\u044C\u043D\u0430 \u0437\u0434\u0430\u0442\u043D\u0456\u0441\u0442\u044C',
                forcedResolution: '\u041F\u0440\u0438\u043C\u0443\u0441\u043E\u0432\u0430 \u0440\u043E\u0437\u0434\u0456\u043B\u044C\u043D\u0430 \u0437\u0434\u0430\u0442\u043D\u0456\u0441\u0442\u044C',
                targetResolution: '\u0426\u0456\u043B\u044C\u043E\u0432\u0430 \u0440\u043E\u0437\u0434\u0456\u043B\u044C\u043D\u0430 \u0437\u0434\u0430\u0442\u043D\u0456\u0441\u0442\u044C',
                videoEnhancement: '\u041F\u043E\u043A\u0440\u0430\u0449\u0435\u043D\u043D\u044F \u0432\u0456\u0434\u0435\u043E',
                enableEnhancer: '\u0423\u0432\u0456\u043C\u043A\u043D\u0443\u0442\u0438 \u043F\u043E\u043A\u0440\u0430\u0449\u0435\u043D\u043D\u044F',
                sharpness: '\u0420\u0456\u0437\u043A\u0456\u0441\u0442\u044C',
                contrast: '\u041A\u043E\u043D\u0442\u0440\u0430\u0441\u0442',
                saturation: '\u041D\u0430\u0441\u0438\u0447\u0435\u043D\u0456\u0441\u0442\u044C',
                advancedFilters: '\u0420\u043E\u0437\u0448\u0438\u0440\u0435\u043D\u0456 \u0432\u0456\u0434\u0435\u043E\u0444\u0456\u043B\u044C\u0442\u0440\u0438',
                quickPresets: '\u0428\u0432\u0438\u0434\u043A\u0456 \u043F\u0440\u0435\u0441\u0435\u0442\u0438',
                enableAdvanced: '\u0423\u0432\u0456\u043C\u043A\u043D\u0443\u0442\u0438 \u0440\u043E\u0437\u0448\u0438\u0440\u0435\u043D\u0456 \u0444\u0456\u043B\u044C\u0442\u0440\u0438',
                presetDefault: '\u0417\u0430 \u0437\u0430\u043C\u043E\u0432\u0447\u0443\u0432\u0430\u043D\u043D\u044F\u043C',
                presetCinematic: '\u041A\u0456\u043D\u0435\u043C\u0430\u0442\u043E\u0433\u0440\u0430\u0444',
                presetGame: '\u0417\u043C\u0430\u0433\u0430\u043B\u044C\u043D\u0438\u0439',
                presetComfort: '\u041A\u043E\u043C\u0444\u043E\u0440\u0442',
                presetPerfect: '\u0406\u0434\u0435\u0430\u043B\u044C\u043D\u0430 \u044F\u043A\u0456\u0441\u0442\u044C',
                presetCustom: '\u041A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0446\u044C\u043A\u0438\u0439',
                noiseReduction: '\u0417\u043C\u0435\u043D\u0448\u0435\u043D\u043D\u044F \u0448\u0443\u043C\u0443',
                vibrance: '\u0416\u0432\u0430\u0432\u0456\u0441\u0442\u044C',
                clarity: '\u0427\u0456\u0442\u043A\u0456\u0441\u0442\u044C',
                streamInterceptor: '\u041F\u0435\u0440\u0435\u0445\u043E\u043F\u043B\u0435\u043D\u043D\u044F \u043F\u043E\u0442\u043E\u043A\u0443 (HW \u0434\u0435\u043A\u043E\u0434.)',
                apply: '\u0417\u0430\u0441\u0442\u043E\u0441\u0443\u0432\u0430\u0442\u0438',
                reset: '\u0421\u043A\u0438\u043D\u0443\u0442\u0438',
                settingsSaved: '[OK] \u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u043E!',
                settingsReset: '[<<] \u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F \u0441\u043A\u0438\u043D\u0443\u0442\u043E.',
                presetApplied: '[*] \u041F\u0440\u0435\u0441\u0435\u0442 "{name}" \u0437\u0430\u0441\u0442\u043E\u0441\u043E\u0432\u0430\u043D\u043E!',
                language: '\u041C\u043E\u0432\u0430',
                autoDetect: '\u0410\u0432\u0442\u043E-\u0432\u0438\u0437\u043D\u0430\u0447\u0435\u043D\u043D\u044F'
            },
            tr: {
                title: 'Optimizer Plus',
                status: 'Durum',
                active: 'Aktif',
                inactive: 'Pasif',
                resolution: '\u00C7\u00F6z\u00FCn\u00FCrl\u00FCk',
                forcedResolution: 'Zorlanm\u0131\u015F \u00E7\u00F6z\u00FCn\u00FCrl\u00FCk',
                targetResolution: 'Hedef \u00E7\u00F6z\u00FCn\u00FCrl\u00FCk',
                videoEnhancement: 'Video iyile\u015Ftirme',
                enableEnhancer: '\u0130yile\u015Ftiriciyi etkinle\u015Ftir',
                sharpness: 'Keskinlik',
                contrast: 'Kontrast',
                saturation: 'Doygunluk',
                advancedFilters: 'Geli\u015Fmi\u015F Video Filtreleri',
                quickPresets: 'H\u0131zl\u0131 presetler',
                enableAdvanced: 'Geli\u015Fmi\u015F filtreleri etkinle\u015Ftir',
                presetDefault: 'Varsay\u0131lan',
                presetCinematic: 'Sinematik',
                presetGame: 'Rekabet\u00E7i',
                presetComfort: 'Konfor',
                presetPerfect: 'M\u00FCkemmel Kalite',
                presetCustom: '\u00D6zel',
                noiseReduction: 'G\u00FCr\u00FClt\u00FC azaltma',
                vibrance: 'Canl\u0131l\u0131k',
                clarity: 'Netlik',
                streamInterceptor: 'Ak\u0131\u015F Yakalay\u0131c\u0131 (HW \u00C7\u00F6z\u00FCc\u00FC)',
                apply: 'Uygula',
                reset: 'S\u0131f\u0131rla',
                settingsSaved: '[OK] Ayarlar kaydedildi!',
                settingsReset: '[<<] Ayarlar s\u0131f\u0131rland\u0131.',
                presetApplied: '[*] Preset "{name}" uyguland\u0131!',
                language: 'Dil',
                autoDetect: 'Otomatik alg\u0131la',
                stretchMode: 'Ekrana S\u0131\u011Fd\u0131r (Kenarl\u0131ks\u0131z)'
            },
            cs: {
                title: 'Optimizer Plus',
                status: 'Stav',
                active: 'Aktivn\u00ED',
                inactive: 'Neaktivn\u00ED',
                resolution: 'Rozli\u0161en\u00ED',
                forcedResolution: 'Vynucen\u00E9 rozli\u0161en\u00ED',
                targetResolution: 'C\u00EDlov\u00E9 rozli\u0161en\u00ED',
                videoEnhancement: 'Vylep\u0161en\u00ED videa',
                enableEnhancer: 'Povolit vylep\u0161en\u00ED',
                sharpness: 'Ostrost',
                contrast: 'Kontrast',
                saturation: 'Sytost',
                advancedFilters: 'Pokro\u010Dil\u00E9 video filtry',
                quickPresets: 'Rychl\u00E9 presety',
                enableAdvanced: 'Povolit pokro\u010Dil\u00E9 filtry',
                presetDefault: 'V\u00FDchoz\u00ED',
                presetCinematic: 'Filmov\u00FD',
                presetGame: 'Sout\u011B\u017En\u00ED',
                presetComfort: 'Komfort',
                presetPerfect: 'Dokonal\u00E1 Kvalita',
                presetCustom: 'Vlastn\u00ED',
                noiseReduction: 'Redukce \u0161umu',
                vibrance: '\u017Divost',
                clarity: '\u010Cistota',
                streamInterceptor: 'Zachyt\u00E1va\u010D Streamu (HW Dek.)',
                apply: 'Pou\u017E\u00EDt',
                reset: 'Obnovit',
                settingsSaved: '[OK] Nastaven\u00ED ulo\u017Eeno! Obnovte str\u00E1nku.',
                settingsReset: '[<<] Nastaven\u00ED obnoveno. Obnovte str\u00E1nku.',
                presetApplied: '[*] Preset "{name}" pou\u017Eit!',
                language: 'Jazyk',
                autoDetect: 'Automaticky',
                stretchMode: 'Rozt\u00E1hnout na celou obrazovku'
            },
            hu: {
                title: 'Optimizer Plus',
                status: '\u00C1llapot',
                active: 'Akt\u00EDv',
                inactive: 'Inakt\u00EDv',
                resolution: 'Felbont\u00E1s',
                forcedResolution: 'K\u00E9nyszer\u00EDtett felbont\u00E1s',
                targetResolution: 'C\u00E9l felbont\u00E1s',
                videoEnhancement: 'Vide\u00F3 jav\u00EDt\u00E1s',
                enableEnhancer: 'Jav\u00EDt\u00F3 enged\u00E9lyez\u00E9se',
                sharpness: '\u00C9less\u00E9g',
                contrast: 'Kontraszt',
                saturation: 'Tel\u00EDtetts\u00E9g',
                advancedFilters: 'Halad\u00F3 vide\u00F3 sz\u0171r\u0151k',
                quickPresets: 'Gyors presetek',
                enableAdvanced: 'Halad\u00F3 sz\u0171r\u0151k enged\u00E9lyez\u00E9se',
                presetDefault: 'Alap\u00E9rtelmezett',
                presetCinematic: 'Filmes',
                presetGame: 'Verseny',
                presetComfort: 'K\u00E9nyelem',
                presetPerfect: 'T\u00F6k\u00E9letes Min\u0151s\u00E9g',
                presetCustom: 'Egy\u00E9ni',
                noiseReduction: 'Zajcs\u00F6kkent\u00E9s',
                vibrance: '\u00C9l\u00E9nks\u00E9g',
                clarity: 'Tisztas\u00E1g',
                streamInterceptor: 'Folyam Elfog\u00F3 (HW Dek.)',
                apply: 'Alkalmaz',
                reset: 'Vissza\u00E1ll\u00EDt\u00E1s',
                settingsSaved: '[OK] Be\u00E1ll\u00EDt\u00E1sok mentve! T\u00F6ltse \u00FAjra az oldalt.',
                settingsReset: '[<<] Be\u00E1ll\u00EDt\u00E1sok vissza\u00E1ll\u00EDtva. T\u00F6ltse \u00FAjra az oldalt.',
                presetApplied: '[*] Preset "{name}" alkalmazva!',
                language: 'Nyelv',
                autoDetect: 'Automatikus',
                stretchMode: 'Kit\u00F6lt\u00E9s a k\u00E9perny\u0151n (Keret n\u00E9lk\u00FCl)'
            },
            ro: {
                title: 'Optimizer Plus',
                status: 'Stare',
                active: 'Activ',
                inactive: 'Inactiv',
                resolution: 'Rezolu\u021Bie',
                forcedResolution: 'Rezolu\u021Bie for\u021Bat\u0103',
                targetResolution: 'Rezolu\u021Bie \u021Bint\u0103',
                videoEnhancement: '\u00CEmbun\u0103t\u0103\u021Bire video',
                enableEnhancer: 'Activare \u00EEmbun\u0103t\u0103\u021Bire',
                sharpness: 'Claritate',
                contrast: 'Contrast',
                saturation: 'Satura\u021Bie',
                advancedFilters: 'Filtre Video Avansate',
                quickPresets: 'Preseturi rapide',
                enableAdvanced: 'Activare filtre avansate',
                presetDefault: 'Implicit',
                presetCinematic: 'Cinematic',
                presetGame: 'Competitiv',
                presetComfort: 'Confort',
                presetPerfect: 'Calitate Perfect\u0103',
                presetCustom: 'Personalizat',
                noiseReduction: 'Reducere zgomot',
                vibrance: 'Vivacitate',
                clarity: 'Limpezime',
                streamInterceptor: 'Interceptor Stream (Dec. HW)',
                apply: 'Aplic\u0103',
                reset: 'Resetare',
                settingsSaved: '[OK] Set\u0103ri salvate! Re\u00EEnc\u0103rca\u021Bi pagina.',
                settingsReset: '[<<] Set\u0103ri resetate. Re\u00EEnc\u0103rca\u021Bi pagina.',
                presetApplied: '[*] Preset "{name}" aplicat!',
                language: 'Limb\u0103',
                autoDetect: 'Auto-detectare',
                stretchMode: '\u00CEntinde pe tot ecranul'
            },
            sk: {
                title: 'Optimizer Plus',
                status: 'Stav',
                active: 'Akt\u00EDvny',
                inactive: 'Neakt\u00EDvny',
                resolution: 'Rozl\u00ED\u0161enie',
                forcedResolution: 'Vyn\u00FAten\u00E9 rozl\u00ED\u0161enie',
                targetResolution: 'Cie\u013Eov\u00E9 rozl\u00ED\u0161enie',
                videoEnhancement: 'Vylep\u0161enie videa',
                enableEnhancer: 'Povoli\u0165 vylep\u0161enie',
                sharpness: 'Ostros\u0165',
                contrast: 'Kontrast',
                saturation: 'S\u00FDtos\u0165',
                advancedFilters: 'Pokro\u010Dil\u00E9 video filtre',
                quickPresets: 'R\u00FDchle presety',
                enableAdvanced: 'Povoli\u0165 pokro\u010Dil\u00E9 filtre',
                presetDefault: 'Predvolen\u00E9',
                presetCinematic: 'Filmov\u00FD',
                presetGame: 'S\u00FA\u0165a\u017En\u00FD',
                presetComfort: 'Komfort',
                presetPerfect: 'Dokonal\u00E1 Kvalita',
                presetCustom: 'Vlastn\u00E9',
                noiseReduction: 'Redukcia \u0161umu',
                vibrance: '\u017Divos\u0165',
                clarity: '\u010Cistota',
                streamInterceptor: 'Zachyt\u00E1va\u010D Streamu (HW Dek.)',
                apply: 'Pou\u017Ei\u0165',
                reset: 'Obnovi\u0165',
                settingsSaved: '[OK] Nastavenia ulo\u017Een\u00E9! Obnovte str\u00E1nku.',
                settingsReset: '[<<] Nastavenia obnoven\u00E9. Obnovte str\u00E1nku.',
                presetApplied: '[*] Preset "{name}" pou\u017Eit\u00FD!',
                language: 'Jazyk',
                autoDetect: 'Automaticky',
                stretchMode: 'Roztiahnu\u0165 (Bez okrajov)'
            },
            sv: {
                title: 'Optimizer Plus',
                status: 'Status',
                active: 'Aktiv',
                inactive: 'Inaktiv',
                resolution: 'Uppl\u00F6sning',
                forcedResolution: 'Tvingad uppl\u00F6sning',
                targetResolution: 'M\u00E5luppl\u00F6sning',
                videoEnhancement: 'Videof\u00F6rb\u00E4ttring',
                enableEnhancer: 'Aktivera f\u00F6rb\u00E4ttring',
                sharpness: 'Sk\u00E4rpa',
                contrast: 'Kontrast',
                saturation: 'M\u00E4ttnad',
                advancedFilters: 'Avancerade videofilter',
                quickPresets: 'Snabbf\u00F6rinst\u00E4llningar',
                enableAdvanced: 'Aktivera avancerade filter',
                presetDefault: 'Standard',
                presetCinematic: 'Filmisk',
                presetGame: 'T\u00E4vling',
                presetComfort: 'Komfort',
                presetPerfect: 'Perfekt Kvalitet',
                presetCustom: 'Anpassad',
                noiseReduction: 'Brusreducering',
                vibrance: 'Livfullhet',
                clarity: 'Klarhet',
                streamInterceptor: 'Stream Interceptor (HW Avk.)',
                apply: 'Till\u00E4mpa',
                reset: '\u00C5terst\u00E4ll',
                settingsSaved: '[OK] Inst\u00E4llningar sparade! Ladda om sidan.',
                settingsReset: '[<<] Inst\u00E4llningar \u00E5terst\u00E4llda. Ladda om sidan.',
                presetApplied: '[*] F\u00F6rinst\u00E4llning "{name}" till\u00E4mpad!',
                language: 'Spr\u00E5k',
                autoDetect: 'Automatisk'
            }
        }
    };

    // Langue courante (d\u00E9tect\u00E9e ou configur\u00E9e)
    let currentLang = 'en';

    // Fonction pour d\u00E9tecter la langue (simplifi\u00E9e)
    function detectLanguage() {
        // V\u00E9rifier la config sauvegard\u00E9e
        if (CONFIG.language && CONFIG.language !== 'auto') {
            return CONFIG.language;
        }

        // D\u00E9tecter depuis le navigateur
        const browserLang = (navigator.language || navigator.userLanguage || 'en').substring(0, 2).toLowerCase();
        return I18N.translations[browserLang] ? browserLang : 'en';
    }

    // Fonction pour obtenir une traduction
    function t(key, params = {}) {
        const translation = I18N.translations[currentLang]?.[key] || I18N.translations['en'][key] || key;

        // Remplacer les param\u00E8tres {param}
        return translation.replace(/\{(\w+)\}/g, (match, param) => params[param] || match);
    }

    // Initialiser la langue
    currentLang = detectLanguage();

    // ===============================================================================
    // IC\u00D4NES SVG PROFESSIONNELLES
    // ===============================================================================

    const ICONS = {
        logo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
        settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
        monitor: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
        film: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>`,
        sliders: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`,
        zap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
        eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
        target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
        layers: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
        cpu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>`,
        activity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
        wifi: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`,
        image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
        sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
        droplet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`,
        contrast: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20z"/></svg>`,
        sparkles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M5 19l.5 1.5L7 21l-1.5.5L5 23l-.5-1.5L3 21l1.5-.5L5 19z"/><path d="M19 5l.5 1.5L21 7l-1.5.5L19 9l-.5-1.5L17 7l1.5-.5L19 5z"/></svg>`,
        volume: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
        check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
        x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
        refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
        save: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
        chevronDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`,
        play: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
        crosshair: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`,
        globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
        gauge: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10H12V2z"/><path d="M12 2a10 10 0 0 1 10 10"/><line x1="12" y1="12" x2="12" y2="2"/><line x1="12" y1="12" x2="17" y2="7"/></svg>`,
        shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
        maximize: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`,
        minimize: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>`
    };

    // ===============================================================================
    // STYLES CSS POUR L'INTERFACE - TH\u00C8ME BOOSTEROID
    // Couleurs: Fond #060912, Conteneur #131721, Texte #FFFFFF, Police Sofia Sans 12px
    // ===============================================================================

    const OPTIMIZER_STYLES = `
        /* ========================================================================== */
        /* OPTIMIZER+ CSS - Native Boosteroid Typography & Layout                     */
        /* ========================================================================== */

        /* Mobile/PWA Fix for .m_lan_wrapper scrollability (iOS Landscape) */
        .m_lan_wrapper.menu-open,
        .m_lan_wrapper {
            overflow-y: auto !important;
            overflow-x: hidden !important;
            max-height: 100vh !important; /* Fallback pour anciens navigateurs */
            max-height: 100dvh !important; /* Unit\u00E9 moderne dynamique */
            padding-bottom: 80px !important;
            -webkit-overflow-scrolling: touch !important; /* Fix crucial pour le scroll iOS */
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

        /* D\u00E9sactive le zoom appliqu\u00E9 par Boosteroid sur ses conteneurs interm\u00E9diaires (sauf notre UI) */
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

        /* Base Section */
        #optimizer-section {
            font-family: 'Sofia Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 12px;
            line-height: 1.4;
            font-weight: 400;
            color: #fff;
            margin-top: 10px;
        }

        /* Menu Title - Section Headers */
        #optimizer-section .menu_title {
            font-size: 12px;
            font-weight: 600;
            color: #fff;
            margin: 16px 0 8px 0;
            padding: 0;
        }

        /* Menu Switch Block - Row Container */
        #optimizer-section .menu_switch_block {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 0;
            gap: 10px;
            min-height: 32px;
            flex-wrap: wrap;
        }

        #optimizer-section .menu_switch_block.top_20 {
            margin-top: 0;
        }

        /* Menu Title Group - Labels */
        #optimizer-section .menu_title_group {
            display: flex;
            align-items: center;
            gap: 6px;
            flex: 1;
            min-width: 80px; /* v3.7.2: Garantir espace minimum pour le texte */
            overflow: visible;
        }

        #optimizer-section .menu_title_group p {
            font-size: 12px;
            font-weight: 400;
            color: rgba(255, 255, 255, 0.85);
            margin: 0;
            white-space: nowrap;
            overflow: visible;
        }

        #optimizer-section .menu_title_group span {
            white-space: nowrap;
            overflow: visible;
        }

        #optimizer-section .menu_title_group svg {
            width: 14px;
            height: 14px;
            opacity: 0.7;
            flex-shrink: 0;
        }

        /* Badge Version */
        #optimizer-section .optimizer-badge {
            font-size: 10px;
            font-weight: 500;
            background: #00a3ff;
            color: #fff;
            padding: 2px 6px;
            border-radius: 3px;
            margin-left: 6px;
            vertical-align: middle;
        }

        /* ========================================================================== */
        /* CUSTOM SLIDERS - Div-based pour compatibilit\u00E9                              */
        /* ========================================================================== */

        #optimizer-section .optimizer-slider {
            position: relative;
            width: 100%;
            height: 20px;
            display: flex;
            align-items: center;
            cursor: pointer;
            user-select: none;
            -webkit-user-select: none;
        }

        #optimizer-section .optimizer-slider-track {
            position: absolute;
            width: 100%;
            height: 4px;
            background: rgba(255, 255, 255, 0.15);
            border-radius: 2px;
        }

        #optimizer-section .optimizer-slider-fill {
            position: absolute;
            height: 4px;
            background: #22c55e;
            border-radius: 2px;
            pointer-events: none;
        }

        #optimizer-section .optimizer-slider-thumb {
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

        #optimizer-section .optimizer-slider:hover .optimizer-slider-thumb {
            transform: translateX(-50%) scale(1.15);
        }

        #optimizer-section .optimizer-slider:active .optimizer-slider-thumb {
            transform: translateX(-50%) scale(1.2);
            box-shadow: 0 2px 8px rgba(34, 197, 94, 0.5);
        }

        /* Fallback pour input[type=range] - hidden mais fonctionnel */
        #optimizer-section input[type="range"] {
            position: absolute;
            width: 100%;
            height: 20px;
            opacity: 0;
            cursor: pointer;
            margin: 0;
            z-index: 2;
        }

        /* Legacy track styling (hidden) */
        #optimizer-section input[type="range"]::-webkit-slider-runnable-track {
            height: 4px;
            border-radius: 2px;
            background: rgba(255, 255, 255, 0.15);
        }

        #optimizer-section input[type="range"]::-moz-range-track {
            height: 4px;
            border-radius: 2px;
            background: rgba(255, 255, 255, 0.15);
        }

        #optimizer-section input[type="range"]::-moz-range-progress {
            background: #22c55e;
            height: 4px;
            border-radius: 2px;
        }

        /* ========================================================================== */
        /* SELECT - Dropdowns                                                         */
        /* ========================================================================== */

        #optimizer-section select,
        #optimizer-section .optimizer-select {
            font-size: 12px;
            font-family: inherit;
            padding: 6px 10px;
            background: rgba(6, 9, 18, 0.9);
            color: #fff;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 4px;
            cursor: pointer;
            outline: none;
            flex-shrink: 0; /* v3.7.2: Ne pas r\u00E9duire le select */
            max-width: 180px; /* v3.7.2: Limite pour laisser place au label */
        }

        /* v3.7.2: Style sp\u00E9cifique pour le s\u00E9lecteur de r\u00E9solution */
        #optimizer-res-select {
            min-width: 140px;
            max-width: 160px;
        }

        #optimizer-section select:focus,
        #optimizer-section .optimizer-select:focus {
            border-color: #00a3ff;
        }

        #optimizer-section select option,
        #optimizer-section .optimizer-select option {
            background: #131721;
            color: #fff;
        }

        /* ========================================================================== */
        /* PRESETS - Button Grid                                                      */
        /* ========================================================================== */

        #optimizer-section .optimizer-presets {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            width: 100%;
        }

        #optimizer-section .optimizer-preset-btn {
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

        #optimizer-section .optimizer-preset-btn svg {
            width: 12px;
            height: 12px;
            flex-shrink: 0;
        }

        #optimizer-section .optimizer-preset-btn:hover {
            border-color: rgba(0, 163, 255, 0.5);
            background: rgba(0, 163, 255, 0.1);
        }

        #optimizer-section .optimizer-preset-btn.active {
            background: #00a3ff;
            border-color: #00a3ff;
            color: #fff;
        }

        #optimizer-section .optimizer-preset-perfect {
            border-color: rgba(0, 136, 204, 0.6);
        }

        #optimizer-section .optimizer-preset-perfect:hover {
            background: linear-gradient(135deg, rgba(0, 163, 255, 0.2), rgba(0, 102, 204, 0.2));
            border-color: #00a3ff;
        }

        #optimizer-section .optimizer-preset-perfect.active {
            background: linear-gradient(135deg, #00a3ff, #0066cc);
            border-color: #00a3ff;
        }



        /* ========================================================================== */
        /* STATUS INDICATOR                                                           */
        /* ========================================================================== */

        #optimizer-section .optimizer-status {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.85);
        }

        #optimizer-section .optimizer-status-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #22c55e;
            animation: optimizer-pulse 2s infinite;
        }

        #optimizer-section .optimizer-status-dot.warning {
            background: #f59e0b;
        }

        #optimizer-section .optimizer-status-dot.error {
            background: #ef4444;
        }

        @keyframes optimizer-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        /* ========================================================================== */
        /* BUTTONS                                                                    */
        /* ========================================================================== */

        #optimizer-section .optimizer-btn {
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

        #optimizer-section .optimizer-btn:hover {
            background: #0082cc;
        }

        #optimizer-section .optimizer-btn.secondary {
            background: transparent;
            border: 1px solid rgba(255, 255, 255, 0.18);
            color: rgba(255, 255, 255, 0.85);
        }

        #optimizer-section .optimizer-btn.secondary:hover {
            background: rgba(255, 255, 255, 0.08);
        }

        #optimizer-section .optimizer-btn svg {
            width: 14px;
            height: 14px;
            flex-shrink: 0;
        }

        /* ========================================================================== */
        /* NOTIFICATION                                                               */
        /* ========================================================================== */

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

        /* ========================================================================== */
        /* RESPONSIVE                                                                 */
        /* ========================================================================== */

        @media (max-width: 767px) {
            #optimizer-section .menu_title_group p {
                font-size: 11px;
            }

            #optimizer-section .optimizer-preset-btn {
                font-size: 10px;
                padding: 5px 8px;
                min-height: 32px;
            }

            #optimizer-section input[type="range"]::-webkit-slider-thumb {
                width: 18px;
                height: 18px;
            }

            #optimizer-section input[type="range"]::-moz-range-thumb {
                width: 18px;
                height: 18px;
            }
        }

        @media (pointer: coarse) {
            #optimizer-section .optimizer-preset-btn {
                min-height: 36px;
                padding: 8px 12px;
            }

            #optimizer-section input[type="range"]::-webkit-slider-thumb {
                width: 20px;
                height: 20px;
            }

            #optimizer-section input[type="range"]::-moz-range-thumb {
                width: 20px;
                height: 20px;
            }
        }

        @media (prefers-reduced-motion: reduce) {
            #optimizer-section *,
            #optimizer-notification {
                animation: none !important;
                transition: none !important;
            }
        }

        /* ========================================================================== */
        /* v3.6.3 SCREEN INFO & HW BADGE                                              */
        /* ========================================================================== */

        /* Screen info display in-game */
        #optimizer-section .optimizer-screen-info {
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

        #optimizer-section .optimizer-screen-info svg {
            width: 14px;
            height: 14px;
            color: #00a3ff;
            flex-shrink: 0;
        }

        #optimizer-section .optimizer-screen-info .screen-detected {
            color: #00a3ff;
            font-weight: 600;
            font-family: 'SF Mono', 'Consolas', monospace;
        }

        #optimizer-section .optimizer-screen-info .screen-ratio {
            color: rgba(255, 255, 255, 0.5);
            font-size: 10px;
            padding: 2px 6px;
            background: rgba(255, 255, 255, 0.08);
            border-radius: 4px;
            margin-left: auto;
        }

        #optimizer-section .optimizer-hw-badge {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
        }

        #optimizer-section .optimizer-hw-badge svg {
            width: 14px;
            height: 14px;
            color: rgba(255, 255, 255, 0.5);
        }

        /* ========================================================================== */
        /* v3.6.3 DASHBOARD FLOATING WIDGET                                           */
        /* ========================================================================== */

        #optimizer-dashboard-widget {
            position: fixed;
            right: 20px;
            bottom: 180px; /* En dessous du chatbot Boosteroid */
            z-index: 99998;
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
            pointer-events: none; /* Laisser le bouton parent recevoir les clics */
        }

        /* Status dot (indicateur vert) */
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
            pointer-events: none; /* Laisser le bouton parent recevoir les clics */
        }

        @keyframes opt-status-pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.5); }
            50% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
        }

        /* Panel d\u00E9roulant */
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

        /* Styles pour l'info \u00E9cran d\u00E9tect\u00E9 */
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

        /* Style pour les options de r\u00E9solution recommand\u00E9es */
        #optimizer-dashboard-widget .opt-widget-select option[value="auto"] {
            font-weight: bold;
            background: rgba(0, 163, 255, 0.15);
        }

        /* ========================================================================== */
        /* MASQUER L'OPTION "IMAGE PLUS LUMINEUSE" DE BOOSTEROID                      */
        /* Ciblage PR\u00C9CIS: uniquement les toggles avec ces attributs sp\u00E9cifiques      */
        /* ========================================================================== */

        /* Masquer uniquement les blocs toggle avec ID/class contenant "brighter" */
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

    // ===============================================================================
    // INITIALISATION DU CONTEXTE WINDOW
    // ===============================================================================

    let windowCtx;

    if (self.unsafeWindow) {
        console.log("[Optimizer+] Mode unsafeWindow activ\u00E9");
        windowCtx = self.unsafeWindow;
    } else {
        console.log("[Optimizer+] Mode window standard");
        windowCtx = self.window;
    }

    // ===============================================================================
    // VARIABLES GLOBALES
    // ===============================================================================

    let qualityLevel = 75; // Niveau de qualit\u00E9 global par d\u00E9faut (0-100)

    // ===============================================================================
    // \u00C9TAT DE LA SESSION - Gestion centralis\u00E9e
    // ===============================================================================

    const SessionState = {
        isGameActive: false,      // True si une instance de jeu est en cours
        isMenuOpen: false,        // True si le menu d'options est ouvert
        isUIInjected: false,      // True si notre UI est inject\u00E9e
        videoElement: null,       // R\u00E9f\u00E9rence \u00E0 la vid\u00E9o de streaming
        menuObserver: null,       // Observer pour le menu
        videoObserver: null,      // Observer pour la vid\u00E9o
        cleanupHandlers: [],      // Handlers \u00E0 nettoyer
        lastSessionId: null,      // Dernier sessionId d\u00E9tect\u00E9
        lastCheckTime: 0,         // Timestamp du dernier check
        retryCount: 0,            // Compteur de tentatives d'injection
        maxRetries: 5,            // Max retries avant reset forc\u00E9

        // Reset complet de l'\u00E9tat
        reset() {
            this.isGameActive = false;
            this.isMenuOpen = false;
            this.isUIInjected = false;
            this.videoElement = null;
            this.lastSessionId = null;
            this.retryCount = 0;
        },

        // V\u00E9rifier si on a chang\u00E9 de session (nouveau jeu)
        hasSessionChanged() {
            const currentSessionId = this.extractSessionId();
            if (currentSessionId && this.lastSessionId && currentSessionId !== this.lastSessionId) {
                console.log(`[Optimizer+] Changement de session d\u00E9tect\u00E9: ${this.lastSessionId} -> ${currentSessionId}`);
                return true;
            }
            if (currentSessionId) {
                this.lastSessionId = currentSessionId;
            }
            return false;
        },

        // Extraire le sessionId de l'URL
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

        // Forcer la r\u00E9injection UI (apr\u00E8s changement de jeu ou bug)
        forceReinject() {
            console.log('[Optimizer+] R\u00E9injection forc\u00E9e de l\'UI');

            // Nettoyer l'ancienne UI
            const oldUI = document.getElementById('optimizer-section');
            if (oldUI) {
                oldUI.remove();
            }

            this.isUIInjected = false;
            this.retryCount = 0;

            return true;
        },

        // M\u00E9thode de r\u00E9cup\u00E9ration en cas d'\u00E9tat incoh\u00E9rent
        selfHeal() {
            const now = Date.now();

            // \u00C9viter les checks trop fr\u00E9quents
            if (now - this.lastCheckTime < 2000) {
                return false;
            }
            this.lastCheckTime = now;

            // 1. V\u00E9rifier le changement de session
            if (this.hasSessionChanged()) {
                this.forceReinject();
                return true;
            }

            // 2. \u00C9tat incoh\u00E9rent: UI marqu\u00E9e inject\u00E9e mais absente du DOM
            if (this.isUIInjected && !document.getElementById('optimizer-section')) {
                console.log('[Optimizer+] Self-heal: UI marqu\u00E9e pr\u00E9sente mais absente du DOM');
                this.isUIInjected = false;
                this.retryCount++;

                if (this.retryCount > this.maxRetries) {
                    console.warn('[Optimizer+] Max retries atteint, reset complet');
                    this.reset();
                }
                return true;
            }

            // 3. UI pr\u00E9sente dans le DOM mais pas marqu\u00E9e
            if (!this.isUIInjected && document.getElementById('optimizer-section')) {
                console.log('[Optimizer+] Self-heal: UI pr\u00E9sente mais pas marqu\u00E9e');
                this.isUIInjected = true;
                return true;
            }

            // 4. Menu ferm\u00E9 mais UI toujours marqu\u00E9e comme inject\u00E9e
            if (this.isUIInjected && !document.querySelector('#menu.menu_desktop[style*="block"]')) {
                // C'est normal, le menu peut \u00EAtre cach\u00E9 mais l'UI existe encore
                // On ne fait rien sauf si l'UI n'est vraiment plus dans le DOM
            }

            return false;
        }
    };

    // ===============================================================================
    // STORAGE - Sauvegarde des param\u00E8tres
    // ===============================================================================

    const Storage = {
        get: function (key, defaultValue) {
            try {
                if (typeof GM_getValue !== 'undefined') {
                    return GM_getValue(key, defaultValue);
                }
                const stored = localStorage.getItem('optimizer_' + key);
                return stored !== null ? JSON.parse(stored) : defaultValue;
            } catch (e) {
                return defaultValue;
            }
        },

        set: function (key, value) {
            try {
                if (typeof GM_setValue !== 'undefined') {
                    GM_setValue(key, value);
                }
                localStorage.setItem('optimizer_' + key, JSON.stringify(value));
            } catch (e) {
                console.warn('[Optimizer+] Erreur sauvegarde:', e);
            }
        }
    };

    // v3.7.2: D\u00E9tecter si nouvelle session (reset presets si sessionId diff\u00E9rent)
    function getCurrentSessionId() {
        const url = window.location.href;
        const match = url.match(/sessionId=([a-f0-9-]+)/i);
        return match ? match[1] : null;
    }

    const currentSessionId = getCurrentSessionId();
    const savedSessionId = Storage.get('lastSessionId', null);
    const isNewSession = currentSessionId && currentSessionId !== savedSessionId;

    // Charger les param\u00E8tres sauvegard\u00E9s
    const savedConfig = Storage.get('config', null);
    if (savedConfig) {
        // v3.7.2: Si nouvelle session, reset les presets et filtres
        if (isNewSession) {
            console.log('[Optimizer+] Nouvelle session d\u00E9tect\u00E9e, reset des presets');
            // Garder les param\u00E8tres de r\u00E9solution mais reset les filtres
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
                enabled: false,
                sharpness: 0.45,
                contrast: 1.0,
                saturation: 1.0,
                brightness: 1.0
            };
            // Sauvegarder le nouveau sessionId
            Storage.set('lastSessionId', currentSessionId);
        }
        // v4.0.0: Remplacer Object.assign par un merge profond pour ne pas \u00E9craser les nouvelles cl\u00E9s par d\u00E9faut
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
        deepMerge(CONFIG, savedConfig);
        
        // v4.0.0: FORCER le reset du Stretch Mode \u00E0 chaque rechargement de page.
        // On ne veut jamais que cet effet persiste sans action explicite de l'utilisateur.
        if (CONFIG.display) {
            CONFIG.display.stretchMode = false;
        }
        // Aussi retirer la classe CSS du DOM (au cas o\u00F9 elle persisterait)
        document.documentElement.classList.remove('optimizer-stretch-mode');
        
    } else if (currentSessionId) {
        // Premi\u00E8re utilisation, sauvegarder le sessionId
        Storage.set('lastSessionId', currentSessionId);
    }

    // Initialiser la r\u00E9solution si mode auto ou pas de config
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

    // Charger le niveau de qualit\u00E9 sauvegard\u00E9
    const savedQuality = Storage.get('qualityLevel', null);
    if (savedQuality !== null) {
        qualityLevel = savedQuality;
    }

    // v3.7.2: R\u00E9initialiser la langue apr\u00E8s chargement de la config
    // Car detectLanguage() est appel\u00E9 avant le chargement depuis Storage
    currentLang = detectLanguage();
    console.log(`[Optimizer+] Langue active: ${currentLang} (config: ${CONFIG.language})`);

    // ===============================================================================
    // HOOK RESOLUTION - Force 4K/8K
    // ===============================================================================

    function hookResolution() {
        const { width, height, pixelRatio } = CONFIG.resolution;

        try {
            // Fix: on \u00E9vite `delete windowCtx.screen` car en strict mode, supprimer une
            // propri\u00E9t\u00E9 non-configurable jette TypeError. Object.defineProperty red\u00E9finit
            // directement la propri\u00E9t\u00E9 (configurable depuis le 1er hook).
            Object.defineProperty(windowCtx, 'screen', {
                get: function () {
                    return {
                        width: width,
                        height: height,
                        availWidth: width,
                        availHeight: height,
                        availLeft: 0,
                        availTop: 0,
                        colorDepth: 30,
                        isExtended: false,
                        pixelDepth: 30,
                        orientation: {
                            type: 'landscape-primary',
                            angle: 0
                        }
                    };
                },
                configurable: true
            });

            Object.defineProperty(windowCtx, 'devicePixelRatio', {
                get: () => pixelRatio,
                configurable: true
            });

            // NOTE: On ne hook PAS innerWidth/innerHeight car cela bloque les \u00E9v\u00E9nements souris
            // Le hook screen + devicePixelRatio suffit pour forcer la r\u00E9solution c\u00F4t\u00E9 serveur

            console.log(`[Optimizer+] R\u00E9solution forc\u00E9e: ${width}x${height} @${pixelRatio}x`);
        } catch (e) {
            console.error('[Optimizer+] Erreur hook r\u00E9solution:', e);
        }
    }

    // ===============================================================================
    // HOOK CODECS - Force AV1/HEVC/VP9
    // ===============================================================================




    let _hookCodecsInstalled = false;
    function hookCodecs() {
        if (_hookCodecsInstalled) return;
        _hookCodecsInstalled = true;
        // Hook MediaSource.isTypeSupported
        if (windowCtx.MediaSource && windowCtx.MediaSource.isTypeSupported) {
            const originalIsTypeSupported = windowCtx.MediaSource.isTypeSupported.bind(windowCtx.MediaSource);

            windowCtx.MediaSource.isTypeSupported = function (mimeType) {
                const original = originalIsTypeSupported(mimeType);

                // Force support AV1
                if (CONFIG.codecs.forceAV1 && mimeType.includes('av01')) {
                    console.log('[Optimizer+] AV1 codec forc\u00E9:', mimeType);
                    return true;
                }

                // Force support HEVC
                if (CONFIG.codecs.forceHEVC && (mimeType.includes('hev1') || mimeType.includes('hvc1'))) {
                    console.log('[Optimizer+] HEVC codec forc\u00E9:', mimeType);
                    return true;
                }

                // Force support VP9
                if (CONFIG.codecs.forceVP9 && mimeType.includes('vp9')) {
                    return true;
                }

                return original;
            };
        }

        // Hook HTMLMediaElement.canPlayType
        if (windowCtx.HTMLMediaElement && windowCtx.HTMLMediaElement.prototype.canPlayType) {
            const originalCanPlayType = windowCtx.HTMLMediaElement.prototype.canPlayType;

            windowCtx.HTMLMediaElement.prototype.canPlayType = function (mimeType) {
                const original = originalCanPlayType.call(this, mimeType);

                if (CONFIG.codecs.forceAV1 && mimeType.includes('av01')) {
                    return 'probably';
                }

                if (CONFIG.codecs.forceHEVC && (mimeType.includes('hev1') || mimeType.includes('hvc1'))) {
                    return 'probably';
                }

                if (CONFIG.codecs.forceVP9 && mimeType.includes('vp9')) {
                    return 'probably';
                }

                return original;
            };
        }

        // Hook MediaCapabilities pour informer le navigateur des capacit\u00E9s
        if (windowCtx.MediaCapabilities && windowCtx.MediaCapabilities.prototype.decodingInfo) {
            const originalDecodingInfo = windowCtx.MediaCapabilities.prototype.decodingInfo;

            windowCtx.MediaCapabilities.prototype.decodingInfo = function (config) {
                return originalDecodingInfo.call(this, config).then(result => {
                    // Am\u00E9liorer les r\u00E9sultats pour les codecs haute qualit\u00E9
                    if (config.video) {
                        const codec = config.video.contentType || '';

                        if (CONFIG.codecs.forceAV1 && codec.includes('av01')) {
                            result.supported = true;
                            result.smooth = true;
                            result.powerEfficient = CONFIG.codecs.preferHardware;
                        }

                        if (CONFIG.codecs.forceHEVC && (codec.includes('hev1') || codec.includes('hvc1'))) {
                            result.supported = true;
                            result.smooth = true;
                            result.powerEfficient = CONFIG.codecs.preferHardware;
                        }
                    }

                    // Toujours reporter comme fluide et efficace
                    result.smooth = result.supported;
                    result.powerEfficient = result.supported;

                    return result;
                });
            };
        }

        console.log('[Optimizer+] Hooks codecs install\u00E9s (AV1, HEVC, VP9)');
    }

    // ===============================================================================
    // HOOK BITRATE - Am\u00E9lioration du d\u00E9bit (FOR\u00C7AGE AGRESSIF)
    // ===============================================================================

    // Stockage global des PeerConnections pour for\u00E7age p\u00E9riodique du bitrate
    const activePeerConnections = new Set();
    let bitrateEnforcementInterval = null;

    let _hookBitrateInstalled = false;
    function hookBitrate() {
        // Fix: garde anti-double-hook (init() peut \u00EAtre appel\u00E9 deux fois en SPA reload)
        if (_hookBitrateInstalled) return;
        _hookBitrateInstalled = true;

        // ===========================================================================
        // HOOK RTCRtpSender.setParameters - BLOQUER LES R\u00C9DUCTIONS DE BITRATE
        // ===========================================================================

        if (typeof RTCRtpSender !== 'undefined' && RTCRtpSender.prototype.setParameters) {
            const originalSetParameters = RTCRtpSender.prototype.setParameters;

            RTCRtpSender.prototype.setParameters = function (parameters) {
                if (parameters && parameters.encodings) {
                    parameters.encodings.forEach((encoding, index) => {
                        // Forcer le bitrate minimum \u00E9lev\u00E9
                        if (encoding.maxBitrate !== undefined) {
                            const originalBitrate = encoding.maxBitrate;
                            const minAllowed = CONFIG.streaming.minBitrate;

                            // Emp\u00EAcher toute r\u00E9duction en dessous du minimum configur\u00E9
                            if (encoding.maxBitrate < minAllowed) {
                                encoding.maxBitrate = CONFIG.streaming.targetBitrate;
                                console.log(`[Optimizer+]  Bitrate forc\u00E9: ${originalBitrate} -> ${encoding.maxBitrate} (min: ${minAllowed})`);
                            }
                        } else {
                            // Si pas de maxBitrate d\u00E9fini, le d\u00E9finir
                            encoding.maxBitrate = CONFIG.streaming.targetBitrate;
                        }

                        // Forcer une bonne qualit\u00E9 de scaling
                        if (encoding.scaleResolutionDownBy !== undefined && encoding.scaleResolutionDownBy > 1) {
                            const originalScale = encoding.scaleResolutionDownBy;
                            encoding.scaleResolutionDownBy = 1; // Pas de downscaling
                            console.log(`[Optimizer+]  Scale forc\u00E9: ${originalScale} -> 1`);
                        }

                        // Forcer le framerate maximum
                        if (CONFIG.streaming.preferredFramerate) {
                            encoding.maxFramerate = CONFIG.streaming.preferredFramerate;
                        }
                    });
                }

                return originalSetParameters.call(this, parameters);
            };

            console.log('[Optimizer+] [OK] Hook RTCRtpSender.setParameters install\u00E9');
        }

        // ===========================================================================
        // HOOK RTCPeerConnection - Intercepter toutes les connexions
        // ===========================================================================

        if (windowCtx.RTCPeerConnection) {
            const OriginalRTCPeerConnection = windowCtx.RTCPeerConnection;

            windowCtx.RTCPeerConnection = function (config, constraints) {
                // Optimiser la configuration ICE pour faible latence
                if (config) {
                    config.iceCandidatePoolSize = config.iceCandidatePoolSize || 10;
                    // Forcer bundlePolicy pour r\u00E9duire les connexions
                    config.bundlePolicy = 'max-bundle';
                    config.rtcpMuxPolicy = 'require';
                }

                const pc = new OriginalRTCPeerConnection(config, constraints);

                // Ajouter \u00E0 la liste pour for\u00E7age p\u00E9riodique
                activePeerConnections.add(pc);

                // Nettoyer quand la connexion se ferme
                pc.addEventListener('connectionstatechange', () => {
                    if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
                        activePeerConnections.delete(pc);
                    }
                });

                // Intercepter setRemoteDescription pour modifier les SDP
                const originalSetRemoteDescription = pc.setRemoteDescription.bind(pc);
                pc.setRemoteDescription = function (description) {
                    if (description && description.sdp) {
                        let modifiedSdp = description.sdp;

                        // Augmenter le bitrate dans le SDP (AS = Application Specific)
                        modifiedSdp = modifiedSdp.replace(
                            /b=AS:\d+/g,
                            `b=AS:${Math.floor(CONFIG.streaming.maxBitrate / 1000)}`
                        );

                        // Ajouter/modifier le bitrate TIAS (Transport Independent Application Specific)
                        if (!modifiedSdp.includes('b=TIAS:')) {
                            modifiedSdp = modifiedSdp.replace(
                                /(m=video.*\r\n)/g,
                                `$1b=TIAS:${CONFIG.streaming.maxBitrate}\r\n`
                            );
                        } else {
                            modifiedSdp = modifiedSdp.replace(
                                /b=TIAS:\d+/g,
                                `b=TIAS:${CONFIG.streaming.maxBitrate}`
                            );
                        }

                        // Forcer x-google-max-bitrate et x-google-min-bitrate
                        modifiedSdp = modifiedSdp.replace(
                            /a=fmtp:(\d+)(.*)/g,
                            (match, pt, rest) => {
                                // Retirer les anciens param\u00E8tres de bitrate
                                let newRest = rest.replace(/;?x-google-(max|min|start)-bitrate=\d+/g, '');
                                // Ajouter nos param\u00E8tres
                                const bitrateParams = `;x-google-max-bitrate=${Math.floor(CONFIG.streaming.maxBitrate / 1000)};x-google-min-bitrate=${Math.floor(CONFIG.streaming.minBitrate / 1000)};x-google-start-bitrate=${Math.floor(CONFIG.streaming.targetBitrate / 1000)}`;
                                return `a=fmtp:${pt}${newRest}${bitrateParams}`;
                            }
                        );

                        description = new RTCSessionDescription({
                            type: description.type,
                            sdp: modifiedSdp
                        });

                        if (!CONFIG.performance.disableLogsInGame) {
                            console.log('[Optimizer+] SDP modifi\u00E9 - Bitrate forc\u00E9:', Math.floor(CONFIG.streaming.maxBitrate / 1000000), 'Mbps');
                        }
                    }
                    return originalSetRemoteDescription(description);
                };

                // Intercepter setLocalDescription aussi pour \u00EAtre s\u00FBr
                const originalSetLocalDescription = pc.setLocalDescription.bind(pc);
                pc.setLocalDescription = function (description) {
                    if (description && description.sdp) {
                        let modifiedSdp = description.sdp;

                        // M\u00EAmes modifications que pour remote
                        modifiedSdp = modifiedSdp.replace(
                            /b=AS:\d+/g,
                            `b=AS:${Math.floor(CONFIG.streaming.maxBitrate / 1000)}`
                        );

                        modifiedSdp = modifiedSdp.replace(
                            /b=TIAS:\d+/g,
                            `b=TIAS:${CONFIG.streaming.maxBitrate}`
                        );

                        description = new RTCSessionDescription({
                            type: description.type,
                            sdp: modifiedSdp
                        });
                    }
                    return originalSetLocalDescription(description);
                };

                // ================================================================
                // OPTIMISATION LATENCE - Jitter Buffer & Playout Delay (CRITIQUE)
                // ================================================================

                const originalAddTransceiver = pc.addTransceiver ? pc.addTransceiver.bind(pc) : null;
                if (originalAddTransceiver) {
                    pc.addTransceiver = function (trackOrKind, init) {
                        const transceiver = originalAddTransceiver(trackOrKind, init);

                        // Optimiser le receiver pour faible latence
                        if (transceiver && transceiver.receiver) {
                            optimizeReceiverLatency(transceiver.receiver);
                        }

                        return transceiver;
                    };
                }

                // Intercepter ontrack pour optimiser les tracks vid\u00E9o entrantes
                const originalOntrack = Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, 'ontrack');
                if (originalOntrack && originalOntrack.set) {
                    let userOntrack = null;
                    Object.defineProperty(pc, 'ontrack', {
                        // Fix: le getter doit retourner le handler ASSIGN\u00C9 par l'utilisateur,
                        // pas notre wrapper interne (sinon code tiers qui fait
                        // `const old = pc.ontrack; pc.ontrack = ...; old.call(...)` casse)
                        get: () => userOntrack,
                        set: (handler) => {
                            userOntrack = handler;
                            const wrapped = function (event) {
                                if (event.receiver) optimizeReceiverLatency(event.receiver);
                                if (handler) handler.call(this, event);
                            };
                            originalOntrack.set.call(pc, handler ? wrapped : null);
                        },
                        configurable: true
                    });
                }

                // Intercepter createOffer/Answer pour les param\u00E8tres d'encodage
                const originalCreateOffer = pc.createOffer.bind(pc);
                pc.createOffer = async function (options) {
                    const offer = await originalCreateOffer(options);
                    return offer;
                };

                return pc;
            };

            // Fix: utiliser getOwnPropertyNames pour ne pas perdre les statiques
            // non-\u00E9num\u00E9rables comme RTCPeerConnection.generateCertificate
            Object.getOwnPropertyNames(OriginalRTCPeerConnection).forEach(key => {
                if (['length', 'name', 'prototype'].includes(key)) return;
                try {
                    const desc = Object.getOwnPropertyDescriptor(OriginalRTCPeerConnection, key);
                    if (desc) Object.defineProperty(windowCtx.RTCPeerConnection, key, desc);
                } catch (_) {
                    windowCtx.RTCPeerConnection[key] = OriginalRTCPeerConnection[key];
                }
            });
            windowCtx.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
        }

        // ===========================================================================
        // FOR\u00C7AGE P\u00C9RIODIQUE DU BITRATE - Emp\u00EAcher Boosteroid de r\u00E9duire le bitrate
        // ===========================================================================

        function startBitrateEnforcement() {
            if (bitrateEnforcementInterval) return;

            bitrateEnforcementInterval = setInterval(() => {
                activePeerConnections.forEach(pc => {
                    try {
                        if (pc.connectionState !== 'connected') return;

                        const senders = pc.getSenders();
                        senders.forEach(sender => {
                            if (!sender.track || sender.track.kind !== 'video') return;

                            const params = sender.getParameters();
                            if (!params.encodings || params.encodings.length === 0) return;

                            let modified = false;
                            params.encodings.forEach(encoding => {
                                // Forcer le bitrate si trop bas
                                if (encoding.maxBitrate === undefined || encoding.maxBitrate < CONFIG.streaming.minBitrate) {
                                    encoding.maxBitrate = CONFIG.streaming.targetBitrate;
                                    modified = true;
                                }

                                // Emp\u00EAcher le downscaling
                                if (encoding.scaleResolutionDownBy && encoding.scaleResolutionDownBy > 1) {
                                    encoding.scaleResolutionDownBy = 1;
                                    modified = true;
                                }
                            });

                            if (modified) {
                                sender.setParameters(params).catch(() => {
                                    // Silencieux
                                });
                            }
                        });
                    } catch (e) {
                        // Ignorer les erreurs
                    }
                });
            }, 5000); // V\u00E9rifier toutes les 5 secondes

            console.log('[Optimizer+] [OK] Bitrate enforcement actif (v\u00E9rification toutes les 5s)');
        }

        function stopBitrateEnforcement() {
            if (bitrateEnforcementInterval) {
                clearInterval(bitrateEnforcementInterval);
                bitrateEnforcementInterval = null;
            }
        }

        // D\u00E9marrer automatiquement sur page streaming
        if (isStreamingPage()) {
            startBitrateEnforcement();
        } else {
            // Fix: en SPA, l'utilisateur peut naviguer vers le streaming SANS reload.
            // On guette les nouveaux RTCPeerConnection pour d\u00E9marrer le for\u00E7age \u00E0 la vol\u00E9e.
            const startWhenPCAppears = setInterval(() => {
                if (activePeerConnections.size > 0) {
                    startBitrateEnforcement();
                    clearInterval(startWhenPCAppears);
                }
            }, 3000);
        }

        // Exposer les fonctions pour le contr\u00F4le externe
        windowCtx._optimizerBitrate = {
            start: startBitrateEnforcement,
            stop: stopBitrateEnforcement,
            getActivePCs: () => activePeerConnections.size,
            forceNow: () => {
                activePeerConnections.forEach(pc => {
                    try {
                        const senders = pc.getSenders();
                        senders.forEach(sender => {
                            if (!sender.track || sender.track.kind !== 'video') return;
                            const params = sender.getParameters();
                            if (params.encodings) {
                                params.encodings.forEach(enc => {
                                    enc.maxBitrate = CONFIG.streaming.maxBitrate;
                                });
                                sender.setParameters(params);
                            }
                        });
                    } catch (e) { }
                });
                console.log('[Optimizer+] Bitrate maximum forc\u00E9 imm\u00E9diatement');
            }
        };

        // Fonction d'optimisation de la latence des receivers
        function optimizeReceiverLatency(receiver) {
            if (!receiver || !CONFIG.performance.lowLatencyMode) return;

            try {
                const trackKind = receiver.track?.kind;

                // ===============================================================
                // ZERO-LATENCY RECEIVER OPTIMIZATION
                // playoutDelayHint=0 force le navigateur \u00E0 afficher les frames
                // ===============================================================
                // ZERO-LATENCY RECEIVER OPTIMIZATION
                // Laisser le navigateur g\u00E9rer le playoutDelayHint (null/undefined)
                // garantit la latence la plus basse sans buffer artificiel.
                // ===============================================================
                if (receiver.playoutDelayHint !== undefined) {
                    if (trackKind === 'video') {
                        // ZERO LATENCY - Aucun d\u00E9lai impos\u00E9 !
                        // On laisse null/undefined pour que l'engin WebRTC fasse son job.
                    }
                }

                // jitterBufferTarget (fallback)
                if (receiver.jitterBufferTarget !== undefined && trackKind === 'video') {
                    // ZERO LATENCY
                }

            } catch (e) {
                console.warn('[Optimizer+] Impossible d\'optimiser la latence receiver:', e);
            }
        }

        // Hook pour les requ\u00EAtes r\u00E9seau (XMLHttpRequest) - Intercepter les changements de qualit\u00E9
        const originalXHROpen = windowCtx.XMLHttpRequest.prototype.open;
        const originalXHRSend = windowCtx.XMLHttpRequest.prototype.send;

        windowCtx.XMLHttpRequest.prototype.open = function (method, url, ...args) {
            this._optimizerUrl = url;
            this._optimizerMethod = method;
            return originalXHROpen.call(this, method, url, ...args);
        };

        windowCtx.XMLHttpRequest.prototype.send = function (body) {
            // Intercepter les requ\u00EAtes qui tentent de r\u00E9duire la qualit\u00E9
            if (this._optimizerUrl && typeof this._optimizerUrl === 'string') {
                const url = this._optimizerUrl.toLowerCase();

                if ((url.includes('quality') || url.includes('bitrate') || url.includes('bandwidth')) &&
                    this._optimizerMethod === 'POST' && body) {
                    try {
                        let data = typeof body === 'string' ? JSON.parse(body) : body;

                        // Forcer les valeurs \u00E9lev\u00E9es si c'est une requ\u00EAte de qualit\u00E9
                        if (data.bitrate !== undefined || data.quality !== undefined || data.bandwidth !== undefined) {
                            console.log('[Optimizer+] [BLOCK] Requ\u00EAte de r\u00E9duction de qualit\u00E9 bloqu\u00E9e:', data);

                            // Remplacer par nos valeurs
                            if (data.bitrate !== undefined) data.bitrate = CONFIG.streaming.targetBitrate;
                            if (data.maxBitrate !== undefined) data.maxBitrate = CONFIG.streaming.maxBitrate;
                            if (data.bandwidth !== undefined) data.bandwidth = CONFIG.streaming.maxBitrate;
                            if (data.quality !== undefined) data.quality = 'ultra';

                            body = JSON.stringify(data);
                        }
                    } catch (e) {
                        // Pas du JSON, ignorer
                    }
                }
            }
            return originalXHRSend.call(this, body);
        };

        // Hook Fetch API - Intercepter les changements de qualit\u00E9
        const originalFetch = windowCtx.fetch;
        windowCtx.fetch = function (url, options) {
            // Intercepter les requ\u00EAtes de qualit\u00E9
            if (typeof url === 'string' && options && options.method === 'POST' && options.body) {
                const urlLower = url.toLowerCase();

                if (urlLower.includes('quality') || urlLower.includes('bitrate') || urlLower.includes('bandwidth')) {
                    try {
                        let data = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;

                        if (data.bitrate !== undefined || data.quality !== undefined) {
                            console.log('[Optimizer+] [BLOCK] Fetch de r\u00E9duction de qualit\u00E9 intercept\u00E9:', data);

                            if (data.bitrate !== undefined) data.bitrate = CONFIG.streaming.targetBitrate;
                            if (data.maxBitrate !== undefined) data.maxBitrate = CONFIG.streaming.maxBitrate;
                            if (data.quality !== undefined) data.quality = 'ultra';

                            options.body = JSON.stringify(data);
                        }
                    } catch (e) {
                        // Pas du JSON, ignorer
                    }
                }
            }

            return originalFetch.call(this, url, options);
        };

        console.log('[Optimizer+] Hooks bitrate + latence install\u00E9s');
    }

    // ===============================================================================
    // HOOK PERFORMANCE - Optimisations GPU et rendu
    // ===============================================================================

    function hookPerformance() {
        // Demander la priorit\u00E9 r\u00E9seau haute (si support\u00E9)
        if ('connection' in navigator) {
            try {
                // Surveiller la qualit\u00E9 de connexion et adapter
                const connection = navigator.connection;
                if (connection) {
                    connection.addEventListener('change', () => {
                        const effectiveType = connection.effectiveType;
                        if (!CONFIG.performance.disableLogsInGame) {
                            console.log('[Optimizer+] Connexion chang\u00E9e:', effectiveType);
                        }

                        // Adapter automatiquement la qualit\u00E9 selon la connexion
                        if (effectiveType === '4g' || effectiveType === 'wifi') {
                            // Connexion rapide: activer tous les filtres
                            CONFIG.performance.maxFiltersActive = 3;
                        } else if (effectiveType === '3g') {
                            // Connexion moyenne: r\u00E9duire les filtres
                            CONFIG.performance.maxFiltersActive = 1;
                        } else {
                            // Connexion lente: d\u00E9sactiver les filtres pour la fluidit\u00E9
                            CONFIG.performance.maxFiltersActive = 0;
                        }
                    });
                }
            } catch (e) { }
        }

        // Optimiser requestAnimationFrame pour le monitoring (si utilis\u00E9)
        let frameCount = 0;
        let lastFpsUpdate = performance.now();
        let currentFps = 60;

        // Exposer les stats FPS globalement pour debug
        windowCtx.optimizerStats = {
            get fps() { return currentFps; },
            get latency() { return CONFIG.performance.targetLatency; }
        };

        // Monitoring FPS l\u00E9ger (seulement si panel visible)
        let fpsCounterRunning = false;

        function updateFpsCounter() {
            if (!fpsCounterRunning) return; // Arr\u00EAter si panel ferm\u00E9
            frameCount++;
            const now = performance.now();

            if (now - lastFpsUpdate >= 1000) {
                currentFps = frameCount;
                frameCount = 0;
                lastFpsUpdate = now;

                const fpsDisplay = document.getElementById('optimizer-fps-display');
                if (fpsDisplay) {
                    fpsDisplay.textContent = currentFps + ' FPS';
                    fpsDisplay.style.color = currentFps >= 55 ? '#22c55e' :
                        currentFps >= 30 ? '#f59e0b' : '#ef4444';
                }
            }

            requestAnimationFrame(updateFpsCounter);
        }

        // Fonctions start/stop expos\u00E9es pour l'UI
        windowCtx._optimizerStartFps = function () {
            if (fpsCounterRunning) return;
            fpsCounterRunning = true;
            requestAnimationFrame(updateFpsCounter);
        };
        windowCtx._optimizerStopFps = function () {
            fpsCounterRunning = false;
        };

        console.log('[Optimizer+] Hooks performance install\u00E9s');
    }

    // ===============================================================================
    // VIDEO ENHANCER - Filtres de nettet\u00E9 et am\u00E9lioration AVANC\u00C9S
    // ===============================================================================

    // Pr\u00E9sets de filtres pr\u00E9d\u00E9finis (style Better xCloud)
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
            // PRESET COMP\u00C9TITIF - Optimis\u00E9 pour FPS (High-End ONLY)
            // v3.6.2 Slim: Valeurs divis\u00E9es par 2 pour stabilit\u00E9 60fps
            nameKey: 'presetGame',
            get name() { return t(this.nameKey); },
            minProfile: 'high-end',
            enhancer: { sharpness: 0.45, contrast: 1.06, saturation: 1.01, brightness: 1.02 },
            filters: {
                usm: { enabled: true, amount: 0.35, radius: 0.5, threshold: 0.03 },
                cas: { enabled: true, sharpness: 0.45 },
                clarity: { enabled: false, amount: 0 }, // v3.6.2: D\u00E9sactiv\u00E9 (trop lourd)
                denoise: { enabled: false, strength: 0.12 }, // v3.6.2: D\u00E9sactiv\u00E9 par d\u00E9faut
                vibrance: { enabled: true, amount: 0.15 },
                gamma: { enabled: true, value: 1.03 },
                exposure: { enabled: false, value: 0 },
                deband: { enabled: false, strength: 0.3 }
            }
        },
        'comfort': {
            // PRESET CONFORT - Anti-fatigue oculaire pour longues sessions
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
        // ===========================================================================
        // v3.5 PERFECT QUALITY PRESET - Zero visual artifacts, maximum clarity
        // ===========================================================================
        'perfect': {
            nameKey: 'presetPerfect',
            get name() { return t(this.nameKey); },
            description: 'Zero artifacts, maximum visual clarity (v3.5)',
            enhancer: { sharpness: 0.45, contrast: 1.02, saturation: 1.0, brightness: 1.0 },
            filters: {
                usm: { enabled: true, amount: 0.3, radius: 1.1, threshold: 0.05 },  // L\u00E9ger + stable
                cas: { enabled: true, sharpness: 0.4 },    // R\u00E9duit pour z\u00E9ro halo
                clarity: { enabled: false, amount: 0 },    // D\u00E9sactiv\u00E9: trop d'artefacts
                denoise: { enabled: false, strength: 0 },  // D\u00E9sactiv\u00E9: peut causer blocage
                vibrance: { enabled: false, amount: 0 },   // D\u00E9sactiv\u00E9
                gamma: { enabled: false, value: 1.0 },     // Neutre
                exposure: { enabled: false, value: 0 },    // Neutre
                deband: { enabled: true, strength: 0.15 }  // Tr\u00E8s l\u00E9ger deband
            },
            performance: {
                maxFiltersActive: 3,  // Limiter strictement
                adaptiveQuality: true,
                lowLatencyMode: true
            }
        },


        'custom': {
            nameKey: 'presetCustom',
            get name() { return t(this.nameKey); },
            enhancer: null,
            filters: null
        }
    };


    // ===============================================================================
    // WebGL2 SHADER ENGINE \u2014 Inlined from webgl-enhancer.js
    // Zero-latency GPU pipeline replacing CSS/SVG filters
    // ===============================================================================

    // ===============================================================================
    // WebGL2 VIDEO ENHANCER \u2014 Zero-latency GPU shader pipeline
    // Replaces CSS/SVG filters with direct GPU fragment shaders
    // ===============================================================================
    
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
    
    // Enhancement uniforms
    uniform float u_contrast;
    uniform float u_saturation;
    uniform float u_brightness;
    uniform float u_gamma;
    uniform float u_exposure;
    uniform float u_vibrance;
    uniform float u_sharpness;    // CAS/USM combined
    uniform float u_denoise;
    uniform float u_clarity;
    uniform float u_deband;
    
    // Master toggles
    uniform bool u_enhancerEnabled;
    uniform bool u_filtersEnabled;
    
    vec3 adjustContrast(vec3 color, float c) {
        return mix(vec3(0.5), color, c);
    }
    
    vec3 adjustSaturation(vec3 color, float s) {
        float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
        return mix(vec3(lum), color, s);
    }
    
    vec3 adjustVibrance(vec3 color, float v) {
        float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
        float maxC = max(color.r, max(color.g, color.b));
        float minC = min(color.r, min(color.g, color.b));
        float sat = maxC - minC;
        // Boost low-saturation pixels more (selective saturation)
        float boost = v * (1.0 - sat) * 0.5;
        return mix(vec3(lum), color, 1.0 + boost);
    }
    
    vec3 sharpen(sampler2D tex, vec2 uv, vec2 res, float amount) {
        vec2 px = 1.0 / res;
        vec3 center = texture(tex, uv).rgb;
        vec3 top    = texture(tex, uv + vec2(0.0, -px.y)).rgb;
        vec3 bottom = texture(tex, uv + vec2(0.0,  px.y)).rgb;
        vec3 left   = texture(tex, uv + vec2(-px.x, 0.0)).rgb;
        vec3 right  = texture(tex, uv + vec2( px.x, 0.0)).rgb;
        vec3 blur = (top + bottom + left + right) * 0.25;
        return center + (center - blur) * amount;
    }
    
    vec3 bilateralDenoise(sampler2D tex, vec2 uv, vec2 res, float strength) {
        vec2 px = 1.0 / res;
        vec3 center = texture(tex, uv).rgb;
        vec3 sum = center;
        float wSum = 1.0;
        float sigmaColor = 0.15;
        // Integer offsets for perfect compatibility with gl.NEAREST
        for (int x = -1; x <= 1; x++) {
            for (int y = -1; y <= 1; y++) {
                if (x == 0 && y == 0) continue;
                vec2 offset = vec2(float(x), float(y)) * px;
                vec3 s = texture(tex, uv + offset).rgb;
                float colorDist = length(s - center);
                float w = exp(-colorDist * colorDist / (2.0 * sigmaColor * sigmaColor));
                sum += s * w;
                wSum += w;
            }
        }
        vec3 denoised = sum / wSum;
        return mix(center, denoised, clamp(strength * 2.0, 0.0, 1.0));
    }
    
    vec3 clarityPass(sampler2D tex, vec2 uv, vec2 res, float amount) {
        vec2 px = 1.0 / res;
        vec3 center = texture(tex, uv).rgb;
        // Highpass via sparse blur subtraction (optimized for iGPU)
        vec3 blur = vec3(0.0);
        for (int x = -1; x <= 1; x++) {
            for (int y = -1; y <= 1; y++) {
                blur += texture(tex, uv + vec2(float(x), float(y)) * px * 3.0).rgb;
            }
        }
        blur /= 9.0;
        vec3 highpass = center - blur;
        return center + highpass * amount;
    }
    
    void main() {
        vec3 color = texture(u_video, v_texCoord).rgb;
    
        if (!u_enhancerEnabled && !u_filtersEnabled) {
            fragColor = vec4(color, 1.0);
            return;
        }
    
        // --- Denoise first (before sharpening) ---
        if (u_filtersEnabled && u_denoise > 0.01) {
            color = bilateralDenoise(u_video, v_texCoord, u_resolution, u_denoise);
        }
    
        // --- Sharpness (CAS-style convolution) ---
        if (u_filtersEnabled && u_sharpness > 0.01) {
            color = sharpen(u_video, v_texCoord, u_resolution, u_sharpness);
        }
    
        // --- Clarity (micro-contrast) ---
        if (u_filtersEnabled && u_clarity > 0.01) {
            color = clarityPass(u_video, v_texCoord, u_resolution, u_clarity);
        }
    
        // --- Basic enhancer adjustments ---
        if (u_enhancerEnabled) {
            // Exposure (before gamma)
            if (abs(u_exposure) > 0.001) {
                color *= pow(2.0, u_exposure * 0.5);
            }
            // Gamma
            if (abs(u_gamma - 1.0) > 0.001) {
                color = pow(max(color, vec3(0.0)), vec3(1.0 / u_gamma));
            }
            // Contrast
            if (abs(u_contrast - 1.0) > 0.001) {
                color = adjustContrast(color, u_contrast);
            }
            // Brightness
            if (abs(u_brightness - 1.0) > 0.001) {
                color *= u_brightness;
            }
            // Saturation
            if (abs(u_saturation - 1.0) > 0.001) {
                color = adjustSaturation(color, u_saturation);
            }
        }
    
        // --- Vibrance (selective saturation) ---
        if (u_filtersEnabled && abs(u_vibrance) > 0.01) {
            color = adjustVibrance(color, u_vibrance);
        }
    
        // --- Deband (subtle dithering) ---
        if (u_filtersEnabled && u_deband > 0.01) {
            float noise = fract(sin(dot(v_texCoord * u_resolution, vec2(12.9898, 78.233))) * 43758.5453);
            color += (noise - 0.5) * u_deband * 0.02;
        }
    
        fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }`;
    
    // ===============================================================================
    // WebGLVideoRenderer \u2014 manages GL context, shaders, and render loop
    // ===============================================================================
    class WebGLVideoRenderer {
        constructor() {
            this.canvas = null;
            this.gl = null;
            this.program = null;
            this.texture = null;
            this.videoElement = null;
            this.animationId = null;
            this.uniforms = {};
            this._attached = false;
            this._useRVFC = typeof HTMLVideoElement !== 'undefined' &&
                            'requestVideoFrameCallback' in HTMLVideoElement.prototype;
        }
    
        init(videoElement) {
            if (!videoElement || this._attached) return false;
            this.videoElement = videoElement;
    
            // Create canvas overlay
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'optimizer-webgl-canvas';
            this.canvas.style.cssText = `
                position: absolute; top: 0; left: 0;
                width: 100%; height: 100%;
                pointer-events: none;
                object-fit: contain;
            `;
    
            // Position relative to video parent
            const parent = videoElement.parentElement;
            if (parent) {
                parent.style.position = parent.style.position || 'relative';
                parent.insertBefore(this.canvas, videoElement.nextSibling);
            }
    
            // Init WebGL2
            this.gl = this.canvas.getContext('webgl2', {
                alpha: false,
                antialias: false,
                premultipliedAlpha: false,
                preserveDrawingBuffer: false,
                powerPreference: 'high-performance'
            });
    
            if (!this.gl) {
                console.warn('[Optimizer+] WebGL2 unavailable, falling back to CSS');
                return false;
            }

            // Gestion de la perte de contexte (tr\u00E8s fr\u00E9quent sur mobile en multi-t\u00E2che)
            this.canvas.addEventListener('webglcontextlost', (e) => {
                e.preventDefault();
                console.warn('[Optimizer+] WebGL context lost (backgrounding?)');
                this.stopRenderLoop();
                // Restaurer la vid\u00E9o visible pendant la perte de contexte
                if (this.videoElement) this.videoElement.style.opacity = '1';
                if (this.canvas) this.canvas.style.display = 'none';
            }, false);

            this.canvas.addEventListener('webglcontextrestored', () => {
                console.log('[Optimizer+] WebGL context restored, re-initializing...');
                this._initShaders();
                this._initGeometry();
                this._initTexture();
                this._textureAllocated = false;
                if (this._lastConfig) this.updateUniforms(this._lastConfig);
                this.startRenderLoop();
            }, false);
    
            this._initShaders();
            this._initGeometry();
            this._initTexture();
            this._attached = true;
    
            // v4.0.0: Quand les filtres sont actifs, la vid\u00E9o est masqu\u00E9e (opacity:0)
            // et le canvas WebGL la remplace. Quand ils sont OFF, la vid\u00E9o redevient visible.
    
            console.log('[Optimizer+] WebGL2 pipeline initialized (zero-latency mode)');
            return true;
        }
    
        _initShaders() {
            const gl = this.gl;
            const vs = this._compile(gl.VERTEX_SHADER, VERTEX_SHADER);
            const fs = this._compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    
            this.program = gl.createProgram();
            gl.attachShader(this.program, vs);
            gl.attachShader(this.program, fs);
            gl.linkProgram(this.program);
    
            if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
                console.error('[Optimizer+] Shader link error:', gl.getProgramInfoLog(this.program));
                return;
            }
    
            gl.useProgram(this.program);
    
            // Cache uniform locations
            const names = [
                'u_video', 'u_resolution',
                'u_contrast', 'u_saturation', 'u_brightness',
                'u_gamma', 'u_exposure', 'u_vibrance',
                'u_sharpness', 'u_denoise', 'u_clarity', 'u_deband',
                'u_enhancerEnabled', 'u_filtersEnabled'
            ];
            for (const n of names) {
                this.uniforms[n] = gl.getUniformLocation(this.program, n);
            }
        }
    
        _compile(type, source) {
            const gl = this.gl;
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error('[Optimizer+] Shader compile error:', gl.getShaderInfoLog(shader));
            }
            return shader;
        }
    
        _initGeometry() {
            const gl = this.gl;
            // Fullscreen quad
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
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            // LINEAR est meilleur car le scale CSS sur du NEAREST cr\u00E9e un aliasing per\u00E7u comme du flou
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
                this.canvas.style.display = this.isActive ? 'block' : 'none';
            }
            if (!this.isActive && this.videoElement) {
                this.videoElement.style.opacity = '1';
            }
            // Relancer la boucle de rendu si on repasse de OFF \u2192 ON
            if (this.isActive && !wasActive && !this.animationId) {
                this.startRenderLoop();
            }

            gl.uniform1i(this.uniforms.u_enhancerEnabled, e.enabled ? 1 : 0);
            gl.uniform1i(this.uniforms.u_filtersEnabled, f.enabled ? 1 : 0);
    
            // Basic enhancer
            gl.uniform1f(this.uniforms.u_contrast, e.contrast || 1.0);
            gl.uniform1f(this.uniforms.u_saturation, e.saturation || 1.0);
            gl.uniform1f(this.uniforms.u_brightness, e.brightness || 1.0);
    
            // Advanced filters
            gl.uniform1f(this.uniforms.u_sharpness,
                (f.cas?.enabled ? f.cas.sharpness : 0) + (f.usm?.enabled ? f.usm.amount : 0));
            gl.uniform1f(this.uniforms.u_gamma,
                f.gamma?.enabled ? f.gamma.value : 1.0);
            gl.uniform1f(this.uniforms.u_exposure,
                f.exposure?.enabled ? f.exposure.value : 0.0);
            gl.uniform1f(this.uniforms.u_vibrance,
                f.vibrance?.enabled ? f.vibrance.amount : 0.0);
            gl.uniform1f(this.uniforms.u_denoise,
                f.denoise?.enabled ? f.denoise.strength : 0.0);
            gl.uniform1f(this.uniforms.u_clarity,
                f.clarity?.enabled ? f.clarity.amount : 0.0);
            gl.uniform1f(this.uniforms.u_deband,
                f.deband?.enabled ? (f.deband.strength || 0.3) : 0.0);
        }
    
        render() {
            if (!this.isActive) return; // Short-circuit: save GPU and compositing when disabled

            const gl = this.gl;
            const video = this.videoElement;
            if (!gl || !video || video.readyState < 2 || gl.isContextLost()) return;

            // Pr\u00E9vention des rendus redondants (crucial pour le fallback rAF sur les \u00E9crans mobiles 120Hz)
            if (!this._useRVFC) {
                if (video.currentTime === this._lastVideoTime) return;
                this._lastVideoTime = video.currentTime;
            }

            // Always render at the stream's native resolution to preserve 100% visual fidelity.
            // Downscaling in WebGL causes bilinear blurring which looks like reduced bitrate.
            const texW = video.videoWidth || 1920;
            const texH = video.videoHeight || 1080;
            
            const renderW = texW;
            const renderH = texH;

            if (!renderW || !renderH) return;

            const sizeChanged = (this.canvas.width !== renderW || this.canvas.height !== renderH);
            if (sizeChanged) {
                this.canvas.width = renderW;
                this.canvas.height = renderH;
                gl.viewport(0, 0, renderW, renderH);
                gl.useProgram(this.program);
                gl.uniform2f(this.uniforms.u_resolution, renderW, renderH);
            }

            // Upload video frame to texture
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            
            // ULTRA-PERFORMANCE FIX: 
            // 1. Utiliser gl.RGBA (pas RGB) d\u00E9clenche le "zero-copy video fast-path" de Chromium.
            // 2. texImage2D avec HTMLVideoElement est plus rapide que texSubImage2D car il passe l'image d\u00E9cod\u00E9e HW directement.
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
            
            this._texW = texW;
            this._texH = texH;
            this._textureAllocated = true;
            
            gl.uniform1i(this.uniforms.u_video, 0);

            // Hide the actual video to prevent the browser compositor from rendering 
            // two 1080p 60fps videos at the same time (massive FPS saver)
            if (video.style.opacity !== '0') {
                video.style.opacity = '0';
            }

            // Draw
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
    
        startRenderLoop() {
            if (this.animationId) return;
    
            const loop = () => {
                this.render();
                // Ne pas programmer le prochain frame si les filtres sont d\u00E9sactiv\u00E9s
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
                (this._useRVFC ? ' (requestVideoFrameCallback sync)' : ' (rAF fallback)'));
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
                this.gl.getExtension('WEBGL_lose_context')?.loseContext();
            }
            this._attached = false;
            this._textureAllocated = false;
            this.gl = null;
            this.canvas = null;
            this.videoElement = null;
        }
    }
    

    // ===============================================================================
    // VideoEnhancer \u2014 Same API, now backed by WebGL2 GPU shaders
    // VideoEnhancer \u2014 Same API, now backed by WebGL2 GPU shaders
    // ===============================================================================
    class VideoEnhancer {
        constructor() {
            this.enabled = CONFIG.enhancer.enabled;
            this.filtersEnabled = CONFIG.filters.enabled;
            this.videoElement = null;
            this.filterString = '';

            // WebGL2 renderer
            this._glRenderer = new WebGLVideoRenderer();
            this._webglActive = false;
        }

        // --- Core: apply to a video element ---
        applyToVideo(videoElement) {
            if (!videoElement) return;
            this.videoElement = videoElement;

            // Handle video element replacement (e.g., stream reconnect, orientation change)
            if (this._webglActive && this._glRenderer.videoElement !== videoElement) {
                console.log('[Optimizer+] Video element changed. Rebinding WebGL...');
                this._glRenderer.destroy();
                this._webglActive = false;
            }

            // Init WebGL2 pipeline (no CSS fallback)
            if (!this._webglActive) {
                this._webglActive = this._glRenderer.init(videoElement);
            }

            if (this._webglActive) {
                this._glRenderer.updateUniforms(CONFIG);
                this._glRenderer.startRenderLoop();
                console.log('[Optimizer+] WebGL2 GPU shaders active (zero-latency)');
            } else {
                console.warn('[Optimizer+] WebGL2 unavailable \u2014 filters disabled');
            }
        }

        // --- Update WebGL2 uniforms ---
        updateFilterString() {
            if (this._webglActive) {
                this._glRenderer.updateUniforms(CONFIG);
            }
        }

        // --- Apply to all videos ---
        applyFiltersToAllVideos() {
            if (this._webglActive) {
                this._glRenderer.updateUniforms(CONFIG);
            }
        }

        removeFiltersFromAllVideos() {
            if (this._webglActive) {
                this._glRenderer.stopRenderLoop();
                // Restaurer la vid\u00E9o visible, sinon \u00E9cran noir !
                if (this._glRenderer.videoElement) {
                    this._glRenderer.videoElement.style.opacity = '1';
                }
                if (this._glRenderer.canvas) {
                    this._glRenderer.canvas.style.display = 'none';
                }
            }
        }




        // --- Settings ---
        updateSettings(settings) {
            Object.assign(CONFIG.enhancer, settings);
            this.updateFilterString();
            this.applyFiltersToAllVideos();
            Storage.set('config', CONFIG);
        }

        updateFilterSettings(filterName, settings) {
            if (CONFIG.filters[filterName]) {
                Object.assign(CONFIG.filters[filterName], settings);
                this.updateFilterString();
                this.applyFiltersToAllVideos();
                Storage.set('config', CONFIG);
            }
        }

        applyPreset(presetName) {
            const preset = FILTER_PRESETS[presetName];
            if (!preset) return;
            CONFIG.filters.preset = presetName;
            if (preset.enhancer) Object.assign(CONFIG.enhancer, preset.enhancer);
            if (preset.filters) {
                Object.keys(preset.filters).forEach(key => {
                    if (CONFIG.filters[key]) Object.assign(CONFIG.filters[key], preset.filters[key]);
                });
            }
            this.updateFilterString();
            this.applyFiltersToAllVideos();
            Storage.set('config', CONFIG);
            console.log('[Optimizer+] Preset "' + (preset.name || presetName) + '" applied (WebGL2)');
        }

        toggle(enabled) {
            this.enabled = enabled;
            CONFIG.enhancer.enabled = enabled;
            this.updateFilterString();
            this.applyFiltersToAllVideos();
            Storage.set('config', CONFIG);
        }

        toggleFilters(enabled) {
            this.filtersEnabled = enabled;
            CONFIG.filters.enabled = enabled;
            this.updateFilterString();
            this.applyFiltersToAllVideos();
            Storage.set('config', CONFIG);
        }

        toggleFilter(filterName, enabled) {
            if (CONFIG.filters[filterName]) {
                CONFIG.filters[filterName].enabled = enabled;
                this.updateFilterString();
                this.applyFiltersToAllVideos();
                Storage.set('config', CONFIG);
            }
        }

        scheduleFilterUpdate() {
            // WebGL updates are instant (uniform changes), no batching needed
            this.updateFilterString();
            this.applyFiltersToAllVideos();
        }

        onFilterSliderChange(filterName, value) {
            if (CONFIG.filters[filterName] !== undefined) {
                if (typeof CONFIG.filters[filterName] === 'object') {
                    const parts = filterName.split('.');
                    if (parts.length === 2) CONFIG.filters[parts[0]][parts[1]] = value;
                } else {
                    CONFIG.filters[filterName] = value;
                }
            } else if (CONFIG.enhancer[filterName] !== undefined) {
                CONFIG.enhancer[filterName] = value;
            }
            this.updateFilterString();
            this.applyFiltersToAllVideos();
        }

        // Compat stubs
        countActiveFilters() { return 0; }
        enforceFilterLimit() { return false; }
        applyEdgeEnhancements() {}
    }

    const videoEnhancer = new VideoEnhancer();

    // ===============================================================================
    // WEBRTC STATS OVERLAY - M\u00E9triques streaming en temps r\u00E9el
    // Polling RTCPeerConnection.getStats() chaque seconde
    // Affiche: bitrate, FPS, dropped, RTT, perte paquets, jitter, r\u00E9solution, codec
    // ===============================================================================

    // v4.0.0: NetworkTelemetryLoop REMOVED \u2014 it polled getStats() every 2s
    // only to feed data to the WASM module which was computing results nobody used.
    // Removing this saves CPU cycles and eliminates unnecessary WebRTC API calls.
    const NetworkTelemetryLoop = {
        active: false,
        start() { console.log('[Optimizer+] NetworkTelemetry disabled (v4.0.0 \u2014 WASM removed)'); },
        stop() { this.active = false; }
    };


    // ===============================================================================
    // DRM HOOKS - Bypass HDCP et autres restrictions
    // ===============================================================================

    function hookDRM() {
        // Fix: les originaux sont conserv\u00E9s en closure plut\u00F4t qu'attach\u00E9s sur les
        // objets globaux (pas d'exposition de *Original au code tiers). Aussi, garde
        // anti-double-hook pour \u00E9viter chaining lors d'une r\u00E9-ex\u00E9cution.
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

    // ===============================================================================
    // UI INJECTION - Ajout de l'interface dans le menu Boosteroid (CRUCIAL)
    // ===============================================================================

    // S\u00E9lecteurs possibles pour le menu Boosteroid
    const MENU_SELECTORS = [
        '#menu',
        '.menu',
        '[class*="sidebar"]',
        '[class*="settings"]',
        '[class*="panel"]',
        '[class*="menu"]',
        '[class*="Menu"]',
        '[class*="control"]',
        '[class*="options"]',
        '[class*="overlay"]',
        '.bstr-menu',
        '.game-menu',
        '[data-menu]',
        '[role="menu"]',
        '[role="dialog"]',
        '.modal-content',
        '.settings-panel',
        '.controls-panel'
    ];

    /**
     * Masquer l'option "Image plus lumineuse" de Boosteroid
     * Cette option interf\u00E8re avec les filtres du script
     */
    function hideBoosteroidBrighterOption() {
        // Cibler UNIQUEMENT les lignes avec un toggle/switch (pas les panneaux stats)
        // L'option "Image plus lumineuse" est un .menu_switch_block avec un input checkbox
        const switchBlocks = document.querySelectorAll('.menu_switch_block');

        switchBlocks.forEach(block => {
            // V\u00E9rifier que c'est bien un bloc avec un toggle (input checkbox)
            const hasToggle = block.querySelector('input[type="checkbox"], .switch, .toggle');
            if (!hasToggle) return; // Ignorer les blocs sans toggle

            // Ne pas toucher \u00E0 notre propre section
            if (block.closest('#optimizer-section')) return;

            // Chercher le texte du label
            const text = block.textContent?.toLowerCase() || '';

            // Mots-cl\u00E9s SP\u00C9CIFIQUES \u00E0 l'option "Image plus lumineuse" (multilingue)
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

    /**
     * Trouve le menu Boosteroid in-game (pas le menu dashboard!)
     * Utilise findOpenOptionsMenu() pour la logique principale
     * @returns {HTMLElement|null}
     */
    function findBoosteroidMenu() {
        // Utiliser la nouvelle fonction de d\u00E9tection
        const menu = findOpenOptionsMenu();
        if (menu) return menu;

        // Fallback: essayer les s\u00E9lecteurs classiques
        for (const selector of MENU_SELECTORS) {
            try {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    // V\u00E9rifier si c'est un \u00E9l\u00E9ment de menu valide (visible et avec du contenu)
                    if (el && el.offsetParent !== null && el.children.length > 0) {
                        // V\u00E9rifier que ce n'est pas notre propre \u00E9l\u00E9ment
                        if (!el.id?.includes('optimizer') && !el.className?.includes('optimizer')) {
                            // V\u00E9rifier qu'on est bien dans un contexte de jeu
                            if (isInGameSession()) {
                                return el;
                            }
                        }
                    }
                }
            } catch (e) { }
        }

        return null;
    }

    /**
     * Trouve le meilleur endroit pour ins\u00E9rer notre section dans le menu
     * Id\u00E9alement apr\u00E8s la section "Streaming"
     * @param {HTMLElement} menu - Le menu parent
     * @returns {HTMLElement|null} L'\u00E9l\u00E9ment apr\u00E8s lequel ins\u00E9rer, ou null pour ajouter \u00E0 la fin
     */
    function findInsertionPoint(menu) {
        // Chercher la section "Streaming" (dernier menu_block avant notre insertion)
        const menuBlocks = menu.querySelectorAll('.menu_block');
        if (menuBlocks.length > 0) {
            // Retourner le dernier menu_block existant
            return menuBlocks[menuBlocks.length - 1];
        }

        // Sinon chercher le dernier menu_title
        const menuTitles = menu.querySelectorAll('.menu_title');
        if (menuTitles.length > 0) {
            return menuTitles[menuTitles.length - 1];
        }

        return null;
    }

    // ===============================================================================
    // D\u00C9TECTION DE SESSION DE JEU - Logique robuste
    // ===============================================================================

    /**
     * V\u00E9rifie si on est sur une page dashboard (o\u00F9 le script ne doit PAS s'activer)
     * @returns {boolean} True si on est sur le dashboard
     */
    function isDashboardPage() {
        const path = window.location.pathname.toLowerCase();
        const href = window.location.href.toLowerCase();

        // Pages de streaming = PAS dashboard (jeu actif)
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

        // Si on est \u00E0 la racine ou sur une page dashboard connue
        if (path === '/' || path === '') {
            return true;
        }

        return dashboardPatterns.some(pattern => path.includes(pattern));
    }

    /**
     * V\u00E9rifie si on est sur la page de streaming (jeu actif)
     * @returns {boolean} True si on est en streaming
     */
    function isStreamingPage() {
        const path = window.location.pathname.toLowerCase();
        const href = window.location.href.toLowerCase();

        // D\u00E9tection de streaming.html avec sessionId
        if (path.includes('streaming.html') || href.includes('sessionid=')) {
            return true;
        }

        // Autres patterns de jeu
        const gamePatterns = ['/play/', '/game/', '/stream/', '/session/', '/run/'];
        return gamePatterns.some(pattern => path.includes(pattern));
    }

    /**
     * V\u00E9rifie si une instance de jeu est active (streaming vid\u00E9o WebRTC)
     * @returns {boolean} True si un jeu est en cours de streaming
     */
    function isInGameSession() {
        // 1. V\u00E9rifier si on est sur la page de streaming
        const onStreamingPage = isStreamingPage();

        // 2. V\u00E9rifier la pr\u00E9sence d'une vid\u00E9o de streaming active
        const video = document.querySelector('video');
        const hasActiveVideo = video && (
            video.src ||
            video.srcObject ||
            video.readyState >= 1 // HAVE_METADATA ou plus
        );

        // 3. V\u00E9rifier la pr\u00E9sence du menu Boosteroid (structure sp\u00E9cifique)
        const hasBoosteroidMenu = document.querySelector('#menu.menu_desktop') ||
            document.querySelector('.menu_switch_block') ||
            document.querySelector('#close-session-control');

        // 4. V\u00E9rifier qu'on n'est PAS sur le dashboard
        const notOnDashboard = !isDashboardPage();

        // Session active si: (page streaming OU vid\u00E9o active OU menu Boosteroid) ET pas dashboard
        const isActive = notOnDashboard && (onStreamingPage || hasActiveVideo || hasBoosteroidMenu);

        if (isActive !== SessionState.isGameActive) {
            console.log(`[Optimizer+] Session de jeu: ${isActive ? 'ACTIVE' : 'INACTIVE'}`);
            console.log(`[Optimizer+] - Page streaming: ${onStreamingPage}`);
            console.log(`[Optimizer+] - Vid\u00E9o active: ${!!hasActiveVideo}`);
            console.log(`[Optimizer+] - Menu Boosteroid: ${!!hasBoosteroidMenu}`);
            SessionState.isGameActive = isActive;
        }

        return isActive;
    }

    /**
     * V\u00E9rifie si le menu d'options de Boosteroid est ouvert
     * Cible sp\u00E9cifiquement la structure: #menu.menu_desktop avec display:block
     * @returns {HTMLElement|null} L'\u00E9l\u00E9ment menu si trouv\u00E9 et visible, null sinon
     */
    function findOpenOptionsMenu() {
        // 0. MOBILE/PWA: S\u00E9lecteur pour le menu mobile (priorit\u00E9 maximale sur mobile)
        const mobileMenu = document.querySelector('.m_lan_wrapper.menu-open');
        if (mobileMenu) {
            const style = window.getComputedStyle(mobileMenu);
            if (style.display !== 'none' && mobileMenu.offsetParent !== null) {
                console.log('[Optimizer+] Menu Mobile Boosteroid trouv\u00E9 (.m_lan_wrapper.menu-open)');
                return mobileMenu;
            }
        }

        // 1. S\u00E9lecteur EXACT du menu Boosteroid desktop
        const boosteroidMenu = document.querySelector('#menu.menu_desktop');
        if (boosteroidMenu) {
            const style = window.getComputedStyle(boosteroidMenu);
            // V\u00E9rifier que le menu est visible (display: block)
            if (style.display !== 'none' && boosteroidMenu.offsetParent !== null) {
                console.log('[Optimizer+] Menu Boosteroid trouv\u00E9 (#menu.menu_desktop)');
                return boosteroidMenu;
            }
        }

        // 2. Fallback: chercher par ID seul
        const menuById = document.getElementById('menu');
        if (menuById && menuById.classList.contains('menu_desktop')) {
            const style = window.getComputedStyle(menuById);
            if (style.display !== 'none') {
                return menuById;
            }
        }

        // 3. Fallback: chercher par structure (menu_title + menu_switch_block)
        const menuTitles = document.querySelectorAll('.menu_title');
        for (const title of menuTitles) {
            let parent = title.parentElement;
            // Remonter pour trouver le conteneur principal
            while (parent && parent !== document.body) {
                if (parent.id === 'menu' || parent.classList.contains('menu_desktop')) {
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

    /**
     * Nettoie tous les \u00E9l\u00E9ments UI du script et reset l'\u00E9tat
     * Appel\u00E9 quand on quitte une session de jeu ou ferme le menu
     */
    function cleanupUI() {
        // \u00C9l\u00E9ments \u00E0 supprimer
        const elementsToRemove = [
            '#optimizer-section',
            '#optimizer-notification',
            '#optimizer-dashboard-widget',
            '.optimizer-overlay',
            '#opt-notification-style'
        ];

        elementsToRemove.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => el.remove());
        });

        // Fix: retirer aussi les handlers document du widget dashboard
        if (typeof detachWidgetEvents === 'function') {
            try { detachWidgetEvents(); } catch (_) { }
        }

        // WebGL2: stop render loop when leaving game
        if (!SessionState.isGameActive && typeof videoEnhancer !== 'undefined') {
            videoEnhancer.removeFiltersFromAllVideos();
        }

        // Mettre \u00E0 jour l'\u00E9tat
        SessionState.isUIInjected = false;

        console.log('[Optimizer+] UI nettoy\u00E9e');
    }

    /**
     * Syst\u00E8me d'injection intelligent de l'UI
     * Ne s'active QUE si:
     * 1. On est en session de jeu (page streaming, pas dashboard)
     * 2. Le menu d'options est ouvert (visible)
     */
    function injectUI() {
        // ===========================================================================
        // V\u00C9RIFICATION INITIALE
        // ===========================================================================

        const onStreaming = isStreamingPage();
        console.log('[Optimizer+] Page de streaming:', onStreaming);
        console.log('[Optimizer+] URL:', window.location.href);

        if (isDashboardPage() && !onStreaming) {
            console.log('[Optimizer+] Dashboard d\u00E9tect\u00E9 - UI d\u00E9sactiv\u00E9e');
            return;
        }

        // ===========================================================================
        // OBSERVER PRINCIPAL - Surveille l'\u00E9tat du jeu et du menu
        // ===========================================================================

        let checkInterval = null;
        let lastUrl = window.location.href;
        let isInjecting = false; // v3.6.4: Mutex pour \u00E9viter double injection (RACE-01)

        /**
         * Fonction principale de v\u00E9rification et injection
         */
        const checkAndInject = () => {
            // v3.6.4: Mutex - \u00E9viter les appels concurrents (RACE-01 fix)
            if (isInjecting) return;
            isInjecting = true;

            try {
                // 0. Auto-r\u00E9paration en cas d'\u00E9tat incoh\u00E9rent
                SessionState.selfHeal();

                // 1. V\u00E9rifier si on est sur une page de streaming
                const onStreaming = isStreamingPage();

                if (!onStreaming && isDashboardPage()) {
                    // Pas en jeu -> nettoyer si n\u00E9cessaire
                    if (SessionState.isUIInjected) {
                        cleanupUI();
                    }
                    return;
                }

                // ===========================================================================
                // STREAMING ENHANCEMENTS: Activer d\u00E8s la page streaming (avant le menu)
                // ===========================================================================
                if (onStreaming && !StreamingEnhancements.active) {
                    StreamingEnhancements.enable();
                }

                // 2. Chercher le menu Boosteroid (#menu.menu_desktop)
                const menu = findOpenOptionsMenu();

                if (menu && !SessionState.isUIInjected) {
                    // Menu trouv\u00E9 et UI pas encore inject\u00E9e -> injecter
                    if (!document.getElementById('optimizer-section')) {
                        createOptimizerUI(menu);
                        hideBoosteroidBrighterOption(); // Masquer l'option conflictuelle
                        SessionState.isUIInjected = true;
                        SessionState.isMenuOpen = true;
                        SessionState.isGameActive = true;
                        SessionState.retryCount = 0; // Reset le compteur apr\u00E8s succ\u00E8s
                        console.log('[Optimizer+] [OK] UI inject\u00E9e dans le menu Boosteroid');
                    }
                } else if (menu && document.getElementById('optimizer-section')) {
                    // Menu ouvert et UI pr\u00E9sente - tout va bien
                    hideBoosteroidBrighterOption(); // S'assurer que l'option reste masqu\u00E9e
                    SessionState.isUIInjected = true;
                    SessionState.isMenuOpen = true;
                    SessionState.retryCount = 0;
                } else if (!menu && SessionState.isUIInjected) {
                    // Menu ferm\u00E9 - l'UI dispara\u00EEt avec le menu (pas besoin de cleanup)
                    // Le menu Boosteroid cache notre UI quand il se ferme
                    SessionState.isMenuOpen = false;
                    // L'UI sera recr\u00E9\u00E9e quand le menu s'ouvrira \u00E0 nouveau
                    if (!document.getElementById('optimizer-section')) {
                        SessionState.isUIInjected = false;
                    }
                }
            } finally {
                isInjecting = false; // v3.6.4: Lib\u00E9rer le mutex
            }
        };

        /**
         * G\u00E8re les changements d'URL (navigation SPA)
         */
        const handleUrlChange = () => {
            if (window.location.href !== lastUrl) {
                const previousUrl = lastUrl;
                lastUrl = window.location.href;
                console.log('[Optimizer+] Navigation d\u00E9tect\u00E9e:', window.location.pathname);

                // V\u00E9rifier si c'est un changement de session (nouveau jeu)
                if (SessionState.hasSessionChanged()) {
                    console.log('[Optimizer+] Nouveau jeu d\u00E9tect\u00E9 - r\u00E9initialisation');
                    SessionState.forceReinject();
                    setTimeout(checkAndInject, 500);
                    return;
                }

                // Si on retourne au dashboard, nettoyer
                if (isDashboardPage()) {
                    cleanupUI();
                    SessionState.reset();
                } else {
                    // Nouvelle page de jeu potentielle, v\u00E9rifier
                    setTimeout(checkAndInject, 500);
                }
            }
        };

        // ===========================================================================
        // MISE EN PLACE DES OBSERVERS
        // ===========================================================================

        // Observer les mutations DOM (apparition de menus, vid\u00E9os, etc.)
        const domObserver = new MutationObserver((mutations) => {
            // V\u00E9rifier les changements d'URL (SPA)
            handleUrlChange();

            // V\u00E9rifier si des \u00E9l\u00E9ments pertinents ont \u00E9t\u00E9 ajout\u00E9s ou modifi\u00E9s
            let shouldCheck = false;
            for (const mutation of mutations) {
                // V\u00E9rifier les attributs (display:block sur le menu)
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    const target = mutation.target;
                    if (target.id === 'menu' || target.classList?.contains('menu_desktop')) {
                        shouldCheck = true;
                        break;
                    }
                }

                // V\u00E9rifier les nouveaux n\u0153uds
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // V\u00E9rifier si c'est le menu ou un \u00E9l\u00E9ment de menu
                        if (node.id === 'menu' ||
                            node.classList?.contains('menu_desktop') ||
                            node.classList?.contains('menu_block') ||
                            node.matches?.('video, .menu_title, .menu_switch_block')) {
                            shouldCheck = true;
                            break;
                        }
                        // V\u00E9rifier les enfants
                        if (node.querySelector?.('#menu, .menu_desktop, .menu_block')) {
                            shouldCheck = true;
                            break;
                        }
                    }
                }
                if (shouldCheck) break;
            }

            if (shouldCheck) {
                // Petit d\u00E9lai pour laisser le DOM se stabiliser
                setTimeout(checkAndInject, 50);
            }
        });

        // Fix: 'display' n'est PAS un attribut HTML (c'est une propri\u00E9t\u00E9 CSS interne \u00E0 'style').
        // Le filtre l'ignorait silencieusement \u2192 on le retire pour clarifier l'intention.
        domObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
        });

        // \u00C9couter les clics (ouverture de menus)
        const clickHandler = () => {
            setTimeout(checkAndInject, 300);
        };
        document.addEventListener('click', clickHandler, { passive: true });

        // \u00C9couter les touches clavier (ESC pour fermer menu)
        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                setTimeout(checkAndInject, 100);
            }


        };
        document.addEventListener('keydown', keyHandler);

        // \u00C9couter popstate pour la navigation
        const popstateHandler = () => {
            setTimeout(() => {
                handleUrlChange();
                checkAndInject();
            }, 100);
        };
        window.addEventListener('popstate', popstateHandler);

        // \u00C9couter le changement de visibilit\u00E9 de l'onglet (retour apr\u00E8s alt-tab, etc.)
        const visibilityHandler = () => {
            if (document.visibilityState === 'visible' && isStreamingPage()) {
                console.log('[Optimizer+] Onglet redevenu visible - v\u00E9rification UI');
                // Laisser le temps au DOM de se r\u00E9tablir apr\u00E8s la reprise
                setTimeout(() => {
                    SessionState.selfHeal();
                    checkAndInject();
                }, 300);
            }
        };
        document.addEventListener('visibilitychange', visibilityHandler);

        // \u00C9couter le focus de la fen\u00EAtre (en plus de visibility pour compatibilit\u00E9)
        const focusHandler = () => {
            if (isStreamingPage()) {
                setTimeout(checkAndInject, 200);
            }
        };
        window.addEventListener('focus', focusHandler);

        // Fix: on relit isStreamingPage() \u00E0 CHAQUE it\u00E9ration (la valeur change quand
        // l'utilisateur navigue dashboard \u2194 jeu \u2014 l'ancienne version capturait
        // onStreaming une seule fois et la cadence ne s'adaptait jamais).
        const scheduleNextCheck = () => {
            const streamingNow = isStreamingPage();
            const delay = streamingNow ? 2000 : 5000;
            if (typeof requestIdleCallback !== 'undefined') {
                checkInterval = requestIdleCallback(() => {
                    if (isStreamingPage()) checkAndInject();
                    scheduleNextCheck();
                }, { timeout: delay });
            } else {
                checkInterval = setTimeout(() => {
                    if (isStreamingPage()) checkAndInject();
                    scheduleNextCheck();
                }, delay);
            }
        };
        scheduleNextCheck();

        // Stocker les handlers pour cleanup potentiel
        SessionState.cleanupHandlers = [
            () => domObserver.disconnect(),
            () => document.removeEventListener('click', clickHandler),
            () => document.removeEventListener('keydown', keyHandler),
            () => window.removeEventListener('popstate', popstateHandler),
            () => document.removeEventListener('visibilitychange', visibilityHandler),
            () => window.removeEventListener('focus', focusHandler),
            () => { if (typeof cancelIdleCallback !== 'undefined') cancelIdleCallback(checkInterval); else clearTimeout(checkInterval); }
        ];

        // Premi\u00E8re v\u00E9rification - imm\u00E9diate sur streaming.html
        if (onStreaming) {
            console.log('[Optimizer+] Page streaming d\u00E9tect\u00E9e - activation imm\u00E9diate');
            // V\u00E9rifier plusieurs fois rapidement au d\u00E9but
            setTimeout(checkAndInject, 100);
            setTimeout(checkAndInject, 500);
            setTimeout(checkAndInject, 1000);
            setTimeout(checkAndInject, 2000);
        } else {
            setTimeout(checkAndInject, 500);
        }

        console.log('[Optimizer+] Syst\u00E8me d\'injection intelligent activ\u00E9');
    }

    // Notification styl\u00E9e
    function showNotification(message, type = 'info') {
        // Supprimer notification existante
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

        // Fix: \u00E9viter d'injecter `message` via innerHTML (XSS potentiel si appel\u00E9 avec
        // une string venant d'un input/URL). On cr\u00E9e un \u00E9l\u00E9ment texte s\u00E9par\u00E9.
        const iconSpan = document.createElement('span');
        iconSpan.style.cssText = `display: flex; align-items: center; color: ${colors[type] || colors.info};`;
        iconSpan.innerHTML = icons[type] || icons.info; // SVG hardcod\u00E9, s\u00FBr
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

        // Ajouter animation CSS
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

    function createOptimizerUI(menuElement) {
        // V\u00E9rifier si d\u00E9j\u00E0 inject\u00E9
        if (document.getElementById('optimizer-section')) {
            console.log('[Optimizer+] UI d\u00E9j\u00E0 pr\u00E9sente');
            return;
        }

        // Activer les am\u00E9liorations de streaming (AXE 2)
        if (!StreamingEnhancements.active) {
            StreamingEnhancements.enable();
        }

        // Trouver le meilleur point d'insertion (apr\u00E8s la derni\u00E8re section)
        const insertAfter = findInsertionPoint(menuElement);

        // Cr\u00E9er la section Optimizer Plus - Structure native Boosteroid
        const section = document.createElement('div');
        section.id = 'optimizer-section';

        // D\u00E9terminer si on est sur un \u00E9cran ultrawide
        const isUltrawideScreen = (window.innerWidth / window.innerHeight) > 1.9;
        const sectionScreenAnalysis = SmartResolutionDetector.getScreenAnalysis();

        section.innerHTML = `
            <div class="menu_title" style="margin-top: 20px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
                <span>${escapeHtml(t('title'))} <span class="optimizer-badge">v4.0.0</span> <span style="font-size: 11px; color: #9b99ad; font-weight: normal;">by Derfog</span></span>
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

            <!-- Status compact -->
            <div class="menu_switch_block top_20">
                <div class="menu_title_group">
                    <div class="optimizer-status-dot" id="optimizer-status-dot"></div>
                    <span style="margin-left: 6px;">${escapeHtml(t('active'))} - <span id="optimizer-resolution">${escapeHtml(CONFIG.resolution.width)}x${escapeHtml(CONFIG.resolution.height)}</span></span>
                </div>
                <span class="optimizer-hw-badge">${ICONS.cpu}</span>
            </div>

            <!-- Info \u00E9cran d\u00E9tect\u00E9 -->
            <div class="optimizer-screen-info">
                ${ICONS.monitor}
                <span class="screen-detected">${escapeHtml(sectionScreenAnalysis.screen.width)}x${escapeHtml(sectionScreenAnalysis.screen.height)}</span>
                <span class="screen-ratio">${escapeHtml(sectionScreenAnalysis.screen.ratioType)}</span>
            </div>

            <!-- S\u00E9lecteur de R\u00E9solution v3.6.3 - Auto-d\u00E9tection intelligente -->
            <div class="menu_title">${escapeHtml(t('targetResolution'))}</div>
            <div class="menu_switch_block top_20">
                <div class="menu_title_group">
                    ${ICONS.monitor} <span>${escapeHtml(t('resolution'))}</span>
                </div>
                <select class="optimizer-select" id="optimizer-res-select">
                    ${SmartResolutionDetector.generateResolutionOptionsHTML(CONFIG.resolution.width, CONFIG.resolution.height, CONFIG.resolution.isAuto)}
                </select>
            </div>

            <!-- Video Enhancer - Simplifi\u00E9 -->
            <div class="menu_title">${escapeHtml(t('videoEnhancement'))}</div>
            <div class="menu_switch_block top_20">
                <div class="menu_title_group">
                    <p>${escapeHtml(t('enableEnhancer'))}</p>
                </div>
                <label class="switch">
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

            <!-- PR\u00C9SETS - Section principale simplifi\u00E9e -->
            <div class="menu_title">${escapeHtml(t('quickPresets'))}</div>
            <div class="menu_switch_block top_20" style="flex-direction: column; align-items: flex-start;">
                <div class="optimizer-presets" id="optimizer-presets">
                    <button class="optimizer-preset-btn ${CONFIG.filters.preset === 'perfect' ? 'active' : ''}" data-preset="perfect">${ICONS.sparkles} Perfect</button>
                    <button class="optimizer-preset-btn ${CONFIG.filters.preset === 'default' ? 'active' : ''}" data-preset="default">${ICONS.target} ${escapeHtml(t('presetDefault'))}</button>
                    <button class="optimizer-preset-btn ${CONFIG.filters.preset === 'cinematic' ? 'active' : ''}" data-preset="cinematic">${ICONS.film} ${escapeHtml(t('presetCinematic'))}</button>
                    <button class="optimizer-preset-btn ${CONFIG.filters.preset === 'game' ? 'active' : ''}" data-preset="game">${ICONS.crosshair} ${escapeHtml(t('presetGame'))}</button>
                    <button class="optimizer-preset-btn ${CONFIG.filters.preset === 'comfort' ? 'active' : ''}" data-preset="comfort">${ICONS.eye} ${escapeHtml(t('presetComfort'))}</button>
                </div>
            </div>

            <!-- Toggle filtres avanc\u00E9s (collapsed par d\u00E9faut) -->
            <div class="menu_switch_block top_20">
                <div class="menu_title_group">
                    <p>${escapeHtml(t('advancedFilters'))}</p>
                </div>
                <label class="switch">
                    <input type="checkbox" id="optimizer-filters-toggle" ${CONFIG.filters.enabled ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            </div>

            <!-- Filtres d\u00E9taill\u00E9s - cach\u00E9s par d\u00E9faut, affich\u00E9s si toggle activ\u00E9 -->
            <div id="optimizer-filters-details" style="display: ${CONFIG.filters.enabled ? 'block' : 'none'};">
                <!-- USM Filter -->
                <div class="menu_switch_block top_20">
                    <div class="menu_title_group">
                        <p>USM</p>
                    </div>
                    <label class="switch">
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
                    <label class="switch">
                        <input type="checkbox" class="optimizer-filter-checkbox" data-filter="cas" ${CONFIG.filters.cas.enabled ? 'checked' : ''}>
                        <span class="slider round"></span>
                    </label>
                </div>
                <div class="menu_switch_block top_20">
                    <div class="menu_title_group" id="cas-title">${Math.round(CONFIG.filters.cas.sharpness * 100)}%</div>
                    <input type="range" id="cas-sharpness" name="cas-sharpness" min="0" max="100" value="${CONFIG.filters.cas.sharpness * 100}">
                </div>
            </div>

            <!-- Mode Performance -->
            <div class="menu_switch_block top_20" style="margin-top: 15px;">
                <div class="menu_title_group">
                    ${ICONS.zap} <span style="margin-left: 4px;">${escapeHtml(t('performanceMode') || 'Performance')}</span>
                </div>
                <label class="switch">
                    <input type="checkbox" id="optimizer-performance-mode" ${CONFIG.display?.performanceMode ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            </div>

            <!-- Stretch Mode (No Borders) -->
            <div class="menu_switch_block top_20" style="margin-top: 15px;">
                <div class="menu_title_group">
                    ${ICONS.monitor} <span style="margin-left: 4px;">${escapeHtml(t('stretchMode'))}</span>
                </div>
                <label class="switch">
                    <input type="checkbox" id="optimizer-stretch-mode">
                    <span class="slider round"></span>
                </label>
            </div>

            <!-- ================================================================ -->
            <!-- WebRTC Stats Overlay                                             -->
            <!-- ================================================================ -->

            <!-- WebRTC Stats Overlay -->


            <!-- Reset -->
            <div class="menu_switch_block top_20" style="margin-top: 15px;">
                <button class="optimizer-btn secondary" id="optimizer-reset" style="width: 100%;">
                    ${ICONS.refresh} ${escapeHtml(t('reset'))}
                </button>
            </div>
        `;

        // Ins\u00E9rer au bon endroit dans le menu
        if (insertAfter && insertAfter.parentNode) {
            // Ins\u00E9rer apr\u00E8s le dernier menu_block (section Streaming)
            insertAfter.parentNode.insertBefore(section, insertAfter.nextSibling);
            console.log('[Optimizer+] UI ins\u00E9r\u00E9e apr\u00E8s la section Streaming');
        } else {
            // Fallback: ajouter \u00E0 la fin du menu
            menuElement.appendChild(section);
            console.log('[Optimizer+] UI ajout\u00E9e \u00E0 la fin du menu');
        }

        // Attacher les \u00E9v\u00E9nements
        attachUIEvents();

        // Initialiser le style des sliders (comme Boosteroid)
        initSliderStyles();

        console.log('[Optimizer+] Interface inject\u00E9e avec succ\u00E8s');
    }

    // Fonction pour cr\u00E9er un slider personnalis\u00E9 visuellement
    function createCustomSlider(inputElement) {
        // Cr\u00E9er le wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'optimizer-slider';

        // Cr\u00E9er les \u00E9l\u00E9ments visuels
        const track = document.createElement('div');
        track.className = 'optimizer-slider-track';

        const fill = document.createElement('div');
        fill.className = 'optimizer-slider-fill';

        const thumb = document.createElement('div');
        thumb.className = 'optimizer-slider-thumb';

        wrapper.appendChild(track);
        wrapper.appendChild(fill);
        wrapper.appendChild(thumb);

        // Ins\u00E9rer le wrapper avant l'input
        inputElement.parentNode.insertBefore(wrapper, inputElement);
        // D\u00E9placer l'input dans le wrapper
        wrapper.appendChild(inputElement);

        // Fonction de mise \u00E0 jour visuelle
        const updateVisual = () => {
            const min = parseFloat(inputElement.min) || 0;
            const max = parseFloat(inputElement.max) || 100;
            const value = parseFloat(inputElement.value) || 0;
            const percentage = ((value - min) / (max - min)) * 100;

            fill.style.width = `${percentage}%`;
            thumb.style.left = `${percentage}%`;
        };

        // Initialiser
        updateVisual();

        // \u00C9couter les changements
        inputElement.addEventListener('input', updateVisual);

        return wrapper;
    }

    function initSliderStyles() {
        // S\u00E9lectionner tous les sliders de notre section
        const sliders = document.querySelectorAll('#optimizer-section input[type="range"]');

        sliders.forEach(slider => {
            // V\u00E9rifier si d\u00E9j\u00E0 wrapp\u00E9
            if (!slider.parentElement.classList.contains('optimizer-slider')) {
                createCustomSlider(slider);
            }
        });
    }

    function attachUIEvents() {
        // Fonction de sauvegarde automatique (appel\u00E9e \u00E0 chaque changement)
        const autoSave = () => {
            Storage.set('config', CONFIG);
        };

        // R\u00E9solution
        const resSelect = document.getElementById('optimizer-res-select');
        if (resSelect) {
            resSelect.addEventListener('change', (e) => {
                const value = e.target.value;
                let width, height;
                let isAutoMode = false;

                if (value === 'auto') {
                    // Mode auto - utilise la r\u00E9solution native
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
                // v3.6.2: Pixel ratio intelligent selon r\u00E9solution
                CONFIG.resolution.pixelRatio = width >= 3840 ? 2 : (width >= 2560 ? 1.5 : 1);

                // Mettre \u00E0 jour l'affichage
                const resDisplay = document.getElementById('optimizer-resolution');
                if (resDisplay) {
                    resDisplay.textContent = isAutoMode ? `Auto: ${width}x${height}` : `${width}x${height}`;
                }

                // R\u00E9appliquer le hook de r\u00E9solution
                hookResolution();

                // Forcer Boosteroid \u00E0 recalculer la taille de la vid\u00E9o (\u00E9vite le bug du coin d'\u00E9cran zoom\u00E9)
                setTimeout(() => {
                    window.dispatchEvent(new Event('resize'));
                    const video = document.querySelector('video');
                    if (video && !CONFIG.display.stretchMode) {
                        video.style.transform = ''; // Reset les vieux transform de l'ancienne r\u00E9solution
                    }
                }, 100);

                // Notification
                // Fix: aspectRatio doit \u00EAtre un nombre, pas une string format\u00E9e (toFixed retourne string)
                const aspectRatio = width / height;
                let ratioName = '16:9';
                if (aspectRatio >= 3.4) ratioName = '32:9';
                else if (aspectRatio >= 2.2) ratioName = '21:9';
                else if (aspectRatio >= 1.75) ratioName = '16:9';
                else if (aspectRatio >= 1.55) ratioName = '16:10';

                const modeText = isAutoMode ? 'Auto' : '';
                showNotification(`${modeText} Resolution: ${width}x${height} (${ratioName})`);
                autoSave();
            });
        }

        // Enhancer toggle
        const enhancerToggle = document.getElementById('optimizer-enhancer');
        if (enhancerToggle) {
            enhancerToggle.addEventListener('change', (e) => {
                videoEnhancer.toggle(e.target.checked);
                autoSave();
            });
        }

        // Stream Interceptor toggle (opt-in)
        const streamInterceptorToggle = document.getElementById('optimizer-stream-interceptor');
        if (streamInterceptorToggle) {
            streamInterceptorToggle.addEventListener('change', (e) => {
                CONFIG.streaming.interceptorEnabled = e.target.checked;
                if (e.target.checked) {
                    StreamInterceptor.enable();
                    showNotification('Stream Interceptor enabled');
                } else {
                    StreamInterceptor.disable();
                    showNotification('Stream Interceptor disabled');
                }
                autoSave();
            });
        }

        // v3.6.1 Filtres avanc\u00E9s toggle - Affiche/cache les d\u00E9tails
        const filtersToggle = document.getElementById('optimizer-filters-toggle');
        if (filtersToggle) {
            filtersToggle.addEventListener('change', (e) => {
                videoEnhancer.toggleFilters(e.target.checked);
                const detailsSection = document.getElementById('optimizer-filters-details');
                if (detailsSection) {
                    detailsSection.style.display = e.target.checked ? 'block' : 'none';
                }
                autoSave();
            });
        }

        // v3.6 Performance Mode toggle
        const perfModeToggle = document.getElementById('optimizer-performance-mode');
        if (perfModeToggle) {
            perfModeToggle.addEventListener('change', (e) => {
                CONFIG.display.performanceMode = e.target.checked;

                if (e.target.checked) {
                    // Mode Performance: d\u00E9sactiver les filtres lourds, mais M\u00C9MORISER l'\u00E9tat pr\u00E9c\u00E9dent
                    // pour le restaurer correctement au toggle OFF (fix r\u00E9gression v4.0.0)
                    CONFIG.display._perfModeBackup = {
                        clarity: CONFIG.filters.clarity.enabled,
                        denoise: CONFIG.filters.denoise.enabled,
                        deband: CONFIG.filters.deband.enabled,
                        gpuAccel: CONFIG.performance.gpuAcceleration
                    };
                    CONFIG.filters.clarity.enabled = false;
                    CONFIG.filters.denoise.enabled = false;
                    CONFIG.filters.deband.enabled = false;
                    CONFIG.performance.gpuAcceleration = false;

                    videoEnhancer.updateFilterString();
                    videoEnhancer.applyFiltersToAllVideos();
                    showNotification('Performance Mode ON - FPS maximized');
                } else {
                    // Fix: restaurer l'\u00E9tat exact d'avant l'activation (sinon clarity/denoise/deband
                    // restaient OFF en permanence apr\u00E8s un seul toggle ON\u2192OFF)
                    const bk = CONFIG.display._perfModeBackup;
                    if (bk) {
                        CONFIG.filters.clarity.enabled = bk.clarity;
                        CONFIG.filters.denoise.enabled = bk.denoise;
                        CONFIG.filters.deband.enabled = bk.deband;
                        CONFIG.performance.gpuAcceleration = bk.gpuAccel;
                        delete CONFIG.display._perfModeBackup;
                    } else {
                        CONFIG.performance.gpuAcceleration = true;
                    }
                    videoEnhancer.updateFilterString();
                    videoEnhancer.applyFiltersToAllVideos();
                    showNotification('Normal mode restored');
                }

                autoSave();
            });
        }

        // Stretch Mode (No Borders)
        const stretchModeToggle = document.getElementById('optimizer-stretch-mode');
        if (stretchModeToggle) {
            stretchModeToggle.addEventListener('change', (e) => {
                CONFIG.display.stretchMode = e.target.checked;
                // Pas de autoSave() \u2014 stretch ne persiste pas entre les sessions
                if (e.target.checked) {
                    document.documentElement.classList.add('optimizer-stretch-mode');
                    // WebGL2: stretch the canvas too
                    const glCanvas = document.getElementById('optimizer-webgl-canvas');
                    if (glCanvas) glCanvas.style.objectFit = 'fill';
                    showNotification('Stretch Mode ON (Borders Removed)');
                } else {
                    document.documentElement.classList.remove('optimizer-stretch-mode');
                    const glCanvas = document.getElementById('optimizer-webgl-canvas');
                    if (glCanvas) glCanvas.style.objectFit = 'contain';
                    showNotification('Stretch Mode OFF');
                }
            });
        }

        // Sharpness
        const sharpSlider = document.getElementById('optimizer-sharpness');
        if (sharpSlider) {
            sharpSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value) / 100;
                document.getElementById('optimizer-sharp-value').textContent = `${e.target.value}%`;
                videoEnhancer.updateSettings({ sharpness: value });
                autoSave();
            });
        }

        // Contrast
        const contrastSlider = document.getElementById('optimizer-contrast');
        if (contrastSlider) {
            contrastSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value) / 100;
                document.getElementById('optimizer-contrast-value').textContent = `${e.target.value}%`;
                videoEnhancer.updateSettings({ contrast: value });
                autoSave();
            });
        }

        // Saturation
        const satSlider = document.getElementById('optimizer-saturation');
        if (satSlider) {
            satSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value) / 100;
                document.getElementById('optimizer-sat-value').textContent = `${e.target.value}%`;
                videoEnhancer.updateSettings({ saturation: value });
                autoSave();
            });
        }



        // Reset button - R\u00E9initialisation instantan\u00E9e
        const resetBtn = document.getElementById('optimizer-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                // R\u00E9initialiser le CONFIG avec les valeurs par d\u00E9faut
                CONFIG.resolution = { ...DEFAULT_CONFIG.resolution };
                CONFIG.enhancer = { ...DEFAULT_CONFIG.enhancer };
                CONFIG.filters = JSON.parse(JSON.stringify(DEFAULT_CONFIG.filters));
                CONFIG.language = DEFAULT_CONFIG.language;
                
                // D\u00E9sactiver le Stretch Mode (valeur par d\u00E9faut)
                if (CONFIG.display) CONFIG.display.stretchMode = false;
                document.documentElement.classList.remove('optimizer-stretch-mode');
                const glCanvas = document.getElementById('optimizer-webgl-canvas');
                if (glCanvas) glCanvas.style.objectFit = 'contain';

                // Sauvegarder le nouveau config
                localStorage.removeItem('optimizer_config');
                Storage.set('config', CONFIG);

                // Mettre \u00E0 jour VideoEnhancer imm\u00E9diatement
                videoEnhancer.enabled = CONFIG.enhancer.enabled;
                videoEnhancer.filtersEnabled = CONFIG.filters.enabled;
                videoEnhancer.updateFilterString();
                videoEnhancer.applyFiltersToAllVideos();

                // Mettre \u00E0 jour l'interface
                updateAllUIValues();

                showNotification('[OK] ' + t('settingsReset').replace('[<<] ', ''));
                console.log('[Optimizer+] Reset effectu\u00E9 - valeurs par d\u00E9faut restaur\u00E9es');
            });
        }

        // S\u00E9lecteur de langue
        const langSelect = document.getElementById('optimizer-lang-select');
        if (langSelect) {
            langSelect.addEventListener('change', (e) => {
                const newLang = e.target.value;
                CONFIG.language = newLang;

                // Mettre \u00E0 jour la langue courante
                if (newLang === 'auto') {
                    const browserLang = (navigator.language || navigator.userLanguage || 'en').substring(0, 2).toLowerCase();
                    currentLang = I18N.translations[browserLang] ? browserLang : 'en';
                } else {
                    currentLang = newLang;
                }

                autoSave();
                showNotification(`${t('language')}: ${e.target.options[e.target.selectedIndex].text}`);

                // Recr\u00E9er l'UI pour appliquer la nouvelle langue
                setTimeout(() => {
                    const section = document.getElementById('optimizer-section');
                    if (section) {
                        section.remove();
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

        // === FILTRES AVANC\u00C9S ===

        // Pr\u00E9sets
        const presetBtns = document.querySelectorAll('.optimizer-preset-btn');
        presetBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const preset = e.currentTarget.dataset.preset;
                videoEnhancer.applyPreset(preset);

                // Update UI active state
                presetBtns.forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');


                // Mettre \u00E0 jour les sliders de l'interface
                updateFiltersUI();

                autoSave();
                showNotification(t('presetApplied', { name: FILTER_PRESETS[preset]?.name || preset }));
            });
        });

        // Filter toggles individuels
        document.querySelectorAll('.optimizer-filter-checkbox').forEach(toggle => {
            toggle.addEventListener('change', (e) => {
                const filterName = e.target.dataset.filter;
                const isActive = e.target.checked;

                videoEnhancer.toggleFilter(filterName, isActive);

                // Passer en mode custom
                setPresetToCustom();
                autoSave();
            });
        });

        // USM sliders
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

        // CAS slider
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

        // Clarity slider
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

        // Denoise slider
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

        // Vibrance slider
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
    }

    // Fonction pour mettre \u00E0 jour TOUTE l'interface avec les valeurs actuelles du CONFIG
    function updateAllUIValues() {
        // R\u00E9solution
        const resSelect = document.getElementById('optimizer-res-select');
        if (resSelect) {
            resSelect.value = `${CONFIG.resolution.width}x${CONFIG.resolution.height}`;
        }
        const resDisplay = document.getElementById('optimizer-resolution');
        if (resDisplay) {
            resDisplay.textContent = `${CONFIG.resolution.width}x${CONFIG.resolution.height}`;
        }

        // Enhancer toggle
        const enhancerToggle = document.getElementById('optimizer-enhancer');
        if (enhancerToggle) {
            enhancerToggle.checked = CONFIG.enhancer.enabled;
        }

        // Filtres toggle
        const filtersToggle = document.getElementById('optimizer-filters-toggle');
        if (filtersToggle) {
            filtersToggle.checked = CONFIG.filters.enabled;
        }

        // Stretch Mode toggle
        const stretchModeToggle = document.getElementById('optimizer-stretch-mode');
        if (stretchModeToggle && CONFIG.display) {
            stretchModeToggle.checked = CONFIG.display.stretchMode;
        }

        // Pr\u00E9sets - mettre \u00E0 jour le bouton actif
        const presetBtns = document.querySelectorAll('.optimizer-preset-btn');
        presetBtns.forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.preset === CONFIG.filters.preset) {
                btn.classList.add('active');
            }
        });

        // Langue
        const langSelect = document.getElementById('optimizer-lang-select');
        if (langSelect) {
            langSelect.value = CONFIG.language;
        }

        // Mettre \u00E0 jour tous les sliders et toggles des filtres
        updateFiltersUI();


    }

    // Fonction pour mettre \u00E0 jour l'UI des filtres
    function updateFiltersUI() {
        // Enhancer de base
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

        // Filtres avanc\u00E9s
        const filters = CONFIG.filters;

        // USM
        const usmAmountEl = document.getElementById('usm-amount');
        if (usmAmountEl) {
            usmAmountEl.value = filters.usm.amount * 100;
            document.getElementById('usm-title').textContent = `${Math.round(filters.usm.amount * 100)}%`;
        }

        // CAS
        const casSharpnessEl = document.getElementById('cas-sharpness');
        if (casSharpnessEl) {
            casSharpnessEl.value = filters.cas.sharpness * 100;
            document.getElementById('cas-title').textContent = `${Math.round(filters.cas.sharpness * 100)}%`;
        }

        // Clarity
        const clarityAmountEl = document.getElementById('clarity-amount');
        if (clarityAmountEl) {
            clarityAmountEl.value = filters.clarity.amount * 100;
            document.getElementById('clarity-title').textContent = `${Math.round(filters.clarity.amount * 100)}%`;
        }

        // Denoise
        const denoiseStrengthEl = document.getElementById('denoise-strength');
        if (denoiseStrengthEl) {
            denoiseStrengthEl.value = filters.denoise.strength * 100;
            document.getElementById('denoise-title').textContent = `${Math.round(filters.denoise.strength * 100)}%`;
        }

        // Vibrance
        const vibranceAmountEl = document.getElementById('vibrance-amount');
        if (vibranceAmountEl) {
            vibranceAmountEl.value = filters.vibrance.amount * 100;
            document.getElementById('vibrance-title').textContent = `${Math.round(filters.vibrance.amount * 100)}%`;
        }

        // Mettre \u00E0 jour les toggles
        ['usm', 'cas', 'clarity', 'denoise', 'vibrance'].forEach(filterName => {
            const checkbox = document.querySelector(`.optimizer-filter-checkbox[data-filter="${filterName}"]`);
            if (checkbox) {
                checkbox.checked = filters[filterName].enabled;
            }
        });

        // Mettre \u00E0 jour le style visuel des sliders
        const sliders = document.querySelectorAll('#optimizer-section input[type="range"]');
        sliders.forEach(slider => updateSliderStyle(slider));

    }

    // ===============================================================================
    // v3.8.0: MISSING FUNCTION FIX - updateSliderStyle
    // Met \u00E0 jour l'affichage visuel d'un slider custom (fill + thumb position)
    // ===============================================================================
    function updateSliderStyle(slider) {
        if (!slider || !slider.parentElement) return;
        const wrapper = slider.closest('.optimizer-slider');
        if (!wrapper) return; // Pas encore wrapp\u00E9

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

    // Fonction pour passer en mode custom quand on modifie manuellement
    function setPresetToCustom() {
        CONFIG.filters.preset = 'custom';

        // Mettre \u00E0 jour les boutons de pr\u00E9set
        document.querySelectorAll('.optimizer-preset-btn').forEach(btn => {
            btn.classList.remove('active');
        });
    }

    function showDRMInfo() {
        let info = "=== Optimizer Plus - Info DRM ===\n\n";

        info += `Resolution forcee: ${CONFIG.resolution.width}x${CONFIG.resolution.height}\n`;
        info += `Pixel Ratio: ${CONFIG.resolution.pixelRatio}x\n\n`;

        info += "Codecs actives:\n";
        info += `  - AV1: ${CONFIG.codecs.forceAV1 ? '[OK]' : '[X]'}\n`;
        info += `  - HEVC: ${CONFIG.codecs.forceHEVC ? '[OK]' : '[X]'}\n`;
        info += `  - VP9: ${CONFIG.codecs.forceVP9 ? '[OK]' : '[X]'}\n\n`;

        info += `Bitrate max: ${CONFIG.streaming.maxBitrate / 1000000} Mbps\n\n`;

        info += "Enhancer:\n";
        info += `  - Active: ${CONFIG.enhancer.enabled ? '[OK]' : '[X]'}\n`;
        info += `  - Nettete: ${Math.round(CONFIG.enhancer.sharpness * 100)}%\n`;
        info += `  - Contraste: ${Math.round(CONFIG.enhancer.contrast * 100)}%\n`;
        info += `  - Saturation: ${Math.round(CONFIG.enhancer.saturation * 100)}%\n`;

        // V\u00E9rifier les capacit\u00E9s DRM
        if (windowCtx.MSMediaKeys && windowCtx.MSMediaKeys.isTypeSupportedWithFeaturesOriginal) {
            info += "\nPlayReady DRM:\n";
            const hwSupport = windowCtx.MSMediaKeys.isTypeSupportedWithFeaturesOriginal(
                "com.microsoft.playready.hardware",
                'video/mp4; codecs="hev1,mp4a"; features="hdcp=2"'
            ) !== '';
            info += `  - Hardware HDCP 2.2: ${hwSupport ? '[OK]' : '[X]'}\n`;
        }

        alert(info);
    }

    // ===============================================================================
    // VIDEO OBSERVER - D\u00E9tection et am\u00E9lioration des \u00E9l\u00E9ments vid\u00E9o
    // ===============================================================================

    function setupVideoObserver() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeName === 'VIDEO') {
                        handleVideoElement(node);
                    } else if (node.querySelectorAll) {
                        node.querySelectorAll('video').forEach(handleVideoElement);
                    }
                });
            });
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        // Traiter les vid\u00E9os existantes
        document.querySelectorAll('video').forEach(handleVideoElement);
    }

    function handleVideoElement(video) {
        console.log('[Optimizer+] Vid\u00E9o d\u00E9tect\u00E9e');

        // Appliquer l'enhancer
        videoEnhancer.applyToVideo(video);

        // Optimisations vid\u00E9o
        video.setAttribute('playsinline', '');

        // Note: Le monitoring de frames a \u00E9t\u00E9 d\u00E9sactiv\u00E9 pour performance
        // Utiliser le mode Performance dans les param\u00E8tres si n\u00E9cessaire
    }

    // ===============================================================================
    // MENU COMMANDS - Commandes Tampermonkey
    // ===============================================================================

    function registerMenuCommands() {
        if (typeof GM_registerMenuCommand === 'undefined') return;

        GM_registerMenuCommand("Optimizer Plus - Parametres", () => {
            // Ouvrir le menu Boosteroid si possible
            const menuBtn = document.querySelector('[class*="menu"]');
            if (menuBtn) menuBtn.click();
        });

        GM_registerMenuCommand("Info DRM & Codecs", showDRMInfo);

        GM_registerMenuCommand("Toggle AV1", () => {
            CONFIG.codecs.forceAV1 = !CONFIG.codecs.forceAV1;
            Storage.set('config', CONFIG);
            showNotification(`AV1: ${CONFIG.codecs.forceAV1 ? 'Active' : 'Desactive'}`);
        });

        GM_registerMenuCommand("Toggle Enhancer", () => {
            videoEnhancer.toggle(!CONFIG.enhancer.enabled);
            showNotification(`Enhancer: ${CONFIG.enhancer.enabled ? 'Active' : 'Desactive'}`);
        });

        GM_registerMenuCommand("Recharger avec parametres", () => {
            location.reload();
        });
    }

    // ===============================================================================
    // v3.6.3 DASHBOARD FLOATING WIDGET - Bouton flottant sur le dashboard
    // Permet de configurer la r\u00E9solution avant de lancer un jeu
    // ===============================================================================

    function createDashboardWidget() {
        // V\u00E9rifier qu'on est bien sur le dashboard principal
        if (document.getElementById('optimizer-dashboard-widget')) {
            return; // D\u00E9j\u00E0 cr\u00E9\u00E9
        }

        // Attendre que le DOM soit pr\u00EAt et que le bouton chatbot soit charg\u00E9
        const waitForChatbot = () => {
            const chatbot = document.getElementById('botbutton');
            if (chatbot) {
                injectWidget();
            } else {
                // R\u00E9essayer apr\u00E8s un d\u00E9lai
                setTimeout(waitForChatbot, 500);
            }
        };

        // Cr\u00E9er le widget imm\u00E9diatement, positionnement relatif au chatbot si pr\u00E9sent
        const injectWidget = () => {
            const widget = document.createElement('div');
            widget.id = 'optimizer-dashboard-widget';
            // v3.7.2: Style inline pour \u00E9viter flash blanc au chargement. v4.0.0: Bottom pass\u00E9 \u00E0 40px pour mobile/PWA
            widget.style.cssText = 'position:fixed;right:20px;bottom:40px;z-index:99998;background:transparent;opacity:0;visibility:hidden;pointer-events:none;transition:opacity 0.25s ease 0.05s;';

            // Utiliser le Smart Resolution Detector pour g\u00E9n\u00E9rer les options
            const screenAnalysis = SmartResolutionDetector.getScreenAnalysis();
            const resolutionOptions = SmartResolutionDetector.generateResolutionOptionsHTML(
                CONFIG.resolution.width,
                CONFIG.resolution.height,
                CONFIG.resolution.isAuto // v3.7.2: Passer le mode auto
            );

            // D\u00E9terminer le status actuel (auto ou manuel)
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
                <button type="button" class="opt-widget-btn" id="opt-widget-toggle" title="Optimizer Plus - Settings" style="background:linear-gradient(135deg,#00a3ff 0%,#0066cc 100%);border:none;width:56px;height:56px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:28px;height:28px;color:white;">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                    </svg>
                    <div class="opt-status-dot" title="Active: ${safeCurrentResText}" style="position:absolute;top:2px;right:2px;width:14px;height:14px;border-radius:50%;background:#22c55e;border:2px solid #fff;"></div>
                </button>

                <!-- Panel d\u00E9roulant -->
                <div class="opt-widget-panel" id="opt-widget-panel" style="position:absolute;bottom:70px;right:0;width:280px;background:rgba(19,23,33,0.98);color:#fff;border:1px solid rgba(0,163,255,0.3);border-radius:12px;padding:16px;opacity:0;visibility:hidden;transform:translateY(10px) scale(0.95);transition:all 0.25s cubic-bezier(0.4,0,0.2,1);">
                    <div class="opt-widget-header">
                        <span class="opt-widget-title">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;vertical-align:middle;margin-right:4px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                            Optimizer Plus
                            <span class="opt-widget-version">v4.0.0</span>
                        </span>
                    </div>

                    <!-- Info \u00E9cran d\u00E9tect\u00E9 -->
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

                    <!-- S\u00E9lecteur de r\u00E9solution -->
                    <div class="opt-widget-row">
                        <label class="opt-widget-label">Target Resolution</label>
                        <select class="opt-widget-select" id="opt-widget-resolution" style="background:rgba(6,9,18,0.9);color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:10px 12px;">
                            ${resolutionOptions}
                        </select>
                    </div>

                    <!-- Boutons d'action -->
                    <div class="opt-widget-actions" style="display:flex;gap:8px;">
                        <button class="opt-widget-action-btn secondary" id="opt-widget-reload" title="Recharger la page" style="background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.85);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:10px 14px;cursor:pointer;flex:1;display:flex;align-items:center;justify-content:center;gap:6px;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                                <polyline points="23 4 23 10 17 10"/>
                                <polyline points="1 20 1 14 7 14"/>
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                            </svg>
                            Recharger
                        </button>
                        <button class="opt-widget-action-btn primary" id="opt-widget-apply" title="Appliquer" style="background:#00a3ff;color:#fff;border:none;border-radius:8px;padding:10px 14px;cursor:pointer;flex:1;display:flex;align-items:center;justify-content:center;gap:6px;">
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

            // v3.7.5: Emp\u00EAcher le flash blanc en affichant le widget seulement une fois styl\u00E9
            const revealWidget = () => {
                widget.style.opacity = '1';
                widget.style.visibility = 'visible';
                widget.style.pointerEvents = 'auto';
            };

            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => requestAnimationFrame(revealWidget));
            } else {
                setTimeout(revealWidget, 50);
            }

            console.log('[Optimizer+] [OK] Dashboard widget inject\u00E9 dans le DOM');

            // Attacher les \u00E9v\u00E9nements avec plusieurs tentatives pour plus de robustesse
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

            // Commencer apr\u00E8s un d\u00E9lai
            setTimeout(() => attachWithRetry(), 50);

            console.log('[Optimizer+] [OK] Dashboard widget cr\u00E9\u00E9');
        };

        // D\u00E9marrer apr\u00E8s un court d\u00E9lai pour laisser la page charger
        setTimeout(() => {
            injectWidget();
        }, 800);
    }

    // Fix: stocker les handlers document-level pour pouvoir les retirer
    // (sinon fuite m\u00E9moire \u00E0 chaque navigation SPA dashboard \u2194 streaming)
    let _widgetDocHandlers = null;
    function detachWidgetEvents() {
        if (!_widgetDocHandlers) return;
        document.removeEventListener('click', _widgetDocHandlers.click);
        document.removeEventListener('keydown', _widgetDocHandlers.keydown);
        _widgetDocHandlers = null;
    }
    function attachWidgetEvents() {
        // Si on rebind, retirer d'abord les anciens handlers (\u00E9vite l'empilement)
        detachWidgetEvents();

        const widget = document.getElementById('optimizer-dashboard-widget');
        const toggleBtn = document.getElementById('opt-widget-toggle');
        const panel = document.getElementById('opt-widget-panel');
        const resSelect = document.getElementById('opt-widget-resolution');
        const reloadBtn = document.getElementById('opt-widget-reload');
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

        // Utiliser la d\u00E9l\u00E9gation d'\u00E9v\u00E9nements sur le widget conteneur
        widget.addEventListener('click', (e) => {
            const target = e.target;

            // Toggle button click
            if (target.id === 'opt-widget-toggle' || target.closest('#opt-widget-toggle')) {
                e.preventDefault();
                e.stopPropagation();
                console.log('[Optimizer+] Toggle button clicked via delegation');
                if (panel) {
                    const isOpen = panel.classList.contains('open');
                    if (isOpen) {
                        // Fermer le panel
                        panel.classList.remove('open');
                        panel.style.opacity = '0';
                        panel.style.visibility = 'hidden';
                        panel.style.transform = 'translateY(10px) scale(0.95)';
                    } else {
                        // Ouvrir le panel
                        panel.classList.add('open');
                        panel.style.opacity = '1';
                        panel.style.visibility = 'visible';
                        panel.style.transform = 'translateY(0) scale(1)';
                    }
                    console.log('[Optimizer+] Panel state:', panel.classList.contains('open') ? 'OPEN' : 'CLOSED');
                }
                return;
            }

            // Reload button click
            if (target.id === 'opt-widget-reload' || target.closest('#opt-widget-reload')) {
                e.preventDefault();
                console.log('[Optimizer+] Reload button clicked');
                location.reload();
                return;
            }

            // Apply button click
            if (target.id === 'opt-widget-apply' || target.closest('#opt-widget-apply')) {
                e.preventDefault();
                console.log('[Optimizer+] Apply button clicked');
                Storage.set('config', CONFIG);
                hookResolution();

                // Feedback visuel
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

                        // Fermer le panel
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

        // Changement de r\u00E9solution
        if (resSelect) {
            resSelect.addEventListener('change', (e) => {
                const value = e.target.value;
                let width, height, displayText;
                let isAutoMode = false;

                if (value === 'auto') {
                    isAutoMode = true;
                    // Mode auto-d\u00E9tection - utilise r\u00E9solution NATIVE de l'\u00E9cran
                    const autoRes = SmartResolutionDetector.applyAutoResolution();
                    if (autoRes) {
                        width = autoRes.w;
                        height = autoRes.h;
                        displayText = `Auto: ${width}x${height}`;
                    } else {
                        // Fallback
                        const screen = SmartResolutionDetector.getScreenDimensions();
                        width = screen.width;
                        height = screen.height;
                        displayText = `Auto: ${width}x${height}`;
                    }
                } else {
                    // R\u00E9solution manuelle
                    [width, height] = value.split('x').map(Number);
                    displayText = `${width}x${height}`;
                }

                CONFIG.resolution.width = width;
                CONFIG.resolution.height = height;
                CONFIG.resolution.pixelRatio = width >= 3840 ? 2 : (width >= 2560 ? 1.5 : 1);
                CONFIG.resolution.isAuto = isAutoMode; // v3.7.2: Marquer le mode auto

                // Mettre \u00E0 jour le status
                if (statusText) {
                    statusText.textContent = displayText;
                }

                // Mettre \u00E0 jour le tooltip du status dot
                const statusDot = document.querySelector('#optimizer-dashboard-widget .opt-status-dot');
                if (statusDot) {
                    statusDot.title = `Actif: ${displayText}`;
                }

                // Mettre \u00E0 jour l'info \u00E9cran si auto
                const screenValue = document.querySelector('.opt-screen-value');
                if (screenValue && value === 'auto') {
                    screenValue.classList.add('auto-active');
                } else if (screenValue) {
                    screenValue.classList.remove('auto-active');
                }

                // Sauvegarder
                Storage.set('config', CONFIG);

                // R\u00E9appliquer le hook
                hookResolution();

                console.log(`[Optimizer+] R\u00E9solution chang\u00E9e: ${displayText}`);
            });
        }

        // Fix: stocker les handlers pour cleanup ult\u00E9rieur
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

    // ===============================================================================
    // INITIALISATION
    // ===============================================================================

    function init() {
        console.log('[Optimizer+] =======================================');
        console.log('[Optimizer+] Boosteroid Optimizer Plus v3.7.2 by Derfog');
        console.log('[Optimizer+] Device:', ENV_PROFILE.summary());
        console.log('[Optimizer+] Filter Tier:', FilterState.currentTier);
        console.log('[Optimizer+] Resolution:', `${CONFIG.resolution.width}x${CONFIG.resolution.height}`);
        console.log('[Optimizer+] Bitrate:', `${Math.round(CONFIG.streaming.maxBitrate / 1000000)}Mbps`);
        console.log('[Optimizer+] Low Latency:', CONFIG.performance.lowLatencyMode ? 'ON' : 'OFF');
        console.log('[Optimizer+] =======================================');

        // IMPORTANT: Les hooks techniques s'appliquent PARTOUT (m\u00EAme dashboard)
        // car ils pr\u00E9parent le navigateur pour le streaming
        hookResolution();
        hookCodecs();
        hookBitrate();
        hookDRM();
        hookPerformance();

        // v4.0.0: WASM module removed (was dead code \u2014 computed stats but never applied them)
        console.log('[Optimizer+] v4.0.0 \u2014 WASM module removed (zero-overhead mode)');

        // L'UI et les observers ne s'activent QUE si on n'est pas sur le dashboard
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', onDOMReady);
        } else {
            onDOMReady();
        }
    }

    function onDOMReady() {
        // Injecter les styles (toujours, ils seront utilis\u00E9s si on lance un jeu)
        ensureOptimizerTypography();

        // Enregistrer les commandes menu Tampermonkey (toujours disponibles)
        registerMenuCommands();

        // D\u00E9terminer le type de page
        const onStreaming = isStreamingPage();
        const onDashboard = isDashboardPage();

        // Stretch mode: ne PAS restaurer automatiquement (l'utilisateur doit l'activer manuellement)

        console.log('[Optimizer+] Type de page - Streaming:', onStreaming, '| Dashboard:', onDashboard);

        // Si on est sur le dashboard ET pas sur streaming, afficher le widget flottant
        if (onDashboard && !onStreaming) {
            console.log('[Optimizer+] Dashboard d\u00E9tect\u00E9 - Widget flottant activ\u00E9');
            console.log('[Optimizer+] L\'UI compl\u00E8te s\'activera automatiquement quand vous lancerez un jeu');
            createDashboardWidget();
            return;
        }

        // v4.0.0: WebGL2 filters initialized on first video attach (no bootstrap needed)

        // Injecter le syst\u00E8me d'UI intelligent
        injectUI();

        // Observer les vid\u00E9os pour appliquer les filtres
        setupVideoObserver();

        // v3.6.9 Log avec info \u00E9cran
        const screenInfo = UltrawideSupport.getScreenInfo();
        console.log('[Optimizer+] v3.6.9 Smart Resolution [OK]');
        console.log(`[Optimizer+] Screen: ${screenInfo.width}x${screenInfo.height} (${screenInfo.type})`);
        // Raccourci ultrawide supprim\u00E9 - utiliser le s\u00E9lecteur de r\u00E9solution

        // v3.6 Auto-d\u00E9tection ratio pour logging seulement
        if (CONFIG.display?.autoDetect !== false) {
            const ratio = parseFloat(screenInfo.ratio);
            if (ratio >= 2.0) {
                console.log('[Optimizer+] \u00C9cran large d\u00E9tect\u00E9 - r\u00E9solutions ultrawide disponibles');
            }
        }
    }

    // D\u00E9marrer
    init();

})();
