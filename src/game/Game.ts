/**
 * Game: owns the renderer, scene, camera, lights, fixed-step loop and the
 * state machine. This is the only module allowed to import other workstreams'
 * concrete classes; everything is typed against the core interfaces.
 */
import * as THREE from 'three';
import type {
  CharacterDef,
  Difficulty,
  GameState,
  IAIDriver,
  IAudioEngine,
  IItemManager,
  IKart,
  InputState,
  IParticleSystem,
  IPostFX,
  ITrack,
  MusicTrack,
  RaceSettings,
  TrackDefinition,
} from '../core/types';
import { events } from '../core/events';
import { COUNTDOWN_STEP_SECONDS, DEFAULT_LAPS, FIXED_DT, KART_COUNT, MAX_FRAME_DT } from '../core/constants';
import { clamp, clamp01, damp } from '../core/math';

import { Kart } from '../kart/Kart';
import { InputManager } from '../kart/InputManager';
import { CHARACTERS, getCharacter } from '../kart/roster';
import { Track } from '../track/Track';
import { TRACKS, getTrackDef } from '../track/tracks';
import { ItemManager } from '../items/ItemManager';
import { buildItemIcon } from '../items/itemVisuals';
import { AIDriver } from '../ai/AIDriver';
import { AudioEngine } from '../audio/AudioEngine';
import { ParticleSystem } from '../fx/ParticleSystem';
import { PostFX } from '../fx/PostFX';

import { RaceManager } from './RaceManager';
import { FollowCamera } from './FollowCamera';
import { MenuBackdrop } from './MenuBackdrop';
import type { MenuFraming } from './MenuBackdrop';
import { HUD } from '../ui/HUD';
import { MainMenu } from '../ui/MainMenu';
import type { MenuPanel } from '../ui/MainMenu';
import { ResultsScreen } from '../ui/ResultsScreen';
import { PauseMenu } from '../ui/PauseMenu';
import { LoadingScreen } from '../ui/LoadingScreen';
import { TouchControls } from '../ui/TouchControls';
import { t } from '../core/i18n';
import { el } from '../ui/dom';
import { showToast } from '../ui/toast';
import { createEmptyInput } from '../core/types';
import { LockSheet, type LockSheetHandlers } from '../ui/LockSheet';
import { LeaderboardPanel, localBestKey, readLocalBest } from '../ui/LeaderboardPanel';
import { SettingsPanel } from '../ui/SettingsPanel';
import { consumePremiumRace, grantPremiumRaces, isPremium, onEntitlementsChange, serverReachable } from '../verse8/entitlements';
import { PLACEMENT_REWARDED_PREMIUM, requestRewardedAd } from '../verse8/ads';
import { buyRemoveAds, initShop } from '../verse8/shop';
import { inVerse8Host } from '../verse8/embed';
import { submitTime, type SubmitResult } from '../verse8/server';
import { OnlineController, type OnlineMode } from '../net/online';
import { OnlinePanel } from '../ui/OnlinePanel';
import { PHASE, type Snapshot, type StandingMsg } from '../net/protocol';
import { assignSlotCharacters } from '../net/roster';
import type { OnlineRaceConfig, RaceStanding } from '../core/types';
import { getEntitlements, refreshEntitlements, consumePremiumRace as consumeTicket } from '../verse8/entitlements';

const MIN_LOADING_SECONDS = 0.8;
/** Give up waiting for async shader compilation after this long and just go. */
const MAX_COMPILE_WAIT_SECONDS = 8;
const RESULTS_DELAY_SECONDS = 1.6;
const MAX_STEPS_PER_FRAME = 8;
const SUN_DISTANCE = 90;
const SHADOW_HALF_EXTENT = 30;
const EMPTY_KARTS: readonly IKart[] = [];

function framingFor(panel: MenuPanel): MenuFraming {
  return panel === 'characterSelect' ? 'characters' : panel === 'trackSelect' ? 'tracks' : 'title';
}

interface PartialRace {
  track: ITrack | null;
  karts: IKart[];
  items: IItemManager | null;
  followCamera: FollowCamera | null;
  hud: HUD | null;
}

interface RaceContext {
  settings: RaceSettings;
  trackDef: TrackDefinition;
  track: ITrack;
  karts: IKart[];
  aiDrivers: IAIDriver[];
  playerAutoDriver: IAIDriver | null;
  /** True when an AI drove the player before the finish (dev `?auto=1`) — never submit such times. */
  playerAutoDriverBeforeFinish: boolean;
  items: IItemManager;
  raceManager: RaceManager;
  followCamera: FollowCamera;
  hud: HUD;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** Soft camera-following fill so karts read on dark tracks (0 intensity on bright ones). */
  fill: THREE.DirectionalLight;
  fog: THREE.FogExp2 | null;
  background: THREE.Color;
  unsubs: (() => void)[];
  resultsTimer: number;
  /** Online race config (null = offline vs AI). */
  online: OnlineRaceConfig | null;
  /** Kart index the local player controls / the camera follows. */
  localKartId: number;
  /** Items are disabled in online races (phase 2). */
  itemsEnabled: boolean;
}

const VOLUME_KEY_MUSIC = 'tkr.vol.music';
const VOLUME_KEY_SFX = 'tkr.vol.sfx';

/** Stored mixer level (0..1) or the fallback when unset / unreadable. */
function readVolume(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = Number(raw);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
  } catch {
    return fallback;
  }
}

export class Game {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly uiRoot: HTMLElement;
  private readonly touch: TouchControls;
  private unsubLang: (() => void) | null = null;
  private lockSheet: LockSheet;
  private leaderboard: LeaderboardPanel;
  private settings: SettingsPanel;
  private lastSubmit: SubmitResult | null = null;
  private online: OnlineController | null = null;
  private onlinePanel: OnlinePanel;

  private readonly input: InputManager;
  private readonly audio: IAudioEngine;
  private readonly particles: IParticleSystem;
  private readonly postfx: IPostFX;
  private postfxOk = true;

  private readonly backdrop: MenuBackdrop;
  private mainMenu: MainMenu;
  private results: ResultsScreen;
  private pauseMenu: PauseMenu;
  private loading: LoadingScreen;
  private readonly muteIndicator: HTMLElement;

  private state: GameState = 'boot';
  private prePauseState: GameState = 'racing';
  private race: RaceContext | null = null;
  private pendingSettings: RaceSettings | null = null;
  private loadingElapsed = 0;
  private loadingFrames = 0;
  private loadingProgress = 0;
  private shadersReady = false;

  private rafId = 0;
  private lastTime = -1;
  private elapsed = 0;
  private accumulator = 0;
  private pendingUseItem = false;
  private currentMusic: MusicTrack = 'none';
  private audioStarted = false;
  private disposed = false;

  private readonly playerInput: InputState = createEmptyInput();
  private readonly unsubs: (() => void)[] = [];
  private readonly sunDir = new THREE.Vector3(0.4, 0.8, 0.3);
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();
  private speedFx = 0;
  private boostFx = 0;
  private hitFx = 0;

  constructor(container: HTMLElement) {
    this.container = container;

    // ---------------------------------------------------------- renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1200);
    this.camera.position.set(0, 3, 8);
    this.scene.add(this.camera);

    this.uiRoot = el('div', '', undefined, container);
    this.uiRoot.id = 'ui';

    // Inside the Verse8 host: connect to the gameserver right away (entitlements, records,
    // nickname) and initialise VXShop. Without this the first server call only happened
    // after a finished race, so the records panel looked offline and VX never opened.
    initShop();
    void refreshEntitlements();

    // ---------------------------------------------------------- systems
    this.input = new InputManager();
    this.audio = new AudioEngine();
    this.audio.setMusicVolume(readVolume(VOLUME_KEY_MUSIC, 1));
    this.audio.setSfxVolume(readVolume(VOLUME_KEY_SFX, 1));
    this.particles = new ParticleSystem();
    this.scene.add(this.particles.object);
    this.postfx = new PostFX();
    try {
      this.postfx.init(this.renderer, this.scene, this.camera);
    } catch (err) {
      console.error('[Game] PostFX init failed, using plain rendering', err);
      this.postfxOk = false;
    }

    // ---------------------------------------------------------- ui
    this.backdrop = new MenuBackdrop();
    this.mainMenu = this.buildMainMenu();
    this.results = this.buildResults();
    this.pauseMenu = this.buildPauseMenu();
    this.loading = new LoadingScreen(this.uiRoot);
    this.lockSheet = new LockSheet(this.uiRoot);
    this.leaderboard = this.buildLeaderboard();
    this.settings = this.buildSettings();
    this.onlinePanel = this.buildOnlinePanel();
    this.muteIndicator = el('div', 'mute-indicator', t('mute'), this.uiRoot);
    this.touch = new TouchControls(this.uiRoot);
    this.input.attachTouch(this.touch);

    // ---------------------------------------------------------- listeners
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('pointerdown', this.onGesture, { passive: true });
    window.addEventListener('keydown', this.onGesture);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.unsubLang = events.on('ui:langChange', () => this.onLangChange());

    this.onResize();
  }

  // ------------------------------------------------------------------ public

  start(): void {
    if (this.state !== 'boot') return;
    this.showMenu('title');
    this.maybeNudgeNickname();
    this.lastTime = -1;
    this.rafId = requestAnimationFrame(this.loop);
  }

  get currentState(): GameState {
    return this.state;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('pointerdown', this.onGesture);
    window.removeEventListener('keydown', this.onGesture);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    this.disposeRace();
    this.backdrop.detach(this.scene);
    this.backdrop.dispose();
    this.mainMenu.dispose();
    this.results.dispose();
    this.pauseMenu.dispose();
    this.loading.dispose();
    this.muteIndicator.remove();
    this.unsubLang?.();
    this.unsubLang = null;
    this.input.attachTouch(null);
    this.touch.dispose();
    this.lockSheet.dispose();
    this.leaderboard.dispose();
    this.settings.dispose();
    this.onlinePanel.dispose();
    this.online?.dispose();
    this.input.dispose();
    this.safe(() => this.audio.dispose());
    this.safe(() => this.particles.dispose());
    this.safe(() => this.postfx.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.uiRoot.remove();
  }

  // ------------------------------------------------------------- ui builders

  private buildMainMenu(): MainMenu {
    const menu = new MainMenu(this.uiRoot, CHARACTERS as readonly CharacterDef[], TRACKS as readonly TrackDefinition[]);
    menu.onHighlight = (id) => this.backdrop.setCharacter(getCharacter(id));
    menu.onPanelChange = (panel) => this.onMenuPanel(panel);
    menu.onStart = (settings) => void this.startRaceGated(settings);
    menu.onLockedAttempt = (c) => this.lockSheet.show(c, this.lockSheetHandlers(c));
    menu.onRecords = () => this.leaderboard.show(TRACKS[0]?.id ?? 'sunny_circuit');
    menu.onSettings = () => this.settings.show();
    menu.onOnline = () => this.onlinePanel.show();
    return menu;
  }

  private buildResults(): ResultsScreen {
    const results = new ResultsScreen(this.uiRoot);
    results.onRaceAgain = () => {
      if (this.race?.online) this.returnToRoom();
      else if (this.race) void this.startRaceGated(this.race.settings);
    };
    results.onRecords = () => {
      if (this.race) this.leaderboard.show(this.race.trackDef.id, { submit: this.lastSubmit });
    };
    results.onChangeTrack = () => {
      if (this.race?.online) this.returnToRoom();
      else this.returnToMenu('trackSelect');
    };
    results.onMainMenu = () => {
      if (this.race?.online) void this.online?.leave();
      this.returnToMenu('title');
    };
    return results;
  }

  private buildPauseMenu(): PauseMenu {
    const pauseMenu = new PauseMenu(this.uiRoot);
    pauseMenu.onResume = () => this.resume();
    pauseMenu.onRestart = () => {
      const settings = this.race?.settings;
      this.leavePause();
      if (settings) void this.startRaceGated(settings);
      else this.returnToMenu('title');
    };
    pauseMenu.onQuit = () => {
      this.leavePause();
      this.returnToMenu('title');
    };
    return pauseMenu;
  }

  /** Inside the host, once entitlements have loaded: nudge a nickname if none is set (once per device). */
  private maybeNudgeNickname(): void {
    if (!inVerse8Host()) return;
    try {
      if (localStorage.getItem('tkr.nudged')) return;
    } catch {
      return;
    }
    const off = onEntitlementsChange((ent) => {
      if (!ent.loaded) return;
      off();
      if (ent.nickname !== '' || !serverReachable()) return;
      showToast(t('settings.nudge'), 'info', 7000);
      try {
        localStorage.setItem('tkr.nudged', '1');
      } catch {
        /* ignore */
      }
    });
  }

  private buildOnlinePanel(): OnlinePanel {
    const panel = new OnlinePanel(
      this.uiRoot,
      this.online,
      TRACKS as readonly TrackDefinition[],
      CHARACTERS as readonly CharacterDef[],
      (mode) => this.getOnline(mode),
    );
    panel.onLockedKart = (c) => this.lockSheet.show(c, this.lockSheetHandlers(c));
    return panel;
  }

  /** Lazily create (or swap) the online controller; the panel binds to it. */
  private getOnline(mode: OnlineMode): OnlineController {
    if (this.online && this.online.mode === mode) return this.online;
    this.online?.dispose();
    const ent = getEntitlements();
    const nick = ent.nickname || 'RACER';
    const c = new OnlineController(
      mode,
      { nick, characterId: this.mainMenu.highlightedCharacter.id },
      { trackId: TRACKS[0]?.id ?? 'sunny_circuit', difficulty: 'normal', laps: DEFAULT_LAPS },
    );
    c.onRaceStart = (settings) => {
      if (isPremium(settings.characterId)) void consumeTicket(settings.characterId);
      this.onlinePanel.hide();
      this.startRace(settings);
    };
    c.onPhase = (phase) => {
      const r = this.race;
      if (!r || r.online?.role !== 'client') return;
      if (phase === PHASE.countdown && r.raceManager.currentPhase === 'grid') r.raceManager.startCountdown();
    };
    c.onResults = (standings) => this.showOnlineResults(standings);
    c.onHostLost = (standings) => {
      showToast(t('online.hostLeft'), 'error');
      this.showOnlineResults(standings);
    };
    c.onMigrating = () => showToast(t('online.migrating'), 'info');
    c.onHostChanged = (nick2) => showToast(t('online.hostChanged', { name: nick2 }), 'info');
    c.onPromoted = (snap) => this.promoteToHost(snap);
    c.onHumanLeft = (kartId, nick2) => {
      const r = this.race;
      if (!r || r.online?.role !== 'host') return;
      if (kartId === r.localKartId) return;
      if (!r.aiDrivers.some((d) => (d as unknown as { kartId?: number }).kartId === kartId)) {
        const drv = new AIDriver(r.karts[kartId], r.settings.difficulty, kartId);
        (drv as unknown as { kartId?: number }).kartId = kartId;
        r.aiDrivers.push(drv);
      }
      showToast(t('online.playerLeft', { name: nick2 }), 'info');
    };
    this.online = c;
    return c;
  }

  /** Host migration: we were a client; take over the simulation from the last mirrored snapshot. */
  private promoteToHost(snap: Snapshot | null): void {
    const r = this.race;
    const c = this.online;
    if (!r || !r.online || !c) return;
    r.online.role = 'host';
    // AI for every slot that is not a live human (empty slots + everyone who left, incl. the old host).
    for (let id = 0; id < r.karts.length; id++) {
      if (id === r.localKartId) continue;
      const entry = r.online.roster.find((e) => e.kartId === id);
      if (entry && !c.isGone(entry.account)) continue;
      if (r.aiDrivers.some((d) => (d as unknown as { kartId?: number }).kartId === id)) continue;
      const drv = new AIDriver(r.karts[id], r.settings.difficulty, id);
      (drv as unknown as { kartId?: number }).kartId = id;
      r.aiDrivers.push(drv);
    }
    if (r.online.items) {
      r.items.setNetMode?.('authority');
      r.items.reset(); // mirrored hazards have no physics; start clean (boxes all live again)
      r.itemsEnabled = true;
    }
    const phase = snap?.phase ?? PHASE.racing;
    r.raceManager.adoptFromKarts(snap?.raceTime ?? 0, phase === PHASE.countdown || phase === PHASE.grid ? 'countdown' : phase === PHASE.complete ? 'complete' : 'racing');
    c.attachRace({
      karts: r.karts,
      raceManager: r.raceManager,
      totalLaps: r.raceManager.totalLaps,
      roster: r.online.roster,
      items: r.online.items ? r.items : undefined,
    });
    showToast(t('online.promoted'), 'info');
  }

  private returnToRoom(): void {
    void this.online?.backToRoom();
    this.returnToMenu('title');
    this.onlinePanel.returnToRoom();
  }

  /** Results delivered by the host (client side) or synthesised after the host vanished. */
  private showOnlineResults(standings: StandingMsg[]): void {
    const r = this.race;
    if (!r || !r.online || this.state === 'results') return;
    const mapped: RaceStanding[] = standings.map((s) => ({
      kartId: s.kartId,
      name: this.online?.nickOf(s.kartId) ?? s.name,
      color: s.color,
      place: s.place,
      finishTime: s.finishTime,
      isPlayer: s.kartId === r.localKartId,
    }));
    r.hud.hide();
    this.results.show(mapped);
    this.setState('results');
    this.playMusic('results');
  }

  private buildLeaderboard(): LeaderboardPanel {
    const lb = new LeaderboardPanel(this.uiRoot, TRACKS as readonly TrackDefinition[], CHARACTERS as readonly CharacterDef[]);
    lb.onSetNickname = () => {
      lb.hide();
      this.settings.show();
    };
    return lb;
  }

  private buildSettings(): SettingsPanel {
    return new SettingsPanel(this.uiRoot, {
      getVolumes: () => ({ music: this.audio.musicVolumeLevel, sfx: this.audio.sfxVolumeLevel }),
      onVolume: (kind, v) => this.setVolume(kind, v),
    });
  }

  private lockSheetHandlers(def: CharacterDef): LockSheetHandlers {
    return {
      onWatch: async () => {
        const rewarded = await requestRewardedAd(PLACEMENT_REWARDED_PREMIUM);
        if (!rewarded) {
          showToast(t('v8.lock.adFailed'), 'error');
          return;
        }
        const granted = await grantPremiumRaces();
        if (!granted) {
          showToast(t('v8.lock.adFailed'), 'error');
          return;
        }
        showToast(t('v8.lock.granted'), 'info');
        this.lockSheet.hide();
        this.mainMenu.proceedFromCharacter();
      },
      onBuy: () => {
        const result = buyRemoveAds();
        if (result === 'unregistered') showToast(t('v8.lock.unregistered'), 'error');
        else if (result === 'blocked') showToast(t('v8.lock.buyFailed'), 'error');
        // A completed purchase lands via refreshEntitlements → badges update; the sheet stays
        // open so the player can continue once the kart shows as unlocked.
        else this.lockSheet.hide();
      },
      onOther: () => this.lockSheet.hide(),
    };
  }

  /** Spend a premium race ticket (server-authoritative) before starting with a premium kart. */
  private async startRaceGated(settings: RaceSettings): Promise<void> {
    if (isPremium(settings.characterId)) {
      const ok = await consumePremiumRace(settings.characterId);
      if (!ok) {
        const def = getCharacter(settings.characterId);
        showToast(t('v8.lock.noTicket', { name: def.name }), 'error');
        this.returnToMenu('characterSelect');
        this.lockSheet.show(def, this.lockSheetHandlers(def));
        return;
      }
    }
    this.startRace(settings);
  }

  private maybeSubmitTime(r: RaceContext, seconds: number): void {
    if (r.online) return; // multiplayer times are not ranked (spec B MVP)
    const params = new URLSearchParams(location.search);
    if (params.has('auto') || r.playerAutoDriverBeforeFinish) return;
    if (Array.from(params.keys()).some((k) => k.startsWith('b.'))) return;
    const timeMs = Math.round(seconds * 1000);
    const trackId = r.trackDef.id;
    try {
      const prev = readLocalBest(trackId);
      if (prev === null || timeMs < prev) localStorage.setItem(localBestKey(trackId), String(timeMs));
    } catch {
      /* storage unavailable */
    }
    if (!inVerse8Host()) return;
    void submitTime(trackId, timeMs, r.settings.characterId, r.settings.difficulty).then((res) => {
      if (!res || this.race !== r) return;
      this.lastSubmit = res;
      if (res.updated && res.rank && this.state === 'results') {
        this.results.showRankBanner(t('lb.newRank', { rank: res.rank }));
      }
    });
  }

  /**
   * Language switched on the title screen: the long-lived overlays are stateless DOM built
   * once, so rebuild them in place. The HUD is rebuilt per race anyway.
   */
  private onLangChange(): void {
    const panel = this.mainMenu.currentPanel;
    const wasMenu = this.state === 'title' || this.state === 'characterSelect' || this.state === 'trackSelect';
    this.mainMenu.dispose();
    this.results.dispose();
    this.pauseMenu.dispose();
    this.loading.dispose();
    const settingsWasOpen = this.settings.isVisible;
    this.lockSheet.dispose();
    this.leaderboard.dispose();
    this.settings.dispose();
    this.lockSheet = new LockSheet(this.uiRoot);
    this.leaderboard = this.buildLeaderboard();
    this.settings = this.buildSettings();
    if (settingsWasOpen) this.settings.show();
    const onlineWasOpen = this.onlinePanel.isVisible;
    this.onlinePanel.dispose();
    this.onlinePanel = this.buildOnlinePanel();
    if (onlineWasOpen) this.onlinePanel.show();
    this.mainMenu = this.buildMainMenu();
    this.results = this.buildResults();
    this.pauseMenu = this.buildPauseMenu();
    this.loading = new LoadingScreen(this.uiRoot);
    // Keep the mute indicator / touch layer above the rebuilt overlays.
    this.uiRoot.appendChild(this.muteIndicator);
    this.uiRoot.appendChild(this.touch.rootElement);
    this.muteIndicator.textContent = t('mute');
    if (wasMenu) this.mainMenu.show(panel);
  }

  // ------------------------------------------------------------- main loop

  private readonly loop = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    if (this.lastTime < 0) this.lastTime = now;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
    if (dt < 0) dt = 0;
    this.elapsed += dt;

    const input = this.input.update();
    try {
      this.frame(dt, input);
    } catch (err) {
      console.error('[Game] frame error', err);
      events.emit('ui:error', {});
    }
  };

  private frame(dt: number, input: InputState): void {
    // Modal overlays (settings / records / lock sheet) swallow menu input while open.
    if (this.settings.isVisible || this.leaderboard.isVisible || this.lockSheet.isVisible || this.onlinePanel.isVisible) {
      if (this.settings.isVisible) this.settings.handleInput(input);
      else if (this.leaderboard.isVisible) this.leaderboard.handleInput(input);
      else if (this.lockSheet.isVisible) {
        if (input.back) this.lockSheet.hide();
      } else this.onlinePanel.handleInput(input);
      input = createEmptyInput();
    }
    switch (this.state) {
      case 'boot':
        return;
      case 'title':
      case 'characterSelect':
      case 'trackSelect':
        this.mainMenu.handleInput(input);
        this.backdrop.update(dt, this.camera);
        this.particles.update(dt, EMPTY_KARTS, this.camera);
        this.audio.update(dt, EMPTY_KARTS, -1, this.camera);
        this.render(dt);
        return;
      case 'loading':
        this.frameLoading(dt);
        return;
      case 'countdown':
      case 'racing':
      case 'finished':
        if (input.pause) {
          this.pause();
          this.render(dt);
          return;
        }
        this.simulate(dt, input);
        this.renderRace(dt, this.state === 'racing' && input.lookBack);
        return;
      case 'paused':
        this.pauseMenu.handleInput(input);
        if (input.pause && this.state === 'paused') this.resume();
        this.render(dt);
        return;
      case 'results':
        this.results.handleInput(input);
        if (this.race && this.state === 'results') {
          // Keep the world alive behind the results panel.
          this.simulate(dt, input);
          this.renderRace(dt, false);
        } else {
          this.render(dt);
        }
        return;
    }
  }

  private frameLoading(dt: number): void {
    this.loading.update(dt);
    this.loadingElapsed += dt;
    this.loadingFrames++;
    // Give the loading screen a frame to paint before the synchronous build.
    if (!this.race && this.loadingFrames >= 2 && this.pendingSettings) {
      const settings = this.pendingSettings;
      try {
        this.buildRace(settings);
      } catch (err) {
        console.error('[Game] failed to build race', err);
        showToast(t('err.buildRace'), 'error');
        this.pendingSettings = null;
        this.loading.hide();
        this.showMenu('title');
        return;
      }
      this.warmShaders();
    }

    // Fake progress creeps toward 90% while shaders compile off-thread, then snaps to 100%.
    const ready = this.race !== null && (this.shadersReady || this.loadingElapsed > MAX_COMPILE_WAIT_SECONDS);
    const target = !this.race ? 0.12 : ready ? 1 : 0.9;
    this.loadingProgress = damp(this.loadingProgress, target, ready ? 14 : 1.4, dt);
    this.loading.setProgress(this.loadingProgress);

    if (this.race && ready) {
      // Warm the remaining passes (shadow depth, post-processing) behind the overlay.
      this.renderRace(dt, false);
      if (this.loadingElapsed >= MIN_LOADING_SECONDS && this.loadingProgress > 0.985) {
        const hs = this.online?.hostSession;
        const hostWaiting =
          this.race.online?.role === 'host' && hs !== undefined && hs !== null && !hs.allLoaded && this.loadingElapsed < MIN_LOADING_SECONDS + 10;
        if (!hostWaiting) this.enterCountdown();
      }
    }
  }

  /** Kick off parallel shader compilation for the freshly built race scene. */
  private warmShaders(): void {
    const r = this.race;
    this.shadersReady = false;
    if (!r) return;
    const renderer = this.renderer as { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown> };
    if (typeof renderer.compileAsync !== 'function') {
      this.shadersReady = true;
      return;
    }
    let promise: Promise<unknown>;
    try {
      promise = renderer.compileAsync.call(this.renderer, this.scene, this.camera);
    } catch (err) {
      console.warn('[Game] compileAsync threw; falling back to synchronous compile', err);
      this.shadersReady = true;
      return;
    }
    const done = (): void => {
      if (this.race === r) this.shadersReady = true;
    };
    promise.then(done, (err: unknown) => {
      console.warn('[Game] compileAsync failed; falling back to synchronous compile', err);
      done();
    });
  }

  private simulate(dt: number, input: InputState): void {
    const r = this.race;
    if (!r) return;
    if (input.useItem) this.pendingUseItem = true;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.step(FIXED_DT, r, input, this.pendingUseItem);
      this.pendingUseItem = false;
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;
  }

  private step(dt: number, r: RaceContext, input: InputState, useItem: boolean): void {
    const { track, karts, items } = r;
    const player = karts[r.localKartId];

    // Player input (or auto-drive after finishing).
    if (r.playerAutoDriver) {
      r.playerAutoDriver.update(dt, track, karts, items, null);
    } else {
      const p = this.playerInput;
      p.throttle = input.throttle;
      p.brake = input.brake;
      p.steer = input.steer;
      p.drift = input.drift;
      p.useItem = useItem;
      p.useItemHeld = input.useItemHeld;
      p.lookBack = input.lookBack;
      p.pause = false;
      p.confirm = false;
      p.back = false;
      p.menuUp = false;
      p.menuDown = false;
      p.menuLeft = false;
      p.menuRight = false;
      player.setInput(p);
    }

    if (r.online?.role === 'client') {
      // Client: predict only our own kart; everything else (karts, boxes, hazards) comes from
      // host snapshots. items.update() in mirror mode only animates.
      player.update(dt, track, karts);
      if (r.raceManager.currentPhase === 'countdown') r.raceManager.update(dt);
      this.online?.clientSession?.tick60(player.input);
      if (r.online.items) items.update(dt);
      return;
    }

    if (r.online?.role === 'host') this.online?.applyRemoteInputs(karts, r.itemsEnabled ? items : undefined);

    for (let i = 0; i < r.aiDrivers.length; i++) {
      r.aiDrivers[i].update(dt, track, karts, items, player);
    }

    for (let i = 0; i < karts.length; i++) {
      karts[i].update(dt, track, karts);
    }

    if (r.itemsEnabled) {
      for (let i = 0; i < karts.length; i++) {
        const k = karts[i];
        const inp = k.input;
        if (inp.useItem && !k.state.itemRouletteActive && k.state.item !== 'none') {
          items.requestUse(k, inp.brake > 0.5 || inp.lookBack);
        }
      }
      items.update(dt);
    }
    r.raceManager.update(dt);
    if (r.online?.role === 'host') this.online?.hostSession?.tick60();
  }

  private renderRace(dt: number, lookBack: boolean): void {
    const r = this.race;
    if (!r) {
      this.render(dt);
      return;
    }
    const player = r.karts[r.localKartId];
    for (let i = 0; i < r.karts.length; i++) r.karts[i].updateVisuals(dt);
    r.track.update(dt, this.elapsed);
    r.followCamera.update(dt, player, lookBack);
    this.updateSun(r, player);
    this.particles.update(dt, r.karts, this.camera);
    this.audio.update(dt, r.karts, player.state.id, this.camera);
    const raceTime = r.online?.role === 'client' ? (this.online?.clientSession?.raceTime ?? 0) : r.raceManager.raceTime;
    r.hud.update(dt, player, r.karts, raceTime, r.raceManager.totalLaps);
    this.updatePostFxFeel(dt, player);

    if (this.state === 'finished' && r.resultsTimer > 0) {
      r.resultsTimer -= dt;
      if (r.resultsTimer <= 0) this.enterResults();
    }
    this.render(dt);
  }

  private render(dt: number): void {
    if (this.postfxOk) {
      try {
        this.postfx.render(dt);
        return;
      } catch (err) {
        console.error('[Game] PostFX render failed; falling back to plain rendering', err);
        this.postfxOk = false;
        this.safe(() => this.postfx.setEnabled(false));
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  private updateSun(r: RaceContext, player: IKart): void {
    const p = player.state.position;
    // Snap the shadow frustum to a coarse grid to avoid edge shimmer while driving.
    const snap = 2;
    this.tmpA.set(Math.round(p.x / snap) * snap, Math.round(p.y / snap) * snap, Math.round(p.z / snap) * snap);
    r.sun.target.position.copy(this.tmpA);
    r.sun.position.copy(this.tmpA).addScaledVector(this.sunDir, SUN_DISTANCE);

    // Fill light shines from just above the camera toward the player kart.
    if (r.fill.visible) {
      r.fill.position.copy(this.camera.position);
      r.fill.position.y += 2;
      r.fill.target.position.copy(p);
    }
  }

  private updatePostFxFeel(dt: number, player: IKart): void {
    if (!this.postfxOk) return;
    const s = player.state;
    const top = Math.max(1, player.topSpeed());
    const speedTarget = clamp01((Math.abs(s.speed) - top * 0.55) / (top * 0.9));
    const boostTarget = s.isBoosting ? clamp01(0.45 + s.boostStrength) : s.isInvincible ? 0.35 : 0;
    this.speedFx = damp(this.speedFx, speedTarget, 5, dt);
    this.boostFx = damp(this.boostFx, boostTarget, s.isBoosting ? 12 : 4, dt);
    if (this.hitFx > 0) {
      this.hitFx = damp(this.hitFx, 0, 3, dt);
      if (this.hitFx < 0.005) this.hitFx = 0;
    }
    this.postfx.setSpeedEffect(this.speedFx);
    this.postfx.setBoostEffect(this.boostFx);
    this.postfx.setHitEffect(this.hitFx);
  }

  // ------------------------------------------------------------ state flow

  private setState(next: GameState): void {
    if (next === this.state) return;
    const from = this.state;
    this.state = next;
    this.uiRoot.dataset.state = next;
    events.emit('game:stateChange', { from, to: next });
  }

  private showMenu(panel: MenuPanel): void {
    this.results.hide();
    this.pauseMenu.hide();
    this.loading.hide();
    this.backdrop.setCharacter(this.mainMenu.highlightedCharacter);
    this.backdrop.setFraming(framingFor(panel), true);
    this.backdrop.attach(this.scene, this.camera, this.renderer);
    this.mainMenu.show(panel);
    this.setState(panel);
    this.playMusic('menu');
  }

  private onMenuPanel(panel: MenuPanel): void {
    if (this.state === 'title' || this.state === 'characterSelect' || this.state === 'trackSelect') {
      this.setState(panel);
      this.backdrop.setFraming(framingFor(panel));
    }
  }

  private returnToMenu(panel: MenuPanel): void {
    this.disposeRace();
    this.showMenu(panel);
  }

  private startRace(settings: RaceSettings): void {
    this.disposeRace();
    this.backdrop.detach(this.scene);
    this.mainMenu.hide();
    this.results.hide();
    this.pauseMenu.hide();
    this.safe(() => this.particles.reset());

    let trackDef: TrackDefinition;
    try {
      trackDef = getTrackDef(settings.trackId) as TrackDefinition;
    } catch {
      trackDef = TRACKS[0] as TrackDefinition;
    }
    if (!trackDef) {
      showToast(t('err.noTracks'), 'error');
      this.showMenu('title');
      return;
    }
    this.pendingSettings = { ...settings, trackId: trackDef.id };
    this.lastSubmit = null;
    this.loadingElapsed = 0;
    this.loadingFrames = 0;
    this.loadingProgress = 0;
    this.shadersReady = false;
    this.loading.show(trackDef);
    this.scene.background = new THREE.Color(0x0b0b1a);
    this.scene.fog = null;
    this.setState('loading');
  }

  private buildRace(settings: RaceSettings): void {
    // Partially constructed pieces, cleaned up if a later constructor throws.
    const partial: PartialRace = { track: null, karts: [], items: null, followCamera: null, hud: null };
    try {
      this.buildRaceInner(settings, partial);
    } catch (err) {
      const { hud, followCamera, items, karts, track } = partial;
      if (hud) this.safe(() => hud.dispose());
      if (followCamera) this.safe(() => followCamera.dispose());
      if (items) this.safe(() => items.dispose());
      for (const k of karts) this.safe(() => k.dispose());
      if (track) this.safe(() => track.dispose());
      throw err;
    }
  }

  private buildRaceInner(settings: RaceSettings, partial: PartialRace): void {
    const trackDef = getTrackDef(settings.trackId) as TrackDefinition;
    const track: ITrack = new Track(trackDef);
    partial.track = track;
    const env = trackDef.environment;
    const karts = partial.karts;

    // Karts. Offline: player 0 with the chosen character, AI 1..7 with the rest shuffled.
    // Online: slots come from the roster (same on every client); the rest are AI on the host.
    let playerChar: CharacterDef;
    try {
      playerChar = getCharacter(settings.characterId) as CharacterDef;
    } catch {
      playerChar = CHARACTERS[0] as CharacterDef;
    }
    const localKartId = settings.online?.localKartId ?? 0;
    const aiDrivers: IAIDriver[] = [];
    const difficulty: Difficulty = settings.difficulty;
    if (settings.online) {
      const slots = assignSlotCharacters(settings.online.roster, CHARACTERS as readonly CharacterDef[]);
      for (let id = 0; id < KART_COUNT; id++) karts.push(new Kart(id, slots[id], id === localKartId));
      if (settings.online.role === 'host') {
        for (let id = 0; id < karts.length; id++) {
          if (settings.online.roster.some((e) => e.kartId === id)) continue;
          const drv = new AIDriver(karts[id], difficulty, id);
          (drv as unknown as { kartId?: number }).kartId = id;
          aiDrivers.push(drv);
        }
      }
    } else {
      const others = (CHARACTERS as readonly CharacterDef[]).filter((c) => c.id !== playerChar.id);
      for (let i = others.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = others[i];
        others[i] = others[j];
        others[j] = t;
      }
      karts.push(new Kart(0, playerChar, true));
      for (let id = 1; id < KART_COUNT; id++) {
        const def = others.length > 0 ? others[(id - 1) % others.length] : playerChar;
        karts.push(new Kart(id, def, false));
      }
      for (let id = 1; id < karts.length; id++) {
        aiDrivers.push(new AIDriver(karts[id], difficulty, id));
      }
    }

    const items: IItemManager = new ItemManager(this.particles);
    partial.items = items;
    items.init(track, karts);

    const raceManager = new RaceManager(track, karts, settings);
    const followCamera = new FollowCamera(this.camera);
    partial.followCamera = followCamera;
    followCamera.setTrack(track);

    const hud = new HUD(this.uiRoot, buildItemIcon);
    partial.hud = hud;
    hud.setTrack(track);

    // Lights from the track environment.
    const sun = new THREE.DirectionalLight(env.sunColor, env.sunIntensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -SHADOW_HALF_EXTENT;
    sc.right = SHADOW_HALF_EXTENT;
    sc.top = SHADOW_HALF_EXTENT;
    sc.bottom = -SHADOW_HALF_EXTENT;
    sc.near = 1;
    sc.far = SUN_DISTANCE + SHADOW_HALF_EXTENT * 3;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    this.sunDir.set(env.sunDirection.x, env.sunDirection.y, env.sunDirection.z);
    if (this.sunDir.lengthSq() < 1e-6) this.sunDir.set(0.4, 0.8, 0.3);
    if (this.sunDir.y < 0) this.sunDir.y = -this.sunDir.y;
    if (this.sunDir.y < 0.15) this.sunDir.y = 0.15;
    this.sunDir.normalize();
    const hemi = new THREE.HemisphereLight(env.ambientSky, env.ambientGround, env.ambientIntensity);
    // Camera-following fill: strong on dim night tracks, zero on sunny ones.
    const darkness =
      clamp(0.9 - env.ambientIntensity, 0, 0.6) + clamp((1.6 - env.sunIntensity) * 0.3, 0, 0.3);
    const fill = new THREE.DirectionalLight(0xd9e4ff, darkness);
    fill.castShadow = false;
    fill.visible = darkness > 0.01;
    const fog = env.fogDensity > 0 ? new THREE.FogExp2(env.fogColor, env.fogDensity) : null;
    const background = new THREE.Color(env.skyHorizon);

    this.scene.add(track.object);
    for (const k of karts) this.scene.add(k.object);
    this.scene.add(items.object);
    this.scene.add(sun, sun.target, hemi, fill, fill.target);
    this.scene.fog = fog;
    this.scene.background = background;

    const r: RaceContext = {
      settings,
      trackDef,
      track,
      karts,
      aiDrivers,
      playerAutoDriver: null,
      playerAutoDriverBeforeFinish: false,
      items,
      raceManager,
      followCamera,
      hud,
      sun,
      hemi,
      fill,
      fog,
      background,
      unsubs: [],
      resultsTimer: 0,
      online: settings.online ?? null,
      localKartId,
      // Items: offline always; online only the host simulates them (clients mirror).
      itemsEnabled: !settings.online || (settings.online.role === 'host' && settings.online.items),
    };
    this.race = r;
    if (settings.online) {
      items.object.visible = settings.online.items;
      if (settings.online.role === 'client') items.setNetMode?.('mirror');
      this.online?.attachRace({
        karts,
        raceManager,
        totalLaps: raceManager.totalLaps,
        roster: settings.online.roster,
        items: settings.online.items ? items : undefined,
      });
    }
    this.accumulator = 0;
    this.pendingUseItem = false;
    this.speedFx = 0;
    this.boostFx = 0;
    this.hitFx = 0;

    if (import.meta.env.DEV) {
      // Dev-only: `?auto=1` lets the AI drive the player for soak testing.
      if (new URLSearchParams(location.search).has('auto')) {
        r.playerAutoDriver = new AIDriver(karts[localKartId], 'hard', 0);
        r.playerAutoDriverBeforeFinish = true;
      }
      (window as unknown as { __tkr?: unknown }).__tkr = {
        game: this,
        getRace: () => this.race,
        renderer: this.renderer,
        events,
      };
    }

    // Sync visuals once so the first rendered frame is sane.
    for (const k of karts) k.updateVisuals(0);
    followCamera.snapTo(karts[localKartId]);
    this.updateSun(r, karts[localKartId]);

    r.unsubs.push(
      events.on('race:start', () => {
        if (this.race === r && this.state === 'countdown') this.setState('racing');
      }),
      events.on('race:lap', (e) => {
        if (this.race !== r || !e.isPlayer) return;
        if (e.isFinalLap) this.playMusic('finalLap');
      }),
      events.on('race:finish', (e) => {
        if (this.race !== r || !e.isPlayer) return;
        this.onPlayerFinished(r);
        this.maybeSubmitTime(r, e.time);
      }),
      events.on('race:allFinished', () => {
        if (this.race !== r) return;
        if (this.state === 'finished') r.resultsTimer = RESULTS_DELAY_SECONDS;
        else if (this.state === 'racing' || this.state === 'countdown') this.enterResults();
      }),
      events.on('item:hit', (e) => {
        if (this.race !== r || !e.isPlayer) return;
        this.hitFx = 1;
      }),
      events.on('item:lightning', () => {
        if (this.race !== r || !this.postfxOk) return;
        this.safe(() => this.postfx.flash(0xffffff, 0.3));
      }),
    );
  }

  private enterCountdown(): void {
    const r = this.race;
    if (!r) return;
    this.pendingSettings = null;
    this.loading.hide();
    r.hud.show();

    // Cinematic: wide shot of the grid swooping into the chase position.
    const grid = r.track.startGrid;
    const center = this.tmpA.set(0, 0, 0);
    const n = Math.min(grid.length, KART_COUNT);
    if (n > 0) {
      for (let i = 0; i < n; i++) center.add(grid[i].position);
      center.multiplyScalar(1 / n);
    } else {
      center.copy(r.karts[r.localKartId].state.position);
    }
    const forward = this.tmpB;
    r.karts[r.localKartId].forwardDir(forward);
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.y = 0;
    forward.normalize();
    const right = this.tmpC.set(-forward.z, 0, forward.x);
    const from = center.clone().addScaledVector(forward, 18).addScaledVector(right, 11);
    from.y += 6.5;
    const look = center.clone();
    look.y += 0.8;
    r.followCamera.setCinematic(from, look, 3 * COUNTDOWN_STEP_SECONDS, 46);

    if (r.online?.role !== 'client') r.raceManager.startCountdown();
    this.setState('countdown');
    this.playMusic('race');
  }

  private onPlayerFinished(r: RaceContext): void {
    if (this.state !== 'racing' && this.state !== 'countdown') return;
    try {
      r.playerAutoDriver = new AIDriver(r.karts[r.localKartId], 'normal', 0);
    } catch (err) {
      console.warn('[Game] could not create auto-driver for the player', err);
      r.playerAutoDriver = null;
    }
    if (this.postfxOk) this.safe(() => this.postfx.flash(0xffffff, 0.35));
    this.setState('finished');
    if (r.raceManager.allFinished) r.resultsTimer = RESULTS_DELAY_SECONDS;
  }

  private enterResults(): void {
    const r = this.race;
    if (!r || this.state === 'results') return;
    r.hud.hide();
    this.results.show(r.raceManager.getStandings());
    if (this.lastSubmit?.updated && this.lastSubmit.rank) {
      this.results.showRankBanner(t('lb.newRank', { rank: this.lastSubmit.rank }));
    }
    this.setState('results');
    this.playMusic('results');
  }

  private pause(): void {
    if (this.state !== 'countdown' && this.state !== 'racing' && this.state !== 'finished') return;
    this.prePauseState = this.state;
    this.setState('paused');
    this.pauseMenu.show();
    events.emit('game:pause', {});
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.pauseMenu.hide();
    this.accumulator = 0;
    this.pendingUseItem = false;
    this.setState(this.prePauseState);
    events.emit('game:resume', {});
  }

  /** Leave the paused state without returning to the race (restart / quit). */
  private leavePause(): void {
    this.pauseMenu.hide();
    if (this.state === 'paused') {
      // Other systems may have ducked audio / frozen timers on game:pause.
      events.emit('game:resume', {});
    }
  }

  private disposeRace(): void {
    const r = this.race;
    if (!r) return;
    this.race = null;
    for (const u of r.unsubs) u();
    r.unsubs.length = 0;

    this.scene.remove(r.track.object);
    for (const k of r.karts) this.scene.remove(k.object);
    this.scene.remove(r.items.object);
    this.scene.remove(r.sun, r.sun.target, r.hemi, r.fill, r.fill.target);
    r.sun.dispose();
    r.hemi.dispose();
    r.fill.dispose();
    this.scene.fog = null;

    this.safe(() => r.items.dispose());
    for (const k of r.karts) this.safe(() => k.dispose());
    this.safe(() => r.track.dispose());
    r.raceManager.dispose();
    r.followCamera.dispose();
    r.hud.dispose();
    this.safe(() => this.particles.reset());
    if (this.postfxOk) {
      this.safe(() => {
        this.postfx.setSpeedEffect(0);
        this.postfx.setBoostEffect(0);
        this.postfx.setHitEffect(0);
      });
    }
    this.accumulator = 0;
    this.pendingUseItem = false;
  }

  // ---------------------------------------------------------------- audio

  private playMusic(track: MusicTrack): void {
    this.currentMusic = track;
    this.safe(() => this.audio.playMusic(track));
  }

  private readonly onGesture = (): void => {
    if (this.audioStarted) return;
    this.audioStarted = true;
    window.removeEventListener('pointerdown', this.onGesture);
    window.removeEventListener('keydown', this.onGesture);
    this.audio
      .init()
      .then(() => {
        if (this.currentMusic !== 'none') this.safe(() => this.audio.playMusic(this.currentMusic));
      })
      .catch((err: unknown) => {
        console.warn('[Game] audio init failed', err);
        this.audioStarted = false;
        window.addEventListener('pointerdown', this.onGesture, { passive: true });
        window.addEventListener('keydown', this.onGesture);
      });
  };

  private setVolume(kind: 'music' | 'sfx', v: number): void {
    const level = Math.max(0, Math.min(1, v));
    this.safe(() => (kind === 'music' ? this.audio.setMusicVolume(level) : this.audio.setSfxVolume(level)));
    try {
      localStorage.setItem(kind === 'music' ? VOLUME_KEY_MUSIC : VOLUME_KEY_SFX, String(level));
    } catch {
      /* private mode */
    }
  }

  private toggleMute(): void {
    const muted = !this.audio.muted;
    this.safe(() => this.audio.setMuted(muted));
    this.muteIndicator.classList.toggle('visible', muted);
  }

  // ------------------------------------------------------------- listeners

  private readonly onResize = (): void => {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.postfxOk) {
      try {
        this.postfx.setSize(w, h, pr);
      } catch (err) {
        console.error('[Game] PostFX resize failed', err);
        this.postfxOk = false;
      }
    }
  };

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.repeat) return;
    if (ev.key === 'm' || ev.key === 'M') this.toggleMute();
  };

  private readonly onBlur = (): void => {
    if (this.state === 'racing' || this.state === 'countdown') this.pause();
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) this.onBlur();
  };

  private safe(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error('[Game]', err);
    }
  }
}
