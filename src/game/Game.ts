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
import { TRACKS, TRACKS_BY_DIFFICULTY, getTrackDef } from '../track/tracks';
import { ItemManager } from '../items/ItemManager';
import { ALL_ITEM_TYPES } from '../core/types';
import { buildItemIcon, buildItemMesh } from '../items/itemVisuals';
import { AIDriver } from '../ai/AIDriver';
import { BALANCE } from '../core/balance';
import { assistSteer, TOUCH_ASSIST_STRENGTH } from '../kart/assists/steerAssist';
import { AudioEngine } from '../audio/AudioEngine';
import { ParticleSystem } from '../fx/ParticleSystem';
import { PostFX } from '../fx/PostFX';
import { RearView } from '../fx/RearView';
import { EnvProbe } from '../gfx/EnvProbe';
import { lookFor } from '../gfx/looks';
import { initQuality, quality, setTier, stepDownForNextRace, type GfxTier } from '../gfx/quality';
import { ensureKartThumbnails, getKartThumbnail, setKartThumbnailsAllowed } from '../ui/kartThumbnails';
import { LobbyTour } from '../ui/LobbyTour';
import { dismissBootSplash } from '../ui/bootSplash';
import { prefetchEngineSample } from '../audio/engineSample';
import { crazyDevice, crazyGameplay, crazyHappytime, crazyLoading, crazyLocale, onCrazyMute, onCrazyReady } from '../platform/crazygames';
import { RECORD_REPLACED_EVENT } from '../verse8/localServer';
import { adoptLocale } from '../core/i18n';
import { ResolutionGovernor } from '../gfx/ResolutionGovernor';
import { findSky } from '../track/builders/sky';
import { isTeamMode } from '../core/teams';
import { TeamMarkers } from './TeamMarkers';
import { tickPatternTime } from '../kart/patternShader';
import { OrientationGate } from './OrientationGate';
import { COACH_KEY, FIRST_RACE_KEY, KART_PICK_KEY, LOBBY_TOUR_KEY, TOMORROW_KEY, readCupRunRaw, writeCupRunRaw, VOLUME_KEY_MUSIC, VOLUME_KEY_SFX, hasFlag, readAutoAccel, readVolume, setFlag, writeVolume, readAutoNext } from './settingsStore';
import { PLATFORM } from '../core/platform';
import { RaceCoach } from '../ui/RaceCoach';

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
import { icon } from '../ui/icons';
import { showToast } from '../ui/toast';
import { createEmptyInput } from '../core/types';
import { LockSheet, type LockSheetHandlers } from '../ui/LockSheet';
import { LeaderboardPanel, localBestKey, readLocalBest } from '../ui/LeaderboardPanel';
import type { DailyChallenge } from '../core/daily';
import { DailyPanel } from '../ui/DailyPanel';
import { RescueDrones } from '../fx/RescueDrones';
import { GaragePanel } from '../ui/GaragePanel';
import type { CupView, NextUnlock, RewardView, TomorrowView, UnlockCard } from '../ui/ResultsScreen';
import { buildTrackThumbnail } from '../ui/trackThumbnails';
import { getLookThumbnail } from '../ui/kartThumbnails';
import { SettingsPanel } from '../ui/SettingsPanel';
import { consumePremiumRace, grantPremiumRaces, isPremium, onEntitlementsChange, serverReachable } from '../verse8/entitlements';
import {
  PLACEMENT_REWARDED_DOUBLE,
  PLACEMENT_REWARDED_MISSION,
  PLACEMENT_REWARDED_PREMIUM,
  PLACEMENT_REWARDED_STREAK,
  requestRewardedAd,
} from '../verse8/ads';
import { AttendancePanel } from '../ui/AttendancePanel';
import { MissionPanel } from '../ui/MissionPanel';
import { ladderCondition, missionTitle, tokenFullName, tokenName } from '../ui/progression/text';
import { RaceStatsTracker } from './RaceStatsTracker';
import {
  LEVEL_COINS,
  LEVEL_REWARDS,
  formatCoins,
  levelInfo,
  nextLadderStep,
  parseMissionKey,
  streakCoins,
  streakGift,
  type LadderView,
  type MissionStat,
} from '../core/economy';
import { computeTeamResult, teamOf } from '../core/teams';
import { submitDailyTime } from '../verse8/server';
import { buyPremium, initShop } from '../verse8/shop';
import { inVerse8Host } from '../verse8/embed';
import { submitTime, type RaceAward, type SubmitResult } from '../verse8/server';
import { OnlineController, type OnlineMode } from '../net/online';
import { OnlinePanel } from '../ui/OnlinePanel';
import { PHASE, type Snapshot, type StandingMsg } from '../net/protocol';
import { assignSlotCharacters } from '../net/roster';
import type { OnlineRaceConfig, RaceStanding } from '../core/types';
import { cosmeticOf, isUnlocked, sanitize, unpackCosmetics, type KartCosmetics } from '../core/cosmetics';
import { addRaceToCup, cupPlaceOf, cupsOpenedBy, getCup, nextCupGoal, parseCupRun, trophyFor, type CupEntry, type CupId } from '../core/cups';
import { CupResumeSheet } from '../ui/CupResumeSheet';
import { UnlockPopup, type UnlockPopupCard } from '../ui/UnlockPopup';
import { botName, localRacerName } from '../core/racerNames';
import {
  getCosmetics,
  getCupProgress,
  getEntitlements,
  getLadder,
  getOwned,
  getXp,
  openTrackCount,
  refreshEntitlements,
  watchForeground,
  saveCupResult,
  consumePremiumRace as consumeTicket,
  abandonRace,
  beginRace,
  buyKart,
  claimAttendance,
  doubleRaceCoins,
  finishRace,
  getMissions,
  getStreak,
  nextRaceIsIntro,
  swapMission,
} from '../verse8/entitlements';
import type { RaceKind } from '../verse8/server';

/** How long a first visit waits for its record, in seconds of drawn frames (see `tickFirstBoot`). */
const FIRST_BOOT_WAIT_HOSTED = 3;
const FIRST_BOOT_WAIT_LOCAL = 10;
const MIN_LOADING_SECONDS = 0.8;
/** Give up waiting for async shader compilation after this long and just go. */
const MAX_COMPILE_WAIT_SECONDS = 8;
const RESULTS_DELAY_SECONDS = 1.6;
/**
 * One-off races finished before the results screen offers the next cup instead of the next
 * circuit. Quick races only ever change the circuit; a cup is a trophy to win.
 */
const CUP_INVITE_AFTER = 2;
const MAX_STEPS_PER_FRAME = 8;
const SUN_DISTANCE = 90;
const EMPTY_KARTS: readonly IKart[] = [];

/** Display name of a circuit, for mission wording. Unknown ids read as themselves. */
function trackName(trackId: string): string {
  return TRACKS.find((tr) => tr.id === trackId)?.name ?? trackId;
}

/**
 * The reward line for a settlement reply. Nothing paid is never left unexplained: no answer, a
 * start the server never saw, and a result it would not accept each say so in their own words.
 */
/** A circuit's thumbnail as its own canvas: the builder hands out one shared, cached canvas. */
function trackThumbCopy(def: TrackDefinition): HTMLCanvasElement {
  const source = buildTrackThumbnail(def);
  const copy = source.cloneNode(false) as HTMLCanvasElement;
  copy.getContext('2d')?.drawImage(source, 0, 0);
  return copy;
}

/** A picture of one garage entry: the player's kart wearing just that. */
function tokenPicture(token: string, characterId: string): string | undefined {
  return getLookThumbnail(characterId, token, CHARACTERS.find((c) => c.id === characterId) as CharacterDef | undefined);
}

/**
 * The closest thing still to earn: a ladder rung the account does not already have, then the next
 * circuit, then the next level reward.
 */
function nextUnlockOf(ladder: LadderView | null): NextUnlock | null {
  if (!ladder) return null;
  const premium = getEntitlements().premium;
  const owned = getOwned();
  const rung = nextLadderStep(ladder, getStreak()?.total ?? 0, (step) => {
    const ref = cosmeticOf(step.token);
    return !ref || isUnlocked(ref.field, ref.id, premium, owned);
  });
  if (rung) return { text: ladderCondition(rung.step), value: rung.value, target: rung.step.at, reward: tokenFullName(rung.step.token) };
  const upcoming = TRACKS_BY_DIFFICULTY[ladder.tracks];
  if (upcoming) return { text: t('ladder.track'), value: 0, target: 1, reward: upcoming.name };
  const level = levelInfo(getXp()).level;
  const at = Object.keys(LEVEL_REWARDS)
    .map(Number)
    .sort((a, b) => a - b)
    .find((l) => l > level);
  return at ? { text: t('ladder.level', { n: at }), value: level, target: at, reward: tokenFullName(LEVEL_REWARDS[at]) } : null;
}

/** Tomorrow's check-in, assuming today's is (or will be) claimed. Null while the record is unknown. */
function tomorrowOf(characterId: string): TomorrowView | null {
  const streak = getStreak();
  if (!streak) return null;
  const day = (streak.claimed ? streak.n : streak.next) + 1;
  const gift = streakGift(streak.total + (streak.claimed ? 1 : 2));
  return {
    coins: streakCoins(day),
    gift: gift ? tokenFullName(gift) : undefined,
    image: gift ? tokenPicture(gift, characterId) : undefined,
  };
}

function rewardViewOf(award: RaceAward | null, characterId: string): RewardView {
  if (!award) return { state: 'failed' };
  if (!award.ok) {
    const lateStart = award.reason === 'no-race' || award.reason === 'bad-time';
    return { state: 'failed', why: lateStart ? t('rewards.noStart') : t('rewards.refused', { reason: award.reason ?? '?' }) };
  }
  const view: RewardView = {
    state: 'paid',
    coins: award.earned?.race ?? 0,
    balance: award.coins,
    rate: award.rate,
    races: award.races,
    // No rewarded ads on this build target: the offer is not made at all.
    canDouble: PLATFORM.rewardedAds && (award.doublesLeft ?? 0) > 0 && (award.earned?.race ?? 0) > 0,
  };
  if (award.xp !== undefined) {
    const levelUps = award.levelUps ?? 0;
    view.xp = { earned: award.xpEarned ?? 0, after: levelInfo(award.xp), levelUps, levelCoins: levelUps * LEVEL_COINS };
  }
  if (award.missions) {
    const list = award.missions.list;
    view.missionCount = { done: list.filter((m) => m.done).length, total: list.length };
    view.missions = (award.completed ?? []).map((key) => ({
      title: missionTitle(key, trackName),
      coins: list.find((m) => m.key === key)?.coins ?? 0,
    }));
    if (award.bonus) view.bonus = award.missions.bonusCoins;
  }
  if (award.unlocked?.length) view.unlocked = award.unlocked.map(tokenName);
  // What the race opened, each with its picture: circuits first, then garage entries.
  const opened: UnlockCard[] = [];
  for (const id of award.newTracks ?? []) {
    const def = TRACKS.find((tr) => tr.id === id);
    if (def) opened.push({ kind: 'track', name: def.name, image: trackThumbCopy(def), ref: def.id });
  }
  for (const token of award.unlocked ?? [])
    opened.push({ kind: 'item', name: tokenFullName(token), image: tokenPicture(token, characterId), ref: token });
  view.opened = opened;
  view.nextUnlock = nextUnlockOf(award.ladder ?? getLadder());
  // The day's second race is where tomorrow is mentioned: one race in, they are staying a while.
  view.tomorrow = award.races === 2 ? tomorrowOf(characterId) : null;
  return view;
}

function framingFor(panel: MenuPanel): MenuFraming {
  return panel === 'characterSelect' ? 'characters' : panel === 'trackSelect' ? 'tracks' : 'title';
}

interface PartialRace {
  track: ITrack | null;
  karts: IKart[];
  items: IItemManager | null;
  followCamera: FollowCamera | null;
  hud: HUD | null;
  teamMarkers?: TeamMarkers;
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
  /** Team chevrons above karts (no sprites in solo). */
  teamMarkers: TeamMarkers;
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
  /** The player's finish has been sent for settlement (once per race). */
  settled?: boolean;
  /** What this finish opened has been put up in front of the results (or there was nothing). */
  unlocksShown?: boolean;
  /** What the local player did this race, for the missions. */
  stats?: RaceStatsTracker;
  /**
   * A finish held back until the race is over: a points team race is not won or lost until
   * everyone is in. Settled from the results screen, or on leaving if the player does not wait.
   */
  heldFinish?: { place: number; retired: boolean; seconds: number };
  /** Items are disabled in online races (phase 2). */
  itemsEnabled: boolean;
  /** The environment probe has been filled for this race. */
  envCaptured?: boolean;
  /** The player steered, braked, drifted, used an item or pressed the throttle at least once. */
  playerActed?: boolean;
}



export class Game {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly uiRoot: HTMLElement;
  private readonly touch: TouchControls;
  private unsubLang: (() => void) | null = null;
  /** Keeps the online identity's nickname in step with the account record. */
  private unsubOnlineNick: (() => void) | null = null;
  private lockSheet: LockSheet;
  private leaderboard: LeaderboardPanel;
  private settings: SettingsPanel;
  private garage: GaragePanel;
  /** Last character the player picked; the garage previews the kart they will actually drive. */
  private garageCharacterId = 'zippy';
  /** In-progress Grand Prix. Null outside a cup; cleared on quitting to the menu. */
  private cup: { id: CupId; index: number; table: CupEntry[]; settings: RaceSettings } | null = null;
  /** Today's challenge, while a daily run is in progress. Null for every other race. */
  private dailyRun: DailyChallenge | null = null;
  private daily: DailyPanel;
  private lastSubmit: SubmitResult | null = null;
  /**
   * What the current race paid: null for a race that pays nothing, `pending` from the finish line
   * until the server answers. Shown on the results screen whichever of the two arrives first.
   */
  private reward: RewardView | null = null;
  /** The settled race the double-coins offer applies to. */
  private rewardRaceId: string | null = null;
  /** The circuit the settled race opened, if it opened one: NEXT RACE goes there. */
  private openedTrackId: string | null = null;
  private missions: MissionPanel;
  private attendance: AttendancePanel;
  /** The check-in window has opened by itself once this session; after that it is the button's job. */
  private attendanceOffered = false;
  private online: OnlineController | null = null;
  private onlinePanel: OnlinePanel;
  /** The first-race coach, while it is on screen. */
  private coach: RaceCoach | null = null;
  /**
   * Set while a device that has never been here waits to learn whether its account is new. Until
   * that is known the lobby stays hidden and nothing opens by itself.
   */
  private firstBoot: { alive: number; limit: number; off: () => void } | null = null;

  private readonly input: InputManager;
  private readonly audio: IAudioEngine;
  private readonly particles: ParticleSystem;
  private readonly rearView: RearView;
  private readonly rescueDrones = new RescueDrones();
  private readonly orientationGate: OrientationGate;
  private readonly postfx: PostFX;
  /** Reflections and ambient light for the race scene; null where the device cannot make them. */
  private envProbe: EnvProbe | null = null;
  private envProbeTried = false;
  private postfxOk = true;

  private readonly backdrop: MenuBackdrop;
  private mainMenu: MainMenu;
  private results: ResultsScreen;
  private pauseMenu: PauseMenu;
  private loading: LoadingScreen;
  private readonly muteIndicator: HTMLElement;
  private readonly muteLabel: HTMLElement;

  private state: GameState = 'boot';
  private prePauseState: GameState = 'racing';
  private race: RaceContext | null = null;
  private pendingSettings: RaceSettings | null = null;
  private loadingElapsed = 0;
  private loadingFrames = 0;
  private loadingProgress = 0;
  private shadersReady = false;
  /** Materials of the race being loaded whose programs are still compiling; null when none. */
  private compiling: Set<THREE.Material> | null = null;
  /** One of each item mesh, parked in the scene so the warm-up compile sees them. */
  private warmGroup: THREE.Group | null = null;

  private rafId = 0;
  private lastTime = -1;
  /** Lowers the render resolution when frames run long (not under automation: its frames are not real time). */
  private governor: ResolutionGovernor;
  private readonly governed = typeof navigator === 'undefined' || !navigator.webdriver;
  private resolutionScale = 1;
  /** Seconds the lobby has been up (-1 once the racer sheet has been asked for). */
  private menuIdle = 0;
  /** Races in a row the player finished without touching the controls. */
  private idleRaces = 0;
  /** One-off races finished since the last cup: after `CUP_INVITE_AFTER`, results offer one. */
  private racesSinceCup = 0;
  /** The cup the results screen's primary button is offering right now, if any. */
  private cupInvite: CupId | null = null;
  /** A kart picked on the results screen for the next race, until that race starts. */
  private kartChoice: string | null = null;
  /** The results screen on show is a new player's very first finish (see `setFirstFinish`). */
  private firstFinish = false;
  private readonly lobbyTour: LobbyTour;
  /** "Carry on with the cup?" in the lobby, for a cup left between races. */
  private cupSheet: CupResumeSheet;
  /** What a race opened, one popup at a time in front of the results (src/ui/UnlockPopup.ts). */
  private readonly unlockPopup: UnlockPopup;
  private splashUp = true;
  /** The player's own mute (M key), and the portal's, which outranks it. */
  private userMuted = false;
  private platformMuted = false;
  /** The pause menu is up because the window lost focus, not because the player asked for it. */
  private focusPaused = false;
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
    // Asking the driver whether a shader compiled makes the page wait until it has: over a second
    // of start-up, to learn something a shipped build does nothing with. The dev server still asks.
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    // The quality tier is read off this context's driver name, before anything asks for it.
    initQuality(this.renderer.getContext());
    this.governor = new ResolutionGovernor({ minScale: quality().minResolutionScale });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    // PCF with the light's own blur radius (set per race from the quality tier). The "soft"
    // type is gone from three and only logged a warning before falling back to this one.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    // Far enough to reach the last ring of mountains from any corner of a circuit.
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2400);
    this.camera.position.set(0, 3, 8);
    this.scene.add(this.camera);

    this.uiRoot = el('div', '', undefined, container);
    this.uiRoot.id = 'ui';

    // Inside the Verse8 host: connect to the gameserver right away (entitlements, records,
    // nickname) and initialise VXShop. Without this the first server call only happened
    // after a finished race, so the records panel looked offline and VX never opened.
    initShop();
    void refreshEntitlements();
    // Two devices share one account. Coming back to the game re-reads the record, so a ticket
    // spent on the phone is not still showing as available on the desktop.
    watchForeground();


    // ---------------------------------------------------------- systems
    this.input = new InputManager();
    this.audio = new AudioEngine();
    this.audio.setMusicVolume(readVolume(VOLUME_KEY_MUSIC, 1));
    this.audio.setSfxVolume(readVolume(VOLUME_KEY_SFX, 1));
    this.particles = new ParticleSystem();
    this.scene.add(this.particles.object);
    this.scene.add(this.rescueDrones.object);
    this.postfx = new PostFX();
    this.rearView = new RearView();

    try {
      this.postfx.init(this.renderer, this.scene, this.camera);
    } catch (err) {
      console.error('[Game] PostFX init failed, using plain rendering', err);
      this.postfxOk = false;
    }

    // ---------------------------------------------------------- ui
    this.backdrop = new MenuBackdrop();
    // The showcase kart is built before the server's saved look arrives; repaint it when the look (or the
    // premium flag that gates it) changes, or the lobby kept the default paint until the next garage save.
    let shownLook = '';
    this.unsubs.push(
      onEntitlementsChange((ent) => {
        const look = `${ent.cos ?? ''}|${ent.premium ? 1 : 0}`;
        if (look === shownLook) return;
        shownLook = look;
        this.safe(() => this.backdrop.applyCosmetics(getCosmetics()));
      }),
    );
    this.mainMenu = this.buildMainMenu();
    this.results = this.buildResults();
    this.pauseMenu = this.buildPauseMenu();
    this.loading = new LoadingScreen(this.uiRoot);
    this.lockSheet = new LockSheet(this.uiRoot);
    this.leaderboard = this.buildLeaderboard();
    this.settings = this.buildSettings();
    this.garage = this.buildGarage();
    this.daily = this.buildDaily();
    this.missions = this.buildMissions();
    this.attendance = this.buildAttendance();
    this.unsubs.push(onEntitlementsChange(() => this.maybeOfferAttendance()));
    this.lobbyTour = new LobbyTour(this.uiRoot);
    this.lobbyTour.onDone = (acted) => {
      setFlag(LOBBY_TOUR_KEY);
      // Skipped or tapped through: the lobby is the player's again, check-in and all.
      if (!acted) this.maybeOfferAttendance();
    };
    this.cupSheet = this.buildCupSheet();
    this.unlockPopup = this.buildUnlockPopup();
    this.onlinePanel = this.buildOnlinePanel();
    this.muteIndicator = el('div', 'mute-indicator', undefined, this.uiRoot);
    this.muteIndicator.appendChild(icon('mute'));
    this.muteLabel = el('span', '', t('mute'), this.muteIndicator);
    this.touch = new TouchControls(this.uiRoot);
    this.input.attachTouch(this.touch);
    // Phones must play in landscape (src/game/OrientationGate.ts).
    this.orientationGate = new OrientationGate(
      this.uiRoot,
      () => this.touch.isEnabled || Boolean(window.matchMedia?.('(pointer: coarse)').matches),
      (gated) => {
        this.uiRoot.classList.toggle('gated', gated);
        if (gated && this.state === 'racing') this.pause();
      },
    );

    // ---------------------------------------------------------- listeners
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('pointerdown', this.onGesture, { passive: true });
    window.addEventListener('keydown', this.onGesture);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.unsubLang = events.on('ui:langChange', () => this.onLangChange());
    this.hookPortal();

    this.onResize();
  }

  // ------------------------------------------------------------------ public

  start(): void {
    if (this.state !== 'boot') return;
    this.showMenu('title');
    this.maybeNudgeNickname();
    this.armFirstRace();
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
    this.safe(() => this.orientationGate.dispose());
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
    this.unsubOnlineNick?.();
    this.unsubLang = null;
    this.input.attachTouch(null);
    this.touch.dispose();
    this.lockSheet.dispose();
    this.cupSheet.dispose();
    this.unlockPopup.dispose();
    this.leaderboard.dispose();
    this.settings.dispose();
    this.garage.dispose();
    this.daily.dispose();
    this.missions.dispose();
    this.attendance.dispose();
    this.onlinePanel.dispose();
    this.online?.dispose();
    this.input.dispose();
    this.safe(() => this.audio.dispose());
    this.safe(() => this.particles.dispose());
    this.safe(() => this.postfx.dispose());
    this.safe(() => this.envProbe?.dispose());
    this.safe(() => this.rearView.dispose());
    this.safe(() => this.rescueDrones.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.uiRoot.remove();
  }

  // ------------------------------------------------------------- ui builders

  private buildMainMenu(): MainMenu {
    const menu = new MainMenu(this.uiRoot, CHARACTERS as readonly CharacterDef[], TRACKS_BY_DIFFICULTY);
    menu.onHighlight = (id) => {
      this.garageCharacterId = id;
      this.backdrop.setCharacter(getCharacter(id));
    };
    menu.onPanelChange = (panel) => this.onMenuPanel(panel);
    menu.onStart = (settings) => void this.startRaceGated(settings);
    menu.onLockedAttempt = (c) => this.lockSheet.show(c, this.lockSheetHandlers(c));
    menu.onRecords = () => this.leaderboard.show(TRACKS[0]?.id ?? 'sunny_circuit');
    menu.onSettings = () => this.settings.show();
    menu.onGarage = () => this.garage.show(this.garageCharacterId);
    menu.onDaily = () => this.daily.show();
    menu.onMissions = () => this.missions.show();
    menu.onAttendance = () => this.attendance.show();
    menu.onStartCup = (cupId, settings) => this.startCup(cupId, settings);
    menu.onOnline = () => this.onlinePanel.show();
    return menu;
  }

  private startCup(cupId: CupId, settings: RaceSettings): void {
    this.dailyRun = null;
    this.cupInvite = null;
    this.racesSinceCup = 0;
    this.cup = { id: cupId, index: 0, table: [], settings };
    this.saveCupRun(0);
    void this.startRaceGated(settings);
  }

  /**
   * Keeps the cup in progress on the device: `done` races finished, the table so far. Leaving
   * for the lobby between races (or closing the tab) then costs nothing; the lobby offers to
   * carry on (`maybeOfferCupResume`).
   */
  private saveCupRun(done: number): void {
    const cup = this.cup;
    if (!cup) return;
    writeCupRunRaw(
      JSON.stringify({ id: cup.id, done, table: cup.table, characterId: cup.settings.characterId, difficulty: cup.settings.difficulty }),
    );
  }

  private buildCupSheet(): CupResumeSheet {
    const sheet = new CupResumeSheet(this.uiRoot);
    sheet.onContinue = () => this.resumeCup();
    sheet.onDrop = () => {
      writeCupRunRaw(null);
      this.maybeOfferAttendance();
    };
    return sheet;
  }

  /** In the lobby with a cup left between races: ask whether to carry on with it. */
  private maybeOfferCupResume(): void {
    if (this.state !== 'title' || this.firstBoot || this.cupSheet.isVisible || this.overlayOpen() || this.attendance.isVisible) return;
    if (new URLSearchParams(location.search).has('auto')) return;
    const run = parseCupRun(readCupRunRaw());
    if (!run) return;
    const def = getCup(run.id);
    const me = run.table.find((e) => e.isPlayer);
    this.cupSheet.show(t(`cup.${run.id}`), run.done + 1, def.trackIds.length, me?.points ?? 0);
  }

  /** Runs the stored cup's next race, with the table it had. */
  private resumeCup(): void {
    const run = parseCupRun(readCupRunRaw());
    if (!run) return;
    const trackId = getCup(run.id).trackIds[run.done];
    const track = TRACKS.find((tr) => tr.id === trackId);
    if (!track) {
      writeCupRunRaw(null);
      return;
    }
    const settings: RaceSettings = {
      characterId: run.characterId,
      trackId,
      difficulty: run.difficulty,
      mode: 'solo',
      laps: track.laps > 0 ? track.laps : DEFAULT_LAPS,
    };
    this.dailyRun = null;
    this.cupInvite = null;
    this.racesSinceCup = 0;
    this.cup = { id: run.id, index: run.done, table: run.table, settings };
    void this.startRaceGated(settings);
  }

  /**
   * The cup a one-off race's results should offer instead of the next circuit: the next one to
   * win, once a few races have gone by since the last cup. Never during the intro races (the
   * first-session walk expects NEXT RACE there), the daily, online, or an unranked run.
   */
  private cupInviteFor(r: RaceContext, finished: boolean): CupId | null {
    if (!finished || this.cup || this.dailyRun || r.online || r.settings.intro || this.isUnrankedRun(r)) return null;
    if (this.racesSinceCup < CUP_INVITE_AFTER) return null;
    return nextCupGoal(getCupProgress());
  }

  /** Starts the next leg on the cup's own track list, keeping kart, mode and difficulty. */
  private async advanceCup(): Promise<void> {
    const cup = this.cup;
    if (!cup) return;
    const def = getCup(cup.id);
    cup.index += 1;
    if (cup.index >= def.trackIds.length) {
      // To the lobby, where the trophy just won stands on the shelf beside the next cup.
      this.cup = null;
      this.returnToMenu('title');
      this.offerTomorrow();
      return;
    }
    const trackId = def.trackIds[cup.index];
    const trackDef = TRACKS.find((tr) => tr.id === trackId);
    await this.startRaceGated({
      ...cup.settings,
      trackId,
      laps: trackDef && trackDef.laps > 0 ? trackDef.laps : cup.settings.laps,
    });
  }

  /**
   * Banks the cup result. Fire-and-forget: the placing is cached locally first, so the unlock is
   * already visible on the next screen whether or not the server answers.
   */
  private finishCup(): void {
    const cup = this.cup;
    if (!cup) return;
    const place = cupPlaceOf(cup.table);
    if (place > 0) void saveCupResult(cup.id, place);
    if (place === 1) crazyHappytime('cup');
  }

  private buildResults(): ResultsScreen {
    const results = new ResultsScreen(this.uiRoot);
    results.onNextRace = () => {
      const invite = this.cupInvite;
      this.cupInvite = null;
      // The very first finish goes to the lobby: the tour there ends on the Rookie Cup.
      if (this.firstFinish) {
        this.firstFinish = false;
        this.returnToMenu('title');
        return;
      }
      if (this.race?.online) this.returnToRoom();
      else if (this.cup) void this.advanceCup();
      else if (this.race && invite) {
        const first = TRACKS.find((tr) => tr.id === getCup(invite).trackIds[0]);
        if (first) {
          this.startCup(invite, {
            characterId: this.takeKartChoice(this.race.settings.characterId),
            trackId: first.id,
            difficulty: this.race.settings.difficulty,
            mode: 'solo',
            laps: first.laps > 0 ? first.laps : DEFAULT_LAPS,
          });
        }
      } else if (this.race) {
        this.dailyRun = null;
        const next = this.nextTrackFor(this.race);
        void this.startRaceGated({
          ...this.race.settings,
          characterId: this.takeKartChoice(this.race.settings.characterId),
          trackId: next.id,
          laps: next.laps > 0 ? next.laps : this.race.settings.laps,
        });
      }
    };
    results.onRaceAgain = () => {
      this.declineCupInvite();
      if (this.race?.online) this.returnToRoom();
      else if (this.race) {
        this.dailyRun = null;
        void this.startRaceGated({ ...this.race.settings, characterId: this.takeKartChoice(this.race.settings.characterId) });
      }
    };
    results.onRecords = () => {
      if (this.race) this.leaderboard.show(this.race.trackDef.id, { submit: this.lastSubmit });
    };
    results.onChangeTrack = () => {
      this.declineCupInvite();
      if (this.race?.online) this.returnToRoom();
      else this.returnToMenu('trackSelect');
    };
    results.onMainMenu = () => {
      this.declineCupInvite();
      if (this.race?.online) void this.online?.leave();
      this.returnToMenu('title');
      this.offerTomorrow();
    };
    results.onDouble = () => this.doubleReward();
    results.onPickKart = (id) => {
      this.kartChoice = id;
      this.garageCharacterId = id;
      this.mainMenu.selectCharacter(id);
    };
    return results;
  }

  /** The kart for the race about to start: the one picked on the results screen, once. */
  private takeKartChoice(fallback: string): string {
    const id = this.kartChoice ?? fallback;
    this.kartChoice = null;
    return id;
  }

  /**
   * A new player's first results: their first race was in the kart they were handed, so offer
   * the others they can drive — the one they had, and the first free kart of each other weight
   * class. Once per device.
   */
  /** A new player's very first finish on this device (the same moment the kart row is offered). */
  private isFirstFinish(r: RaceContext, finished: boolean): boolean {
    if (!finished || hasFlag(KART_PICK_KEY) || r.online || this.cup || this.dailyRun || this.isUnrankedRun(r)) return false;
    // A new account only: one older than the unlock ladder, or with races behind it on another
    // device, has been here before. (This finish may or may not be counted yet.)
    const ladder = getLadder();
    return Boolean(ladder && !ladder.all && ladder.finishes <= 1);
  }

  private maybeOfferKartPick(r: RaceContext, finished: boolean): void {
    if (!this.isFirstFinish(r, finished)) return;
    const current = r.settings.characterId;
    const all = CHARACTERS as readonly CharacterDef[];
    const picks: CharacterDef[] = [];
    const mine = all.find((c) => c.id === current);
    if (mine) picks.push(mine);
    for (const cls of ['light', 'medium', 'heavy'] as const) {
      const c = all.find((k) => k.weightClass === cls && !isPremium(k.id) && !picks.includes(k));
      if (c && !picks.some((p) => p.weightClass === cls)) picks.push(c);
    }
    setFlag(KART_PICK_KEY);
    this.results.showKartPick(
      picks.map((c) => ({ id: c.id, name: c.name, color: c.color, thumb: getKartThumbnail(c.id) })),
      current,
    );
    // A first visitor never stood in the lobby, where the pictures are drawn: draw these three
    // now, one a frame behind the results screen (the next race turns drawing off again).
    const missing = picks.filter((c) => !getKartThumbnail(c.id));
    if (missing.length > 0) {
      setKartThumbnailsAllowed(true);
      void ensureKartThumbnails(missing).then((map) => {
        if (this.race !== r || this.state !== 'results') return;
        for (const c of missing) {
          const url = map.get(c.id);
          if (url) this.results.setKartPickThumb(c.id, url);
        }
      });
    }
  }

  /** The lobby tour is still to come for this player: nothing else opens over the lobby first. */
  private tourDue(): boolean {
    if (hasFlag(LOBBY_TOUR_KEY) || !hasFlag(KART_PICK_KEY) || new URLSearchParams(location.search).has('auto')) return false;
    // The first-finish screen was shown on this device; the tour follows it.
    const ladder = getLadder();
    return Boolean(ladder && !ladder.all);
  }

  /**
   * The lobby tour (src/ui/LobbyTour.ts), once per device, for a player who has raced but has
   * not stood in the lobby with nothing over it before. Not for accounts older than the unlock
   * ladder: they know the lobby.
   */
  private maybeLobbyTour(): void {
    if (this.lobbyTour.isActive || hasFlag(LOBBY_TOUR_KEY) || this.firstBoot || this.state !== 'title') return;
    if (this.overlayOpen() || this.attendance.isVisible) return;
    if (!this.tourDue()) return;
    const at = this.mainMenu.tourTargets();
    // What the lobby holds first, then the cup last, with its button starting it: the tour is
    // there to send a new player into a cup.
    const goal = nextCupGoal(getCupProgress());
    this.lobbyTour.start([
      { target: at.garage, text: 'tour.garage' },
      { target: at.missions, text: 'tour.missions' },
      { target: at.daily, text: 'tour.daily' },
      {
        target: at.cup,
        text: 'tour.cup',
        action: goal ? { label: t('cup.invite', { cup: t(`cup.${goal}`) }), run: () => this.mainMenu.startCupGoalFromTour() } : undefined,
      },
    ]);
  }

  /** The player went another way from a cup offer: ask again a few races later, not next race. */
  private declineCupInvite(): void {
    if (this.cupInvite) this.racesSinceCup = 0;
    this.cupInvite = null;
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
    // A nickname that arrives (or changes) after the online controller was built has to reach the
    // room, or the lobby keeps showing the placeholder to everyone else.
    this.unsubs.push(
      onEntitlementsChange((ent) => {
        if (ent.nickname) this.online?.setNick(ent.nickname);
      }),
    );
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
      TRACKS_BY_DIFFICULTY,
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
      // The look travels with the identity: everyone in the room paints this kart the same way.
      { nick, characterId: this.mainMenu.highlightedCharacter.id, cos: ent.cos },
      { trackId: TRACKS[0]?.id ?? 'sunny_circuit', difficulty: 'normal', laps: DEFAULT_LAPS },
    );
    // The identity above is a snapshot, and on a cold start the nickname has often not arrived
    // yet — which is why a host who had set one still showed as RACER to everyone, in the lobby,
    // in the race and on the standings. Follow the record instead of sampling it once.
    this.unsubOnlineNick?.();
    this.unsubOnlineNick = onEntitlementsChange((e) => {
      if (e.loaded && e.nickname) c.setNick(e.nickname);
    });
    const known = getEntitlements();
    if (known.loaded && known.nickname) c.setNick(known.nickname);

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
    // A client whose race ended without its own finish event (host lost) still gets settled.
    const mine = mapped.find((s) => s.isPlayer);
    if (mine) this.settleRace(r, mine.place, !(mine.finishTime > 0), mine.finishTime);
    this.results.show(mapped, r.settings.mode ?? 'solo', true);
    if (this.reward) this.results.showRewards(this.reward);
    this.setState('results');
    this.playMusic('results');
  }

  private buildLeaderboard(): LeaderboardPanel {
    const lb = new LeaderboardPanel(this.uiRoot, TRACKS_BY_DIFFICULTY, CHARACTERS as readonly CharacterDef[]);
    lb.onSetNickname = () => {
      lb.hide();
      this.settings.show();
    };
    return lb;
  }

  private buildDaily(): DailyPanel {
    const daily = new DailyPanel(this.uiRoot, TRACKS, CHARACTERS as readonly CharacterDef[]);
    daily.onStart = (challenge, characterId) => {
      daily.hide();
      this.cup = null;
      this.dailyRun = challenge;
      // The challenge IS the settings: seeded circuit, seeded rule, seeded class.
      void this.startRaceGated({
        characterId,
        trackId: challenge.trackId,
        difficulty: challenge.rule.difficulty,
        laps: challenge.laps,
        mode: 'solo',
      });
    };
    return daily;
  }

  private buildMissions(): MissionPanel {
    const panel = new MissionPanel(this.uiRoot, trackName);
    panel.onSwap = async (index) => {
      if (!(await requestRewardedAd(PLACEMENT_REWARDED_MISSION))) {
        showToast(t('v8.lock.adFailed'), 'error');
        return;
      }
      const r = await swapMission(index);
      showToast(t(r?.ok ? 'mis.swapped' : 'mis.swapFailed'), r?.ok ? 'info' : 'error');
    };
    return panel;
  }

  private buildAttendance(): AttendancePanel {
    const panel = new AttendancePanel(this.uiRoot);
    panel.pictureOf = (token) => tokenPicture(token, this.garageCharacterId);
    panel.onClaim = async (recover) => {
      // Carrying a broken run on is what the ad pays for; restarting or an unbroken run is free.
      // Where there are no rewarded ads, carrying the run on is simply offered.
      if (recover === true && PLATFORM.rewardedAds && !(await requestRewardedAd(PLACEMENT_REWARDED_STREAK))) {
        showToast(t('v8.lock.adFailed'), 'error');
        return;
      }
      const r = await claimAttendance(recover);
      if (!r) {
        showToast(t('att.failed'), 'error');
        return;
      }
      if (!r.ok) return; // already claimed, or the choice is still open: the panel shows which
      showToast(t('att.got', { n: formatCoins(r.reward) }), 'info');
      for (const token of r.unlocked) showToast(t('rewards.unlocked', { name: tokenFullName(token) }), 'info', 6000);
    };
    return panel;
  }

  /**
   * Opens the check-in window by itself, once a session, the first time the lobby is on screen
   * with today unclaimed. Not during dev auto-runs, which are driven by scripts that expect the
   * lobby to be the lobby.
   */
  private maybeOfferAttendance(): void {
    if (this.attendanceOffered || this.firstBoot || this.state !== 'title') return;
    // The tour goes first; the check-in waits for the lobby after it.
    if (this.lobbyTour?.isActive || this.tourDue()) return;
    const streak = getStreak();
    if (!streak || streak.claimed) return;
    if (new URLSearchParams(location.search).has('auto')) return;
    if (this.overlayOpen()) return;
    this.attendanceOffered = true;
    this.attendance.show();
  }

  /** A panel is open over the lobby (the check-in window itself not counted). */
  private overlayOpen(): boolean {
    return (
      this.settings.isVisible ||
      this.garage.isVisible ||
      this.daily.isVisible ||
      this.missions.isVisible ||
      this.leaderboard.isVisible ||
      this.lockSheet.isVisible ||
      this.cupSheet.isVisible ||
      this.unlockPopup.isVisible ||
      this.onlinePanel.isVisible
    );
  }

  /**
   * First visit: a brand-new account skips the lobby and is put straight into a race on the
   * easiest circuit with the default kart. Whether the account is new is the server's to say, so
   * the lobby is held back (hidden, nothing opening by itself) until the record arrives. Once per
   * device: after this decision, or for anyone the server already knows, the game opens on the
   * lobby as it always did.
   *
   * Not under `?auto` or `?lobby`: scripts and tools that drive the menus expect to find them.
   */
  private armFirstRace(): void {
    const params = new URLSearchParams(location.search);
    if (hasFlag(FIRST_RACE_KEY) || params.has('lobby') || this.isUnrankedRun(null)) return;
    this.uiRoot.classList.add('first-boot');
    const decide = (): void => {
      const ent = getEntitlements();
      if (!this.firstBoot || !ent.loaded) return;
      this.releaseFirstBoot();
      setFlag(FIRST_RACE_KEY);
      const ladder = ent.ladder;
      const fresh = Boolean(ladder && !ladder.all && ladder.races === 0);
      if (fresh && this.state === 'title' && !this.overlayOpen() && !this.attendance.isVisible) this.startFirstRace();
      else this.maybeOfferAttendance();
    };
    this.firstBoot = {
      off: onEntitlementsChange(decide),
      alive: 0,
      // A gameserver may not answer; a record kept in this browser always does, once its code
      // has loaded, so that wait is only there for a page that could not load it at all.
      limit: PLATFORM.hosted && inVerse8Host() ? FIRST_BOOT_WAIT_HOSTED : FIRST_BOOT_WAIT_LOCAL,
    };
    decide();
  }

  private releaseFirstBoot(): void {
    const boot = this.firstBoot;
    if (!boot) return;
    this.firstBoot = null;
    boot.off();
    this.uiRoot.classList.remove('first-boot');
  }

  /**
   * The wait for a first visitor's record, counted in frames the game actually drew.
   *
   * This was a three-second timer set while the game was still starting up. On a slow device the
   * start-up alone holds the main thread for longer than that, so the timer was already due the
   * moment the page could run anything, fired before the record's reply could be read, and the
   * new player got the lobby instead of the race. A frame's worth of waiting is now at most a
   * tenth of a second however long the frame took: time the page spent blocked is not time the
   * record was given.
   */
  private tickFirstBoot(seconds: number): void {
    const boot = this.firstBoot;
    if (!boot) return;
    boot.alive += Math.min(Math.max(seconds, 0), 0.1);
    if (boot.alive < boot.limit) return;
    // The record did not come: show the lobby, and ask again on the next visit.
    this.releaseFirstBoot();
    this.maybeOfferAttendance();
  }

  private startFirstRace(): void {
    const track = TRACKS_BY_DIFFICULTY[0] ?? TRACKS[0];
    const character = (CHARACTERS as readonly CharacterDef[])[0];
    if (!track || !character) return;
    this.cup = null;
    this.dailyRun = null;
    void this.startRaceGated({
      characterId: character.id,
      trackId: track.id,
      difficulty: 'normal',
      laps: track.laps > 0 ? track.laps : DEFAULT_LAPS,
      mode: 'solo',
    });
  }

  /** The results screen's "watch an ad, double the coins". */
  private async doubleReward(): Promise<void> {
    const raceId = this.rewardRaceId;
    const view = this.reward;
    if (!raceId || !view || view.state !== 'paid' || !view.canDouble) return;
    if (!(await requestRewardedAd(PLACEMENT_REWARDED_DOUBLE))) {
      showToast(t('v8.lock.adFailed'), 'error');
      return;
    }
    const r = await doubleRaceCoins(raceId);
    if (!r || !r.ok) {
      showToast(t('rewards.doubleFailed'), 'error');
      // Spent, or the day's five are used: either way the offer is gone.
      if (r && this.reward === view) this.showReward({ ...view, canDouble: false });
      return;
    }
    if (this.reward === view) this.showReward({ ...view, canDouble: false, doubled: r.added, balance: r.coins });
  }

  private buildGarage(): GaragePanel {
    const garage = new GaragePanel(this.uiRoot);
    // The showcase kart on the title screen is the same kart the garage just painted. Wired here
    // rather than next to the menu, because the menu is built before `this.garage` exists.
    garage.onSaved = () => this.safe(() => this.backdrop.applyCosmetics(getCosmetics()));
    garage.onUnlock = () => {
      const result = buyPremium();
      if (result === 'unregistered') showToast(t('v8.lock.unregistered'), 'error');
      else if (result === 'blocked') showToast(t('v8.lock.buyFailed'), 'error');
    };
    return garage;
  }

  private buildSettings(): SettingsPanel {
    return new SettingsPanel(this.uiRoot, {
      getVolumes: () => ({ music: this.audio.musicVolumeLevel, sfx: this.audio.sfxVolumeLevel }),
      onVolume: (kind, v) => this.setVolume(kind, v),
      onGraphics: (tier) => this.setGraphics(tier),
    });
  }

  /**
   * A new graphics quality from the settings panel. What belongs to the renderer changes now
   * (resolution, multisampling, bloom); what was built for the circuit on
   * screen — its plants, its shadow map, its sky — is rebuilt with the next race.
   */
  private setGraphics(tier: GfxTier | 'auto'): void {
    setTier(tier);
    this.applyGraphicsTier();
  }

  /** Rebuilds what the renderer holds for the tier now in force, and starts the governor afresh. */
  private applyGraphicsTier(): void {
    this.governor = new ResolutionGovernor({ minScale: quality().minResolutionScale });
    this.resolutionScale = 1;
    if (this.postfxOk) {
      try {
        this.postfx.setLean(false);
        this.postfx.init(this.renderer, this.scene, this.camera);
      } catch (err) {
        console.error('[Game] PostFX re-init failed, using plain rendering', err);
        this.postfxOk = false;
      }
    }
    this.onResize();
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
        // The total, not just the delta: "+3" on its own left QA unable to tell a double grant
        // from a grant on top of tickets they already had.
        showToast(t('v8.lock.granted', { n: String(getEntitlements().premiumRaces) }), 'info');
        this.lockSheet.hide();
        this.mainMenu.proceedFromCharacter();
      },
      onCoins: async () => {
        const r = await buyKart(def.id);
        if (!r || !r.ok) {
          showToast(t(r?.reason === 'short' ? 'buy.notEnough' : 'buy.failed'), 'error');
          return;
        }
        this.lockSheet.hide();
        this.mainMenu.proceedFromCharacter();
        // A new racer: on the turntable, in its own colours, before anything else.
        this.unlockPopup.show([{ kind: 'racer', name: def.name, characterId: def.id }], { characterId: def.id, cosmetics: {} });
      },
      onBuy: () => {
        const result = buyPremium();
        if (result === 'unregistered') showToast(t('v8.lock.unregistered'), 'error');
        else if (result === 'blocked') showToast(t('v8.lock.buyFailed'), 'error');
        // A completed purchase lands via refreshEntitlements → badges update; the sheet stays
        // open so the player can continue once the kart shows as unlocked.
        else this.lockSheet.hide();
      },
      onOther: () => this.lockSheet.hide(),
    };
  }

  /**
   * Where NEXT RACE goes: the circuit this race just opened, else the next open one after it in
   * the picker's easy-to-hard order, wrapping from the last open one to the first.
   */
  private nextTrackFor(r: RaceContext): TrackDefinition {
    const order = TRACKS_BY_DIFFICULTY;
    const opened = this.openedTrackId ? order.find((tr) => tr.id === this.openedTrackId) : undefined;
    if (opened) return opened;
    const open = openTrackCount(order.length);
    const at = order.findIndex((tr) => tr.id === r.trackDef.id);
    // A cup or the daily may have run on a circuit that is not open yet: start from the top.
    return order[at >= 0 && at < open ? (at + 1) % open : 0] ?? r.trackDef;
  }

  /**
   * Coming back to the lobby from a race: once a day, the check-in window opens on its "tomorrow"
   * side even though today is claimed, so the player leaves knowing what tomorrow is worth. (With
   * today unclaimed it opens anyway, and shows the same thing after the claim.)
   */
  private offerTomorrow(): void {
    if (this.state !== 'title' || this.attendance.isVisible || this.overlayOpen()) return;
    const streak = getStreak();
    if (!streak?.claimed) return;
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (localStorage.getItem(TOMORROW_KEY) === today) return;
      localStorage.setItem(TOMORROW_KEY, today);
    } catch {
      return;
    }
    this.attendance.show();
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

  /**
   * A run that must not earn anything: an AI drove it, or the balance was tuned from the URL.
   * The same rule that keeps such a run off the records board.
   */
  private isUnrankedRun(r: RaceContext | null): boolean {
    const params = new URLSearchParams(location.search);
    if (params.has('auto') || r?.playerAutoDriverBeforeFinish) return true;
    return Array.from(params.keys()).some((k) => k.startsWith('b.'));
  }

  /**
   * The race clock as this machine knows it. A mirrored client never runs its own race manager
   * past the countdown, so its clock is the host's, read from the newest snapshot. Reading the
   * local manager there gives 0, which is how a retired client once reported a 0-second race and
   * was refused its coins.
   */
  private raceClock(r: RaceContext): number {
    return r.online?.role === 'client' ? (this.online?.clientSession?.raceTime ?? 0) : r.raceManager.raceTime;
  }

  /**
   * Sends the player's finish to the server, which decides what it was worth. Only the facts go:
   * place, whether they retired, and the race clock. See the progression server design, section 5.
   */
  private settleRace(r: RaceContext, place: number, retired: boolean, seconds: number, standings?: readonly RaceStanding[]): void {
    if (r.settled) return;
    const mode = r.settings.mode ?? 'solo';
    // A points team race is decided by everyone's placing, which is not known at the player's own
    // finish. Hold the report until the standings are final.
    if (mode === 'teamPoints' && !r.online && !standings) {
      r.heldFinish = { place, retired, seconds };
      if (!this.isUnrankedRun(r)) this.showReward({ state: 'pending' });
      return;
    }
    r.settled = true;
    r.heldFinish = undefined;
    if (this.isUnrankedRun(r)) {
      abandonRace();
      return;
    }
    // A retired kart has no finish time; the race clock at that moment is how long it ran.
    const clock = retired || !(seconds > 0) ? this.raceClock(r) : seconds;
    // "First place wins" is settled the moment anyone has won, so the live standings will do.
    const table = standings ?? (isTeamMode(mode) && !r.online ? r.raceManager.getStandings() : null);
    const me = table?.find((s) => s.isPlayer);
    const teamWon = Boolean(table && me && isTeamMode(mode) && computeTeamResult(table, mode).winner === (me.team ?? teamOf(me.kartId)));
    const cup = this.cup;
    this.showReward({ state: 'pending' });
    void finishRace({
      place,
      retired,
      timeMs: Math.round(clock * 1000),
      stats: { ...(r.stats?.stats ?? {}) },
      daily: Boolean(this.dailyRun),
      teamWon,
      cupDone: Boolean(cup && cup.index >= getCup(cup.id).trackIds.length - 1),
    }).then((award) => {
      if (this.race !== r) return;
      this.rewardRaceId = award?.ok ? (award.raceId ?? null) : null;
      // A circuit this finish opened is where NEXT RACE goes.
      this.openedTrackId = award?.ok ? (award.newTracks?.[0] ?? null) : null;
      this.showReward(rewardViewOf(award, r.settings.characterId));
      this.results.setNextTrack(this.nextTrackFor(r).name);
      // Five finishes: the emblem is on its card; the cup it points at is worth a sentence.
      if (award?.ok && !r.settings.intro && award.ladder?.finishes === 5 && !award.ladder.all) showToast(t('ladder.cup'), 'info', 6500);
    });
  }

  /**
   * A counter mission reached its target mid-race. The coins arrive with the finish; this is the
   * moment the player did the thing, which is when they want to hear about it.
   */
  private announceMissions(r: RaceContext, announced: Set<string>): void {
    const missions = getMissions();
    const stats = r.stats?.stats;
    if (!missions || !stats || this.isUnrankedRun(r)) return;
    for (const m of missions.list) {
      const stat = parseMissionKey(m.key)?.def.stat;
      if (!stat || m.done || announced.has(m.key)) continue;
      if (m.progress + stats[stat] < m.target) continue;
      announced.add(m.key);
      showToast(t('mis.toast', { name: missionTitle(m.key, trackName) }), 'info', 3000);
    }
  }

  /** A mission counter moved mid-race: say how far along it is, in the HUD's event feed. */
  private feedMission(r: RaceContext, stat: MissionStat): void {
    const missions = getMissions();
    const stats = r.stats?.stats;
    if (!missions || !stats || stat === 'walls' || this.isUnrankedRun(r)) return;
    for (const m of missions.list) {
      if (m.done || parseMissionKey(m.key)?.def.stat !== stat) continue;
      r.hud.feedMission(t(`feed.stat.${stat}`), Math.min(m.target, m.progress + stats[stat]), m.target);
    }
  }

  private showReward(view: RewardView): void {
    this.reward = view;
    if (this.state === 'results') {
      this.results.showRewards(view);
      this.maybeShowUnlocks(view);
    }
  }

  private buildUnlockPopup(): UnlockPopup {
    const popup = new UnlockPopup(this.uiRoot);
    popup.onGarage = () => {
      const r = this.race;
      const characterId = r?.settings.characterId ?? this.garageCharacterId;
      // A new player's first finish: the lobby, where the tour starts with the garage itself.
      // Anyone else: straight into the garage.
      const tour = this.firstFinish;
      this.returnToMenu('title');
      if (!tour) this.garage.show(characterId);
    };
    popup.onDone = (toGarage) => {
      if (toGarage || this.state !== 'results') return;
      this.results.setAutoHeld(false);
      if (this.firstFinish) this.results.lockToLobby();
    };
    return popup;
  }

  /**
   * Once a finish has been paid: everything it opened, one popup at a time in front of the
   * results. The race's first answer only (a doubled reward re-sends the view).
   */
  private maybeShowUnlocks(view: RewardView): void {
    const r = this.race;
    if (!r || r.unlocksShown || this.state !== 'results' || view.state === 'pending') return;
    r.unlocksShown = true;
    const cards: UnlockPopupCard[] = [];
    if (view.state === 'paid') {
      for (const card of view.opened ?? []) {
        if (card.kind === 'track') {
          const def = TRACKS.find((tr) => tr.id === card.ref);
          // Its own copy of the map: the results card keeps the one it has.
          cards.push({ kind: 'track', name: card.name, image: def ? trackThumbCopy(def) : undefined });
        } else {
          cards.push({ kind: 'item', name: card.name, token: card.ref });
        }
      }
    }
    if (cards.length === 0) {
      if (this.firstFinish) this.results.lockToLobby();
      return;
    }
    this.results.setAutoHeld(true);
    this.unlockPopup.show(cards, { characterId: r.settings.characterId, cosmetics: getCosmetics() });
  }

  private maybeSubmitTime(r: RaceContext, seconds: number): void {
    if (r.online) return; // multiplayer times are not ranked (spec B MVP)
    // An intro race is run against a field that lets the player through: not a time to rank.
    if (r.settings.intro) return;
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
    if (this.dailyRun) {
      // Seeded rules make this time incomparable with a normal track record, so it never touches
      // `tkr_times`; the server owns the one-attempt rule either way.
      void submitDailyTime(timeMs, r.settings.characterId).then((res) => {
        if (!res || this.race !== r) return;
        showToast(res.accepted ? t('daily.submitted', { rank: String(res.rank ?? 0) }) : t('daily.spent'), 'info');
      });
      return;
    }
    void submitTime(trackId, timeMs, r.settings.characterId, r.settings.difficulty).then((res) => {
      if (this.race !== r) return;
      // A lost submit used to be silent, which is how "my time never appeared on the board" and
      // "my time was not fast enough" became the same experience for a player. Say which it was.
      if (!res) {
        showToast(t('lb.submitFailed'), 'error');
        return;
      }
      this.lastSubmit = res;
      // This is the player's standing on the track's record board, which has nothing to do with
      // where they came in this race — the first time set on a circuit is rank 1 even if its
      // driver finished last. The banner says "track record" for that reason: it sat beside an
      // 8th-place finish reading "1st" and was read as the race result.
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
    const garageWasOpen = this.garage.isVisible;
    this.lockSheet.dispose();
    this.leaderboard.dispose();
    this.settings.dispose();
    this.lockSheet = new LockSheet(this.uiRoot);
    const cupSheetWasOpen = this.cupSheet.isVisible;
    this.cupSheet.dispose();
    this.cupSheet = this.buildCupSheet();
    this.leaderboard = this.buildLeaderboard();
    this.settings = this.buildSettings();
    if (settingsWasOpen) this.settings.show();
    this.garage.dispose();
    this.garage = this.buildGarage();
    if (garageWasOpen) this.garage.show(this.garageCharacterId);
    const dailyWasOpen = this.daily.isVisible;
    this.daily.dispose();
    this.daily = this.buildDaily();
    if (dailyWasOpen) this.daily.show();
    const missionsWereOpen = this.missions.isVisible;
    this.missions.dispose();
    this.missions = this.buildMissions();
    if (missionsWereOpen) this.missions.show();
    const attendanceWasOpen = this.attendance.isVisible;
    this.attendance.dispose();
    this.attendance = this.buildAttendance();
    if (attendanceWasOpen) this.attendance.show();
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
    this.muteLabel.textContent = t('mute');
    if (wasMenu) this.mainMenu.show(panel);
    if (cupSheetWasOpen) this.maybeOfferCupResume();
  }

  // ------------------------------------------------------------- main loop

  private readonly loop = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    if (this.lastTime < 0) this.lastTime = now;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    this.tickFirstBoot(dt);
    this.tickMenuIdle(dt);
    // Only a race is measured: menus are light, and a loading screen is slow for its own reasons.
    if (this.governed && (this.state === 'racing' || this.state === 'countdown')) {
      const change = this.governor.sample(dt);
      if (change) {
        this.resolutionScale = change.scale;
        if (this.postfxOk) this.safe(() => this.postfx.setLean(change.lean));
        this.onResize();
      }
    }
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
    if (dt < 0) dt = 0;
    this.elapsed += dt;

    // Auto-accelerate is for the race itself. The countdown is left alone, so the start boost is
    // still the player's to time and a held throttle cannot stall the engine for them.
    this.input.setAutoThrottle(this.state === 'racing' && readAutoAccel());
    const input = this.input.update();
    try {
      this.frame(dt, input);
    } catch (err) {
      console.error('[Game] frame error', err);
      events.emit('ui:error', {});
    }
    // The page's own splash goes once the game has drawn something to take its place: the lobby,
    // or the loading screen of a first visitor's race (not the empty wait before either).
    if (this.splashUp && !this.firstBoot) {
      this.splashUp = false;
      dismissBootSplash();
      // Something is on screen: now is the time to start fetching what nothing waits for.
      prefetchEngineSample();
      crazyLoading(false);
    }
  };

  private frame(dt: number, input: InputState): void {
    // Modal overlays (settings / records / lock sheet) swallow menu input while open.
    if (
      this.settings.isVisible ||
      this.garage.isVisible ||
      this.daily.isVisible ||
      this.missions.isVisible ||
      this.attendance.isVisible ||
      this.leaderboard.isVisible ||
      this.lockSheet.isVisible ||
      this.cupSheet.isVisible ||
      this.unlockPopup.isVisible ||
      this.onlinePanel.isVisible
    ) {
      if (this.settings.isVisible) this.settings.handleInput(input);
      else if (this.garage.isVisible) this.garage.handleInput(input);
      else if (this.daily.isVisible) this.daily.handleInput(input);
      else if (this.missions.isVisible) this.missions.handleInput(input);
      else if (this.attendance.isVisible) this.attendance.handleInput(input);
      else if (this.leaderboard.isVisible) this.leaderboard.handleInput(input);
      else if (this.lockSheet.isVisible) {
        if (input.back) this.lockSheet.hide();
      } else if (this.cupSheet.isVisible) {
        // Nothing to cancel to: the sheet's two buttons are the two answers.
      } else if (this.unlockPopup.isVisible) this.unlockPopup.handleInput(input);
      else this.onlinePanel.handleInput(input);
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
        this.coach?.update(dt, input, this.state === 'racing');
        this.simulate(dt, input);
        this.renderRace(dt, this.state === 'racing' && input.lookBack);
        return;
      case 'paused':
        this.pauseMenu.handleInput(input);
        if (input.pause && this.state === 'paused') this.resume();
        this.render(dt);
        return;
      case 'results':
        if (this.unlockPopup.isVisible) this.unlockPopup.handleInput(input);
        else this.results.handleInput(input);
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
    this.pollShaders();

    // Fake progress creeps toward 90% while shaders compile off-thread, then snaps to 100%.
    const ready = this.race !== null && (this.shadersReady || this.loadingElapsed > MAX_COMPILE_WAIT_SECONDS);
    const target = !this.race ? 0.12 : ready ? 1 : 0.9;
    this.loadingProgress = damp(this.loadingProgress, target, ready ? 14 : 1.4, dt);
    this.loading.setProgress(this.loadingProgress);

    if (this.race && ready) {
      if (!this.race.envCaptured) {
        this.race.envCaptured = true;
        this.captureEnvironment(this.race);
      }
      // Warm the remaining passes (shadow depth, post-processing) behind the overlay.
      this.renderRace(dt, false);
      if (this.loadingElapsed >= MIN_LOADING_SECONDS && this.loadingProgress > 0.985) {
        const hs = this.online?.hostSession;
        const hostWaiting =
          this.race.online?.role === 'host' && hs !== undefined && hs !== null && !hs.allLoaded && this.loadingElapsed < MIN_LOADING_SECONDS + 10;
        if (!hostWaiting) {
          // Leaving on the timeout rather than on a finished compile: stop waiting all the same.
          this.endWarm();
          this.enterCountdown();
        }
      }
    }
  }

  /**
   * Fills the environment probe from the start line, with everything that moves left out. Done
   * once per race, after the shaders are ready (the six views use the programs just compiled).
   */
  private captureEnvironment(r: RaceContext): void {
    const probe = this.envProbe;
    if (!probe?.texture) return;
    const slot = r.track.startGrid[0];
    if (!slot) return;
    const at = this.tmpA.copy(slot.position);
    at.y += 2.2;
    const hide: THREE.Object3D[] = [...r.karts.map((k) => k.object), r.items.object, this.particles.object, this.rescueDrones.object];
    if (this.warmGroup) hide.push(this.warmGroup);
    this.safe(() => probe.capture(this.scene, at, hide));
  }

  /** Kick off parallel shader compilation for the freshly built race scene. */
  private warmShaders(): void {
    this.endWarm();
    this.shadersReady = false;
    if (!this.race) return;
    // Items appear mid-race (shells, bananas, bombs…), so their materials used to compile on first use:
    // the one or two hitches QA saw only in the first race of a session. Put one of each in the scene,
    // hidden behind the camera, for the compile pass, and draw every HUD item icon once.
    const warm = new THREE.Group();
    warm.name = 'item-warmup';
    for (const type of ALL_ITEM_TYPES) {
      buildItemIcon(type);
      const mesh = buildItemMesh(type);
      mesh.position.set(0, -500, 0);
      warm.add(mesh);
    }
    this.scene.add(warm);
    this.warmGroup = warm;
    // `compile` skips hidden objects, and exhaust flames are hidden until a kart boosts. Show them
    // for the compile pass, or the first boost of the race pays for their program (the next
    // `updateVisuals` hides them again).
    for (const k of this.race.karts) {
      k.object.traverse((o) => {
        if (o.name === 'neonFlame') o.visible = true;
      });
    }
    try {
      // The synchronous half only: every program is created and starts compiling off-thread.
      // Whether they have finished is asked from the loading loop (pollShaders), not by three's
      // compileAsync — see there for why.
      // Compiled against the buffer the race is drawn into: a material's program depends on
      // whether it is headed for the screen (tone mapped, sRGB) or for the HDR buffer, and a race
      // is always the second. Warmed against the screen, every program was built twice.
      const target = this.postfxOk ? this.postfx.sceneRenderTarget : null;
      const prevTarget = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(target);
      try {
        this.compiling = this.renderer.compile(this.scene, this.camera);
      } finally {
        this.renderer.setRenderTarget(prevTarget);
      }
    } catch (err) {
      console.warn('[Game] shader warm-up failed; programs will compile on first use', err);
      this.endWarm();
      this.shadersReady = true;
    }
  }

  /**
   * Has every program of the race being loaded finished compiling? Called each loading frame.
   *
   * This wait used to be three's `compileAsync`, which asks the same question on a timer of its
   * own — and goes on asking after the race it was started for is gone. Disposing that race
   * before the compile settled (a second start arriving, the host leaving an online room while
   * everyone loads) left the timer reading the program of a disposed material: an uncaught
   * "reading 'isReady'" error, a promise that never resolved, and the warm-up item meshes left in
   * the scene for good. Asking from here ties the wait to the race: `disposeRace` drops it.
   */
  private pollShaders(): void {
    const pending = this.compiling;
    if (!pending) return;
    const properties = this.renderer.properties;
    for (const material of pending) {
      const program = properties.has(material)
        ? (properties.get(material) as { currentProgram?: { isReady?: () => boolean } }).currentProgram
        : undefined;
      // No program means the material was disposed meanwhile: nothing left to wait for.
      if (!program || typeof program.isReady !== 'function' || program.isReady()) pending.delete(material);
    }
    if (pending.size > 0) return;
    this.endWarm();
    this.shadersReady = true;
  }

  /** Stop waiting on the warm-up compile and take the warm-up meshes back out of the scene. */
  private endWarm(): void {
    this.compiling = null;
    if (this.warmGroup) {
      this.scene.remove(this.warmGroup);
      this.warmGroup = null;
    }
  }

  private simulate(dt: number, input: InputState): void {
    const r = this.race;
    if (!r) return;
    if (input.useItem) this.pendingUseItem = true;
    // Did a person drive this race? A throttle held by the touch auto-accelerate is not one.
    if (!r.playerActed && this.state === 'racing') {
      const ownThrottle = input.throttle > 0.1 && !(this.touch.isEnabled && readAutoAccel());
      if (ownThrottle || Math.abs(input.steer) > 0.1 || input.brake > 0.1 || input.drift || input.useItem) r.playerActed = true;
    }
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

    // Moving obstacles sit where the race clock says: the host's clock on a client, so every
    // machine sees the same boulder in the same place without it being sent.
    track.setRaceTime?.(this.raceClock(r));

    // Player input (or auto-drive after finishing).
    if (r.playerAutoDriver) {
      r.playerAutoDriver.update(dt, track, karts, items, null);
    } else {
      const p = this.playerInput;
      p.throttle = input.throttle;
      p.brake = input.brake;
      // A touch stick gets the steering assist (src/kart/assists/steerAssist.ts); keys and pads do not.
      p.steer = this.touch.isEnabled ? assistSteer(player, track, input.steer, TOUCH_ASSIST_STRENGTH) : input.steer;
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
    tickPatternTime(dt);
    for (let i = 0; i < r.karts.length; i++) r.karts[i].updateVisuals(dt);
    r.teamMarkers.update(r.karts, this.elapsed);
    r.track.update(dt, this.elapsed);
    r.followCamera.update(dt, player, lookBack);
    this.updateSun(r, player);
    this.particles.update(dt, r.karts, this.camera);
    this.rescueDrones.update(dt, r.karts);
    this.audio.update(dt, r.karts, player.state.id, this.camera);
    const raceTime = this.raceClock(r);
    r.hud.update(dt, player, r.karts, raceTime, r.raceManager.totalLaps, r.items.getHazards());
    this.updatePostFxFeel(dt, player);

    if (this.state === 'finished' && r.resultsTimer > 0) {
      r.resultsTimer -= dt;
      if (r.resultsTimer <= 0) this.enterResults();
    }
    this.render(dt);

    // Rear-view mirror PiP: drawn on top of the presented frame while the HUD shows a threat.
    const mirrorRect = r.hud.getMirrorRect();
    if (mirrorRect) {
      const h = this.container.clientHeight || window.innerHeight;
      this.safe(() => this.rearView.render(this.renderer, this.scene, player, mirrorRect, h));
    }
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
    // The tour points at lobby buttons: anywhere else it would point at nothing.
    if (next !== 'title') this.lobbyTour?.hide();
    events.emit('game:stateChange', { from, to: next });
  }

  private showMenu(panel: MenuPanel): void {
    this.results.hide();
    this.pauseMenu.hide();
    this.loading.hide();
    this.backdrop.setFraming(framingFor(panel), true);
    this.backdrop.attach(this.scene, this.camera, this.renderer);
    // Straight away, not after the hover rest: the menu must never open on an empty turntable.
    this.backdrop.setCharacter(this.mainMenu.highlightedCharacter, true);
    this.backdrop.prewarm(CHARACTERS as readonly CharacterDef[]);
    this.mainMenu.show(panel);
    this.setState(panel);
    this.playMusic('menu');
    if (panel === 'title') this.maybeOfferCupResume();
    this.maybeOfferAttendance();
    setKartThumbnailsAllowed(true);
    this.menuIdle = 0;
  }

  /**
   * A lobby that has been on screen for a moment draws the racer sheet in the background, one
   * kart a frame, so it is ready by the time anyone opens it. Not for a first visitor still
   * waiting to be sent into a race.
   */
  private tickMenuIdle(seconds: number): void {
    if (this.menuIdle < 0 || this.firstBoot || this.state !== 'title') return;
    this.menuIdle += Math.min(seconds, 0.1);
    if (this.menuIdle < 1.2) return;
    this.menuIdle = -1;
    this.maybeLobbyTour();
    void ensureKartThumbnails(CHARACTERS as readonly CharacterDef[]);
  }

  private onMenuPanel(panel: MenuPanel): void {
    if (panel !== 'title') this.lobbyTour.hide();
    if (this.state === 'title' || this.state === 'characterSelect' || this.state === 'trackSelect') {
      this.setState(panel);
      this.backdrop.setFraming(framingFor(panel));
    }
  }

  /**
   * Every path back to the menu goes through here — results buttons, the pause menu, a failed
   * ticket check — so this is where a Grand Prix and a daily run end. Leaving them set would
   * chain the next ordinary race into an abandoned cup, or file its time on the daily board.
   */
  private returnToMenu(panel: MenuPanel): void {
    this.unlockPopup.hide();
    this.cup = null;
    this.firstFinish = false;
    this.dailyRun = null;
    this.disposeRace();
    this.showMenu(panel);
  }

  private startRace(settings: RaceSettings): void {
    // From here to the next menu every frame belongs to the race.
    setKartThumbnailsAllowed(false);
    // The last race could not hold its frame rate with everything the governor has: this one
    // is built a tier lower (and so is every later one on this device, unless the player has
    // picked a tier in the settings).
    if (this.governor.overwhelmed && stepDownForNextRace()) this.applyGraphicsTier();
    this.disposeRace();
    this.backdrop.detach(this.scene);
    this.mainMenu.hide();
    this.results.hide();
    this.pauseMenu.hide();
    this.safe(() => this.particles.reset());
    this.safe(() => this.rescueDrones.reset());

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
    // One of a new account's first plain races runs against the intro field. The server makes
    // the same call from the same count when the race is opened below.
    const kind: RaceKind = settings.online ? 'online' : this.cup ? 'cup' : this.dailyRun ? 'daily' : 'race';
    const unranked = this.isUnrankedRun(null);
    // A new account's first cup is one of its first races too: same gentle field. (The server
    // only counts plain races as intro races; for it this stays an ordinary cup race.)
    const intro = (kind === 'race' || kind === 'cup') && !unranked && nextRaceIsIntro();
    this.pendingSettings = { ...settings, trackId: trackDef.id, intro };
    this.lastSubmit = null;
    this.reward = null;
    this.rewardRaceId = null;
    this.openedTrackId = null;
    // Open the race on the server now, so its clock covers the whole race by the time the
    // finish is reported. Fire-and-forget: a slow server must not hold up the start lights.
    if (unranked) abandonRace();
    else beginRace({ ...settings, trackId: trackDef.id, kind });
    this.loadingElapsed = 0;
    this.loadingFrames = 0;
    this.loadingProgress = 0;
    this.shadersReady = false;
    this.loading.show(trackDef, this.touch.isEnabled);
    this.scene.background = new THREE.Color(0x15161a);
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
      // Remote looks come off the frozen roster. They were sanitized against their owner's
      // entitlement when saved, so the gate here only rejects unknown ids and stray colours.
      const looks = new Map<number, KartCosmetics>();
      const nicks = new Map<number, string>();
      for (const entry of settings.online.roster) {
        if (entry.cos) looks.set(entry.kartId, sanitize(unpackCosmetics(entry.cos), true));
        if (entry.nick) nicks.set(entry.kartId, entry.nick);
      }
      looks.set(localKartId, getCosmetics());
      for (let id = 0; id < KART_COUNT; id++) {
        const kart = new Kart(id, slots[id], id === localKartId, looks.get(id));
        // Humans by their nickname, the rest by a handle derived from the circuit and the slot,
        // which every client computes identically.
        kart.state.racerName = nicks.get(id) ?? botName(trackDef.id, id);
        karts.push(kart);
      }
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
      const player = new Kart(0, playerChar, true, getCosmetics());
      // Only the kart's own name stands in when the record has actually loaded and the player has
      // set nothing. While it is still on its way, the kart keeps its name rather than being
      // handed one of the bot handles — a player whose nickname was merely slow to arrive should
      // never see themselves racing as "kkobuk".
      const ent = getEntitlements();
      player.state.racerName = localRacerName(ent.loaded ? ent.nickname : '', playerChar.name);
      karts.push(player);
      for (let id = 1; id < KART_COUNT; id++) {
        const def = others.length > 0 ? others[(id - 1) % others.length] : playerChar;
        const bot = new Kart(id, def, false);
        bot.state.racerName = botName(trackDef.id, id);
        karts.push(bot);
      }
      // A one-off race keeps the field close around the player both ways; a cup does not bend
      // the field that much, so its points still say who drove best.
      const pack = !this.cup;
      // Driving by touch is harder than by keys: the field eases off a little for it.
      const pace = this.touch.isEnabled ? BALANCE.ai.touchPace : 1;
      for (let id = 1; id < karts.length; id++) {
        aiDrivers.push(new AIDriver(karts[id], difficulty, id, Boolean(settings.intro), pack, pace));
      }
    }

    const items: IItemManager = new ItemManager(this.particles);
    partial.items = items;
    items.init(track, karts);
    items.setRaceMode?.(settings.mode ?? 'solo');
    items.setGentleAi?.(Boolean(settings.intro));

    const raceManager = new RaceManager(track, karts, settings);
    const followCamera = new FollowCamera(this.camera);
    partial.followCamera = followCamera;
    followCamera.setTrack(track);

    const hud = new HUD(this.uiRoot, buildItemIcon);
    partial.hud = hud;
    hud.setTrack(track);
    hud.setMode(settings.mode ?? 'solo', localKartId);
    hud.setMirrorPictured(quality().mirror);
    // A new player's first races carry the control hints; after those the HUD is left clean.
    if (settings.intro) hud.setHints(this.touch.isEnabled ? 'touch' : 'keys');

    // Lights from the track environment.
    const q = quality();
    const look = lookFor(trackDef);
    const sun = new THREE.DirectionalLight(env.sunColor, env.sunIntensity * look.sunScale);
    sun.castShadow = q.sunShadows;
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const sc = sun.shadow.camera;
    const reach = q.shadowHalfExtent;
    sc.left = -reach;
    sc.right = reach;
    sc.top = reach;
    sc.bottom = -reach;
    sc.near = 1;
    sc.far = SUN_DISTANCE + reach * 3;
    sc.updateProjectionMatrix();
    // The bias is in shadow-map depth units, the normal bias in metres: both grow with the size
    // of one shadow texel on the ground.
    const texel = (reach * 2) / q.shadowMapSize;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = Math.max(0.03, texel * 1.6);
    sun.shadow.radius = q.softShadows ? 2.2 : 1;
    this.sunDir.set(env.sunDirection.x, env.sunDirection.y, env.sunDirection.z);
    if (this.sunDir.lengthSq() < 1e-6) this.sunDir.set(0.4, 0.8, 0.3);
    if (this.sunDir.y < 0) this.sunDir.y = -this.sunDir.y;
    if (this.sunDir.y < 0.15) this.sunDir.y = 0.15;
    this.sunDir.normalize();
    // The probe is made with the first race, behind its loading screen: it has shaders of its own
    // to build, and the lobby has no use for it.
    if (!this.envProbeTried) {
      this.envProbeTried = true;
      try {
        this.envProbe = new EnvProbe(this.renderer, q.envSize);
      } catch (err) {
        console.warn('[Game] no environment probe; races render without reflections', err);
      }
    }
    const hasProbe = Boolean(this.envProbe?.texture);
    const hemi = new THREE.HemisphereLight(env.ambientSky, env.ambientGround, env.ambientIntensity * (hasProbe ? look.hemiScale : 1));
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
    // Team modes: a coloured chevron floats over every kart so friend / foe reads at a glance.
    const teamMarkers = new TeamMarkers();
    if (isTeamMode(settings.mode)) teamMarkers.attach(this.scene, karts, localKartId, settings.mode);
    partial.teamMarkers = teamMarkers;
    this.scene.add(sun, sun.target, hemi, fill, fill.target);
    this.scene.fog = fog;
    this.scene.background = background;
    // The probe's texture goes in now, still showing whatever it last held: what matters before
    // the shaders compile is that an environment of this size is there. It is filled once they have.
    this.scene.environment = this.envProbe?.texture ?? null;
    this.scene.environmentIntensity = look.envIntensity;
    const sky = findSky(track.object);
    this.postfx.setLook(look.post);
    this.postfx.setSun(sky?.sunDirection ?? null, sky?.sunColor, sky?.sunPresence ?? 0);
    // Smoke and dust are unlit sprites: hand them the light they stand in, or they glow at night.
    const ambient = new THREE.Color(env.ambientSky)
      .multiplyScalar(env.ambientIntensity * 0.55)
      .add(new THREE.Color(env.sunColor).multiplyScalar(env.sunIntensity * 0.22));
    const peak = Math.max(ambient.r, ambient.g, ambient.b, 1e-3);
    if (peak > 1) ambient.multiplyScalar(1 / peak);
    this.particles.setScene(ambient, new THREE.Color(trackDef.palette.offroad));
    this.particles.setSea((track.object.userData.seaLevel as number | null | undefined) ?? null);

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
      teamMarkers: partial.teamMarkers ?? new TeamMarkers(),
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
        // The step a client replays through after the host corrects it: the same update the race
        // loop runs, minus the other karts — their positions come from the host, and a rewind
        // must not shove them around.
        replay: (kart, input) => {
          kart.setInput(input);
          kart.update(FIXED_DT, track, EMPTY_KARTS);
        },
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

    const stats = new RaceStatsTracker(localKartId);
    const announced = new Set<string>();
    stats.onChange = (stat) => {
      this.announceMissions(r, announced);
      this.feedMission(r, stat);
    };
    r.stats = stats;
    r.unsubs.push(
      () => stats.dispose(),
      events.on('race:start', () => {
        if (this.race === r && this.state === 'countdown') this.setState('racing');
      }),
      events.on('race:lap', (e) => {
        if (this.race !== r || !e.isPlayer) return;
        if (!e.isFinalLap) return;
        this.playMusic('finalLap');
        // The last lap gets one more row of boxes. Offline only: a mirrored race keeps the boxes
        // both ends were built with.
        if (!r.online) r.items.openFinalLapBoxes?.();
      }),
      events.on('race:finish', (e) => {
        if (this.race !== r || !e.isPlayer) return;
        this.onPlayerFinished(r);
        // The portal is told of a win, and passes on the first of a visit (and a cup, in finishCup).
        if (e.place === 1 && !e.retired && e.time > 0) crazyHappytime('win');
        this.settleRace(r, e.place, Boolean(e.retired) || !(e.time > 0), e.time);
        if (!e.retired && e.time > 0) this.maybeSubmitTime(r, e.time);
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

    // The very first race: the coach's first card holds the lights until the player has pressed
    // go. The grid waits, karts frozen, with the chase camera already in place.
    if (r.settings.intro && !r.online && !hasFlag(COACH_KEY)) {
      const coach = new RaceCoach(this.uiRoot, this.touch.isEnabled, r.localKartId);
      coach.onStart = () => {
        if (this.race === r) this.beginCountdown(r);
      };
      coach.onDone = () => setFlag(COACH_KEY);
      this.coach = coach;
      this.setState('countdown');
      this.playMusic('race');
      return;
    }
    this.beginCountdown(r);
    this.setState('countdown');
    this.playMusic('race');
  }

  /** The grid cinematic and the 3-2-1. */
  private beginCountdown(r: RaceContext): void {
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
    this.endCoach();
    this.setState('finished');
    if (r.raceManager.allFinished) r.resultsTimer = RESULTS_DELAY_SECONDS;
  }

  private enterResults(): void {
    const r = this.race;
    if (!r || this.state === 'results') return;
    r.hud.hide();
    const standings = r.raceManager.getStandings();
    let cupView: CupView | undefined;
    if (this.cup) {
      const cupDef = getCup(this.cup.id);
      this.cup.table = addRaceToCup(this.cup.table, standings);
      cupView = {
        table: this.cup.table,
        raceIndex: this.cup.index,
        raceCount: cupDef.trackIds.length,
        isFinal: this.cup.index >= cupDef.trackIds.length - 1,
      };
      if (cupView.isFinal) {
        // Read before the save: what the cup had given before is what makes this trophy new.
        const before = getCupProgress();
        const place = cupPlaceOf(this.cup.table);
        const tier = trophyFor(place);
        const prior = trophyFor(before[this.cup.id]);
        const rank = { gold: 1, silver: 2, bronze: 3 } as const;
        cupView.trophy = {
          tier,
          isNew: Boolean(tier && (!prior || rank[tier] < rank[prior])),
          opened: cupsOpenedBy(before, this.cup.id, place).map((id) => t(`cup.${id}`)),
        };
        this.finishCup();
        writeCupRunRaw(null);
      } else {
        this.saveCupRun(this.cup.index + 1);
      }
    }
    const meStanding = standings.find((s) => s.isPlayer);
    const finished = Boolean(meStanding && isFinite(meStanding.finishTime) && meStanding.finishTime > 0);
    // Intro races count toward the offer, though none of them makes it (see `cupInviteFor`): the
    // first race after them is the one that points at the Rookie Cup.
    if (!this.cup && !r.online && !this.dailyRun && finished) this.racesSinceCup += 1;
    if (r.heldFinish) this.settleRace(r, r.heldFinish.place, r.heldFinish.retired, r.heldFinish.seconds, standings);
    this.results.show(standings, r.settings.mode ?? 'solo', Boolean(r.online), cupView);
    this.results.setNextTrack(this.nextTrackFor(r).name);
    this.cupInvite = this.cupInviteFor(r, finished);
    this.firstFinish = this.isFirstFinish(r, finished);
    if (this.firstFinish) this.results.setFirstFinish();
    this.maybeOfferKartPick(r, finished);
    this.results.setCupInvite(this.cupInvite ? t(`cup.${this.cupInvite}`) : '');
    if (this.reward) this.results.showRewards(this.reward);
    if (this.lastSubmit?.updated && this.lastSubmit.rank) {
      this.results.showRankBanner(t('lb.newRank', { rank: this.lastSubmit.rank }));
    }
    this.setState('results');
    // After the state is 'results': a reward that came in during the finish is put up now.
    if (this.reward) this.maybeShowUnlocks(this.reward);
    this.playMusic('results');
    this.maybeAutoNext(r, standings, cupView);
  }

  /**
   * Lets the results screen start the next race by itself (it fills the primary button for a few
   * seconds first). Most sessions used to end on this screen after two races, with nobody
   * pressing anything. Not where going on would be wrong: a retirement, a cup's last race, the
   * daily, an online race, a dev auto-drive. Not when the player has turned it off. And not for
   * someone who has walked away: two races in a row finished without a single input stop it.
   */
  private maybeAutoNext(r: RaceContext, standings: readonly RaceStanding[], cupView: CupView | undefined): void {
    this.idleRaces = r.playerActed ? 0 : this.idleRaces + 1;
    const me = standings.find((s) => s.isPlayer);
    const retired = !me || !isFinite(me.finishTime) || me.finishTime <= 0;
    // The very first finish waits for the player: it leads to the lobby, not on by itself.
    if (retired || r.online || this.dailyRun || cupView?.isFinal || r.playerAutoDriverBeforeFinish || this.firstFinish) return;
    if (!readAutoNext() || this.idleRaces >= 2) return;
    this.results.armAutoNext();
  }

  /** Takes the coach off the screen. It has had its race, finished or not: it is not shown again. */
  private endCoach(): void {
    const coach = this.coach;
    if (!coach) return;
    this.coach = null;
    setFlag(COACH_KEY);
    coach.dispose();
  }

  private pause(): void {
    if (this.state !== 'countdown' && this.state !== 'racing' && this.state !== 'finished') return;
    this.prePauseState = this.state;
    this.setState('paused');
    this.pauseMenu.show();
    this.safe(() => this.audio.setEnginesMuted(true));
    events.emit('game:pause', {});
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.pauseMenu.hide();
    this.accumulator = 0;
    this.pendingUseItem = false;
    this.setState(this.prePauseState);
    this.safe(() => this.audio.setEnginesMuted(false));
    events.emit('game:resume', {});
  }

  /** Leave the paused state without returning to the race (restart / quit). */
  private leavePause(): void {
    this.pauseMenu.hide();
    if (this.state === 'paused') {
      // Other systems may have ducked audio / frozen timers on game:pause. Restarting or quitting
      // leaves the pause without resuming, so the engines have to be let back in here too.
      this.safe(() => this.audio.setEnginesMuted(false));
      events.emit('game:resume', {});
    }
  }

  private disposeRace(): void {
    // Leaving a points team race before the table is final: settle what is known, without the win.
    const leaving = this.race;
    if (leaving?.heldFinish) {
      const held = leaving.heldFinish;
      this.settleRace(leaving, held.place, held.retired, held.seconds, []);
    }
    // Before anything is freed: nothing may go on waiting for this race's shaders.
    this.endWarm();
    this.endCoach();
    const r = this.race;
    if (!r) return;
    this.race = null;
    for (const u of r.unsubs) u();
    r.unsubs.length = 0;

    this.scene.remove(r.track.object);
    for (const k of r.karts) this.scene.remove(k.object);
    this.scene.remove(r.items.object);
    r.teamMarkers.dispose();
    this.scene.remove(r.sun, r.sun.target, r.hemi, r.fill, r.fill.target);
    r.sun.dispose();
    r.hemi.dispose();
    r.fill.dispose();
    this.scene.fog = null;
    if (this.scene.environment === this.envProbe?.texture) this.scene.environment = null;
    this.scene.environmentIntensity = 1;
    this.postfx.setLook(null);
    this.postfx.setSun(null);

    this.safe(() => r.items.dispose());
    for (const k of r.karts) this.safe(() => k.dispose());
    this.safe(() => r.track.dispose());
    r.raceManager.dispose();
    r.followCamera.dispose();
    r.hud.dispose();
    this.safe(() => this.particles.reset());
    this.safe(() => this.rescueDrones.reset());
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
    writeVolume(kind === 'music' ? VOLUME_KEY_MUSIC : VOLUME_KEY_SFX, level);
  }

  private toggleMute(): void {
    this.userMuted = !this.userMuted;
    this.applyMute();
  }

  /** Silent when either the player or the portal says so; the portal's switch cannot be overridden from here. */
  private applyMute(): void {
    const muted = this.userMuted || this.platformMuted;
    this.safe(() => this.audio.setMuted(muted));
    this.muteIndicator.classList.toggle('visible', muted);
  }

  /**
   * What the game tells the portal it is published on, and what it takes from it
   * (platform/crazygames.ts; every call is a no-op in a build without that SDK).
   */
  private hookPortal(): void {
    // On the grid and racing is gameplay; menus, results and the pause menu are breaks. A pause
    // the game made itself because the window lost focus is not reported: the portal sees focus
    // for itself and asks not to be told.
    this.unsubs.push(
      events.on('game:stateChange', ({ to }) => {
        if (to !== 'paused') this.focusPaused = false;
        crazyGameplay(to === 'countdown' || to === 'racing' || to === 'finished' || (to === 'paused' && this.focusPaused));
      }),
      onCrazyMute((muted) => {
        this.platformMuted = muted;
        this.applyMute();
      }),
    );
    onCrazyReady(() => {
      // The portal knows what the device is; a touch screen is not always a phone, nor a phone always "coarse".
      const device = crazyDevice();
      if (device === 'mobile' || device === 'tablet') this.touch.setEnabled(true);
      adoptLocale(crazyLocale());
    });
    // The account's copy of the record arrived after the game had read the local one: read again.
    const reread = (): void => void refreshEntitlements();
    window.addEventListener(RECORD_REPLACED_EVENT, reread);
    this.unsubs.push(() => window.removeEventListener(RECORD_REPLACED_EVENT, reread));
  }

  // ------------------------------------------------------------- listeners

  private readonly onResize = (): void => {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    const pr = this.pixelRatio();
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

  /** The pixel ratio the scene is drawn at: the device's, capped by the quality tier, scaled by the governor. */
  private pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, quality().pixelRatioCap) * this.resolutionScale;
  }

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.repeat) return;
    if (ev.key === 'm' || ev.key === 'M') this.toggleMute();
  };

  private readonly onBlur = (): void => {
    if (this.state === 'racing' || this.state === 'countdown') {
      this.focusPaused = true;
      this.pause();
    }
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
