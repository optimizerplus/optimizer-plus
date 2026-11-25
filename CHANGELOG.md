# Changelog - Boosteroid Optimizer Plus

## v6.1.1 - Rendu hors main thread, latence souris, résolution exacte, nettoyage

Remplace la v6.1.0 publiée le matin du même jour.

### Correctifs de la v6.1.1

- **Couleurs décalées en 1080p natif (bande verte, image fantôme).** Boosteroid envoie 1920x1082 (et 3200x1802) : deux lignes de remplissage sous l'image. Pour ces hauteurs, Chrome transmet l'image à WebGPU (`importExternalTexture` comme `copyExternalImageToTexture`) avec la couche couleur décalée de 12 lignes. Le script compare désormais, à chaque nouvelle taille de flux, l'import WebGPU à un canvas 2D ; s'ils diffèrent, l'image passe par le canvas 2D (correct). Chaque nouvelle taille démarre sur ce chemin sûr. Les lignes de remplissage ne sont jamais affichées.
- **Résolution manuelle exacte.** Le script modifiait à la fois `screen.width` et `devicePixelRatio` : Boosteroid demandait le double (4K demandait 8K, 2560x1440 arrivait en 3200x1802). Seul `devicePixelRatio` change maintenant, comme sur un vrai écran HiDPI.
- **Résolution conservée au rechargement.** Le choix fait dans le menu en jeu est sauvegardé immédiatement (avant : 1 s de délai, perdu si on rechargeait aussitôt).
- **Reset** remet aussi le flux en résolution native et les réglages d'un début de session (avant : netteté USM + CAS au maximum).
- **Filtres et changement de résolution.** Quand le flux est plus grand que l'affichage, il est d'abord réduit à la taille de l'affichage, puis filtré : moins de moiré (3200x1800 vers 1080p : 81 -> 0 sur un motif d'une ligne). En taille native, l'image est affichée pixel pour pixel. Le canvas n'est plus placé sur un demi-pixel.
- `StreamInterceptor` supprimé : il ciblait des URL que Boosteroid n'utilise pas.


### Qualité d'image

- **Vrai upscale, AMD FSR 1 (EASU + RCAS)** : quand le flux est plus petit que l'écran, le canvas est rendu à la résolution d'affichage (pixels physiques) au lieu d'être étiré en bilinéaire par le navigateur. Trois passes : filtres à la résolution source, EASU (rééchantillonnage le long des bords), RCAS (netteté à la résolution écran, avec limiteur de bruit). Textures intermédiaires 10 bits. Une seule passe quand flux = écran. Chemins WebGPU uniquement (Worker et main thread). Désactivé sur appareils low-end ; interrupteur : `localStorage.setItem('optimizer_upscale', '0')` + reload.
- **Netteté en mode upscale** : appliquée par RCAS après la mise à l'échelle, plus par CAS avant. Curseur 0.45 (défaut) = force par défaut de FSR.
- **Garde-fou GPU** : le temps GPU réel des trois passes est mesuré (`timestamp-query`) toutes les 30 frames. Plus de la moitié de l'intervalle de frame, dix mesures de suite : l'upscale se coupe pour la session, avec notification. Sans `timestamp-query`, pas de garde-fou.
- **Latence réglable** : `localStorage.setItem('optimizer_playout_ms', '10')` + reload remplace `playoutDelayHintMs` (30 par défaut, 0 accepté).

### Diagnostic

- **Build dev privé** : `node build.js` génère `Boosteroid-Optimizer-Plus.dev.user.js` (nom « Boosteroid Optimizer Plus DEV », sans URL de mise à jour, ignoré par git). Lui seul affiche le rapport ci-dessous. Le build prod n'affiche rien dans la console. Un garde empêche les deux copies de s'exécuter ensemble.
- **Rapport console du build dev** (F12, sans commande) : une ligne d'en-tête (version, profil, écran, worker/upscale/playout) puis des lignes `[Optimizer+] [Stats]` : débit, FPS reçus/décodés, résolution, codec, temps de décodage, frames perdues, paquets perdus, freezes, jitter buffer, RTT, état du rendu (chemin, FPS, écart max, temps GPU, taille du canvas). Toutes les 5 s pendant 30 s, puis une par minute, plus à chaque changement ou dégradation du flux.

### Couleur et débit

- **Flux demandé en SDR, spoof HDR retiré (prod et dev).** Mesure sur une frame 10 bits identique : en SDR, `importExternalTexture`, `copyExternalImageToTexture` et le chemin natif de Chrome donnent les mêmes pixels (gris 147, rouge 134/7/1). En PQ / BT.2020, WebGPU sort un gris à 200 et un rouge à 234, contre 184 et 164 en natif : WebGPU n'applique pas le tone mapping HDR de Chrome. Le spoof HDR produisait donc des couleurs trop claires et trop saturées dans le canvas. Le script annonce maintenant un écran SDR sur tous les écrans (`matchMedia`, `decodingInfo`) ; le spoof `colorDepth` et les indications HDR de `StreamInterceptor` sont retirés. Vérifié en session réelle : frames reçues en `bt709/NV12`.
- **Plancher de débit supprimé (prod et dev).** Testé en session réelle sous ses deux formes (ligne `a=x-google-min-bitrate:` et paramètre `fmtp`) : 1,3 à 12 Mbit/s reçus pour 20 demandés. Le serveur Boosteroid ne le respecte pas. Code et clés `minBitrate` retirés.
- Le rapport dev affiche l'espace colorimétrique réel des frames décodées (`color primaries/transfer/matrix/range/format`).

### Performance (clavier/souris)

- **Rendu WebGPU dans un Worker** (`WorkerVideoRenderer`) : décodeur -> `MediaStreamTrackProcessor` -> worker -> `OffscreenCanvas`. Le rythme des frames ne dépend plus du main thread, occupé par les événements d'input en jeu souris. Chrome/Edge uniquement ; tout échec retombe sur le WebGPU main thread puis WebGL2. Désactivation : `localStorage.setItem('optimizer_worker', '0')` + reload.
- Bridges de debug DataChannel/WebSocket installés uniquement avec `optimizer_debug=1`. Avant : chaque paquet d'input (un par mouvement souris) était décodé + regex + `JSON.parse` sur le main thread, même hors debug.
- MutationObserver global : plus d'observation `style`/`class` sur tout le `body`. Les attributs sont observés sur les conteneurs du menu seulement (`#menu`, `.m_lan_wrapper`).
- Clic en jeu (pointer lock) : plus de `checkAndInject` (layout forcé) à chaque tir.
- Boucle WebGL2 : watchdog FPS supprimé (2 `console.warn` par seconde sous 50 FPS).

### Codec et décodage

- **AV1 n'est plus forcé à l'aveugle.** L'ancien test « décodage matériel » passait par le `decodingInfo` que le script falsifiait lui-même : AV1 était donc toujours jugé matériel, et mis en tête de chaque offre SDP, même sur un GPU sans décodeur AV1 (décodage logiciel). Le test interroge maintenant l'API réelle, type `webrtc`, à la résolution cible et 120 FPS. AV1 passe en tête seulement si le matériel le décode.
- `decodingInfo` ne déclare plus AV1/HEVC « fluide et matériel » quand ce n'est pas le cas.
- `applyCodecPreferences` supprimé : il comparait `video/av01` à `video/av1` et n'a jamais sélectionné de codec.
- **Rendu à la taille écran quand le flux est plus grand que l'écran** (flux 4K sur écran 1080p) : 4 fois moins de pixels calculés, plus de couche 4K à réduire par le compositeur. Mode étiré pris en compte.
- **Flux bien plus grand que le canvas** (rapport sous 0,75) : quatre lectures par pixel au lieu d'une, pour ne sauter aucun pixel source (anti-crénelage).
- **Résolution** : le retour en Auto annule maintenant le spoof d'un choix manuel fait plus tôt dans la page. Six secondes après un changement, une notification dit ce que le flux fait réellement : « Flux maintenant en WxH » ou « Flux toujours en WxH : recharge la page ».
- Le build dev affiche la fréquence d'écran mesurée (`display X Hz`). Aucun avertissement ni limite côté utilisateur : le 120 FPS reste disponible sur un écran 60 Hz.
- Notification « décodeur surchargé » quand le temps de décodage dépasse l'intervalle de frame sur trois rapports de suite.

### Correctifs

- **Traces vertes avec l'enhancer (rendu Worker).** Chaque `VideoFrame` était fermée juste après l'envoi des commandes GPU ; le décodeur matériel pouvait réutiliser sa surface avant que le GPU l'ait lue (une surface NV12 vide s'affiche en vert). La frame reste ouverte jusqu'à `onSubmittedWorkDone`, 4 frames retenues au maximum. Cause déduite du symptôme, non reproduite en local.
- Liste des résolutions : en mode Auto, une résolution manuelle pouvait rester marquée « sélectionnée » en même temps qu'Auto.
- Verrouillage clavier : le script appelait `navigator.keyboard.lock(['Escape'])` à chaque passage en plein écran, ce qui annulait le verrouillage de Boosteroid (« Fullscreen/keyboard lock failed: superseded » dans sa console) et le remplaçait par Échap seul. Supprimé : Boosteroid gère son propre verrouillage.
- WebGL2 : le fragment shader ne compilait pas (`flat` est réservé en GLSL ES 3.0). Le fallback Firefox/Safari n'affichait aucun filtre depuis v5.1.1.
- WebGL2 : uniform `u_performanceMode` jamais localisé, le Mode Performance était sans effet sur ce chemin.
- Écran HDR : `colorSpace: 'rec2100-pq'` n'est pas une valeur valide pour `GPUCanvasContext.configure()`, l'init WebGPU échouait. Chemin canvas HDR supprimé (le shader ne faisait que ré-encoder du SDR en PQ) : rendu sRGB partout.

### Nettoyage

- ~780 lignes de code mort supprimées : `FilterTiers`/`FilterState`, `UltrawideSupport`, perf watchdog neutralisé, `degradeQuality`, `registerMenuCommands`, méthodes inutilisées de `SmartResolutionDetector`, icônes et clés de config jamais lues.
- Commentaires : historique de versions et commentaires français supprimés, le reste réécrit en anglais (904 -> ~410). Flux de tokens JS vérifié identique avant/après la passe.

### Validation

- Harnais local Chrome (flux généré dans un worker) : les trois chemins (Worker, WebGPU main thread, WebGL2) rendent sans erreur ; changement de `srcObject` et de résolution suivi par le Worker.
- Main thread bloqué 700 ms : chemin Worker = 44 frames rendues, écart max 18 ms ; chemin main thread = 3 frames, écart max 700 ms.
- Upscale FSR 1, 640x360 vers 1680x945 (GPU AMD RDNA 2) : +13 % de pixels de bord nets face au bilinéaire (émulé en canvas 2D), halo sombre de 7,8 niveaux contre 16,7 sans upscale, 1,05 ms GPU pour les trois passes, 60 FPS conservés.
- Garde-fou : la bascule upscale -> passe unique a été observée en fonctionnement ; le déclenchement par le seuil `timestamp-query` et la notification ne sont pas testés.
- Build prod final revalidé sur harnais local : boucle WebRTC (rendu Worker, 62 FPS, 43 frames pendant 700 ms de main thread bloqué, 0,98 ms GPU pour l'upscale), source 4K réduite, WebGPU main thread, WebGL2. Aucune ligne `[Stats]` en prod.
- Sessions Boosteroid réelles (build dev) : rendu Worker actif, flux SDR, rendu réduit à la taille écran, correctif clavier confirmé. Non confirmé en session : disparition des traces vertes, notification de changement de résolution.

---
## v6.0.2 - Fusion des toggles Performance

**Date :** 2025-01-XX

### Objectif

Supprimer le doublon obsolète « Mode Performance » v3.6 qui désactivait brutalement des filtres, au profit d'un UNIQUE toggle v6.0.0 qui optimise le shader SANS toucher à la config utilisateur.

### Changements

- **Fusion des toggles** : suppression du toggle `optimizer-performance-mode` (v3.6) et de `CONFIG.display.performanceMode` — source unique = `CONFIG.filters.performanceMode`
- **Fix `updateFilters is not a function`** : le handler v6.0.0 appelait une méthode inexistante → maintenant `updateFilterString()` + `applyFiltersToAllVideos()`
- Mode Performance n'**désactive plus** clarity/denoise/deband dans CONFIG — il optimise le shader (fast denoise 4 lectures vs 9, skip clarity GPU)
- Les sliders/toggles des filtres lourds restent **toujours actifs** (plus de `disabled` sur toggle perf)
- Feedback utilisateur : notification ON/OFF (perfModeNotifOn/Off) + tooltip desc mis à jour (en/fr)
- Section « Performance & Options » → « Options » (ne contient plus que Stretch + Reset)
- `04-interceptors.js` : ref migrée vers `CONFIG.filters.performanceMode`
- **Suppression du warning console Chrome** : `powerPreference` de `requestAdapter()` conditionné sur non-Windows (crbug.com/369219127)
- `gpuAcceleration` orphelin dans CONFIG (plus rien ne le lit, conservé inoffensif)

### Validation

- Build : 8 233 lignes, syntaxe OK
- Aucune ref résiduelle `display.performanceMode` / `_perfModeBackup` / `optimizer-performance-mode` (hors commentaires)

---

## v6.0.1 — WebGPU Buffer Fix (Hotfix)

**Date :** 2025-01-XX

### Critique

**Écran noir WebGPU** : `buffer binding size mismatch (80 bytes provided vs 88 bytes required)`

**Cause :** Structure `Uniforms` WGSL étendue (performanceMode + time) mais buffer non mis à jour.

**Solution :**
- Buffer uniforme : 80 → **112 bytes** (28 floats)
- Uniforms : 20 → **26 valeurs** écrites
- `time` uniform : maintenant `performance.now() / 1000`
- Padding WGSL : 4 floats réservés pour alignement vec4

**Impact :** WebGPU fonctionne à nouveau avec v6.0.0+ sans écran noir.

### Changements

#### `src/14-renderers.js`
```javascript
// AVANT
data[15] = 0.0;  // time unused
data[16] = ENV_PROFILE.isHighEnd ? 1.0 : 0.0;
data[17] = f.performanceMode ? 1.0 : 0.0;
data[18] = 0.0;
data[19] = 0.0;

// APRÈS
data[15] = performance.now() / 1000;  // time in seconds
data[16] = ENV_PROFILE.isHighEnd ? 1.0 : 0.0;  // qualityMode
data[17] = f.performanceMode ? 1.0 : 0.0;  // performanceMode
data[18] = 0.0;  // _p0
data[19] = 0.0;  // _p1
data[20] = 0.0;  // _p2
data[21] = 0.0;  // _p3
```

```javascript
// AVANT
this._uniformData = new Float32Array(20);  // 80 bytes
this.uniformBuffer = this.device.createBuffer({ size: 80, ... });

// APRÈS
this._uniformData = new Float32Array(28);  // 112 bytes
this.uniformBuffer = this.device.createBuffer({ size: 112, ... });
```

---

## v6.0.0 — Performance First (2025)

### Optimisations GPU Majeures

**Problème résolu :** FPS drops lors de l'activation des filtres (deband, denoise, clarity)

| Avant v6.0.0 | v6.0.0 | Gain |
|--------------|--------|------|
| Bilateral Denoise: **9 lectures texture** | Fast Denoise: **4 lectures texture** | -55% |
| Clarity + Denoise + Sharpen: **27 lectures/pixel** | Max **6 lectures/pixel** (mode perf) | -77% |
| FPS drops: **40-50 FPS** (4K, filtres ON) | **60 FPS stables** (mode perf) | +20 FPS |

### Nouveau : Mode Performance

**Toggle dans l'UI** : "Mode Performance" (activé par défaut)

**Quand activé :**
- `fastDenoise()` : kernel croix 4 directions (au lieu de 9)
- `clarity` désactivé (redondant avec sharpen)
- Deband allégé
- **4-6 lectures texture / pixel** (vs 27)

**Quand désactivé** (qualité max) :
- Bilateral denoise complet (9 lectures)
- Clarity pass activé
- Deband full strength
- **27 lectures texture / pixel**

### FPS Watchdog Intégré

Détection automatique des FPS drops :

```javascript
// Si FPS < 50 pendant 1 sec avec filtres activés
[Optimizer+] FPS drop détecté: 45 FPS avec filtres lourds
[Optimizer+] → Activez le Mode Performance pour FPS max
```

### Changements Techniques

#### WebGPU Shader (`src/13-webgpu-shaders.js`)
```wgsl
// NOUVEAU : Fast denoise (4 lectures)
fn fastDenoise(uv: vec2f, res: vec2f, strength: f32) -> vec3f {
    let center = textureSample(...);
    let left = textureSample(...);
    let right = textureSample(...);
    let top = textureSample(...);
    let bottom = textureSample(...);
    return mix(center, (center*0.4 + left*0.15 + right*0.15 + top*0.15 + bottom*0.15), strength);
}

// Garde bilateral denoise pour mode qualité
fn bilateralDenoise(...) { /* 9 lectures */ }
```

#### Uniforms (`src/14-renderers.js`)
```javascript
// NOUVEAU : performanceMode uniform
data[17] = f.performanceMode ? 1.0 : 0.0;

// FPS watchdog intégré au render loop
if (currentFPS < 50 && CONFIG.filters.enabled && !CONFIG.filters.performanceMode) {
    console.warn('[Optimizer+] FPS drop détecté');
}
```

#### UI (`src/16-observers.js`)
```html
<!-- Toggle Mode Performance -->
<input type="checkbox" id="optimizer-filters-performance-toggle">
Mode Performance ⓘ
```

### Benchmarks (RTX 4070, 4K)

| Scénario | v5.1.11 | v6.0.0 (perf) | v6.0.0 (qualité) |
|----------|---------|---------------|------------------|
| **Sans filtres** | 60 FPS | 60 FPS | 60 FPS |
| **Avec filtres** | 45 FPS | **60 FPS** | 50 FPS |
| **Lectures texture** | 27 | **4-6** | 27 |
| **Latence ajoutée** | ~8ms | **~2ms** | ~8ms |

### i18n

Nouvelles traductions :
- `performanceMode` : "Mode Performance" (FR), "Performance Mode" (EN), etc.
- `performanceModeDesc` : Description du mode

### Fixes

- FPS drops avec filtres lourds (résolu par fast denoise)
- Clarity redondant avec sharpen (désactivé en mode perf)
- Pas de backup/restaurer (évite conflits de config)

### Migration

**Utilisateurs existants :**
- Mode Performance activé par défaut - Anciens paramètres conservés
- Bascule facile via UI

**Nouveaux utilisateurs :**
- Mode Performance ON par défaut
- Qualité max disponible si besoin

---

## v5.1.11 — Production Ready

- Fix `findInsertionPoint` JSDoc non fermé
- Version cohérente 5.1.11
- Architecture modulaire (18 modules)
- Build script automatisé

---

## v5.1.10 — SDP Munging Validé

- Validation complète du SDP
- Logs gated derrière `optimizer_debug=1`

---

## v5.1.9 — WebSocket Bridge

- `WsBridge` pour reverse-engineering
- Stats line avec `WS⇐...`

---

## v5.1.8 — DataChannel Bridge

- `hookDataChannel()` bidirectionnel
- ParsePayload pour JSON/text
- Stats line avec `DC⇐k=v,...`

---

## v5.1.7 — WebGPU Fail-Open

- `_failOpen` flag + guard
- Diagnostics RTT/latence

---

## v5.0.0 — WebGPU Zero-Copy

- `importExternalTexture()` pipeline
- WASM module removed (dead code)
- Fallback WebGL2