/**
 * Online lobby + room UI over an OnlineController. Two views in one panel:
 *   lobby — quick race / create / join by code / open room list
 *   room  — racers (nick, kart, READY, ping), host settings, code, START / LEAVE
 */
import type { CharacterDef, Difficulty, InputState, TrackDefinition } from '../core/types';
import { t } from '../core/i18n';
import type { StringKey } from '../core/i18n';
import type { LobbyView } from '../net/lobby';
import type { OnlineController } from '../net/online';
import type { RoomListing } from '../net/types';
import { canRace } from '../verse8/entitlements';
import { unpackCosmetics } from '../core/cosmetics';
import { badgeElement } from './badges';
import { getLookThumbnail } from './kartThumbnails';
import { button, el, TextField } from './dom';
import { showToast } from './toast';

const DIFFS: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export class OnlinePanel {
  onClose: (() => void) | null = null;
  /** The player picked a locked premium kart — let Game show the lock sheet. */
  onLockedKart: ((c: CharacterDef) => void) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly lobbyView: HTMLElement;
  private readonly roomView: HTMLElement;
  private readonly status: TextField;
  private readonly roomList: HTMLElement;
  private readonly codeInput: HTMLInputElement;
  private readonly roomTitle: TextField;
  private readonly playersBox: HTMLElement;
  private readonly playersHead: TextField;
  private readonly settingsBox: HTMLElement;
  private readonly readyBtn: HTMLButtonElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly waitText: TextField;
  private readonly kartSelect: HTMLSelectElement;
  private readonly demoBtn: HTMLButtonElement;
  private visible = false;
  private busy = false;
  private unsubLobby: (() => void) | null = null;

  constructor(
    root: HTMLElement,
    private controller: OnlineController | null,
    private readonly tracks: readonly TrackDefinition[],
    private readonly characters: readonly CharacterDef[],
    private readonly requestController: (mode: 'real' | 'loopback') => OnlineController,
  ) {
    this.rootNode = el('div', 'screen online hidden', undefined, root);
    const panel = el('div', 'glass panel online-panel', undefined, this.rootNode);
    el('div', 'panel-kicker', t('online.title'), panel);

    // ---- lobby view
    this.lobbyView = el('div', 'online-lobby', undefined, panel);
    this.status = new TextField(el('div', 'online-status', '', this.lobbyView));
    const quickRow = el('div', 'actions', undefined, this.lobbyView);
    quickRow.appendChild(button(t('online.quick'), 'primary', () => void this.run(() => this.ctl().lobby.quickJoin())));
    quickRow.appendChild(button(t('online.create'), '', () => void this.run(() => this.ctl().lobby.create())));
    const codeRow = el('div', 'online-code-row', undefined, this.lobbyView);
    this.codeInput = el('input', 'settings-input online-code', undefined, codeRow);
    this.codeInput.maxLength = 4;
    this.codeInput.placeholder = t('online.codePh');
    this.codeInput.autocomplete = 'off';
    this.codeInput.addEventListener('keydown', (e) => e.stopPropagation());
    codeRow.appendChild(button(t('online.join'), '', () => void this.run(() => this.ctl().lobby.joinCode(this.codeInput.value))));
    const listHead = el('div', 'online-list-head', undefined, this.lobbyView);
    el('span', 'settings-label', t('online.rooms'), listHead);
    listHead.appendChild(button(t('online.refresh'), 'ghost small', () => void this.refreshRooms()));
    this.roomList = el('div', 'online-room-list', undefined, this.lobbyView);
    this.demoBtn = button(t('online.demo'), 'ghost small', () => void this.startDemo());
    this.lobbyView.appendChild(this.demoBtn);

    // ---- room view
    this.roomView = el('div', 'online-room hidden', undefined, panel);
    const head = el('div', 'online-room-head', undefined, this.roomView);
    this.roomTitle = new TextField(el('h2', 'panel-title', '', head));
    head.appendChild(button(t('online.copyCode'), 'ghost small', () => this.copyCode()));
    this.playersHead = new TextField(el('div', 'settings-label', '', this.roomView));
    this.playersBox = el('div', 'online-players', undefined, this.roomView);
    const kartRow = el('label', 'settings-field settings-row', undefined, this.roomView);
    el('span', 'settings-label', t('online.kart'), kartRow);
    this.kartSelect = el('select', 'settings-input online-select', undefined, kartRow);
    for (const c of characters) {
      const o = el('option', '', c.name, this.kartSelect);
      o.value = c.id;
    }
    this.kartSelect.addEventListener('change', () => void this.pickKart(this.kartSelect.value));
    this.settingsBox = el('div', 'online-settings', undefined, this.roomView);
    el('div', 'settings-hint', t('online.aiFill'), this.roomView);
    this.waitText = new TextField(el('div', 'online-status', '', this.roomView));
    const roomActions = el('div', 'actions', undefined, this.roomView);
    this.readyBtn = button(t('online.imReady'), 'primary', () => void this.toggleReady());
    this.startBtn = button(t('online.start'), 'primary start', () => void this.run(() => this.ctl().startRaceAsHost()));
    roomActions.append(this.readyBtn, this.startBtn);
    roomActions.appendChild(button(t('online.leave'), 'ghost', () => void this.leaveRoom()));

    const foot = el('div', 'actions', undefined, panel);
    foot.appendChild(button(t('lb.close'), 'ghost', () => this.close()));

    if (controller) this.bind(controller);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.rootNode.classList.remove('hidden');
    this.visible = true;
    this.render();
    if (this.controller && this.controller.transport.status === 'online') void this.refreshRooms();
  }

  hide(): void {
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  handleInput(input: InputState): void {
    if (!this.visible) return;
    if (input.back) this.close();
  }

  /** Re-enter the room view after a race (host resets READY). */
  returnToRoom(): void {
    this.show();
  }

  dispose(): void {
    this.unsubLobby?.();
    this.rootNode.remove();
  }

  // ------------------------------------------------------------------ private

  private ctl(): OnlineController {
    if (!this.controller) this.bind(this.requestController('real'));
    return this.controller!;
  }

  private bind(c: OnlineController): void {
    this.unsubLobby?.();
    this.controller = c;
    c.lobby.onChange = () => this.render();
    this.unsubLobby = () => {
      c.lobby.onChange = null;
    };
    this.render();
  }

  private async startDemo(): Promise<void> {
    const c = this.requestController('loopback');
    this.bind(c);
    await this.run(async () => {
      await c.connect();
      await c.lobby.create();
      await c.inviteBot();
    });
  }

  private async run(fn: () => Promise<unknown>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.rootNode.classList.add('busy');
    try {
      const c = this.ctl();
      if (c.transport.status !== 'online') {
        this.status.set(t('online.connecting'));
        const st = await c.connect();
        if (st !== 'online') {
          this.status.set(t('online.offline'));
          return;
        }
      }
      await fn();
      this.render();
    } catch (err) {
      console.warn('[online]', err);
      showToast(t('online.joinFailed'), 'error');
    } finally {
      this.busy = false;
      this.rootNode.classList.remove('busy');
    }
  }

  private async refreshRooms(): Promise<void> {
    const c = this.controller;
    if (!c || c.transport.status !== 'online') return;
    let rooms: RoomListing[] = [];
    try {
      rooms = await c.transport.listRooms();
    } catch {
      rooms = [];
    }
    this.roomList.replaceChildren();
    const open = rooms.filter((r) => !r.started && r.count < 8);
    if (open.length === 0) {
      el('div', 'settings-hint', t('online.noRooms'), this.roomList);
      return;
    }
    for (const r of open) {
      const row = button(`${r.key} · ${r.count}/8 · ${this.trackName(r.trackId)}`, 'ghost online-room-row', () =>
        void this.run(() => this.ctl().lobby.joinCode(r.key)),
      );
      this.roomList.appendChild(row);
    }
  }

  private trackName(id: string): string {
    return this.tracks.find((tr) => tr.id === id)?.name ?? '—';
  }

  private async toggleReady(): Promise<void> {
    const c = this.controller;
    if (!c) return;
    const me = c.lobby.view.players.find((p) => p.isMe);
    const cid = me?.characterId ?? this.kartSelect.value;
    if (!me?.ready && !canRace(cid)) {
      const def = this.characters.find((ch) => ch.id === cid);
      if (def) this.onLockedKart?.(def);
      return;
    }
    await this.run(() => c.lobby.setReady(!me?.ready));
  }

  private async pickKart(id: string): Promise<void> {
    const c = this.controller;
    if (!c) return;
    await this.run(() => c.lobby.setCharacter(id));
  }

  private async leaveRoom(): Promise<void> {
    const c = this.controller;
    if (!c) return;
    await this.run(() => c.leave());
    this.render();
  }

  private async copyCode(): Promise<void> {
    const key = this.controller?.lobby.key;
    if (!key) return;
    // The async Clipboard API is blocked by permissions policy inside the Verse8 iframe
    // ("Failed to execute 'writeText'"), so fall back to a hidden textarea + execCommand.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(key);
        showToast(t('online.copied'), 'info');
        return;
      }
    } catch {
      /* fall through to the legacy path */
    }
    let ok = false;
    try {
      const ta = document.createElement('textarea');
      ta.value = key;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, key.length);
      ok = document.execCommand('copy');
      ta.remove();
    } catch {
      ok = false;
    }
    showToast(ok ? t('online.copied') : t('online.copyFailed', { code: key }), ok ? 'info' : 'error');
  }

  private close(): void {
    this.hide();
    this.onClose?.();
  }

  private render(): void {
    const c = this.controller;
    const inRoom = !!c?.lobby.key;
    this.lobbyView.classList.toggle('hidden', inRoom);
    this.roomView.classList.toggle('hidden', !inRoom);
    if (!c) {
      this.status.set(t('online.offline'));
      return;
    }
    if (!inRoom) {
      this.status.set(c.transport.status === 'online' ? '' : c.transport.status === 'connecting' ? t('online.connecting') : t('online.offline'));
      this.demoBtn.classList.toggle('hidden', c.mode === 'loopback');
      return;
    }
    const v = c.lobby.view;
    this.renderRoom(v);
  }

  private renderRoom(v: LobbyView): void {
    this.roomTitle.set(t('online.room', { code: v.roomKey ?? '' }));
    this.playersHead.set(t('online.players', { n: v.players.length }));
    this.playersBox.replaceChildren();
    for (const p of v.players) {
      const row = el('div', 'online-player' + (p.isMe ? ' me' : ''), undefined, this.playersBox);
      const character = this.characters.find((ch) => ch.id === p.characterId);
      // Everyone's garage look, side by side, before anyone turns a wheel.
      const look = getLookThumbnail(p.characterId, p.cos, character);
      const thumb = el('span', 'online-player-thumb', undefined, row);
      if (look) {
        const img = el('img', undefined, undefined, thumb);
        img.src = look;
        img.alt = character?.name ?? p.characterId;
      }
      const nickCell = el('span', 'online-player-nick', undefined, row);
      const badge = badgeElement(unpackCosmetics(p.cos).badge);
      if (badge) nickCell.appendChild(badge);
      nickCell.appendChild(document.createTextNode(p.nick + (p.isHost ? ` · ${t('online.host')}` : '')));
      el('span', 'online-player-kart', character?.name ?? p.characterId, row);
      el('span', 'online-player-ready ' + (p.ready || p.isHost ? 'on' : ''), p.isHost ? t('online.host') : p.ready ? t('online.ready') : t('online.notReady'), row);
    }
    const me = v.players.find((p) => p.isMe);
    if (me) this.kartSelect.value = me.characterId;
    this.readyBtn.textContent = me?.ready ? t('online.unready') : t('online.imReady');
    this.readyBtn.classList.toggle('hidden', v.isHost);
    this.startBtn.classList.toggle('hidden', !v.isHost);
    this.startBtn.disabled = !v.canStart;
    this.waitText.set(v.isHost ? (v.players.length < 2 ? t('online.needTwo') : v.canStart ? '' : t('online.waiting')) : '');

    // Host settings (segmented controls); read-only summary for others.
    this.settingsBox.replaceChildren();
    const trackRow = el('div', 'settings-field', undefined, this.settingsBox);
    el('span', 'settings-label', t('menu.pickCircuit'), trackRow);
    const trackSeg = el('div', 'segmented wrap', undefined, trackRow);
    for (const tr of this.tracks) {
      const b = el('button', 'seg' + (tr.id === v.trackId ? ' selected' : ''), tr.name.toUpperCase(), trackSeg);
      b.type = 'button';
      b.disabled = !v.isHost;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.run(() => this.ctl().lobby.setSettings({ trackId: tr.id }));
      });
    }
    const diffRow = el('div', 'settings-field settings-row', undefined, this.settingsBox);
    el('span', 'settings-label', t('menu.difficulty'), diffRow);
    const diffSeg = el('div', 'segmented', undefined, diffRow);
    for (const d of DIFFS) {
      const b = el('button', 'seg' + (d === v.difficulty ? ' selected' : ''), t(`diff.${d}` as StringKey), diffSeg);
      b.type = 'button';
      b.disabled = !v.isHost;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.run(() => this.ctl().lobby.setSettings({ difficulty: d }));
      });
    }
    const itemRow = el('div', 'settings-field settings-row', undefined, this.settingsBox);
    el('span', 'settings-label', t('online.itemsLabel'), itemRow);
    const itemSeg = el('div', 'segmented', undefined, itemRow);
    for (const on of [true, false]) {
      const b = el('button', 'seg' + (on === v.items ? ' selected' : ''), on ? t('online.on') : t('online.off'), itemSeg);
      b.type = 'button';
      b.disabled = !v.isHost;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.run(() => this.ctl().lobby.setSettings({ items: on }));
      });
    }
    const lapRow = el('div', 'settings-field settings-row', undefined, this.settingsBox);
    el('span', 'settings-label', t('hud.lap'), lapRow);
    const lapSeg = el('div', 'segmented', undefined, lapRow);
    for (const n of [1, 2, 3]) {
      const b = el('button', 'seg' + (n === v.laps ? ' selected' : ''), String(n), lapSeg);
      b.type = 'button';
      b.disabled = !v.isHost;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.run(() => this.ctl().lobby.setSettings({ laps: n }));
      });
    }
  }
}
