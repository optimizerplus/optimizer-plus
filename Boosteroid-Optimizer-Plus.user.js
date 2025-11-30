// ==UserScript==
// @name                 Boosteroid Optimizer Plus by Derfog
// @name:fr              Boosteroid Optimizer Plus par Derfog
// @namespace            https://github.com/derfog
// @version              3.7.2
// @description          Ultimate Boosteroid optimizer: SLIM & FAST, Smart Resolution, 5 Presets, requestIdleCallback, Zero VRAM leak
// @description:fr       Optimiseur ultime Boosteroid: SLIM & FAST, Résolution intelligente, 5 Presets, requestIdleCallback, Zéro fuite VRAM
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
 * BOOSTEROID OPTIMIZER PLUS v3.7.2 "Smart Quality" by DERFOG
 * Copyright (c) 2024-2025 Derfog - MIT License
 *
 * v3.7.2: Smart Quality Edition
 * - NEW: Presets désactivés par défaut (tier OFF) - l'utilisateur choisit
 * - NEW: getScreenDetails API for screen detection
 * - SECURITY: Removed global SmartResolutionDetector exposure (XSS prevention)
 * - Upscale Only + SUPPORTED_RESOLUTIONS whitelist
 * - Retry system for filter presets
 */

(function () {
    'use strict';

    // ===============================================================================
    // AXE 1: ENVIRONMENT DETECTION & PROFILING (avec fallbacks robustes)
    // ===============================================================================

    const ENV_PROFILE = (function() {
        // Helpers pour accès sécurisé aux APIs navigateur
        const safeGet = (fn, fallback) => {
            try { return fn() ?? fallback; } catch (e) { return fallback; }
        };

        const ua = navigator.userAgent || '';
        const cores = safeGet(() => navigator.hardwareConcurrency, 4);
        const memory = safeGet(() => navigator.deviceMemory, 4); // GB - non supporté sur Firefox/Safari

        // matchMedia peut échouer sur certains navigateurs TV
        let isTouch = false;
        try {
            isTouch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
        } catch (e) {
            isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        }

        const width = safeGet(() => window.innerWidth || document.documentElement.clientWidth, 1920);
        const height = safeGet(() => window.innerHeight || document.documentElement.clientHeight, 1080);
        const dpr = safeGet(() => window.devicePixelRatio, 1);

        // Network Information API (non supportée partout)
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

        // Détection UA
        const isMobile = /Android|iPhone|iPad|iPod|Windows Phone/i.test(ua);
        const isTablet = /iPad|Android(?!.*Mobile)/i.test(ua);
        // Fix: Ajout patterns TV modernes (Steam Link, Shield, Chromecast, Android TV, tvOS)
        const isTVByUA = /SmartTV|Tizen|WebOS|NetCast|HbbTV|BRAVIA|AFT|Fire TV|Hisense|VIDAA|Roku|PlayStation|Xbox|Steam Link|SHIELD|Chromecast|Android TV|tvOS|GoogleTV|Apple TV/i.test(ua);
        // Heuristique: Grand écran (>1920) + DPR 1.0 + pas mobile/tablet = probablement TV
        const isTVByHeuristic = (width > 1920 && height > 1080 && dpr === 1.0 && !isMobile && !isTablet);
        const isTV = isTVByUA || isTVByHeuristic;
        const isFirefox = /Firefox/i.test(ua);
        const isChrome = /Chrome|Chromium|CriOS/i.test(ua);
        const isSafari = /Safari/i.test(ua) && !/Chrome/i.test(ua);
        const isEdge = /Edg/i.test(ua);
        const isOldBrowser = /MSIE|Trident|Edge\/\d+\./i.test(ua); // Ancien Edge non-Chromium

        // Fix: Ne pas utiliser effectiveType pour classifier Low-End sur desktop (faux positifs '4g')
        const isSlowByNetwork = isMobile && (effectiveType === '3g' || effectiveType === '2g');
        // Classification de puissance (avec logique améliorée)
        const isLowEnd = cores <= 4 || memory <= 4 || isSlowByNetwork || isOldBrowser;
        const isHighEnd = cores > 8 && memory > 8 && !isMobile && !isTablet;
        const isMidRange = !isLowEnd && !isHighEnd;

        // Classification d'écran
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
            // Fix: isSlowNetwork utilise downlink en priorité, effectiveType seulement sur mobile
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
        author: 'Derfog',
        version: '3.7.2',
        hash: 'BOP372SQ2025', // Smart Quality - v3.7.2
        verify: () => {
            const meta = document.querySelector('meta[name="optimizer-author"]');
            if (!meta) {
                const m = document.createElement('meta');
                m.name = 'optimizer-author';
                m.content = 'Derfog';
                document.head.appendChild(m);
            }
            return true;
        }
    };
    SCRIPT_SIGNATURE.verify();

    // ===============================================================================
    // BASE CONFIGURATION (High-End defaults)
    // ===============================================================================

    const CONFIG = {
        // Résolution forcée - v3.7.2: isAuto=true utilise la résolution native de l'écran
        resolution: {
            width: 3840,
            height: 2160,
            pixelRatio: 2,
            isAuto: true // v3.7.2: Mode auto par défaut = résolution native
        },

        // Codec préférences
        codecs: {
            forceAV1: true,
            forceHEVC: true,
            forceVP9: true,
            preferHardware: true
        },

        // Bitrate et qualité
        streaming: {
            maxBitrate: 50000000,
            minBitrate: 15000000,
            targetBitrate: 35000000,
            bufferSize: 2000,
            forceHighQuality: true,
            interceptorEnabled: false  // Opt-in: Stream Interceptor désactivé par défaut
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
            // v3.6.1: maxFiltersActive dynamique selon profil matériel
            maxFiltersActive: ENV_PROFILE.isHighEnd ? 5 : (ENV_PROFILE.isMidRange ? 3 : 2),
            disableLogsInGame: true,
            adaptiveQuality: true,
            fpsThreshold: 55,
            streamInterceptor: true  // Opt-in: intercepte configs pour forcer HW decode
        },

        // Video Enhancer
        enhancer: {
            enabled: false, // v3.7.2: Désactivé par défaut - l'utilisateur choisit
            sharpness: 0.45,
            contrast: 1.0,   // Valeurs neutres
            saturation: 1.0,
            brightness: 1.0
        },

        // Filtres vidéo avancés
        filters: {
            enabled: false, // v3.7.2: Désactivé par défaut - l'utilisateur choisit
            preset: null,   // v3.7.2: Aucun preset actif par défaut
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
            ultrawideMode: false,       // Ultrawide stretch mode toggle
            autoDetect: true,           // Auto-activer ultrawide si écran 21:9+
            performanceMode: false      // Mode performance: désactive les filtres lourds
        },

        // Langue (auto-détectée ou choisie)
        language: 'auto'
    };

    // Valeurs par défaut pour le Reset (copie immutable)
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
        // Tier 3 : High-End = config par défaut (isAuto: true)

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
        `@ ${Math.round(CONFIG.streaming.maxBitrate/1000000)}Mbps`
    );

    // ===============================================================================
    // AXE 3: FILTER TIERING SYSTEM
    // ===============================================================================

    const FilterTiers = {
        // v3.7.2: OFF = aucun filtre activé par défaut, l'utilisateur choisit
        OFF: {
            name: 'Désactivé',
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

    // v3.7.2: Par défaut, aucun preset actif - l'utilisateur choisit
    function getInitialFilterTier(envProfile) {
        // Retourner OFF par défaut - l'utilisateur active manuellement le preset souhaité
        return 'OFF';
    }

    const FilterState = {
        currentTier: getInitialFilterTier(ENV_PROFILE),
        adaptiveEnabled: CONFIG.performance.adaptiveQuality,
        fpsHistory: [],
        fpsThreshold: CONFIG.performance.fpsThreshold || 55,
        lastAutoChange: 0, // v3.6.2: Cooldown pour éviter boucle infinie

        updateTierBasedOnFps(currentFps) {
            if (!this.adaptiveEnabled) return;
            // v3.6.2: Cooldown de 10 secondes entre changements auto
            if (Date.now() - this.lastAutoChange < 10000) return;
            this.fpsHistory.push(currentFps);
            // v3.6.4: Limiter à 20 éléments pour éviter memory leak
            if (this.fpsHistory.length > 20) this.fpsHistory.shift();
            const avgFps = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;

            // v3.6.2: Auto-activation du Performance Mode si FPS critiques
            if (avgFps < this.fpsThreshold && !CONFIG.display.performanceMode) {
                console.warn('[Optimizer+] [!] FPS critique (' + Math.round(avgFps) + '), activation auto du Performance Mode');
                CONFIG.display.performanceMode = true;

                // Désactiver les filtres lourds
                CONFIG.filters.clarity.enabled = false;
                CONFIG.filters.denoise.enabled = false;
                CONFIG.filters.deband.enabled = false;
                CONFIG.performance.gpuAcceleration = false;

                // Forcer le tier SAFE
                this.setFilterTier('SAFE');

                // Mettre à jour les filtres
                if (typeof videoEnhancer !== 'undefined' && videoEnhancer.updateFilterString) {
                    videoEnhancer.updateFilterString();
                    videoEnhancer.applyFiltersToAllVideos();
                }

                // Notification utilisateur
                if (typeof showNotification === 'function') {
                    showNotification(' Performance Mode auto-activé (FPS < ' + this.fpsThreshold + ')');
                }

                // Mettre à jour le toggle UI si présent
                const toggle = document.getElementById('optimizer-performance-mode');
                if (toggle) toggle.checked = true;

                return; // Ne pas continuer le calcul de tier
            }

            const newTier = this.calculateOptimalTier(avgFps);
            if (newTier !== this.currentTier) {
                this.setFilterTier(newTier);
                this.lastAutoChange = Date.now(); // v3.6.2: Reset cooldown
            }
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

            // Si OFF, désactiver tous les filtres et ne rien appliquer
            if (tierName === 'OFF') {
                Object.keys(tier.filters).forEach(filterName => {
                    if (CONFIG.filters[filterName]) {
                        CONFIG.filters[filterName].enabled = false;
                    }
                });
                Object.assign(CONFIG.enhancer, tier.enhancer);
                
                // Retirer les filtres des vidéos existantes
                if (typeof videoEnhancer !== 'undefined' && videoEnhancer.removeFiltersFromAllVideos) {
                    videoEnhancer.removeFiltersFromAllVideos();
                } else {
                    // Fallback: retirer manuellement les filtres
                    document.querySelectorAll('video').forEach(video => {
                        video.style.filter = '';
                    });
                }
                console.log('[Optimizer+] [OK] Tous les filtres désactivés');
                return;
            }

            // Appliquer les filtres du tier en mémoire
            Object.keys(tier.filters).forEach(filterName => {
                if (CONFIG.filters[filterName]) {
                    Object.assign(CONFIG.filters[filterName], tier.filters[filterName]);
                }
            });
            Object.assign(CONFIG.enhancer, tier.enhancer);

            // v3.7.0: Système de retry robuste
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
                videoEnhancer.updateSVGFilters();
                videoEnhancer.applyFiltersToAllVideos();
                
                // Valider que les filtres sont appliqués
                setTimeout(() => this._validateFiltersApplied(), 200);
                
                this._pendingTier = null;
                this._retryCount = 0;
                console.log('[Optimizer+] [OK] Filters applied successfully');
            } else if (this._retryCount < this._maxRetries) {
                // Retry après 100ms
                this._retryCount++;
                setTimeout(() => this._applyWithRetry(), 100);
                if (this._retryCount === 1) {
                    console.log('[Optimizer+] videoEnhancer not ready, retrying...');
                }
            } else {
                // Timeout après 5 secondes
                console.warn('[Optimizer+] [!] Failed to apply filters after 5s - videoEnhancer not available');
                this._pendingTier = null;
                this._retryCount = 0;
            }
        },

        // v3.7.0: Valider que les filtres sont vraiment appliqués
        _validateFiltersApplied() {
            const videos = document.querySelectorAll('video');
            if (videos.length === 0) return; // Pas de vidéo encore

            let allValid = true;
            videos.forEach(video => {
                const hasFilter = video.style.filter && video.style.filter.includes('url(#optimizer-');
                const svgExists = document.getElementById('optimizer-usm-filter');
                if (!hasFilter && !svgExists) {
                    allValid = false;
                }
            });

            if (!allValid && this._retryCount < 10) {
                // Retry l'application
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
    // AXE 3: FPS MONITOR CLASS
    // ===============================================================================

    class FpsMonitor {
        constructor() {
            this.fps = 0;
            this.lastTime = performance.now();
            this.frameCount = 0;
            this.animationFrameId = null;
            this.enabled = false;
            this.callbacks = [];
        }

        start() {
            if (this.enabled) return;
            this.enabled = true;

            const loop = () => {
                this.frameCount++;
                const now = performance.now();
                const elapsed = now - this.lastTime;

                // v3.6.1: Intervalle adaptatif - 1000ms si fps < 55, sinon 500ms
                const updateInterval = this.fps > 0 && this.fps < 55 ? 1000 : 500;

                if (elapsed >= updateInterval) {
                    this.fps = Math.round((this.frameCount * 1000) / elapsed);
                    this.frameCount = 0;
                    this.lastTime = now;

                    // Adapter le tier de filtres
                    FilterState.updateTierBasedOnFps(this.fps);

                    // Exécuter les callbacks
                    this.callbacks.forEach(cb => cb(this.fps));
                }

                if (this.enabled) {
                    this.animationFrameId = requestAnimationFrame(loop);
                }
            };

            this.animationFrameId = requestAnimationFrame(loop);
            console.log('[Optimizer+] FPS monitor started');
        }

        stop() {
            if (!this.enabled) return;
            this.enabled = false;
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
            console.log('[Optimizer+] FPS monitor stopped');
        }

        onFpsUpdate(callback) {
            this.callbacks.push(callback);
        }

        getFps() {
            return this.fps;
        }
    }

    // Instance globale du FPS Monitor (sera démarré en streaming)
    let fpsMonitor = null;

    // ===============================================================================
    // v3.5 AXE 1: STREAM INTERCEPTOR - Force HW Decode + GPU Acceleration
    // Inspiré de BetterXCloud pattern pour intercepter les configs streaming
    // ===============================================================================

    const StreamInterceptor = {
        originalFetch: null,
        enabled: false,

        /**
         * Intercepter les réponses de configuration pour forcer HW decode
         */
        enable() {
            if (this.enabled) return;
            this.enabled = true;

            // Sauvegarder le fetch original
            this.originalFetch = window.fetch;
            const self = this;

            window.fetch = async function(...args) {
                const request = args[0];
                const url = typeof request === 'string' ? request : request?.url;

                // Intercepter /configuration pour forcer décodage HW
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
                                    overrides.videoConfiguration.preferredCodec = 'av1'; // AV1 si supporté

                                    // Force high bitrate settings
                                    overrides.bitrateConfiguration = overrides.bitrateConfiguration || {};
                                    overrides.bitrateConfiguration.maxBitrate = CONFIG.streaming.maxBitrate;
                                    overrides.bitrateConfiguration.targetBitrate = CONFIG.streaming.targetBitrate;

                                    config.clientStreamingConfigOverrides = JSON.stringify(overrides);

                                    console.log('[Optimizer+] [OK] StreamInterceptor: Config enrichie avec HW decode + codec optimisé');

                                    return new Response(JSON.stringify(config), {
                                        status: response.status,
                                        statusText: response.statusText,
                                        headers: response.headers
                                    });
                                }
                            } catch (parseError) {
                                // Pas du JSON, retourner la réponse originale
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
         * Calculer l'aspect ratio de l'écran
         */
        getScreenAspectRatio() {
            const width = window.innerWidth;
            const height = window.innerHeight;
            return (width / height).toFixed(2);
        },

        /**
         * Déterminer si l'écran est "ultrawide" (> 1.7 ratio)
         */
        isUltrawideScreen() {
            const ratio = parseFloat(this.getScreenAspectRatio());
            return ratio > 1.7; // 16:9 = 1.78, 21:9 = 2.33, 32:9 = 3.56
        },

        /**
         * Obtenir les infos de l'écran pour logging
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
         * CSS pour le mode ultrawide - ÉTIREMENT INTELLIGENT
         * Garde les filtres vidéo (sharpness, contrast, etc.) fonctionnels
         * PRÉSERVE les fenêtres flottantes de Boosteroid
         */
        getUltrawideCSS() {
            return `
                /* =================================================================== */
                /* ULTRAWIDE MODE v3.6.0 - ÉTIREMENT (object-fit: fill)                */
                /* L'image 16:9 est ÉTIRÉE horizontalement pour remplir le 21:9/32:9   */
                /* PAS de zoom, PAS de crop - juste un étirement des côtés             */
                /* =================================================================== */

                html.optimizer-ultrawide-mode,
                html.optimizer-ultrawide-mode body {
                    overflow: hidden !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    background: #000 !important;
                }

                /* ================================================================ */
                /* VIDÉO: object-fit: fill = ÉTIRE pour remplir (pas de zoom)       */
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

                /* Canvas (WebRTC) - même traitement */
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

                /* Fenêtres flottantes Boosteroid - toujours au-dessus */
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

            // v3.6.1: "Cheap mode" - Désactiver les filtres lourds si prioritizeFramerate
            if (CONFIG.performance.prioritizeFramerate || CONFIG.display.performanceMode) {
                console.log('[Optimizer+] Ultrawide: Mode performance - désactivation filtres lourds');
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

            // Écouter les changements de taille de fenêtre
            this.resizeHandler = () => this.onWindowResize();
            window.addEventListener('resize', this.resizeHandler);

            // Sauvegarder la config
            if (typeof Storage !== 'undefined' && Storage.set) {
                Storage.set('config', CONFIG);
            }
        },

        /**
         * Désactiver le mode ultrawide
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
                showNotification('Ultrawide désactivé');
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
            // Rien à faire, le CSS gère tout
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

    // v3.6.4: Suppression de l'exposition globale pour raisons de sécurité (SEC-01)
    // UltrawideSupport reste accessible uniquement dans le scope de l'IIFE

    // ===============================================================================
    // v3.7.1 SMART RESOLUTION DETECTOR - Auto-détection écran et résolutions adaptées
    // UPSCALE ONLY: Ne propose que des résolutions >= native
    // ===============================================================================

    const SmartResolutionDetector = {
        // Cache des résultats - invalidé à chaque nouvelle version
        _cache: null,
        _cacheTime: 0,
        _version: '3.7.2', // Incrémenté pour invalider le cache (Smart Quality)
        CACHE_TTL: 5000, // 5 secondes
        
        /**
         * Invalider le cache manuellement
         */
        invalidateCache() {
            this._cache = null;
            this._cacheTime = 0;
            console.log('[Optimizer+] Cache résolution invalidé');
        },

        /**
         * Obtenir les dimensions de l'écran actuel (support multi-moniteurs)
         * Utilise getScreenDetails API si disponible (Chrome 100+)
         * Fallback sur screen.width/height sinon
         * @returns {Promise<Object>} Dimensions de l'écran
         */
        async getScreenDetailsAsync() {
            try {
                // Chrome 100+ : Window Management API
                if ('getScreenDetails' in window) {
                    const screenDetails = await window.getScreenDetails();
                    const currentScreen = screenDetails.currentScreen;
                    
                    if (currentScreen) {
                        console.log(`[Optimizer+] Screen detection: ${screenDetails.screens.length} écran(s) détecté(s)`);
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
                // Permission refusée ou API non supportée
                console.log('[Optimizer+] getScreenDetails non disponible, fallback screen.width');
            }
            
            // Fallback standard
            return this.getScreenDimensions();
        },

        /**
         * Obtenir les dimensions réelles de l'écran (hardware natif)
         * Fix: Utilise screen.width/height pour éviter les bugs de zoom navigateur
         */
        getScreenDimensions() {
            // Heuristique: Si window est très différent de screen, user peut être sur autre écran
            const screenW = window.screen.width || window.screen.availWidth || window.innerWidth;
            const screenH = window.screen.height || window.screen.availHeight || window.innerHeight;
            const windowW = window.innerWidth;
            const windowH = window.innerHeight;
            
            // Si fenêtre plein écran sur écran différent, innerWidth peut être plus fiable
            let width = screenW;
            let height = screenH;
            
            // Détection heuristique: fenêtre plus grande que l'écran détecté = probablement autre écran
            if (windowW > screenW * 1.1 || windowH > screenH * 1.1) {
                console.log('[Optimizer+] Heuristique: fenêtre sur écran externe détectée');
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
         * Calculer le ratio de l'écran et le classifier
         * Fix: Utilise tolérance de 5% pour éviter faux positifs
         */
        detectAspectRatio() {
            const screen = this.getScreenDimensions();
            const ratio = screen.width / screen.height;

            // Classification STRICTE basée sur des plages de tolérance réalistes
            // Chaque ratio standard a une tolérance de ±3% maximum
            let ratioType, ratioName;

            // 32:9 = 3.556 (tolérance: 3.45 - 3.7)
            if (ratio >= 3.45) {
                ratioType = '32:9';
                ratioName = 'Super Ultrawide';
            }
            // 21:9 = 2.333-2.388 (tolérance: 2.25 - 2.5)
            else if (ratio >= 2.25 && ratio < 2.5) {
                ratioType = '21:9';
                ratioName = 'Ultrawide';
            }
            // 19.5:9 = 2.167 (iPhone ratio, tolérance: 2.1 - 2.25)
            else if (ratio >= 2.1 && ratio < 2.25) {
                ratioType = '19.5:9';
                ratioName = 'Mobile Tall';
            }
            // 18:9 = 2.0 (tolérance: 1.95 - 2.1)
            else if (ratio >= 1.95 && ratio < 2.1) {
                ratioType = '18:9';
                ratioName = 'Mobile Wide';
            }
            // 16:9 = 1.778 (tolérance STRICTE: 1.74 - 1.82)
            else if (ratio >= 1.74 && ratio < 1.82) {
                ratioType = '16:9';
                ratioName = 'Standard';
            }
            // 16:10 = 1.6 (tolérance: 1.55 - 1.65)
            else if (ratio >= 1.55 && ratio < 1.65) {
                ratioType = '16:10';
                ratioName = 'Widescreen';
            }
            // 3:2 = 1.5 (tolérance: 1.45 - 1.55)
            else if (ratio >= 1.45 && ratio < 1.55) {
                ratioType = '3:2';
                ratioName = 'Classic';
            }
            // 4:3 = 1.333 (tolérance: 1.28 - 1.38)
            else if (ratio >= 1.28 && ratio < 1.38) {
                ratioType = '4:3';
                ratioName = 'Legacy';
            }
            // Tout autre ratio = Custom (non-standard)
            else {
                ratioType = 'custom';
                // Donner un nom descriptif basé sur le ratio
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
         * Vérifie si c'est une résolution standard connue
         */
        isStandardResolution(w, h) {
            const standardResolutions = [
                // 16:9
                [1920, 1080], [2560, 1440], [3840, 2160], [1280, 720], [1366, 768],
                // 16:10
                [1920, 1200], [2560, 1600], [1680, 1050], [1440, 900],
                // 21:9
                [2560, 1080], [3440, 1440], [3840, 1600],
                // 32:9
                [3840, 1080],
                // 4:3
                [1600, 1200], [1024, 768],
                // Mobile 19.5:9 (iPhone)
                [2688, 1242], [2778, 1284], [2796, 1290], [2556, 1179], [2436, 1125],
                // Mobile 18:9 / 18.5:9
                [2960, 1440], [2880, 1440], [2560, 1312]
            ];
            // Tolérance de ±8 pixels pour l'arrondi codec
            return standardResolutions.some(([sw, sh]) => 
                Math.abs(sw - w) <= 8 && Math.abs(sh - h) <= 8
            );
        },

        /**
         * Arrondir à un multiple de 8 (compatibilité codec vidéo)
         */
        roundToMultipleOf8(value) {
            return Math.round(value / 8) * 8;
        },

        /**
         * Liste des résolutions gaming STANDARD à partir de 2K
         * Basée sur les résolutions utilisées dans les jeux vidéo
         */
        GAMING_RESOLUTIONS: {
            // 16:9 Standard - Les plus courantes en gaming
            '16:9': [
                { w: 2560, h: 1440, label: '2K (1440p)' },
                { w: 2880, h: 1620, label: '3K (1620p)' },
                { w: 3200, h: 1800, label: 'QHD+ (1800p)' },
                { w: 3840, h: 2160, label: '4K (2160p)' }
            ],
            // 16:10 Widescreen - Moniteurs productivité/gaming
            '16:10': [
                { w: 2560, h: 1600, label: '2K (WQXGA)' },
                { w: 3072, h: 1920, label: '3K (16:10)' },
                { w: 3840, h: 2400, label: '4K (WQUXGA)' }
            ],
            // 21:9 Ultrawide - Gaming immersif
            '21:9': [
                { w: 2560, h: 1080, label: 'UWFHD (1080p UW)' },
                { w: 3440, h: 1440, label: 'UWQHD (1440p UW)' },
                { w: 3840, h: 1600, label: 'UWQHD+ (1600p UW)' }
            ],
            // 32:9 Super Ultrawide - Double écran gaming
            '32:9': [
                { w: 3840, h: 1080, label: 'DFHD (1080p SW)' }
            ]
        },

        /**
         * Obtenir le groupe de ratio le plus proche pour l'écran
         */
        getClosestRatioGroup(screenRatio) {
            // Ratios de référence
            const ratioGroups = {
                '16:9': 1.778,    // 16/9
                '16:10': 1.6,    // 16/10
                '21:9': 2.37,    // 21/9 (2.333 à 2.388)
                '32:9': 3.556    // 32/9
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
         * Résolutions supportées par Boosteroid (whitelist serveur)
         * Ces résolutions sont garanties de fonctionner côté serveur
         */
        SUPPORTED_RESOLUTIONS: [
            // 16:9 Standard
            [1920, 1080], [2560, 1440], [3840, 2160],
            // 16:10 Widescreen
            [1920, 1200], [2560, 1600], [3840, 2400],
            // 21:9 Ultrawide
            [2560, 1080], [3440, 1440], [3840, 1600],
            // 32:9 Super Ultrawide
            [3840, 1080]
        ],

        /**
         * Vérifier si une résolution est supportée par Boosteroid
         */
        isResolutionSupported(width, height) {
            return this.SUPPORTED_RESOLUTIONS.some(([w, h]) => w === width && h === height);
        },

        /**
         * Générer la liste des résolutions sélectionnables
         * CRITIQUE: N'affiche QUE les résolutions >= native (upscale uniquement)
         */
        getSelectableResolutions(screenWidth, screenHeight) {
            const screenRatio = screenWidth / screenHeight;
            const ratioGroup = this.getClosestRatioGroup(screenRatio);
            const gamingRes = this.GAMING_RESOLUTIONS[ratioGroup] || this.GAMING_RESOLUTIONS['16:9'];
            const nativePixels = screenWidth * screenHeight;
            
            const resolutions = [];

            // 1. Ajouter la résolution NATIVE de l'écran en premier
            resolutions.push({
                w: screenWidth,
                h: screenHeight,
                label: 'Native',
                tier: 'native',
                isNative: true,
                ratioGroup: ratioGroup
            });

            // 2. Ajouter UNIQUEMENT les résolutions gaming >= native (UPSCALE ONLY)
            gamingRes.forEach(res => {
                const resPixels = res.w * res.h;
                
                // CRITIQUE: Ignorer les résolutions plus petites que native
                if (resPixels < nativePixels) return;
                
                // Éviter les doublons avec la native
                if (res.w === screenWidth && res.h === screenHeight) return;
                
                resolutions.push({
                    w: res.w,
                    h: res.h,
                    label: res.label,
                    tier: res.h >= 2160 ? 'ultra' : (res.h >= 1440 ? 'mid' : 'low'),
                    isNative: false,
                    ratioGroup: ratioGroup,
                    isSupported: this.isResolutionSupported(res.w, res.h)
                });
            });

            // 3. Trier par nombre de pixels (du plus petit au plus grand)
            resolutions.sort((a, b) => (a.w * a.h) - (b.w * b.h));

            // 4. Marquer la résolution recommandée (premier upscale disponible, préférer 1440p)
            const recommended = resolutions.find(r => !r.isNative && r.h >= 1440) ||
                               resolutions.find(r => !r.isNative);
            if (recommended) {
                recommended.isRecommended = true;
            } else {
                // Aucun upscale disponible, recommander native
                resolutions[0].isRecommended = true;
            }

            return resolutions;
        },

        /**
         * Générer les résolutions supérieures basées sur le ratio détecté
         * Utilise maintenant la liste de résolutions gaming standards
         */
        generateUpscaleResolutions(screenInfo) {
            const { width, height } = screenInfo;
            return this.getSelectableResolutions(width, height);
        },

        /**
         * Obtenir les infos complètes de l'écran et les résolutions recommandées
         */
        getScreenAnalysis() {
            // Vérifier le cache (TTL court pour éviter les valeurs obsolètes)
            const now = Date.now();
            if (this._cache && (now - this._cacheTime) < this.CACHE_TTL) {
                return this._cache;
            }

            const screenInfo = this.detectAspectRatio();
            const upscaleOptions = this.generateUpscaleResolutions(screenInfo);
            
            // Trouver la résolution recommandée (celle avec isRecommended = true)
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
         * Générer le HTML des options de résolution pour un <select>
         * TOUS les aspect ratios avec leurs résolutions gaming
         */
        generateResolutionOptionsHTML(currentWidth, currentHeight, isAutoMode = false) {
            const analysis = this.getScreenAnalysis();
            const { screen, resolutions } = analysis;
            const detectedRatio = this.getClosestRatioGroup(screen.ratio);

            let html = '';

            // Option Auto-détection en premier - utilise la résolution NATIVE de l'écran
            const nativeRes = analysis.native || { w: screen.width, h: screen.height, label: 'Native' };
            // v3.7.2: Sélectionner auto si isAutoMode est true
            const isAutoSelected = isAutoMode || !currentWidth || currentWidth === 'auto';
            html += `<optgroup label="[AUTO]">`;
            html += `<option value="auto" ${isAutoSelected ? 'selected' : ''}>`;
            html += `Auto -> ${nativeRes.w}x${nativeRes.h} (Native)`;
            html += `</option>`;
            html += `</optgroup>`;

            // Résolution Native de l'écran
            html += `<optgroup label="Native (${screen.width}x${screen.height})">`;
            const isNativeSelected = !isAutoSelected && currentWidth === screen.width && currentHeight === screen.height;
            html += `<option value="${screen.width}x${screen.height}" ${isNativeSelected ? 'selected' : ''}>`;
            html += `${screen.width}x${screen.height} (Native)`;
            html += `</option>`;
            html += `</optgroup>`;

            // TOUS les groupes de ratio avec leurs résolutions
            const ratioLabels = {
                '16:9': '16:9 Standard',
                '16:10': '16:10 Widescreen',
                '21:9': '21:9 Ultrawide',
                '32:9': '32:9 Super Ultrawide'
            };

            for (const [ratio, label] of Object.entries(ratioLabels)) {
                const gamingRes = this.GAMING_RESOLUTIONS[ratio];
                if (!gamingRes) continue;

                // Marquer le ratio détecté de l'écran
                const isDetected = ratio === detectedRatio ? ' [OK]' : '';
                html += `<optgroup label="${label}${isDetected}">`;

                gamingRes.forEach(res => {
                    const isSelected = currentWidth === res.w && currentHeight === res.h;
                    html += `<option value="${res.w}x${res.h}" ${isSelected ? 'selected' : ''}>`;
                    html += `${res.w}x${res.h} - ${res.label}`;
                    html += `</option>`;
                });

                html += `</optgroup>`;
            }

            return html;
        },

        /**
         * Appliquer une résolution de manière sécurisée avec validation
         * Vérifie si Boosteroid accepte réellement la résolution demandée
         * @param {number} newWidth - Largeur demandée
         * @param {number} newHeight - Hauteur demandée
         * @param {string} label - Label de la résolution (ex: "2K 1440p")
         * @returns {Object} - Résultat avec statut et résolution appliquée
         */
        setResolutionSafely(newWidth, newHeight, label = '') {
            const oldWidth = CONFIG.resolution.width;
            const oldHeight = CONFIG.resolution.height;

            // Vérifier si c'est dans la whitelist
            const isSupported = this.isResolutionSupported(newWidth, newHeight);
            
            if (!isSupported) {
                console.warn(`[Optimizer+] [!] Résolution ${newWidth}x${newHeight} non dans la whitelist serveur`);
                // On applique quand même mais on prévient
            }

            // Appliquer la nouvelle résolution
            CONFIG.resolution.width = newWidth;
            CONFIG.resolution.height = newHeight;
            CONFIG.resolution.pixelRatio = newWidth >= 3840 ? 2 : (newWidth >= 2560 ? 1.5 : 1);

            console.log(`[Optimizer+] Résolution demandée: ${newWidth}x${newHeight} ${label ? `(${label})` : ''}`);

            // Validation asynchrone après 2 secondes
            setTimeout(() => {
                const video = document.querySelector('video');
                if (video && video.videoWidth && video.videoHeight) {
                    const actualWidth = video.videoWidth;
                    const actualHeight = video.videoHeight;
                    const tolerance = 0.9; // 10% de tolérance

                    if (actualWidth < newWidth * tolerance || actualHeight < newHeight * tolerance) {
                        console.warn(`[Optimizer+] [!] Résolution ${newWidth}x${newHeight} refusée par Boosteroid`);
                        console.warn(`[Optimizer+] Fallback réel: ${actualWidth}x${actualHeight}`);
                        
                        // Revert à l'ancienne résolution dans CONFIG
                        CONFIG.resolution.width = actualWidth;
                        CONFIG.resolution.height = actualHeight;
                        
                        // Notification utilisateur
                        if (typeof showNotification === 'function') {
                            showNotification(`[!] Résolution refusée -> ${actualWidth}x${actualHeight}`);
                        }
                    } else {
                        console.log(`[Optimizer+] [OK] Résolution ${newWidth}x${newHeight} confirmée par le stream`);
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
         * Appliquer la résolution auto-détectée - utilise la résolution NATIVE de l'écran client
         * Utilise setResolutionSafely pour validation serveur
         */
        applyAutoResolution() {
            const analysis = this.getScreenAnalysis();
            // CORRECTION: Auto = résolution NATIVE de l'écran client, pas upscale
            const nativeRes = analysis.native || analysis.screen;
            
            if (nativeRes) {
                const width = nativeRes.w || nativeRes.width;
                const height = nativeRes.h || nativeRes.height;
                const label = nativeRes.label || 'Native';
                
                // Utiliser setResolutionSafely pour validation et feedback
                this.setResolutionSafely(width, height, label);
                console.log(`[Optimizer+] Auto-résolution (native): ${width}x${height}`);
                return { w: width, h: height, label: label };
            }
            return null;
        },

        /**
         * Obtenir l'état actuel de la résolution active
         * @returns {Object} - Résolution actuelle et statut
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

    // v3.7.2: Exposition globale supprimée pour sécurité (XSS prevention)
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
         * Promise avec timeout pour éviter blocages sur machines lentes
         */
        withTimeout(promise, ms) {
            return Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
            ]);
        },

        /**
         * Détecter les codecs supportés en HW et choisir le meilleur
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

            let bestCodec = codecs[codecs.length - 1]; // H.264 par défaut

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
                        console.log(`[Optimizer+] [OK] Codec ${codecInfo.name} supporté & power-efficient (HW decode)`);
                        bestCodec = codecInfo;
                        break; // Premier codec supporté = le meilleur
                    } else if (result.supported) {
                        console.log(`[Optimizer+] Codec ${codecInfo.name} supporté (SW decode)`);
                        // Continuer à chercher un codec HW
                    }
                } catch (e) {
                    // Codec non supporté, continuer
                }
            }

            this.detectedCodec = bestCodec;
            this.codecCheckDone = true;
            console.log(`[Optimizer+] Codec optimal détecté: ${bestCodec.name} (efficiency: ${bestCodec.efficiency})`);
            return bestCodec;
        },

        /**
         * Adapter le bitrate au codec + FPS réels
         */
        calculateOptimalBitrate(fpsHistory) {
            if (!fpsHistory || fpsHistory.length === 0) return CONFIG.streaming.targetBitrate;

            const avgFps = fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length;
            let bitrate = CONFIG.streaming.targetBitrate;

            // Si FPS stable > 58: peut augmenter bitrate
            if (avgFps >= 58) {
                bitrate = Math.min(bitrate * 1.1, CONFIG.streaming.maxBitrate);
            }
            // Si FPS < 50: réduire bitrate
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
    // v3.5 AXE 3: FILTER BATCH PROCESSOR - Anti-Flickering Frame-by-Frame
    // ===============================================================================

    const FilterBatchProcessor = {
        filterUpdateQueue: [],
        isProcessingBatch: false,
        lastBatchTime: 0,
        minBatchInterval: 150, // v3.6.2: Augmenté à 150ms pour réduire les recalculs inutiles

        /**
         * Queue filter updates au lieu de les appliquer immédiatement
         */
        queueFilterUpdate(operation) {
            this.filterUpdateQueue.push(operation);

            // Traiter la queue via rAF (frame-aligned)
            if (!this.isProcessingBatch) {
                this.isProcessingBatch = true;
                requestAnimationFrame(() => this.processBatch());
            }
        },

        /**
         * Process toutes les opérations en une seule passe pour éviter flickering
         */
        processBatch() {
            const now = performance.now();

            // Throttle: minimum 16ms entre les batches
            if (now - this.lastBatchTime < this.minBatchInterval) {
                requestAnimationFrame(() => this.processBatch());
                return;
            }

            if (this.filterUpdateQueue.length === 0) {
                this.isProcessingBatch = false;
                return;
            }

            const videos = document.querySelectorAll('video');

            // v3.6: Ne pas utiliser willChange en mode performance (cause des leaks mémoire GPU)
            const useWillChange = !CONFIG.display.performanceMode && CONFIG.performance.gpuAcceleration;

            if (useWillChange) {
                videos.forEach(video => {
                    video.style.willChange = 'filter';
                });
            }

            // Appliquer TOUS les changements d'un coup
            while (this.filterUpdateQueue.length > 0) {
                const operation = this.filterUpdateQueue.shift();
                try {
                    operation();
                } catch (e) {
                    console.warn('[Optimizer+] Batch operation error:', e);
                }
            }

            // Cleanup rapide - pas de force reflow inutile
            if (useWillChange) {
                requestAnimationFrame(() => {
                    videos.forEach(video => {
                        video.style.willChange = 'auto';
                    });
                });
            }

            this.lastBatchTime = now;
            this.isProcessingBatch = false;
        },

        /**
         * Clear la queue (pour reset)
         */
        clear() {
            this.filterUpdateQueue = [];
            this.isProcessingBatch = false;
        }
    };

    // ===============================================================================
    // v3.5 AXE 4: ZERO-FLICKER BOOTSTRAP - Initialization sans pop-in
    // ===============================================================================

    const ZeroFlickerBootstrap = {
        initialized: false,

        /**
         * Initialize filters avec transition douce
         */
        async initializeFilters() {
            if (this.initialized) return;

            const videos = document.querySelectorAll('video');
            if (videos.length === 0) return;

            console.log('[Optimizer+] ZeroFlickerBootstrap: Initializing...');

            // Phase 1: Freezer le rendu momentanément
            videos.forEach(video => {
                video.style.pointerEvents = 'none';
                video.style.willChange = 'filter';
            });

            // Phase 2: Appliquer les filtres neutres d'abord
            const originalEnabled = CONFIG.filters.enabled;
            CONFIG.filters.enabled = false;

            if (typeof videoEnhancer !== 'undefined' && videoEnhancer) {
                videoEnhancer.updateFilterString();
                videoEnhancer.applyFiltersToAllVideos();
            }

            // Phase 3: Transition douce vers les vrais filtres
            await new Promise(resolve => requestAnimationFrame(resolve));

            CONFIG.filters.enabled = originalEnabled;

            if (typeof videoEnhancer !== 'undefined' && videoEnhancer) {
                videoEnhancer.updateFilterString();
                videoEnhancer.applyFiltersToAllVideos();
            }

            // Phase 4: Déverrouiller
            await new Promise(resolve => requestAnimationFrame(resolve));

            videos.forEach(video => {
                video.style.pointerEvents = 'auto';
                video.style.willChange = 'auto';
            });

            this.initialized = true;
            console.log('[Optimizer+] [OK] ZeroFlickerBootstrap: Filters initialized smoothly');
        },

        reset() {
            this.initialized = false;
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
                    console.log('[Optimizer+] StreamInterceptor désactivé (opt-in)');
                }

                // v3.5: Détecter le codec optimal
                SmartCodecSelector.getOptimalCodec().then(codec => {
                    console.log(`[Optimizer+] Using codec: ${codec.name}`);
                });

                // Démarrer le FPS Monitor
                fpsMonitor = new FpsMonitor();
                fpsMonitor.start();

                // v3.5: Adapter le bitrate selon FPS + codec
                fpsMonitor.onFpsUpdate((fps) => {
                    if (FilterState.fpsHistory.length >= 5) {
                        const optimalBitrate = SmartCodecSelector.calculateOptimalBitrate(FilterState.fpsHistory);
                        if (Math.abs(optimalBitrate - CONFIG.streaming.targetBitrate) > 1000000) {
                            CONFIG.streaming.targetBitrate = optimalBitrate;
                        }
                    }
                });

                this.cleanupHandlers.push(() => {
                    if (fpsMonitor) {
                        fpsMonitor.stop();
                        fpsMonitor = null;
                    }
                });

                // Détection de fermeture de session
                this.initSessionCloseDetection();
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
                } catch (e) {}
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

            // Écouter les changements d'URL
            window.addEventListener('popstate', handleUrlChange);
            this.cleanupHandlers.push(() => window.removeEventListener('popstate', handleUrlChange));

            // Override pushState pour SPA
            const originalPushState = window.history.pushState;
            window.history.pushState = function(...args) {
                originalPushState.apply(this, args);
                handleUrlChange();
            };
            this.cleanupHandlers.push(() => {
                window.history.pushState = originalPushState;
            });
        }
    };

    // ===============================================================================
    // SYSTÈME D'INTERNATIONALISATION (i18n)
    // ===============================================================================

    const I18N = {
        // Langues disponibles
        languages: {
            en: 'English',
            fr: 'Français',
            de: 'Deutsch',
            es: 'Español',
            it: 'Italiano',
            pt: 'Português',
            ru: 'Русский',
            pl: 'Polski',
            uk: 'Українська',
            tr: 'Türkçe',
            cs: 'Čeština',
            hu: 'Magyar',
            ro: 'Română',
            sk: 'Slovenčina',
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
                hwProfile: 'Profile'
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
                ultrawideMode: 'Mode Ultrawide (21:9, 32:9)',
                ultrawideAutoDetect: 'Auto-détection 21:9+',
                performanceMode: 'Mode Performance',
                performanceModeHint: 'Désactive les filtres lourds pour maximiser les FPS',
                displaySettings: 'Affichage & Ultrawide',
                screenInfo: 'Info écran',
                fitMode: 'Mode d\'affichage',
                hwProfile: 'Profil'
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
                ultrawideMode: 'Ultrawide-Modus (21:9, 32:9)',
                ultrawideAutoDetect: 'Auto-Erkennung 21:9+',
                performanceMode: 'Leistungsmodus',
                performanceModeHint: 'Deaktiviert schwere Filter für maximale FPS',
                displaySettings: 'Anzeige & Ultrawide',
                screenInfo: 'Bildschirminfo',
                fitMode: 'Anzeigemodus',
                hwProfile: 'Profil'
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
                autoDetect: 'Auto-detectar'
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
                displaySettings: 'Display & Ultrawide',
                screenInfo: 'Info schermo',
                fitMode: 'Modalità display'
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
                enableAdvanced: 'Ativar filtros avançados',
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
                displaySettings: 'Tela & Ultrawide',
                screenInfo: 'Info tela',
                fitMode: 'Modo de exibição'
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
                displaySettings: 'Экран & Ultrawide',
                screenInfo: 'Инфо экрана',
                fitMode: 'Режим отображения'
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
                autoDetect: 'Auto-wykrywanie'
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
                streamInterceptor: 'Перехоплення потоку (HW декод.)',
                apply: 'Застосувати',
                reset: 'Скинути',
                settingsSaved: '[OK] Налаштування збережено!',
                settingsReset: '[<<] Налаштування скинуто.',
                presetApplied: '[*] Пресет "{name}" застосовано!',
                language: 'Мова',
                autoDetect: 'Авто-визначення'
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
                autoDetect: 'Otomatik algıla'
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
                presetCustom: 'Vlastní',
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
                autoDetect: 'Automaticky'
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
                autoDetect: 'Automatikus'
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
                settingsSaved: '[OK] Setări salvate! Reîncărcați pagina.',
                settingsReset: '[<<] Setări resetate. Reîncărcați pagina.',
                presetApplied: '[*] Preset "{name}" aplicat!',
                language: 'Limbă',
                autoDetect: 'Auto-detectare'
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
                autoDetect: 'Automaticky'
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
                settingsSaved: '[OK] Inställningar sparade! Ladda om sidan.',
                settingsReset: '[<<] Inställningar återställda. Ladda om sidan.',
                presetApplied: '[*] Förinställning "{name}" tillämpad!',
                language: 'Språk',
                autoDetect: 'Automatisk'
            }
        }
    };

    // Langue courante (détectée ou configurée)
    let currentLang = 'en';

    // Fonction pour détecter la langue (simplifiée)
    function detectLanguage() {
        // Vérifier la config sauvegardée
        if (CONFIG.language && CONFIG.language !== 'auto') {
            return CONFIG.language;
        }

        // Détecter depuis le navigateur
        const browserLang = (navigator.language || navigator.userLanguage || 'en').substring(0, 2).toLowerCase();
        return I18N.translations[browserLang] ? browserLang : 'en';
    }

    // Fonction pour obtenir une traduction
    function t(key, params = {}) {
        const translation = I18N.translations[currentLang]?.[key] || I18N.translations['en'][key] || key;

        // Remplacer les paramètres {param}
        return translation.replace(/\{(\w+)\}/g, (match, param) => params[param] || match);
    }

    // Initialiser la langue
    currentLang = detectLanguage();

    // ===============================================================================
    // ICÔNES SVG PROFESSIONNELLES
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
    // STYLES CSS POUR L'INTERFACE - THÈME BOOSTEROID
    // Couleurs: Fond #060912, Conteneur #131721, Texte #FFFFFF, Police Sofia Sans 12px
    // ===============================================================================

    const OPTIMIZER_STYLES = `
        /* ========================================================================== */
        /* OPTIMIZER+ CSS - Native Boosteroid Typography & Layout                     */
        /* ========================================================================== */

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
        /* CUSTOM SLIDERS - Div-based pour compatibilité                              */
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
            flex-shrink: 0; /* v3.7.2: Ne pas réduire le select */
            max-width: 180px; /* v3.7.2: Limite pour laisser place au label */
        }

        /* v3.7.2: Style spécifique pour le sélecteur de résolution */
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

        /* Panel déroulant */
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

        /* Styles pour l'info écran détecté */
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

        /* Style pour les options de résolution recommandées */
        #optimizer-dashboard-widget .opt-widget-select option[value="auto"] {
            font-weight: bold;
            background: rgba(0, 163, 255, 0.15);
        }

        /* ========================================================================== */
        /* MASQUER L'OPTION "IMAGE PLUS LUMINEUSE" DE BOOSTEROID                      */
        /* Ciblage PRÉCIS: uniquement les toggles avec ces attributs spécifiques      */
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
        console.log("[Optimizer+] Mode unsafeWindow activé");
        windowCtx = self.unsafeWindow;
    } else {
        console.log("[Optimizer+] Mode window standard");
        windowCtx = self.window;
    }

    // ===============================================================================
    // VARIABLES GLOBALES
    // ===============================================================================

    let qualityLevel = 75; // Niveau de qualité global par défaut (0-100)

    // ===============================================================================
    // ÉTAT DE LA SESSION - Gestion centralisée
    // ===============================================================================

    const SessionState = {
        isGameActive: false,      // True si une instance de jeu est en cours
        isMenuOpen: false,        // True si le menu d'options est ouvert
        isUIInjected: false,      // True si notre UI est injectée
        videoElement: null,       // Référence à la vidéo de streaming
        menuObserver: null,       // Observer pour le menu
        videoObserver: null,      // Observer pour la vidéo
        cleanupHandlers: [],      // Handlers à nettoyer
        lastSessionId: null,      // Dernier sessionId détecté
        lastCheckTime: 0,         // Timestamp du dernier check
        retryCount: 0,            // Compteur de tentatives d'injection
        maxRetries: 5,            // Max retries avant reset forcé

        // Reset complet de l'état
        reset() {
            this.isGameActive = false;
            this.isMenuOpen = false;
            this.isUIInjected = false;
            this.videoElement = null;
            this.lastSessionId = null;
            this.retryCount = 0;
        },

        // Vérifier si on a changé de session (nouveau jeu)
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

        // Forcer la réinjection UI (après changement de jeu ou bug)
        forceReinject() {
            console.log('[Optimizer+] Réinjection forcée de l\'UI');

            // Nettoyer l'ancienne UI
            const oldUI = document.getElementById('optimizer-section');
            if (oldUI) {
                oldUI.remove();
            }

            this.isUIInjected = false;
            this.retryCount = 0;

            return true;
        },

        // Méthode de récupération en cas d'état incohérent
        selfHeal() {
            const now = Date.now();

            // Éviter les checks trop fréquents
            if (now - this.lastCheckTime < 2000) {
                return false;
            }
            this.lastCheckTime = now;

            // 1. Vérifier le changement de session
            if (this.hasSessionChanged()) {
                this.forceReinject();
                return true;
            }

            // 2. État incohérent: UI marquée injectée mais absente du DOM
            if (this.isUIInjected && !document.getElementById('optimizer-section')) {
                console.log('[Optimizer+] Self-heal: UI marquée présente mais absente du DOM');
                this.isUIInjected = false;
                this.retryCount++;

                if (this.retryCount > this.maxRetries) {
                    console.warn('[Optimizer+] Max retries atteint, reset complet');
                    this.reset();
                }
                return true;
            }

            // 3. UI présente dans le DOM mais pas marquée
            if (!this.isUIInjected && document.getElementById('optimizer-section')) {
                console.log('[Optimizer+] Self-heal: UI présente mais pas marquée');
                this.isUIInjected = true;
                return true;
            }

            // 4. Menu fermé mais UI toujours marquée comme injectée
            if (this.isUIInjected && !document.querySelector('#menu.menu_desktop[style*="block"]')) {
                // C'est normal, le menu peut être caché mais l'UI existe encore
                // On ne fait rien sauf si l'UI n'est vraiment plus dans le DOM
            }

            return false;
        }
    };

    // ===============================================================================
    // STORAGE - Sauvegarde des paramètres
    // ===============================================================================

    const Storage = {
        get: function(key, defaultValue) {
            try {
                if (typeof GM_getValue !== 'undefined') {
                    return GM_getValue(key, defaultValue);
                }
                const stored = localStorage.getItem('optimizer_' + key);
                return stored !== null ? JSON.parse(stored) : defaultValue;
            } catch(e) {
                return defaultValue;
            }
        },

        set: function(key, value) {
            try {
                if (typeof GM_setValue !== 'undefined') {
                    GM_setValue(key, value);
                }
                localStorage.setItem('optimizer_' + key, JSON.stringify(value));
            } catch(e) {
                console.warn('[Optimizer+] Erreur sauvegarde:', e);
            }
        }
    };

    // v3.7.2: Détecter si nouvelle session (reset presets si sessionId différent)
    function getCurrentSessionId() {
        const url = window.location.href;
        const match = url.match(/sessionId=([a-f0-9-]+)/i);
        return match ? match[1] : null;
    }

    const currentSessionId = getCurrentSessionId();
    const savedSessionId = Storage.get('lastSessionId', null);
    const isNewSession = currentSessionId && currentSessionId !== savedSessionId;

    // Charger les paramètres sauvegardés
    const savedConfig = Storage.get('config', null);
    if (savedConfig) {
        // v3.7.2: Si nouvelle session, reset les presets et filtres
        if (isNewSession) {
            console.log('[Optimizer+] Nouvelle session détectée, reset des presets');
            // Garder les paramètres de résolution mais reset les filtres
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
        Object.assign(CONFIG, savedConfig);
    } else if (currentSessionId) {
        // Première utilisation, sauvegarder le sessionId
        Storage.set('lastSessionId', currentSessionId);
    }

    // v3.7.2: Initialiser la résolution avec la résolution NATIVE de l'écran client
    // Si pas de config sauvegardée, ou si mode auto activé (isAuto=true)
    if (!savedConfig || !savedConfig.resolution || savedConfig.resolution.isAuto === true) {
        const nativeScreen = SmartResolutionDetector.getScreenDimensions();
        CONFIG.resolution.width = nativeScreen.width;
        CONFIG.resolution.height = nativeScreen.height;
        CONFIG.resolution.pixelRatio = nativeScreen.devicePixelRatio || 1;
        CONFIG.resolution.isAuto = true;
        console.log(`[Optimizer+] Auto-resolution (native): ${nativeScreen.width}x${nativeScreen.height}`);
    }

    // Charger le niveau de qualité sauvegardé
    const savedQuality = Storage.get('qualityLevel', null);
    if (savedQuality !== null) {
        qualityLevel = savedQuality;
    }

    // v3.7.2: Réinitialiser la langue après chargement de la config
    // Car detectLanguage() est appelé avant le chargement depuis Storage
    currentLang = detectLanguage();
    console.log(`[Optimizer+] Langue active: ${currentLang} (config: ${CONFIG.language})`);

    // ===============================================================================
    // HOOK RESOLUTION - Force 4K/8K
    // ===============================================================================

    function hookResolution() {
        const { width, height, pixelRatio } = CONFIG.resolution;

        try {
            delete windowCtx.screen;
            // v3.6.4: Remplacement de __defineGetter__ déprécié par Object.defineProperty
            Object.defineProperty(windowCtx, 'screen', {
                get: function() {
                    return {
                        width: width,
                        height: height,
                        availWidth: width,
                        availHeight: height,
                        availLeft: 0,
                        availTop: 0,
                        colorDepth: 30,     // HDR support
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

            delete windowCtx.devicePixelRatio;
            Object.defineProperty(windowCtx, 'devicePixelRatio', {
                get: () => pixelRatio,
                configurable: true
            });

            // NOTE: On ne hook PAS innerWidth/innerHeight car cela bloque les événements souris
            // Le hook screen + devicePixelRatio suffit pour forcer la résolution côté serveur

            console.log(`[Optimizer+] Résolution forcée: ${width}x${height} @${pixelRatio}x`);
        } catch(e) {
            console.error('[Optimizer+] Erreur hook résolution:', e);
        }
    }

    // ===============================================================================
    // HOOK CODECS - Force AV1/HEVC/VP9
    // ===============================================================================

    function hookCodecs() {
        // Hook MediaSource.isTypeSupported
        if (windowCtx.MediaSource && windowCtx.MediaSource.isTypeSupported) {
            const originalIsTypeSupported = windowCtx.MediaSource.isTypeSupported.bind(windowCtx.MediaSource);

            windowCtx.MediaSource.isTypeSupported = function(mimeType) {
                const original = originalIsTypeSupported(mimeType);

                // Force support AV1
                if (CONFIG.codecs.forceAV1 && mimeType.includes('av01')) {
                    console.log('[Optimizer+] AV1 codec forcé:', mimeType);
                    return true;
                }

                // Force support HEVC
                if (CONFIG.codecs.forceHEVC && (mimeType.includes('hev1') || mimeType.includes('hvc1'))) {
                    console.log('[Optimizer+] HEVC codec forcé:', mimeType);
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

            windowCtx.HTMLMediaElement.prototype.canPlayType = function(mimeType) {
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

        // Hook MediaCapabilities pour informer le navigateur des capacités
        if (windowCtx.MediaCapabilities && windowCtx.MediaCapabilities.prototype.decodingInfo) {
            const originalDecodingInfo = windowCtx.MediaCapabilities.prototype.decodingInfo;

            windowCtx.MediaCapabilities.prototype.decodingInfo = function(config) {
                return originalDecodingInfo.call(this, config).then(result => {
                    // Améliorer les résultats pour les codecs haute qualité
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

        console.log('[Optimizer+] Hooks codecs installés (AV1, HEVC, VP9)');
    }

    // ===============================================================================
    // HOOK BITRATE - Amélioration du débit (FORÇAGE AGRESSIF)
    // ===============================================================================

    // Stockage global des PeerConnections pour forçage périodique du bitrate
    const activePeerConnections = new Set();
    let bitrateEnforcementInterval = null;

    function hookBitrate() {
        // ===========================================================================
        // HOOK RTCRtpSender.setParameters - BLOQUER LES RÉDUCTIONS DE BITRATE
        // ===========================================================================

        if (typeof RTCRtpSender !== 'undefined' && RTCRtpSender.prototype.setParameters) {
            const originalSetParameters = RTCRtpSender.prototype.setParameters;

            RTCRtpSender.prototype.setParameters = function(parameters) {
                if (parameters && parameters.encodings) {
                    parameters.encodings.forEach((encoding, index) => {
                        // Forcer le bitrate minimum élevé
                        if (encoding.maxBitrate !== undefined) {
                            const originalBitrate = encoding.maxBitrate;
                            const minAllowed = CONFIG.streaming.minBitrate;

                            // Empêcher toute réduction en dessous du minimum configuré
                            if (encoding.maxBitrate < minAllowed) {
                                encoding.maxBitrate = CONFIG.streaming.targetBitrate;
                                console.log(`[Optimizer+]  Bitrate forcé: ${originalBitrate} -> ${encoding.maxBitrate} (min: ${minAllowed})`);
                            }
                        } else {
                            // Si pas de maxBitrate défini, le définir
                            encoding.maxBitrate = CONFIG.streaming.targetBitrate;
                        }

                        // Forcer une bonne qualité de scaling
                        if (encoding.scaleResolutionDownBy !== undefined && encoding.scaleResolutionDownBy > 1) {
                            const originalScale = encoding.scaleResolutionDownBy;
                            encoding.scaleResolutionDownBy = 1; // Pas de downscaling
                            console.log(`[Optimizer+]  Scale forcé: ${originalScale} -> 1`);
                        }

                        // Forcer le framerate maximum
                        if (CONFIG.streaming.preferredFramerate) {
                            encoding.maxFramerate = CONFIG.streaming.preferredFramerate;
                        }
                    });
                }

                return originalSetParameters.call(this, parameters);
            };

            console.log('[Optimizer+] [OK] Hook RTCRtpSender.setParameters installé');
        }

        // ===========================================================================
        // HOOK RTCPeerConnection - Intercepter toutes les connexions
        // ===========================================================================

        if (windowCtx.RTCPeerConnection) {
            const OriginalRTCPeerConnection = windowCtx.RTCPeerConnection;

            windowCtx.RTCPeerConnection = function(config, constraints) {
                // Optimiser la configuration ICE pour faible latence
                if (config) {
                    config.iceCandidatePoolSize = config.iceCandidatePoolSize || 10;
                    // Forcer bundlePolicy pour réduire les connexions
                    config.bundlePolicy = 'max-bundle';
                    config.rtcpMuxPolicy = 'require';
                }

                const pc = new OriginalRTCPeerConnection(config, constraints);

                // Ajouter à la liste pour forçage périodique
                activePeerConnections.add(pc);

                // Nettoyer quand la connexion se ferme
                pc.addEventListener('connectionstatechange', () => {
                    if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
                        activePeerConnections.delete(pc);
                    }
                });

                // Intercepter setRemoteDescription pour modifier les SDP
                const originalSetRemoteDescription = pc.setRemoteDescription.bind(pc);
                pc.setRemoteDescription = function(description) {
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
                                // Retirer les anciens paramètres de bitrate
                                let newRest = rest.replace(/;?x-google-(max|min|start)-bitrate=\d+/g, '');
                                // Ajouter nos paramètres
                                const bitrateParams = `;x-google-max-bitrate=${Math.floor(CONFIG.streaming.maxBitrate/1000)};x-google-min-bitrate=${Math.floor(CONFIG.streaming.minBitrate/1000)};x-google-start-bitrate=${Math.floor(CONFIG.streaming.targetBitrate/1000)}`;
                                return `a=fmtp:${pt}${newRest}${bitrateParams}`;
                            }
                        );

                        description = new RTCSessionDescription({
                            type: description.type,
                            sdp: modifiedSdp
                        });

                        if (!CONFIG.performance.disableLogsInGame) {
                            console.log('[Optimizer+] SDP modifié - Bitrate forcé:', Math.floor(CONFIG.streaming.maxBitrate/1000000), 'Mbps');
                        }
                    }
                    return originalSetRemoteDescription(description);
                };

                // Intercepter setLocalDescription aussi pour être sûr
                const originalSetLocalDescription = pc.setLocalDescription.bind(pc);
                pc.setLocalDescription = function(description) {
                    if (description && description.sdp) {
                        let modifiedSdp = description.sdp;

                        // Mêmes modifications que pour remote
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
                    pc.addTransceiver = function(trackOrKind, init) {
                        const transceiver = originalAddTransceiver(trackOrKind, init);

                        // Optimiser le receiver pour faible latence
                        if (transceiver && transceiver.receiver) {
                            optimizeReceiverLatency(transceiver.receiver);
                        }

                        return transceiver;
                    };
                }

                // Intercepter ontrack pour optimiser les tracks vidéo entrantes
                const originalOntrack = Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, 'ontrack');
                if (originalOntrack && originalOntrack.set) {
                    let userOntrack = null;
                    Object.defineProperty(pc, 'ontrack', {
                        get: () => userOntrack,
                        set: (handler) => {
                            userOntrack = function(event) {
                                // Optimiser la latence du receiver
                                if (event.receiver) {
                                    optimizeReceiverLatency(event.receiver);
                                }
                                if (handler) handler.call(this, event);
                            };
                        },
                        configurable: true
                    });
                }

                // Intercepter createOffer/Answer pour les paramètres d'encodage
                const originalCreateOffer = pc.createOffer.bind(pc);
                pc.createOffer = async function(options) {
                    const offer = await originalCreateOffer(options);
                    return offer;
                };

                return pc;
            };

            // Copier les propriétés statiques
            Object.keys(OriginalRTCPeerConnection).forEach(key => {
                windowCtx.RTCPeerConnection[key] = OriginalRTCPeerConnection[key];
            });
            windowCtx.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
        }

        // ===========================================================================
        // FORÇAGE PÉRIODIQUE DU BITRATE - Empêcher Boosteroid de réduire le bitrate
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

                                // Empêcher le downscaling
                                if (encoding.scaleResolutionDownBy && encoding.scaleResolutionDownBy > 1) {
                                    encoding.scaleResolutionDownBy = 1;
                                    modified = true;
                                }
                            });

                            if (modified) {
                                sender.setParameters(params).then(() => {
                                    console.log('[Optimizer+]  Bitrate ré-appliqué:', Math.floor(CONFIG.streaming.targetBitrate/1000000), 'Mbps');
                                }).catch(e => {
                                    // Ignorer les erreurs silencieusement
                                });
                            }
                        });
                    } catch (e) {
                        // Ignorer les erreurs
                    }
                });
            }, 5000); // Vérifier toutes les 5 secondes

            console.log('[Optimizer+] [OK] Bitrate enforcement actif (vérification toutes les 5s)');
        }

        function stopBitrateEnforcement() {
            if (bitrateEnforcementInterval) {
                clearInterval(bitrateEnforcementInterval);
                bitrateEnforcementInterval = null;
            }
        }

        // Démarrer automatiquement sur page streaming
        if (isStreamingPage()) {
            startBitrateEnforcement();
        }

        // Exposer les fonctions pour le contrôle externe
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
                    } catch (e) {}
                });
                console.log('[Optimizer+] Bitrate maximum forcé immédiatement');
            }
        };

        // Fonction d'optimisation de la latence des receivers
        function optimizeReceiverLatency(receiver) {
            if (!receiver || !CONFIG.performance.lowLatencyMode) return;

            try {
                // ===============================================================
                // JITTER BUFFER OPTIMIZATION (CRITIQUE POUR LATENCE)
                // ===============================================================

                // Vérifier si on peut configurer le jitter buffer (Chrome 86+)
                if (receiver.jitterBufferTarget !== undefined) {
                    // Réduire le jitter buffer pour moins de latence
                    // Attention: trop bas = saccades, trop haut = latence
                    receiver.jitterBufferTarget = CONFIG.performance.jitterBufferTarget;

                    if (!CONFIG.performance.disableLogsInGame) {
                        console.log('[Optimizer+] Jitter buffer réduit à', CONFIG.performance.jitterBufferTarget, 'ms');
                    }
                }

                // Playout delay hint (WebRTC 1.0+)
                if (receiver.playoutDelayHint !== undefined) {
                    receiver.playoutDelayHint = CONFIG.performance.targetLatency / 1000; // En secondes

                    if (!CONFIG.performance.disableLogsInGame) {
                        console.log('[Optimizer+] Playout delay hint:', CONFIG.performance.targetLatency, 'ms');
                    }
                }

            } catch(e) {
                console.warn('[Optimizer+] Impossible d\'optimiser la latence receiver:', e);
            }
        }

        // Hook pour les requêtes réseau (XMLHttpRequest) - Intercepter les changements de qualité
        const originalXHROpen = windowCtx.XMLHttpRequest.prototype.open;
        const originalXHRSend = windowCtx.XMLHttpRequest.prototype.send;

        windowCtx.XMLHttpRequest.prototype.open = function(method, url, ...args) {
            this._optimizerUrl = url;
            this._optimizerMethod = method;
            return originalXHROpen.call(this, method, url, ...args);
        };

        windowCtx.XMLHttpRequest.prototype.send = function(body) {
            // Intercepter les requêtes qui tentent de réduire la qualité
            if (this._optimizerUrl && typeof this._optimizerUrl === 'string') {
                const url = this._optimizerUrl.toLowerCase();

                if ((url.includes('quality') || url.includes('bitrate') || url.includes('bandwidth')) &&
                    this._optimizerMethod === 'POST' && body) {
                    try {
                        let data = typeof body === 'string' ? JSON.parse(body) : body;

                        // Forcer les valeurs élevées si c'est une requête de qualité
                        if (data.bitrate !== undefined || data.quality !== undefined || data.bandwidth !== undefined) {
                            console.log('[Optimizer+] [BLOCK] Requête de réduction de qualité bloquée:', data);

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

        // Hook Fetch API - Intercepter les changements de qualité
        const originalFetch = windowCtx.fetch;
        windowCtx.fetch = function(url, options) {
            // Intercepter les requêtes de qualité
            if (typeof url === 'string' && options && options.method === 'POST' && options.body) {
                const urlLower = url.toLowerCase();

                if (urlLower.includes('quality') || urlLower.includes('bitrate') || urlLower.includes('bandwidth')) {
                    try {
                        let data = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;

                        if (data.bitrate !== undefined || data.quality !== undefined) {
                            console.log('[Optimizer+] [BLOCK] Fetch de réduction de qualité intercepté:', data);

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

        console.log('[Optimizer+] Hooks bitrate + latence installés');
    }

    // ===============================================================================
    // HOOK PERFORMANCE - Optimisations GPU et rendu
    // ===============================================================================

    function hookPerformance() {
        // Demander la priorité réseau haute (si supporté)
        if ('connection' in navigator) {
            try {
                // Surveiller la qualité de connexion et adapter
                const connection = navigator.connection;
                if (connection) {
                    connection.addEventListener('change', () => {
                        const effectiveType = connection.effectiveType;
                        if (!CONFIG.performance.disableLogsInGame) {
                            console.log('[Optimizer+] Connexion changée:', effectiveType);
                        }

                        // Adapter automatiquement la qualité selon la connexion
                        if (effectiveType === '4g' || effectiveType === 'wifi') {
                            // Connexion rapide: activer tous les filtres
                            CONFIG.performance.maxFiltersActive = 3;
                        } else if (effectiveType === '3g') {
                            // Connexion moyenne: réduire les filtres
                            CONFIG.performance.maxFiltersActive = 1;
                        } else {
                            // Connexion lente: désactiver les filtres pour la fluidité
                            CONFIG.performance.maxFiltersActive = 0;
                        }
                    });
                }
            } catch(e) {}
        }

        // Optimiser requestAnimationFrame pour le monitoring (si utilisé)
        let frameCount = 0;
        let lastFpsUpdate = performance.now();
        let currentFps = 60;

        // Exposer les stats FPS globalement pour debug
        windowCtx.optimizerStats = {
            get fps() { return currentFps; },
            get latency() { return CONFIG.performance.targetLatency; }
        };

        // Monitoring FPS léger (seulement si panel visible)
        function updateFpsCounter() {
            frameCount++;
            const now = performance.now();

            if (now - lastFpsUpdate >= 1000) {
                currentFps = frameCount;
                frameCount = 0;
                lastFpsUpdate = now;

                // Mettre à jour l'affichage si présent
                const fpsDisplay = document.getElementById('optimizer-fps-display');
                if (fpsDisplay) {
                    fpsDisplay.textContent = currentFps + ' FPS';
                    fpsDisplay.style.color = currentFps >= 55 ? '#22c55e' :
                                             currentFps >= 30 ? '#f59e0b' : '#ef4444';
                }
            }

            requestAnimationFrame(updateFpsCounter);
        }

        // Démarrer le compteur FPS après un délai
        setTimeout(() => {
            requestAnimationFrame(updateFpsCounter);
        }, 2000);

        console.log('[Optimizer+] Hooks performance installés');
    }

    // ===============================================================================
    // VIDEO ENHANCER - Filtres de netteté et amélioration AVANCÉS
    // ===============================================================================

    // Présets de filtres prédéfinis (style Better xCloud)
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
            // PRESET COMPÉTITIF - Optimisé pour FPS (High-End ONLY)
            // v3.6.2 Slim: Valeurs divisées par 2 pour stabilité 60fps
            nameKey: 'presetGame',
            get name() { return t(this.nameKey); },
            minProfile: 'high-end',
            enhancer: { sharpness: 0.45, contrast: 1.06, saturation: 1.01, brightness: 1.02 },
            filters: {
                usm: { enabled: true, amount: 0.35, radius: 0.5, threshold: 0.03 },
                cas: { enabled: true, sharpness: 0.45 },
                clarity: { enabled: false, amount: 0 }, // v3.6.2: Désactivé (trop lourd)
                denoise: { enabled: false, strength: 0.12 }, // v3.6.2: Désactivé par défaut
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
            enhancer: { sharpness: 0.35, contrast: 1.02, saturation: 1.0, brightness: 1.0 },
            filters: {
                usm: { enabled: true, amount: 0.3, radius: 1.1, threshold: 0.05 },  // Léger + stable
                cas: { enabled: true, sharpness: 0.4 },    // Réduit pour zéro halo
                clarity: { enabled: false, amount: 0 },    // Désactivé: trop d'artefacts
                denoise: { enabled: false, strength: 0 },  // Désactivé: peut causer blocage
                vibrance: { enabled: false, amount: 0 },   // Désactivé
                gamma: { enabled: false, value: 1.0 },     // Neutre
                exposure: { enabled: false, value: 0 },    // Neutre
                deband: { enabled: true, strength: 0.15 }  // Très léger deband
            },
            performance: {
                maxFiltersActive: 3,  // Limiter strictement
                adaptiveQuality: true,
                lowLatencyMode: true
            }
        },
        // v3.6.2: PerfectPro supprimé (redondant avec Perfect)
        'custom': {
            nameKey: 'presetCustom',
            get name() { return t(this.nameKey); },
            enhancer: null,
            filters: null
        }
    };

    class VideoEnhancer {
        constructor() {
            this.enabled = CONFIG.enhancer.enabled;
            this.filtersEnabled = CONFIG.filters.enabled;
            this.canvas = null;
            this.ctx = null;
            this.gl = null;
            this.videoElement = null;
            this.animationId = null;
            this.filterString = '';
            this.svgFiltersCreated = false;

            // ===============================================================
            // ANTI-ARTEFACTS: Debounce pour éviter le tearing/flickering
            // ===============================================================
            this._filterUpdateScheduled = false;
            this._lastFilterUpdate = 0;
            this._minUpdateInterval = 16; // ~60fps max

            this.updateFilterString();
        }

        // ===============================================================
        // Compte le nombre de filtres SVG actifs (pour limiter les artefacts)
        // ===============================================================
        countActiveFilters() {
            const filters = CONFIG.filters;
            let count = 0;
            if (filters.cas?.enabled) count++;
            if (filters.usm?.enabled) count++;
            if (filters.clarity?.enabled) count++;
            if (filters.denoise?.enabled) count++;
            if (filters.vibrance?.enabled) count++;
            if (filters.deband?.enabled) count++;
            return count;
        }

        // ===============================================================
        // Auto-limite les filtres si trop sont actifs (évite artefacts de composition)
        // Ordre de désactivation: vibrance > denoise > clarity > deband > CAS > USM
        // ===============================================================
        enforceFilterLimit() {
            const maxFilters = CONFIG.performance?.maxFiltersActive || 4;
            let activeCount = this.countActiveFilters();

            if (activeCount <= maxFilters) return false;

            console.warn(`[Optimizer+] ${activeCount} filtres actifs, limite: ${maxFilters} - désactivation auto`);

            // Ordre de désactivation par coût de rendu (du plus coûteux au moins coûteux)
            const costOrder = ['vibrance', 'denoise', 'clarity', 'deband', 'cas', 'usm'];
            let toDisable = activeCount - maxFilters;

            for (const filterName of costOrder) {
                if (toDisable <= 0) break;
                if (CONFIG.filters[filterName]?.enabled) {
                    CONFIG.filters[filterName].enabled = false;
                    console.log(`[Optimizer+] Filtre "${filterName}" désactivé automatiquement (limite atteinte)`);
                    toDisable--;
                }
            }

            return true; // Des filtres ont été désactivés
        }

        updateFilterString() {
            const { contrast, saturation, brightness } = CONFIG.enhancer;
            const filters = CONFIG.filters;

            let cssFilters = [];

            // Filtres CSS de base (très performants, toujours appliqués si enabled)
            if (this.enabled) {
                if (contrast !== 1.0) {
                    cssFilters.push(`contrast(${contrast})`);
                }
                if (saturation !== 1.0) {
                    cssFilters.push(`saturate(${saturation})`);
                }
                if (brightness !== 1.0) {
                    cssFilters.push(`brightness(${brightness})`);
                }

                // Gamma et Exposure sont des filtres CSS légers
                if (filters.gamma?.enabled && filters.gamma.value !== 1.0) {
                    // Gamma simulé via brightness curve
                    const gammaCorrection = Math.pow(filters.gamma.value, 0.5);
                    cssFilters.push(`brightness(${gammaCorrection})`);
                }

                if (filters.exposure?.enabled && filters.exposure.value !== 0) {
                    const exposureFactor = 1 + filters.exposure.value * 0.5;
                    cssFilters.push(`brightness(${exposureFactor})`);
                }
            }

            // Filtres SVG avancés
            if (filters.enabled) {
                if (filters.cas?.enabled) {
                    cssFilters.push(`url(#optimizer-cas-filter)`);
                }
                if (filters.usm?.enabled) {
                    cssFilters.push(`url(#optimizer-usm-filter)`);
                }
                if (filters.clarity?.enabled) {
                    cssFilters.push(`url(#optimizer-clarity-filter)`);
                }
                if (filters.denoise?.enabled) {
                    cssFilters.push(`url(#optimizer-denoise-filter)`);
                }
                if (filters.vibrance?.enabled) {
                    cssFilters.push(`url(#optimizer-vibrance-filter)`);
                }
                if (filters.deband?.enabled) {
                    cssFilters.push(`url(#optimizer-deband-filter)`);
                }
            }

            this.filterString = cssFilters.length > 0 ? cssFilters.join(' ') : 'none';
        }

        createSVGFilters() {
            if (this.svgFiltersCreated) {
                this.updateSVGFilters();
                return;
            }

            const svgNS = "http://www.w3.org/2000/svg";
            const svg = document.createElementNS(svgNS, "svg");
            svg.setAttribute("id", "optimizer-svg-filters");
            svg.setAttribute("width", "0");
            svg.setAttribute("height", "0");
            svg.style.position = "absolute";
            svg.style.visibility = "hidden";

            svg.innerHTML = this.generateSVGFilters();
            document.body.appendChild(svg);
            this.svgFiltersCreated = true;

            console.log('[Optimizer+] Filtres SVG avancés créés');
        }

        generateSVGFilters() {
            const filters = CONFIG.filters;
            const enhancer = CONFIG.enhancer;

            return `
                <defs>
                    <!-- USM (Unsharp Mask) Filter - Netteté professionnelle -->
                    <filter id="optimizer-usm-filter" x="-10%" y="-10%" width="120%" height="120%">
                        <feGaussianBlur in="SourceGraphic" stdDeviation="${filters.usm.radius}" result="blur"/>
                        <feComponentTransfer in="SourceGraphic" result="original">
                            <feFuncR type="identity"/>
                            <feFuncG type="identity"/>
                            <feFuncB type="identity"/>
                        </feComponentTransfer>
                        <feComposite in="original" in2="blur" operator="arithmetic"
                            k1="0" k2="${1 + filters.usm.amount}" k3="${-filters.usm.amount}" k4="0" result="sharpen"/>
                        <feComposite in="sharpen" in2="SourceGraphic" operator="in"/>
                    </filter>

                    <!-- CAS (Contrast Adaptive Sharpening) Filter - AMD FidelityFX style -->
                    <filter id="optimizer-cas-filter" x="0%" y="0%" width="100%" height="100%">
                        <feConvolveMatrix
                            order="3"
                            kernelMatrix="
                                0 ${-filters.cas.sharpness * 0.25} 0
                                ${-filters.cas.sharpness * 0.25} ${1 + filters.cas.sharpness} ${-filters.cas.sharpness * 0.25}
                                0 ${-filters.cas.sharpness * 0.25} 0
                            "
                            divisor="1"
                            bias="0"
                            preserveAlpha="true"
                            edgeMode="duplicate"/>
                    </filter>

                    <!-- Clarity Filter - Micro-contraste et détails -->
                    <filter id="optimizer-clarity-filter" x="-5%" y="-5%" width="110%" height="110%">
                        <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur1"/>
                        <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur2"/>
                        <feComposite in="blur1" in2="blur2" operator="arithmetic"
                            k1="0" k2="1" k3="-1" k4="0" result="highpass"/>
                        <feComposite in="SourceGraphic" in2="highpass" operator="arithmetic"
                            k1="0" k2="1" k3="${filters.clarity.amount}" k4="0"/>
                    </filter>

                    <!-- Denoise Filter - Réduction de bruit pour streams compressés -->
                    <filter id="optimizer-denoise-filter" x="0%" y="0%" width="100%" height="100%">
                        <feGaussianBlur in="SourceGraphic" stdDeviation="${filters.denoise.strength * 1.5}" result="blur"/>
                        <feMorphology in="SourceGraphic" operator="dilate" radius="${filters.denoise.strength * 0.5}" result="dilate"/>
                        <feComposite in="blur" in2="dilate" operator="arithmetic"
                            k1="0" k2="${1 - filters.denoise.strength * 0.3}" k3="${filters.denoise.strength * 0.3}" k4="0"/>
                    </filter>

                    <!-- Vibrance Filter - Saturation intelligente -->
                    <filter id="optimizer-vibrance-filter" x="0%" y="0%" width="100%" height="100%">
                        <feColorMatrix type="matrix" values="
                            ${1 + filters.vibrance.amount * 0.3} ${-filters.vibrance.amount * 0.15} ${-filters.vibrance.amount * 0.15} 0 0
                            ${-filters.vibrance.amount * 0.1} ${1 + filters.vibrance.amount * 0.2} ${-filters.vibrance.amount * 0.1} 0 0
                            ${-filters.vibrance.amount * 0.1} ${-filters.vibrance.amount * 0.1} ${1 + filters.vibrance.amount * 0.4} 0 0
                            0 0 0 1 0
                        "/>
                    </filter>

                    <!-- Deband Filter - Anti-banding pour streams compressés -->
                    <!-- OPTIMISÉ: baseFrequency réduite, seed déterministe, scale modéré pour éviter flickering -->
                    <filter id="optimizer-deband-filter" x="0%" y="0%" width="100%" height="100%">
                        <feTurbulence type="fractalNoise" baseFrequency="0.3" numOctaves="2" result="noise" seed="1"/>
                        <feDisplacementMap in="SourceGraphic" in2="noise" scale="${(filters.deband?.strength || 0.3) * 0.8}"
                            xChannelSelector="R" yChannelSelector="G"/>
                    </filter>

                    <!-- Legacy sharpen filter -->
                    <filter id="optimizer-sharpen-filter">
                        <feConvolveMatrix
                            order="3"
                            kernelMatrix="0 -${enhancer.sharpness} 0 -${enhancer.sharpness} ${1 + 4 * enhancer.sharpness} -${enhancer.sharpness} 0 -${enhancer.sharpness} 0"
                            preserveAlpha="true"/>
                    </filter>
                </defs>
            `;
        }

        updateSVGFilters() {
            const svg = document.getElementById('optimizer-svg-filters');
            if (svg) {
                svg.innerHTML = this.generateSVGFilters();
            }
        }

        applyToVideo(videoElement) {
            if (!videoElement) return;

            this.videoElement = videoElement;

            if (this.enabled || this.filtersEnabled) {
                this.updateFilterString();
                videoElement.style.filter = this.filterString;
            }

            this.applyEdgeEnhancements(videoElement);

            console.log('[Optimizer+] Enhancer + Filtres avancés appliqués');
        }

        applyEdgeEnhancements(videoElement) {
            try {
                // ===============================================================
                // v3.6: MODE PERFORMANCE - Optimisations légères uniquement
                // ===============================================================

                // En mode Performance, appliquer un minimum de styles
                if (CONFIG.display.performanceMode) {
                    // Juste le rendu de base sans couches GPU supplémentaires
                    videoElement.style.imageRendering = 'auto';
                    console.log('[Optimizer+] Mode Performance: enhancements désactivés');
                    return;
                }

                // ===============================================================
                // MODE NORMAL: Optimisations GPU sélectives
                // ===============================================================

                // Forcer l'accélération GPU uniquement si activée
                if (CONFIG.performance.gpuAcceleration) {
                    videoElement.style.transform = 'translateZ(0)';
                    videoElement.style.backfaceVisibility = 'hidden';
                }

                // Anti-ghosting simplifié
                videoElement.style.mixBlendMode = 'normal';

                // Ne PAS utiliser willChange en permanence - cause des problèmes de mémoire GPU
                // Sera activé temporairement lors des changements de filtres uniquement

                // Qualité de rendu - 'auto' est plus performant
                videoElement.style.imageRendering = 'auto';

                // NE PAS utiliser 'contain' - cause des repaints inutiles sur certains navigateurs

                if (!CONFIG.performance.disableLogsInGame) {
                    console.log('[Optimizer+] Edge enhancements appliqués (mode normal)');
                }

            } catch(e) {
                console.warn('[Optimizer+] Edge enhancements non disponibles');
            }
        }

        updateSettings(settings) {
            Object.assign(CONFIG.enhancer, settings);
            // Utiliser le debounce pour éviter le tearing sur les sliders
            this.scheduleFilterUpdate();
            Storage.set('config', CONFIG);
        }

        updateFilterSettings(filterName, settings) {
            if (CONFIG.filters[filterName]) {
                Object.assign(CONFIG.filters[filterName], settings);
                // Utiliser le debounce pour éviter le tearing sur les sliders
                this.scheduleFilterUpdate();
                Storage.set('config', CONFIG);
            }
        }

        applyPreset(presetName) {
            const preset = FILTER_PRESETS[presetName];
            if (!preset) return;

            CONFIG.filters.preset = presetName;

            if (preset.enhancer) {
                Object.assign(CONFIG.enhancer, preset.enhancer);
            }
            if (preset.filters) {
                Object.keys(preset.filters).forEach(key => {
                    if (CONFIG.filters[key]) {
                        Object.assign(CONFIG.filters[key], preset.filters[key]);
                    }
                });
            }

            this.updateSVGFilters();
            this.updateFilterString();
            this.applyFiltersToAllVideos();

            Storage.set('config', CONFIG);
            console.log(`[Optimizer+] Préset "${preset.name}" appliqué`);
        }

        toggle(enabled) {
            this.enabled = enabled;
            CONFIG.enhancer.enabled = enabled;

            // Mettre à jour les filtres et appliquer immédiatement
            this.updateFilterString();
            this.applyFiltersToAllVideos();

            Storage.set('config', CONFIG);
            console.log(`[Optimizer+] Enhancer ${enabled ? 'activé' : 'désactivé'}`);
        }

        toggleFilters(enabled) {
            this.filtersEnabled = enabled;
            CONFIG.filters.enabled = enabled;

            // Mettre à jour et appliquer immédiatement
            this.updateFilterString();
            this.applyFiltersToAllVideos();

            Storage.set('config', CONFIG);
            console.log(`[Optimizer+] Filtres avancés ${enabled ? 'activés' : 'désactivés'}`);
        }

        toggleFilter(filterName, enabled) {
            if (CONFIG.filters[filterName]) {
                CONFIG.filters[filterName].enabled = enabled;

                // Mettre à jour SVG, recalculer les filtres et appliquer
                this.updateSVGFilters();
                this.updateFilterString();
                this.applyFiltersToAllVideos();

                Storage.set('config', CONFIG);
                console.log(`[Optimizer+] Filtre ${filterName} ${enabled ? 'activé' : 'désactivé'}`);
            }
        }

        // ===============================================================
        // Applique les filtres à toutes les vidéos avec limitation smart
        // ===============================================================
        applyFiltersToAllVideos() {
            const videos = document.querySelectorAll('video');

            // Vérifier et appliquer la limite de filtres actifs
            if (this.filtersEnabled && this.enforceFilterLimit()) {
                // Des filtres ont été désactivés, recalculer la string
                this.updateFilterString();
            }

            const filterValue = (this.enabled || this.filtersEnabled) ? this.filterString : '';

            videos.forEach(video => {
                video.style.filter = filterValue;
                this.videoElement = video; // Garder une référence

                // S'assurer que les edge enhancements sont appliqués
                if (!video.dataset.optimizerEnhanced) {
                    this.applyEdgeEnhancements(video);
                    video.dataset.optimizerEnhanced = 'true';
                }
            });
        }

        // ===============================================================
        // v3.5: Utilise FilterBatchProcessor pour éviter flickering
        // Queue l'opération pour traitement batched frame-aligned
        // ===============================================================
        scheduleFilterUpdate() {
            FilterBatchProcessor.queueFilterUpdate(() => {
                this.updateSVGFilters();
                this.updateFilterString();
                this.applyFiltersToAllVideos();
            });
        }

        // ===============================================================
        // v3.5: Méthode pour les sliders - anti-flickering
        // ===============================================================
        onFilterSliderChange(filterName, value) {
            FilterBatchProcessor.queueFilterUpdate(() => {
                if (CONFIG.filters[filterName] !== undefined) {
                    if (typeof CONFIG.filters[filterName] === 'object') {
                        // Pour les filtres avec sous-propriétés (usm.amount, cas.sharpness, etc.)
                        const parts = filterName.split('.');
                        if (parts.length === 2) {
                            CONFIG.filters[parts[0]][parts[1]] = value;
                        }
                    } else {
                        CONFIG.filters[filterName] = value;
                    }
                } else if (CONFIG.enhancer[filterName] !== undefined) {
                    CONFIG.enhancer[filterName] = value;
                }
                this.updateFilterString();
                this.updateSVGFilters();
                this.applyFiltersToAllVideos();
            });
        }
    }

    const videoEnhancer = new VideoEnhancer();

    // ===============================================================================
    // DRM HOOKS - Bypass HDCP et autres restrictions
    // ===============================================================================

    function hookDRM() {
        // MSMediaKeys (Edge Legacy / IE)
        if (windowCtx.MSMediaKeys) {
            if (windowCtx.MSMediaKeys.isTypeSupportedWithFeatures) {
                windowCtx.MSMediaKeys.isTypeSupportedWithFeaturesOriginal = windowCtx.MSMediaKeys.isTypeSupportedWithFeatures;
                windowCtx.MSMediaKeys.isTypeSupportedWithFeatures = function(keySystem, targetMediaCodec) {
                    const reg = /,display-res-[x|y]=\d+,display-res-[x|y]=\d+/;
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

                    let r = this.isTypeSupportedWithFeaturesOriginal(keySystem, targetMediaCodec);

                    if (CONFIG.drm.forceALL) {
                        return "probably";
                    }
                    return r;
                };
            }

            if (windowCtx.MSMediaKeys.isTypeSupported) {
                windowCtx.MSMediaKeys.isTypeSupportedOriginal = windowCtx.MSMediaKeys.isTypeSupported;
                windowCtx.MSMediaKeys.isTypeSupported = function(keySystem) {
                    keySystem = keySystem.replace("com.microsoft.playready.hardware", "com.microsoft.playready");
                    return this.isTypeSupportedOriginal(keySystem);
                };
            }
        }

        // Navigator MediaKeySystemAccess (Standard EME)
        if (windowCtx.navigator.requestMediaKeySystemAccess) {
            windowCtx.navigator.requestMediaKeySystemAccessOriginal = windowCtx.navigator.requestMediaKeySystemAccess;
            windowCtx.navigator.requestMediaKeySystemAccess = async function(keySystem, options) {
                let newKeySystem = keySystem;

                if (keySystem.indexOf("playready") !== -1) {
                    try {
                        return await windowCtx.navigator.requestMediaKeySystemAccessOriginal(newKeySystem, options);
                    } catch(e) {
                        console.warn("[Optimizer+] Fallback PlayReady SL2000 -> SL3000");
                        newKeySystem = "com.microsoft.playready";
                    }
                }

                // Modifier les options pour permettre plus de flexibilité
                for (let i = 0; i < options.length; i++) {
                    if (options[i].videoCapabilities) {
                        for (let j = 0; j < options[i].videoCapabilities.length; j++) {
                            // Permettre le décodage software si hardware non disponible
                            if (options[i].videoCapabilities[j].robustness) {
                                // On garde la robustness originale pour la sécurité
                            }
                        }
                    }
                }

                return await windowCtx.navigator.requestMediaKeySystemAccessOriginal(newKeySystem, options);
            };
        }

        console.log('[Optimizer+] Hooks DRM installés');
    }

    // ===============================================================================
    // UI INJECTION - Ajout de l'interface dans le menu Boosteroid (CRUCIAL)
    // ===============================================================================

    // Sélecteurs possibles pour le menu Boosteroid
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
     * Cette option interfère avec les filtres du script
     */
    function hideBoosteroidBrighterOption() {
        // Cibler UNIQUEMENT les lignes avec un toggle/switch (pas les panneaux stats)
        // L'option "Image plus lumineuse" est un .menu_switch_block avec un input checkbox
        const switchBlocks = document.querySelectorAll('.menu_switch_block');

        switchBlocks.forEach(block => {
            // Vérifier que c'est bien un bloc avec un toggle (input checkbox)
            const hasToggle = block.querySelector('input[type="checkbox"], .switch, .toggle');
            if (!hasToggle) return; // Ignorer les blocs sans toggle

            // Ne pas toucher à notre propre section
            if (block.closest('#optimizer-section')) return;

            // Chercher le texte du label
            const text = block.textContent?.toLowerCase() || '';

            // Mots-clés SPÉCIFIQUES à l'option "Image plus lumineuse" (multilingue)
            const brighterKeywords = [
                'brighter image', 'image plus lumineuse', 'helleres bild',
                'imagen más brillante', 'immagine più luminosa', 'imagem mais brilhante',
                'ярче изображение', 'jaśniejszy obraz', 'яскравіше зображення',
                'daha parlak', 'světlejší obraz', 'fényesebb kép', 'imagine mai luminoasă'
            ];

            const isBrighterOption = brighterKeywords.some(kw => text.includes(kw.toLowerCase()));

            if (isBrighterOption) {
                block.style.display = 'none';
                block.style.visibility = 'hidden';
                block.style.pointerEvents = 'none';
                console.log('[Optimizer+] Masqué: option "Image plus lumineuse" de Boosteroid');
            }
        });
    }

    /**
     * Trouve le menu Boosteroid in-game (pas le menu dashboard!)
     * Utilise findOpenOptionsMenu() pour la logique principale
     * @returns {HTMLElement|null}
     */
    function findBoosteroidMenu() {
        // Utiliser la nouvelle fonction de détection
        const menu = findOpenOptionsMenu();
        if (menu) return menu;

        // Fallback: essayer les sélecteurs classiques
        for (const selector of MENU_SELECTORS) {
            try {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    // Vérifier si c'est un élément de menu valide (visible et avec du contenu)
                    if (el && el.offsetParent !== null && el.children.length > 0) {
                        // Vérifier que ce n'est pas notre propre élément
                        if (!el.id?.includes('optimizer') && !el.className?.includes('optimizer')) {
                            // Vérifier qu'on est bien dans un contexte de jeu
                            if (isInGameSession()) {
                                return el;
                            }
                        }
                    }
                }
            } catch(e) {}
        }

        return null;
    }

    /**
     * Trouve le meilleur endroit pour insérer notre section dans le menu
     * Idéalement après la section "Streaming"
     * @param {HTMLElement} menu - Le menu parent
     * @returns {HTMLElement|null} L'élément après lequel insérer, ou null pour ajouter à la fin
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
    // DÉTECTION DE SESSION DE JEU - Logique robuste
    // ===============================================================================

    /**
     * Vérifie si on est sur une page dashboard (où le script ne doit PAS s'activer)
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

        // Si on est à la racine ou sur une page dashboard connue
        if (path === '/' || path === '') {
            return true;
        }

        return dashboardPatterns.some(pattern => path.includes(pattern));
    }

    /**
     * Vérifie si on est sur la page de streaming (jeu actif)
     * @returns {boolean} True si on est en streaming
     */
    function isStreamingPage() {
        const path = window.location.pathname.toLowerCase();
        const href = window.location.href.toLowerCase();

        // Détection de streaming.html avec sessionId
        if (path.includes('streaming.html') || href.includes('sessionid=')) {
            return true;
        }

        // Autres patterns de jeu
        const gamePatterns = ['/play/', '/game/', '/stream/', '/session/', '/run/'];
        return gamePatterns.some(pattern => path.includes(pattern));
    }

    /**
     * Vérifie si une instance de jeu est active (streaming vidéo WebRTC)
     * @returns {boolean} True si un jeu est en cours de streaming
     */
    function isInGameSession() {
        // 1. Vérifier si on est sur la page de streaming
        const onStreamingPage = isStreamingPage();

        // 2. Vérifier la présence d'une vidéo de streaming active
        const video = document.querySelector('video');
        const hasActiveVideo = video && (
            video.src ||
            video.srcObject ||
            video.readyState >= 1 // HAVE_METADATA ou plus
        );

        // 3. Vérifier la présence du menu Boosteroid (structure spécifique)
        const hasBoosteroidMenu = document.querySelector('#menu.menu_desktop') ||
                                  document.querySelector('.menu_switch_block') ||
                                  document.querySelector('#close-session-control');

        // 4. Vérifier qu'on n'est PAS sur le dashboard
        const notOnDashboard = !isDashboardPage();

        // Session active si: (page streaming OU vidéo active OU menu Boosteroid) ET pas dashboard
        const isActive = notOnDashboard && (onStreamingPage || hasActiveVideo || hasBoosteroidMenu);

        if (isActive !== SessionState.isGameActive) {
            console.log(`[Optimizer+] Session de jeu: ${isActive ? 'ACTIVE' : 'INACTIVE'}`);
            console.log(`[Optimizer+] - Page streaming: ${onStreamingPage}`);
            console.log(`[Optimizer+] - Vidéo active: ${!!hasActiveVideo}`);
            console.log(`[Optimizer+] - Menu Boosteroid: ${!!hasBoosteroidMenu}`);
            SessionState.isGameActive = isActive;
        }

        return isActive;
    }

    /**
     * Vérifie si le menu d'options de Boosteroid est ouvert
     * Cible spécifiquement la structure: #menu.menu_desktop avec display:block
     * @returns {HTMLElement|null} L'élément menu si trouvé et visible, null sinon
     */
    function findOpenOptionsMenu() {
        // 1. Sélecteur EXACT du menu Boosteroid (priorité maximale)
        const boosteroidMenu = document.querySelector('#menu.menu_desktop');
        if (boosteroidMenu) {
            const style = window.getComputedStyle(boosteroidMenu);
            // Vérifier que le menu est visible (display: block)
            if (style.display !== 'none' && boosteroidMenu.offsetParent !== null) {
                console.log('[Optimizer+] Menu Boosteroid trouvé (#menu.menu_desktop)');
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
     * Nettoie tous les éléments UI du script et reset l'état
     * Appelé quand on quitte une session de jeu ou ferme le menu
     */
    function cleanupUI() {
        // Éléments à supprimer
        const elementsToRemove = [
            '#optimizer-section',
            '#optimizer-notification',
            '#optimizer-svg-filters',
            '.optimizer-overlay',
            '#opt-notification-style'
        ];

        elementsToRemove.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => el.remove());
        });

        // Retirer les filtres CSS appliqués aux vidéos (seulement si on quitte le jeu)
        if (!SessionState.isGameActive) {
            document.querySelectorAll('video').forEach(video => {
                video.style.filter = '';
            });
        }

        // Mettre à jour l'état
        SessionState.isUIInjected = false;

        console.log('[Optimizer+] UI nettoyée');
    }

    /**
     * Système d'injection intelligent de l'UI
     * Ne s'active QUE si:
     * 1. On est en session de jeu (page streaming, pas dashboard)
     * 2. Le menu d'options est ouvert (visible)
     */
    function injectUI() {
        // ===========================================================================
        // VÉRIFICATION INITIALE
        // ===========================================================================

        const onStreaming = isStreamingPage();
        console.log('[Optimizer+] Page de streaming:', onStreaming);
        console.log('[Optimizer+] URL:', window.location.href);

        if (isDashboardPage() && !onStreaming) {
            console.log('[Optimizer+] Dashboard détecté - UI désactivée');
            return;
        }

        // ===========================================================================
        // OBSERVER PRINCIPAL - Surveille l'état du jeu et du menu
        // ===========================================================================

        let checkInterval = null;
        let lastUrl = window.location.href;
        let isInjecting = false; // v3.6.4: Mutex pour éviter double injection (RACE-01)

        /**
         * Fonction principale de vérification et injection
         */
        const checkAndInject = () => {
            // v3.6.4: Mutex - éviter les appels concurrents (RACE-01 fix)
            if (isInjecting) return;
            isInjecting = true;

            try {
            // 0. Auto-réparation en cas d'état incohérent
            SessionState.selfHeal();

            // 1. Vérifier si on est sur une page de streaming
            const onStreaming = isStreamingPage();

            if (!onStreaming && isDashboardPage()) {
                // Pas en jeu -> nettoyer si nécessaire
                if (SessionState.isUIInjected) {
                    cleanupUI();
                }
                return;
            }

            // ===========================================================================
            // STREAMING ENHANCEMENTS: Activer dès la page streaming (avant le menu)
            // ===========================================================================
            if (onStreaming && !StreamingEnhancements.active) {
                StreamingEnhancements.enable();
            }

            // 2. Chercher le menu Boosteroid (#menu.menu_desktop)
            const menu = findOpenOptionsMenu();

            if (menu && !SessionState.isUIInjected) {
                // Menu trouvé et UI pas encore injectée -> injecter
                if (!document.getElementById('optimizer-section')) {
                    createOptimizerUI(menu);
                    hideBoosteroidBrighterOption(); // Masquer l'option conflictuelle
                    SessionState.isUIInjected = true;
                    SessionState.isMenuOpen = true;
                    SessionState.isGameActive = true;
                    SessionState.retryCount = 0; // Reset le compteur après succès
                    console.log('[Optimizer+] [OK] UI injectée dans le menu Boosteroid');
                }
            } else if (menu && document.getElementById('optimizer-section')) {
                // Menu ouvert et UI présente - tout va bien
                hideBoosteroidBrighterOption(); // S'assurer que l'option reste masquée
                SessionState.isUIInjected = true;
                SessionState.isMenuOpen = true;
                SessionState.retryCount = 0;
            } else if (!menu && SessionState.isUIInjected) {
                // Menu fermé - l'UI disparaît avec le menu (pas besoin de cleanup)
                // Le menu Boosteroid cache notre UI quand il se ferme
                SessionState.isMenuOpen = false;
                // L'UI sera recréée quand le menu s'ouvrira à nouveau
                if (!document.getElementById('optimizer-section')) {
                    SessionState.isUIInjected = false;
                }
            }
            } finally {
                isInjecting = false; // v3.6.4: Libérer le mutex
            }
        };

        /**
         * Gère les changements d'URL (navigation SPA)
         */
        const handleUrlChange = () => {
            if (window.location.href !== lastUrl) {
                const previousUrl = lastUrl;
                lastUrl = window.location.href;
                console.log('[Optimizer+] Navigation détectée:', window.location.pathname);

                // Vérifier si c'est un changement de session (nouveau jeu)
                if (SessionState.hasSessionChanged()) {
                    console.log('[Optimizer+] Nouveau jeu détecté - réinitialisation');
                    SessionState.forceReinject();
                    setTimeout(checkAndInject, 500);
                    return;
                }

                // Si on retourne au dashboard, nettoyer
                if (isDashboardPage()) {
                    cleanupUI();
                    SessionState.reset();
                } else {
                    // Nouvelle page de jeu potentielle, vérifier
                    setTimeout(checkAndInject, 500);
                }
            }
        };

        // ===========================================================================
        // MISE EN PLACE DES OBSERVERS
        // ===========================================================================

        // Observer les mutations DOM (apparition de menus, vidéos, etc.)
        const domObserver = new MutationObserver((mutations) => {
            // Vérifier les changements d'URL (SPA)
            handleUrlChange();

            // Vérifier si des éléments pertinents ont été ajoutés ou modifiés
            let shouldCheck = false;
            for (const mutation of mutations) {
                // Vérifier les attributs (display:block sur le menu)
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    const target = mutation.target;
                    if (target.id === 'menu' || target.classList?.contains('menu_desktop')) {
                        shouldCheck = true;
                        break;
                    }
                }

                // Vérifier les nouveaux nœuds
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Vérifier si c'est le menu ou un élément de menu
                        if (node.id === 'menu' ||
                            node.classList?.contains('menu_desktop') ||
                            node.classList?.contains('menu_block') ||
                            node.matches?.('video, .menu_title, .menu_switch_block')) {
                            shouldCheck = true;
                            break;
                        }
                        // Vérifier les enfants
                        if (node.querySelector?.('#menu, .menu_desktop, .menu_block')) {
                            shouldCheck = true;
                            break;
                        }
                    }
                }
                if (shouldCheck) break;
            }

            if (shouldCheck) {
                // Petit délai pour laisser le DOM se stabiliser
                setTimeout(checkAndInject, 50);
            }
        });

        domObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class', 'display']
        });

        // Écouter les clics (ouverture de menus)
        const clickHandler = () => {
            setTimeout(checkAndInject, 300);
        };
        document.addEventListener('click', clickHandler, { passive: true });

        // Écouter les touches clavier (ESC pour fermer menu)
        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                setTimeout(checkAndInject, 100);
            }
            // Note: Raccourci ultrawide (Ctrl+Alt+W / F10) supprimé en v3.6.9
        };
        document.addEventListener('keydown', keyHandler);

        // Écouter popstate pour la navigation
        const popstateHandler = () => {
            setTimeout(() => {
                handleUrlChange();
                checkAndInject();
            }, 100);
        };
        window.addEventListener('popstate', popstateHandler);

        // Écouter le changement de visibilité de l'onglet (retour après alt-tab, etc.)
        const visibilityHandler = () => {
            if (document.visibilityState === 'visible' && isStreamingPage()) {
                console.log('[Optimizer+] Onglet redevenu visible - vérification UI');
                // Laisser le temps au DOM de se rétablir après la reprise
                setTimeout(() => {
                    SessionState.selfHeal();
                    checkAndInject();
                }, 300);
            }
        };
        document.addEventListener('visibilitychange', visibilityHandler);

        // Écouter le focus de la fenêtre (en plus de visibility pour compatibilité)
        const focusHandler = () => {
            if (isStreamingPage()) {
                setTimeout(checkAndInject, 200);
            }
        };
        window.addEventListener('focus', focusHandler);

        // v3.6.2: Remplacé setInterval par requestIdleCallback (évite micro-freezes)
        const scheduleNextCheck = () => {
            if (typeof requestIdleCallback !== 'undefined') {
                checkInterval = requestIdleCallback(() => {
                    if (isStreamingPage()) checkAndInject();
                    scheduleNextCheck();
                }, { timeout: onStreaming ? 2000 : 5000 });
            } else {
                // Fallback pour navigateurs sans requestIdleCallback
                checkInterval = setTimeout(() => {
                    if (isStreamingPage()) checkAndInject();
                    scheduleNextCheck();
                }, onStreaming ? 2000 : 5000);
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

        // Première vérification - immédiate sur streaming.html
        if (onStreaming) {
            console.log('[Optimizer+] Page streaming détectée - activation immédiate');
            // Vérifier plusieurs fois rapidement au début
            setTimeout(checkAndInject, 100);
            setTimeout(checkAndInject, 500);
            setTimeout(checkAndInject, 1000);
            setTimeout(checkAndInject, 2000);
        } else {
            setTimeout(checkAndInject, 500);
        }

        console.log('[Optimizer+] Système d\'injection intelligent activé');
    }

    // Notification stylée
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

        notification.innerHTML = `
            <span style="display: flex; align-items: center; color: ${colors[type]};">${icons[type] || icons.info}</span>
            <span>${message}</span>
        `;

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
        // Vérifier si déjà injecté
        if (document.getElementById('optimizer-section')) {
            console.log('[Optimizer+] UI déjà présente');
            return;
        }

        // Activer les améliorations de streaming (AXE 2)
        if (!StreamingEnhancements.active) {
            StreamingEnhancements.enable();
        }

        // Trouver le meilleur point d'insertion (après la dernière section)
        const insertAfter = findInsertionPoint(menuElement);

        // Créer la section Optimizer Plus - Structure native Boosteroid
        const section = document.createElement('div');
        section.id = 'optimizer-section';

        // Déterminer si on est sur un écran ultrawide
        const isUltrawideScreen = (window.innerWidth / window.innerHeight) > 1.9;

        section.innerHTML = `
            <div class="menu_title" style="margin-top: 20px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;">
                <span>${t('title')} <span class="optimizer-badge">v3.7.2</span> <span style="font-size: 11px; color: #9b99ad; font-weight: normal;">by Derfog</span></span>
                <select class="optimizer-select" id="optimizer-lang-select" style="width: auto; min-width: 80px; padding: 4px 6px; font-size: 11px;">
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
                    <span style="margin-left: 6px;">${t('active')} - <span id="optimizer-resolution">${CONFIG.resolution.width}x${CONFIG.resolution.height}</span></span>
                </div>
                <span class="optimizer-hw-badge">${ICONS.cpu}</span>
            </div>

            <!-- Info écran détecté -->
            <div class="optimizer-screen-info">
                ${ICONS.monitor}
                <span class="screen-detected">${SmartResolutionDetector.getScreenAnalysis().screen.width}x${SmartResolutionDetector.getScreenAnalysis().screen.height}</span>
                <span class="screen-ratio">${SmartResolutionDetector.getScreenAnalysis().screen.ratioType}</span>
            </div>

            <!-- Sélecteur de Résolution v3.6.3 - Auto-détection intelligente -->
            <div class="menu_title">${t('targetResolution')}</div>
            <div class="menu_switch_block top_20">
                <div class="menu_title_group">
                    ${ICONS.monitor} <span>${t('resolution')}</span>
                </div>
                <select class="optimizer-select" id="optimizer-res-select">
                    ${SmartResolutionDetector.generateResolutionOptionsHTML(CONFIG.resolution.width, CONFIG.resolution.height, CONFIG.resolution.isAuto)}
                </select>
            </div>

            <!-- Video Enhancer - Simplifié -->
            <div class="menu_title">${t('videoEnhancement')}</div>
            <div class="menu_switch_block top_20">
                <div class="menu_title_group">
                    <p>${t('enableEnhancer')}</p>
                </div>
                <label class="switch">
                    <input type="checkbox" id="optimizer-enhancer" ${CONFIG.enhancer.enabled ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            </div>
            <div class="menu_switch_block top_20">
                <div class="menu_title_group"><p>${t('sharpness')}</p></div>
                <div class="menu_title_group" id="optimizer-sharp-value">${Math.round(CONFIG.enhancer.sharpness * 100)}%</div>
                <input type="range" id="optimizer-sharpness" name="sharpness" min="0" max="100" value="${CONFIG.enhancer.sharpness * 100}">
            </div>
            <div class="menu_switch_block top_20">
                <div class="menu_title_group"><p>${t('contrast')}</p></div>
                <div class="menu_title_group" id="optimizer-contrast-value">${Math.round(CONFIG.enhancer.contrast * 100)}%</div>
                <input type="range" id="optimizer-contrast" name="contrast" min="80" max="120" value="${CONFIG.enhancer.contrast * 100}">
            </div>
            <div class="menu_switch_block top_20">
                <div class="menu_title_group"><p>${t('saturation')}</p></div>
                <div class="menu_title_group" id="optimizer-sat-value">${Math.round(CONFIG.enhancer.saturation * 100)}%</div>
                <input type="range" id="optimizer-saturation" name="saturation" min="80" max="120" value="${CONFIG.enhancer.saturation * 100}">
            </div>

            <!-- PRÉSETS - Section principale simplifiée -->
            <div class="menu_title">${t('quickPresets')}</div>
            <div class="menu_switch_block top_20" style="flex-direction: column; align-items: flex-start;">
                <div class="optimizer-presets" id="optimizer-presets">
                    <button class="optimizer-preset-btn ${CONFIG.filters.preset === 'perfect' ? 'active' : ''}" data-preset="perfect">${ICONS.sparkles} Perfect</button>
                    <button class="optimizer-preset-btn ${CONFIG.filters.preset === 'default' ? 'active' : ''}" data-preset="default">${ICONS.target} ${t('presetDefault')}</button>
                    <button class="optimizer-preset-btn ${CONFIG.filters.preset === 'cinematic' ? 'active' : ''}" data-preset="cinematic">${ICONS.film} ${t('presetCinematic')}</button>
                    <button class="optimizer-preset-btn ${CONFIG.filters.preset === 'game' ? 'active' : ''}" data-preset="game">${ICONS.crosshair} ${t('presetGame')}</button>
                    <button class="optimizer-preset-btn ${CONFIG.filters.preset === 'comfort' ? 'active' : ''}" data-preset="comfort">${ICONS.eye} ${t('presetComfort')}</button>
                </div>
            </div>

            <!-- Toggle filtres avancés (collapsed par défaut) -->
            <div class="menu_switch_block top_20">
                <div class="menu_title_group">
                    <p>${t('advancedFilters')}</p>
                </div>
                <label class="switch">
                    <input type="checkbox" id="optimizer-filters-toggle" ${CONFIG.filters.enabled ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            </div>

            <!-- Filtres détaillés - cachés par défaut, affichés si toggle activé -->
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
                    ${ICONS.zap} <span style="margin-left: 4px;">${t('performanceMode') || 'Performance'}</span>
                </div>
                <label class="switch">
                    <input type="checkbox" id="optimizer-performance-mode" ${CONFIG.display?.performanceMode ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            </div>

            <!-- Reset -->
            <div class="menu_switch_block top_20" style="margin-top: 15px;">
                <button class="optimizer-btn secondary" id="optimizer-reset" style="width: 100%;">
                    ${ICONS.refresh} ${t('reset')}
                </button>
            </div>
        `;

        // Insérer au bon endroit dans le menu
        if (insertAfter && insertAfter.parentNode) {
            // Insérer après le dernier menu_block (section Streaming)
            insertAfter.parentNode.insertBefore(section, insertAfter.nextSibling);
            console.log('[Optimizer+] UI insérée après la section Streaming');
        } else {
            // Fallback: ajouter à la fin du menu
            menuElement.appendChild(section);
            console.log('[Optimizer+] UI ajoutée à la fin du menu');
        }

        // Attacher les événements
        attachUIEvents();

        // Initialiser le style des sliders (comme Boosteroid)
        initSliderStyles();

        console.log('[Optimizer+] Interface injectée avec succès');
    }

    // Fonction pour créer un slider personnalisé visuellement
    function createCustomSlider(inputElement) {
        // Créer le wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'optimizer-slider';

        // Créer les éléments visuels
        const track = document.createElement('div');
        track.className = 'optimizer-slider-track';

        const fill = document.createElement('div');
        fill.className = 'optimizer-slider-fill';

        const thumb = document.createElement('div');
        thumb.className = 'optimizer-slider-thumb';

        wrapper.appendChild(track);
        wrapper.appendChild(fill);
        wrapper.appendChild(thumb);

        // Insérer le wrapper avant l'input
        inputElement.parentNode.insertBefore(wrapper, inputElement);
        // Déplacer l'input dans le wrapper
        wrapper.appendChild(inputElement);

        // Fonction de mise à jour visuelle
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

        // Écouter les changements
        inputElement.addEventListener('input', updateVisual);

        return wrapper;
    }

    function initSliderStyles() {
        // Sélectionner tous les sliders de notre section
        const sliders = document.querySelectorAll('#optimizer-section input[type="range"]');

        sliders.forEach(slider => {
            // Vérifier si déjà wrappé
            if (!slider.parentElement.classList.contains('optimizer-slider')) {
                createCustomSlider(slider);
            }
        });
    }

    function attachUIEvents() {
        // Fonction de sauvegarde automatique (appelée à chaque changement)
        const autoSave = () => {
            Storage.set('config', CONFIG);
        };

        // Résolution
        const resSelect = document.getElementById('optimizer-res-select');
        if (resSelect) {
            resSelect.addEventListener('change', (e) => {
                const value = e.target.value;
                let width, height;
                let isAutoMode = false;

                if (value === 'auto') {
                    // Mode auto - utilise la résolution native
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
                // v3.6.2: Pixel ratio intelligent selon résolution
                CONFIG.resolution.pixelRatio = width >= 3840 ? 2 : (width >= 2560 ? 1.5 : 1);

                // Mettre à jour l'affichage
                const resDisplay = document.getElementById('optimizer-resolution');
                if (resDisplay) {
                    resDisplay.textContent = isAutoMode ? `Auto: ${width}x${height}` : `${width}x${height}`;
                }

                // Réappliquer le hook de résolution
                hookResolution();

                // Notification
                const aspectRatio = (width / height).toFixed(2);
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

        // v3.6.1 Filtres avancés toggle - Affiche/cache les détails
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
                    // Mode Performance: désactiver les filtres lourds
                    CONFIG.filters.clarity.enabled = false;
                    CONFIG.filters.denoise.enabled = false;
                    CONFIG.filters.deband.enabled = false;
                    CONFIG.performance.gpuAcceleration = false;

                    // Réappliquer les filtres légers uniquement
                    videoEnhancer.updateFilterString();
                    videoEnhancer.applyFiltersToAllVideos();

                    showNotification('Performance Mode ON - FPS maximized');
                } else {
                    // Réactiver l'accélération GPU
                    CONFIG.performance.gpuAcceleration = true;
                    showNotification('Normal mode restored');
                }

                autoSave();
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

        // Reset button - Réinitialisation instantanée
        const resetBtn = document.getElementById('optimizer-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                // Réinitialiser le CONFIG avec les valeurs par défaut
                CONFIG.resolution = { ...DEFAULT_CONFIG.resolution };
                CONFIG.enhancer = { ...DEFAULT_CONFIG.enhancer };
                CONFIG.filters = JSON.parse(JSON.stringify(DEFAULT_CONFIG.filters));
                CONFIG.language = DEFAULT_CONFIG.language;

                // Sauvegarder le nouveau config
                localStorage.removeItem('optimizer_config');
                Storage.set('config', CONFIG);

                // Mettre à jour VideoEnhancer immédiatement
                videoEnhancer.enabled = CONFIG.enhancer.enabled;
                videoEnhancer.filtersEnabled = CONFIG.filters.enabled;
                videoEnhancer.updateFilterString();
                videoEnhancer.updateSVGFilters();
                videoEnhancer.applyFiltersToAllVideos();

                // Mettre à jour l'interface
                updateAllUIValues();

                showNotification('[OK] ' + t('settingsReset').replace('[<<] ', ''));
                console.log('[Optimizer+] Reset effectué - valeurs par défaut restaurées');
            });
        }

        // Sélecteur de langue
        const langSelect = document.getElementById('optimizer-lang-select');
        if (langSelect) {
            langSelect.addEventListener('change', (e) => {
                const newLang = e.target.value;
                CONFIG.language = newLang;

                // Mettre à jour la langue courante
                if (newLang === 'auto') {
                    const browserLang = (navigator.language || navigator.userLanguage || 'en').substring(0, 2).toLowerCase();
                    currentLang = I18N.translations[browserLang] ? browserLang : 'en';
                } else {
                    currentLang = newLang;
                }

                autoSave();
                showNotification(`${t('language')}: ${e.target.options[e.target.selectedIndex].text}`);

                // Recréer l'UI pour appliquer la nouvelle langue
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

        // === FILTRES AVANCÉS ===

        // Présets
        const presetBtns = document.querySelectorAll('.optimizer-preset-btn');
        presetBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const preset = e.target.dataset.preset;
                videoEnhancer.applyPreset(preset);

                // Update UI
                presetBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');

                // Mettre à jour les sliders de l'interface
                updateFiltersUI();

                autoSave();
                showNotification(t('presetApplied', { name: FILTER_PRESETS[preset].name }));
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

    // Fonction pour mettre à jour TOUTE l'interface avec les valeurs actuelles du CONFIG
    function updateAllUIValues() {
        // Résolution
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

        // Présets - mettre à jour le bouton actif
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

        // Mettre à jour tous les sliders et toggles des filtres
        updateFiltersUI();
    }

    // Fonction pour mettre à jour l'UI des filtres
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

        // Filtres avancés
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

        // Mettre à jour les toggles
        ['usm', 'cas', 'clarity', 'denoise', 'vibrance'].forEach(filterName => {
            const checkbox = document.querySelector(`.optimizer-filter-checkbox[data-filter="${filterName}"]`);
            if (checkbox) {
                checkbox.checked = filters[filterName].enabled;
            }
        });

        // Mettre à jour le style visuel des sliders
        const sliders = document.querySelectorAll('#optimizer-section input[type="range"]');
        sliders.forEach(slider => updateSliderStyle(slider));
    }

    // Fonction pour passer en mode custom quand on modifie manuellement
    function setPresetToCustom() {
        CONFIG.filters.preset = 'custom';

        // Mettre à jour les boutons de préset
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

        // Vérifier les capacités DRM
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
    // VIDEO OBSERVER - Détection et amélioration des éléments vidéo
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

        // Traiter les vidéos existantes
        document.querySelectorAll('video').forEach(handleVideoElement);
    }

    function handleVideoElement(video) {
        console.log('[Optimizer+] Vidéo détectée');

        // Appliquer l'enhancer
        videoEnhancer.applyToVideo(video);

        // Optimisations vidéo
        video.setAttribute('playsinline', '');

        // Note: Le monitoring de frames a été désactivé pour performance
        // Utiliser le mode Performance dans les paramètres si nécessaire
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
    // Permet de configurer la résolution avant de lancer un jeu
    // ===============================================================================

    function createDashboardWidget() {
        // Vérifier qu'on est bien sur le dashboard principal
        if (document.getElementById('optimizer-dashboard-widget')) {
            return; // Déjà créé
        }

        // Attendre que le DOM soit prêt et que le bouton chatbot soit chargé
        const waitForChatbot = () => {
            const chatbot = document.getElementById('botbutton');
            if (chatbot) {
                injectWidget();
            } else {
                // Réessayer après un délai
                setTimeout(waitForChatbot, 500);
            }
        };

        // Créer le widget immédiatement, positionnement relatif au chatbot si présent
        const injectWidget = () => {
            const widget = document.createElement('div');
            widget.id = 'optimizer-dashboard-widget';
            // v3.7.2: Style inline pour éviter flash blanc au chargement
            widget.style.cssText = 'position:fixed;right:20px;bottom:180px;z-index:99998;background:transparent;opacity:0;visibility:hidden;pointer-events:none;transition:opacity 0.25s ease 0.05s;';

            // Utiliser le Smart Resolution Detector pour générer les options
            const screenAnalysis = SmartResolutionDetector.getScreenAnalysis();
            const resolutionOptions = SmartResolutionDetector.generateResolutionOptionsHTML(
                CONFIG.resolution.width,
                CONFIG.resolution.height,
                CONFIG.resolution.isAuto // v3.7.2: Passer le mode auto
            );

            // Déterminer le status actuel (auto ou manuel)
            const currentResText = CONFIG.resolution.isAuto
                ? `Auto: ${CONFIG.resolution.width}x${CONFIG.resolution.height}`
                : `${CONFIG.resolution.width}x${CONFIG.resolution.height}`;

            widget.innerHTML = `
                <!-- Bouton principal -->
                <button type="button" class="opt-widget-btn" id="opt-widget-toggle" title="Optimizer Plus - Settings" style="background:linear-gradient(135deg,#00a3ff 0%,#0066cc 100%);border:none;width:56px;height:56px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:28px;height:28px;color:white;">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                    </svg>
                    <div class="opt-status-dot" title="Active: ${currentResText}" style="position:absolute;top:2px;right:2px;width:14px;height:14px;border-radius:50%;background:#22c55e;border:2px solid #fff;"></div>
                </button>

                <!-- Panel déroulant -->
                <div class="opt-widget-panel" id="opt-widget-panel" style="position:absolute;bottom:70px;right:0;width:280px;background:rgba(19,23,33,0.98);color:#fff;border:1px solid rgba(0,163,255,0.3);border-radius:12px;padding:16px;opacity:0;visibility:hidden;transform:translateY(10px) scale(0.95);transition:all 0.25s cubic-bezier(0.4,0,0.2,1);">
                    <div class="opt-widget-header">
                        <span class="opt-widget-title">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;vertical-align:middle;margin-right:4px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                            Optimizer Plus
                            <span class="opt-widget-version">v3.7.2</span>
                        </span>
                    </div>

                    <!-- Info écran détecté -->
                    <div class="opt-widget-screen-info">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                        <span class="opt-screen-label">Screen:</span>
                        <span class="opt-screen-value">${screenAnalysis.screen.width}x${screenAnalysis.screen.height}</span>
                        <span class="opt-screen-ratio">${screenAnalysis.screen.ratioType} ${screenAnalysis.screen.ratioName}</span>
                    </div>

                    <!-- Status actuel -->
                    <div class="opt-widget-status">
                        <div class="opt-widget-status-dot"></div>
                        <span class="opt-widget-status-text" id="opt-widget-status-text">
                            ${currentResText}
                        </span>
                    </div>

                    <!-- Sélecteur de résolution -->
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
                        <span class="opt-widget-credit" style="font-size:10px;">by Derfog - ${ENV_PROFILE.isHighEnd ? ' High-End' : (ENV_PROFILE.isMidRange ? ' Mid-Range' : ' Low-End')}</span>
                    </div>
                </div>
            `;

            document.body.appendChild(widget);

            // v3.7.5: Empêcher le flash blanc en affichant le widget seulement une fois stylé
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

            console.log('[Optimizer+] [OK] Dashboard widget injecté dans le DOM');

            // Attacher les événements avec plusieurs tentatives pour plus de robustesse
            const attachWithRetry = (attempt = 1) => {
                const btn = document.getElementById('opt-widget-toggle');
                if (btn) {
                    attachWidgetEvents();
                    console.log('[Optimizer+] [OK] Événements attachés (tentative ' + attempt + ')');
                } else if (attempt < 5) {
                    console.log('[Optimizer+] Bouton non trouvé, nouvelle tentative dans 100ms...');
                    setTimeout(() => attachWithRetry(attempt + 1), 100);
                } else {
                    console.error('[Optimizer+] [X] Impossible de trouver le bouton après 5 tentatives');
                }
            };

            // Commencer après un délai
            setTimeout(() => attachWithRetry(), 50);

            console.log('[Optimizer+] [OK] Dashboard widget créé');
        };

        // Démarrer après un court délai pour laisser la page charger
        setTimeout(() => {
            injectWidget();
        }, 800);
    }

    function attachWidgetEvents() {
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

        // Utiliser la délégation d'événements sur le widget conteneur
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
                        Appliqué!
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
                console.log('[Optimizer+] [OK] Configuration sauvegardée');
                return;
            }
        });

        // Changement de résolution
        if (resSelect) {
            resSelect.addEventListener('change', (e) => {
                const value = e.target.value;
                let width, height, displayText;
                let isAutoMode = false;

                if (value === 'auto') {
                    isAutoMode = true;
                    // Mode auto-détection - utilise résolution NATIVE de l'écran
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
                    // Résolution manuelle
                    [width, height] = value.split('x').map(Number);
                    displayText = `${width}x${height}`;
                }

                CONFIG.resolution.width = width;
                CONFIG.resolution.height = height;
                CONFIG.resolution.pixelRatio = width >= 3840 ? 2 : (width >= 2560 ? 1.5 : 1);
                CONFIG.resolution.isAuto = isAutoMode; // v3.7.2: Marquer le mode auto

                // Mettre à jour le status
                if (statusText) {
                    statusText.textContent = displayText;
                }

                // Mettre à jour le tooltip du status dot
                const statusDot = document.querySelector('#optimizer-dashboard-widget .opt-status-dot');
                if (statusDot) {
                    statusDot.title = `Actif: ${displayText}`;
                }

                // Mettre à jour l'info écran si auto
                const screenValue = document.querySelector('.opt-screen-value');
                if (screenValue && value === 'auto') {
                    screenValue.classList.add('auto-active');
                } else if (screenValue) {
                    screenValue.classList.remove('auto-active');
                }

                // Sauvegarder
                Storage.set('config', CONFIG);

                // Réappliquer le hook
                hookResolution();

                console.log(`[Optimizer+] Résolution changée: ${displayText}`);
            });
        }

        // Fermer le panel en cliquant ailleurs
        document.addEventListener('click', (e) => {
            if (panel && !widget.contains(e.target)) {
                panel.classList.remove('open');
                panel.style.opacity = '0';
                panel.style.visibility = 'hidden';
                panel.style.transform = 'translateY(10px) scale(0.95)';
            }
        });

        // Fermer avec Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && panel) {
                panel.classList.remove('open');
                panel.style.opacity = '0';
                panel.style.visibility = 'hidden';
                panel.style.transform = 'translateY(10px) scale(0.95)';
            }
        });

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
        console.log('[Optimizer+] Bitrate:', `${Math.round(CONFIG.streaming.maxBitrate/1000000)}Mbps`);
        console.log('[Optimizer+] Low Latency:', CONFIG.performance.lowLatencyMode ? 'ON' : 'OFF');
        console.log('[Optimizer+] =======================================');

        // IMPORTANT: Les hooks techniques s'appliquent PARTOUT (même dashboard)
        // car ils préparent le navigateur pour le streaming
        hookResolution();
        hookCodecs();
        hookBitrate();
        hookDRM();
        hookPerformance();

        // L'UI et les observers ne s'activent QUE si on n'est pas sur le dashboard
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', onDOMReady);
        } else {
            onDOMReady();
        }
    }

    function onDOMReady() {
        // Injecter les styles (toujours, ils seront utilisés si on lance un jeu)
        ensureOptimizerTypography();

        // Enregistrer les commandes menu Tampermonkey (toujours disponibles)
        registerMenuCommands();

        // Déterminer le type de page
        const onStreaming = isStreamingPage();
        const onDashboard = isDashboardPage();

        console.log('[Optimizer+] Type de page - Streaming:', onStreaming, '| Dashboard:', onDashboard);

        // Si on est sur le dashboard ET pas sur streaming, afficher le widget flottant
        if (onDashboard && !onStreaming) {
            console.log('[Optimizer+] Dashboard détecté - Widget flottant activé');
            console.log('[Optimizer+] L\'UI complète s\'activera automatiquement quand vous lancerez un jeu');
            createDashboardWidget();
            return;
        }

        // Créer les filtres SVG pour le sharpening
        videoEnhancer.createSVGFilters();

        // v3.5: Initialiser les filtres sans flickering
        ZeroFlickerBootstrap.initializeFilters();

        // Injecter le système d'UI intelligent
        injectUI();

        // Observer les vidéos pour appliquer les filtres
        setupVideoObserver();

        // v3.6.9 Log avec info écran
        const screenInfo = UltrawideSupport.getScreenInfo();
        console.log('[Optimizer+] v3.6.9 Smart Resolution [OK]');
        console.log(`[Optimizer+] Screen: ${screenInfo.width}x${screenInfo.height} (${screenInfo.type})`);
        // Raccourci ultrawide supprimé - utiliser le sélecteur de résolution

        // v3.6 Auto-détection ratio pour logging seulement
        if (CONFIG.display?.autoDetect !== false) {
            const ratio = parseFloat(screenInfo.ratio);
            if (ratio >= 2.0) {
                console.log('[Optimizer+] Écran large détecté - résolutions ultrawide disponibles');
            }
        }
    }

    // Démarrer
    init();

})();
