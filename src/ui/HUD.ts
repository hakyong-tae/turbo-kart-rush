/**
 * In-race heads-up display. Pure DOM over the canvas; DOM writes only happen
 * when a displayed value actually changes.
 */
import type { IKart, ITrack, ItemType, HazardInfo, KartState, RaceMode } from '../core/types';
import { BALANCE as B } from '../core/balance';
import { baseItemType } from '../items/itemVisuals';
import { ChargeGauge } from './hud/ChargeGauge';
import { DraftMeter } from './hud/DraftMeter';
import { MirrorPanel } from './hud/MirrorPanel';
import { StandingsBoard } from './hud/StandingsBoard';
import { TeamTally } from './hud/TeamTally';
import { ALL_ITEM_TYPES } from '../core/types';
import { events } from '../core/events';
import { BASE_TOP_SPEED } from '../core/constants';
import { clamp01, damp, formatRaceTime } from '../core/math';
import { localOrdinal, localOrdinalSuffix, t } from '../core/i18n';
import type { StringKey } from '../core/i18n';
import { el, restartAnimation, TextField, cssHex } from './dom';
import { Minimap } from './Minimap';


const ITEM_FALLBACK_COLOR: Record<ItemType, string> = {
  none: '#333',
  banana: '#ffd23f',
  triple_banana: '#ffd23f',
  green_shell: '#3ddc5a',
  triple_green_shell: '#3ddc5a',
  red_shell: '#ff4040',
  triple_red_shell: '#ff4040',
  blue_shell: '#3f7fff',
  nitro: '#ff5a3a',
  triple_nitro: '#ff5a3a',
  overdrive: '#ffc800',
  star: '#ffe14a',
  lightning: '#ffef70',
  bob_omb: '#333344',
  magnet: '#ff3b4a',
};

/** Speedometer gauge arc length in SVG units (240° of a r=44 circle). */
const GAUGE_ARC = 184.3;
const ROULETTE_FALLBACK_INTERVAL = 0.09;
const SPEED_MAX_KMH = BASE_TOP_SPEED * 3.6 * 1.7;

interface TimedNode {
  node: HTMLElement;
  ttl: number;
}

export class HUD {
  private readonly rootNode: HTMLElement;
  private readonly minimap: Minimap;
  private readonly unsubs: (() => void)[] = [];
  private visible = false;
  private playerId = 0;

  // Item slot
  private readonly itemFrame: HTMLElement;
  private readonly itemIconHost: HTMLElement;
  private readonly itemCount: TextField;
  private shownStack = 0;
  private readonly iconCache = new Map<ItemType, HTMLCanvasElement>();
  private shownIcon: ItemType = 'none';
  private shownCount = 0;
  private rouletteTimer = 0;
  private rouletteVisual = false;

  // Place / lap / timer / speed
  private readonly placeNode: HTMLElement;
  private readonly placeNum: TextField;
  private readonly placeSuffix: TextField;
  private lastPlace = 0;
  private readonly lapText: TextField;
  private readonly timerText: TextField;
  private readonly speedText: TextField;
  private readonly gaugeFill: SVGCircleElement;
  private gaugeValue = -1;
  private speedSmooth = 0;

  // Centre overlays
  private readonly center: HTMLElement;
  private readonly wrongWay: HTMLElement;
  private wrongWayShown = false;
  private readonly vignette: HTMLElement;
  private vignetteAlpha = 0;
  private vignetteApplied = -1;
  private readonly timed: TimedNode[] = [];
  private readonly boostGlow: HTMLElement;
  private mode: RaceMode = 'solo';
  private localKartId = 0;
  // Widgets (src/ui/hud/*)
  private readonly mirror: MirrorPanel;
  private readonly teamTally: TeamTally;
  private readonly draft: DraftMeter;
  private readonly charge: ChargeGauge;
  private readonly standings: StandingsBoard;
  private boostGlowApplied = -1;

  constructor(
    root: HTMLElement,
    private readonly buildIcon: (item: ItemType) => HTMLCanvasElement,
  ) {
    this.rootNode = el('div', 'hud hidden', undefined, root);

    // Top-left: item slot
    const itemWrap = el('div', 'hud-item', undefined, this.rootNode);
    this.itemFrame = el('div', 'item-frame', undefined, itemWrap);
    this.itemIconHost = el('div', 'item-icon', undefined, this.itemFrame);
    this.itemCount = new TextField(el('div', 'item-count', '', this.itemFrame));

    // Top-left: standings board
    this.standings = new StandingsBoard(this.rootNode);

    // Top-right: lap + timer
    const topRight = el('div', 'hud-topright', undefined, this.rootNode);
    const lapBox = el('div', 'hud-lap glass', undefined, topRight);
    el('span', 'hud-lap-label', t('hud.lap'), lapBox);
    this.lapText = new TextField(el('span', 'hud-lap-value', '', lapBox));
    this.timerText = new TextField(el('div', 'hud-timer glass', '0:00.000', topRight));
    // Team tally (team modes only) + rear-view mirror PiP frame (bottom-left).
    this.teamTally = new TeamTally(this.rootNode);
    this.mirror = new MirrorPanel(this.rootNode);

    // Bottom-left: place
    this.placeNode = el('div', 'hud-place', undefined, this.rootNode);
    this.placeNum = new TextField(el('span', 'place-num', '', this.placeNode));
    this.placeSuffix = new TextField(el('span', 'place-suffix', '', this.placeNode));

    // Bottom-centre: speedometer
    const speedWrap = el('div', 'hud-speed', undefined, this.rootNode);
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.classList.add('gauge');
    const bg = document.createElementNS(svgNS, 'circle');
    bg.setAttribute('cx', '50');
    bg.setAttribute('cy', '50');
    bg.setAttribute('r', '44');
    bg.classList.add('gauge-bg');
    bg.setAttribute('stroke-dasharray', `${GAUGE_ARC} 276.5`);
    svg.appendChild(bg);
    this.gaugeFill = document.createElementNS(svgNS, 'circle');
    this.gaugeFill.setAttribute('cx', '50');
    this.gaugeFill.setAttribute('cy', '50');
    this.gaugeFill.setAttribute('r', '44');
    this.gaugeFill.classList.add('gauge-fill');
    this.gaugeFill.setAttribute('stroke-dasharray', `0 276.5`);
    svg.appendChild(this.gaugeFill);
    speedWrap.appendChild(svg);
    const speedInner = el('div', 'speed-inner', undefined, speedWrap);
    this.speedText = new TextField(el('div', 'speed-value', '0', speedInner));
    el('div', 'speed-unit', 'km/h', speedInner);
    // Slipstream meter (wordless bar) under the speedometer; rocket-start charge gauge (grid only).
    this.draft = new DraftMeter(speedWrap);
    this.charge = new ChargeGauge(this.rootNode);

    // Bottom-right: minimap
    const mapWrap = el('div', 'hud-minimap glass', undefined, this.rootNode);
    this.minimap = new Minimap(mapWrap);

    // Centre overlays
    this.center = el('div', 'hud-center', undefined, this.rootNode);
    this.wrongWay = el('div', 'hud-wrongway', undefined, this.rootNode);
    el('span', 'wrongway-arrow', '⟲', this.wrongWay);
    el('span', 'wrongway-text', t('hud.wrongWay'), this.wrongWay);
    this.vignette = el('div', 'hud-vignette', undefined, this.rootNode);
    this.boostGlow = el('div', 'hud-boostglow', undefined, this.rootNode);

    this.subscribe();
  }

  // ------------------------------------------------------------------ public

  setMode(mode: RaceMode, localKartId = 0): void {
    this.mode = mode;
    this.localKartId = localKartId;
    this.teamTally.setMode(mode, localKartId);
    this.standings.setMode(mode);
    this.minimap.setMode(mode);
  }

  /** Screen rectangle (CSS px) the rear camera should be drawn into, or null while the mirror is hidden. */
  getMirrorRect(): { x: number; y: number; w: number; h: number } | null {
    return this.visible ? this.mirror.getRect() : null;
  }


  setTrack(track: ITrack | null): void {
    this.minimap.setTrack(track);
  }

  show(): void {
    this.rootNode.classList.remove('hidden');
    this.visible = true;
  }

  hide(): void {
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  update(dt: number, player: IKart, karts: readonly IKart[], raceTime: number, totalLaps: number, hazards: readonly HazardInfo[] = []): void {
    if (!this.visible) return;
    const s = player.state;
    this.playerId = s.id;

    this.charge.update(s);
    this.draft.update(s);
    this.mirror.update(player, karts, hazards);
    this.teamTally.update(karts);

    // Place numeral
    const place = s.place > 0 ? s.place : karts.length;
    if (place !== this.lastPlace) {
      this.lastPlace = place;
      this.placeNum.set(String(place));
      this.placeSuffix.set(localOrdinalSuffix(place));
      this.placeNode.classList.toggle('gold', place === 1);
      this.placeNode.classList.toggle('silver', place === 2);
      this.placeNode.classList.toggle('bronze', place === 3);
      restartAnimation(this.placeNode, 'punch');
    }

    // Lap + timer
    const lapShown = Math.min(Math.max(1, s.lap), totalLaps);
    this.lapText.set(`${lapShown}/${totalLaps}`);
    this.timerText.set(formatRaceTime(raceTime));

    // Speedometer
    const kmh = Math.abs(s.speed) * 3.6;
    this.speedSmooth = damp(this.speedSmooth, kmh, 12, dt);
    this.speedText.set(String(Math.round(this.speedSmooth)));
    const g = clamp01(this.speedSmooth / SPEED_MAX_KMH);
    if (Math.abs(g - this.gaugeValue) > 0.004) {
      this.gaugeValue = g;
      this.gaugeFill.setAttribute('stroke-dasharray', `${(g * GAUGE_ARC).toFixed(1)} 276.5`);
    }
    const boost = s.isBoosting ? 1 : 0;
    if (boost !== this.boostGlowApplied) {
      this.boostGlowApplied = boost;
      this.boostGlow.classList.toggle('on', boost === 1);
      this.rootNode.classList.toggle('boosting', boost === 1);
    }

    // Item slot
    this.updateItemSlot(dt, s.item, s.itemCount, s.itemRouletteActive, s.overdriveTimer);
    this.standings.update(karts, s.id);

    // Wrong way
    if (s.wrongWay !== this.wrongWayShown) {
      this.wrongWayShown = s.wrongWay;
      this.wrongWay.classList.toggle('visible', s.wrongWay);
    }

    // Hit vignette decay
    if (this.vignetteAlpha > 0.001) {
      this.vignetteAlpha = damp(this.vignetteAlpha, 0, 3.5, dt);
      if (this.vignetteAlpha < 0.001) this.vignetteAlpha = 0;
    }
    if (Math.abs(this.vignetteAlpha - this.vignetteApplied) > 0.01) {
      this.vignetteApplied = this.vignetteAlpha;
      this.vignette.style.opacity = this.vignetteAlpha.toFixed(2);
    }

    // Timed centre messages
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i];
      t.ttl -= dt;
      if (t.ttl <= 0) {
        t.node.remove();
        this.timed.splice(i, 1);
      }
    }

    this.minimap.update(dt, karts, s.id);
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    this.minimap.dispose();
    this.mirror.dispose();
    this.rootNode.remove();
  }

  // ----------------------------------------------------------------- private

  private subscribe(): void {
    const on = events.on.bind(events);
    this.unsubs.push(
      on('item:rouletteTick', (e) => {
        if (!e.isPlayer && e.kartId !== this.playerId) return;
        this.rouletteVisual = true;
        this.rouletteTimer = 0;
        this.setIcon(this.randomItem(), false);
        this.itemFrame.classList.add('spinning');
      }),
      on('item:rouletteEnd', (e) => {
        if (!e.isPlayer && e.kartId !== this.playerId) return;
        this.rouletteVisual = false;
        this.itemFrame.classList.remove('spinning');
        this.setIcon(e.item, true);
      }),
      on('race:countdown', (e) => {
        this.flashCenter(String(e.count), 'hud-count', 0.95);
      }),
      on('race:start', () => {
        this.flashCenter(t('hud.go'), 'hud-count hud-go', 1.1);
        this.charge.hide();
      }),
      on('kart:startOvercharge', (e) => {
        if (e.kartId !== this.playerId) return;
        this.flashCenter(t('hud.overcharge'), 'hud-banner down', 1.4);
        restartAnimation(this.rootNode, 'hit-shake');
      }),

      on('race:lap', (e) => {
        if (!e.isPlayer) return;
        if (e.isFinalLap) this.flashCenter(t('hud.finalLap'), 'hud-banner final', 2.4);
        else if (e.lap > 1) this.flashCenter(t('hud.lapN', { n: e.lap }), 'hud-banner lap', 1.4);
      }),
      on('race:positionChange', (e) => {
        if (!e.isPlayer) return;
        const up = e.to < e.from;
        this.flashCenter(`${up ? '▲' : '▼'} ${localOrdinal(e.to).toUpperCase()}`, `hud-posflash ${up ? 'up' : 'down'}`, 1.0);
      }),
      on('item:hit', (e) => {
        if (!e.isPlayer) return;
        this.vignetteAlpha = 1;
        restartAnimation(this.rootNode, 'hit-shake');
      }),
      on('race:finish', (e) => {
        if (!e.isPlayer) return;
        if (e.retired) {
          const node = this.flashCenter(t('hud.retired'), 'hud-finish retired', 4.5);
          el('div', 'hud-finish-place', t('results.dnf'), node);
          return;
        }
        const node = this.flashCenter(t('hud.finish'), 'hud-finish', 4.5);
        el('div', 'hud-finish-place', t('results.place', { ord: localOrdinal(e.place).toUpperCase() }), node);
      }),
      on('kart:respawn', (e) => {
        if (e.kartId !== this.playerId) return;
        this.vignetteAlpha = Math.max(this.vignetteAlpha, 0.6);
      }),
    );
  }

  private randomItem(): ItemType {
    return ALL_ITEM_TYPES[Math.floor(Math.random() * ALL_ITEM_TYPES.length)];
  }

  private updateItemSlot(dt: number, item: ItemType, count: number, rouletteActive: boolean, overdriveTimer: number): void {
    if (rouletteActive) {
      // If the item system doesn't emit ticks we still animate the roulette locally.
      this.rouletteTimer += dt;
      if (this.rouletteTimer >= ROULETTE_FALLBACK_INTERVAL) {
        this.rouletteTimer = 0;
        this.rouletteVisual = true;
        this.setIcon(this.randomItem(), false);
        this.itemFrame.classList.add('spinning');
      }
      if (this.shownCount !== 0) {
        this.shownCount = 0;
        this.itemCount.set('');
      }
      return;
    }
    if (this.rouletteVisual) {
      // Roulette ended without an explicit event; land on the real item.
      this.rouletteVisual = false;
      this.itemFrame.classList.remove('spinning');
      this.setIcon(item, true);
    } else if (item !== this.shownIcon) {
      this.setIcon(item, item !== 'none');
    }
    const shownCount = item === 'none' || count <= 1 ? 0 : count;
    if (shownCount !== this.shownCount) {
      this.shownCount = shownCount;
      this.itemCount.set('');
    }
    // Triples read as a fan of overlapping icons (3 → 2 → 1) instead of a number.
    const stack = item === 'none' ? 0 : Math.min(3, Math.max(1, count));
    if (stack !== this.shownStack || item !== this.shownIcon) this.setStack(item, stack);
    // Overdrive window: the frame's ring drains while unlimited nitro is available.
    if (item === 'overdrive' && overdriveTimer > 0) {
      this.itemFrame.classList.add('overdrive');
      this.itemFrame.style.setProperty('--od', `${((overdriveTimer / B.items.overdriveDuration) * 100).toFixed(1)}%`);
    } else if (this.itemFrame.classList.contains('overdrive')) {
      this.itemFrame.classList.remove('overdrive');
    }
  }

  private setStack(item: ItemType, stack: number): void {
    this.shownStack = stack;
    this.itemIconHost.replaceChildren();
    this.itemIconHost.classList.toggle('stacked', stack > 1);
    if (item === 'none') return;
    const base = baseItemType(item);
    for (let i = 0; i < stack; i++) {
      const c = this.getIcon(stack > 1 ? base : item).cloneNode(true) as HTMLCanvasElement;
      c.getContext('2d')?.drawImage(this.getIcon(stack > 1 ? base : item), 0, 0);
      c.classList.add('item-icon-canvas', `stack-${i}`);
      this.itemIconHost.appendChild(c);
    }
  }

  private setIcon(item: ItemType, pop: boolean): void {
    if (item === this.shownIcon && !pop) return;
    this.shownIcon = item;
    this.itemIconHost.replaceChildren();
    if (item !== 'none') {
      this.itemIconHost.appendChild(this.getIcon(item));
    }
    this.itemFrame.classList.toggle('has-item', item !== 'none');
    if (pop) restartAnimation(this.itemFrame, 'pop');
  }

  private getIcon(item: ItemType): HTMLCanvasElement {
    let icon = this.iconCache.get(item);
    if (icon) return icon;
    try {
      icon = this.buildIcon(item);
      if (!(icon instanceof HTMLCanvasElement)) throw new Error('buildItemIcon did not return a canvas');
    } catch (err) {
      console.warn('[HUD] item icon fallback for', item, err);
      icon = this.fallbackIcon(item);
    }
    icon.classList.add('item-icon-canvas');
    this.iconCache.set(item, icon);
    return icon;
  }

  private fallbackIcon(item: ItemType): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = ITEM_FALLBACK_COLOR[item];
      ctx.beginPath();
      ctx.arc(32, 32, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px Impact, "Arial Narrow", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.replace(/^triple_/, '')[0]?.toUpperCase() ?? '?', 32, 34);
    }
    return c;
  }

  private flashCenter(text: string, cls: string, ttl: number): HTMLElement {
    const node = el('div', `hud-msg ${cls}`, text, this.center);
    node.style.setProperty('--ttl', `${ttl}s`);
    this.timed.push({ node, ttl });
    return node;
  }
}
