import { useEffect, useRef } from 'preact/hooks';
import { go } from '../../app/nav';
import { Icon, type IconName } from '../icons';
import { GameRenderer } from '../../render/GameRenderer';
import { Session } from '../../game/session';
import { settings } from '../../core/settings';
import { RECIPES } from '../../paper/recipes';
import { BEDROOM } from '../../world/levels/sample';
import type { LevelDef } from '../../game/level';
import type { ControlState, ThrowState } from '../../core/types';
import { createLoop } from '../../core/loop';
import { planePx } from '../../physics/flight';
import './title.css';

const LETTERS = 'GLIDERAMA'.split('');
const TILE = ['#f4efe2', '#b8d0ea', '#f6c9cc', '#f0d470', '#c8e8d0', '#f4efe2', '#ceb0d6', '#f8d4b0', '#b8d0ea'];

const ATTRACT: LevelDef = {
  id: 'attract',
  name: 'Attract',
  place: 'home',
  rooms: { '0,0': { ...BEDROOM, id: 'attract-bedroom', exits: {}, items: BEDROOM.items.filter((i) => i.t !== 'star') } },
  start: { room: '0,0', x: 520, y: 140, facing: -1 },
  sheets: 999,
  par: 0,
};

function useAttract(canvas: { current: HTMLCanvasElement | null }) {
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const design = RECIPES.find((r) => r.id === 'glider')!.make();
    let renderer: GameRenderer;
    try {
      renderer = new GameRenderer(el, design.look);
    } catch {
      return; // no WebGL: the menu still works over the desk background
    }
    renderer.air.setVisible(settings.peek().airCurrents);
    const session = new Session(renderer, ATTRACT, design, { autoTrim: true, slowMo: false });
    session.message = null;
    const ctl: ControlState = { dir: 0, pitch: 0, gadget: false, gadgetPressed: false, pausePressed: false };
    const thr: ThrowState = { aiming: false, angle: 0, power: 0, released: false };
    let aimT = 0;
    const loop = createLoop({
      update(dt) {
        thr.released = false;
        ctl.dir = 0;
        ctl.pitch = 0;
        if (session.phase === 'aim') {
          aimT += dt;
          if (aimT > 0.9) {
            aimT = 0;
            thr.released = true;
            thr.angle = Math.PI - 0.12;
            thr.power = session.hud().idealPower * 1.05;
          }
        } else if (session.phase === 'fly') {
          const p = session.plane;
          const pos = planePx(p);
          if (!p.turn) {
            if (p.facing < 0 && pos.x < 120) ctl.dir = 1;
            if (p.facing > 0 && pos.x > 520) ctl.dir = -1;
          }
          // hold altitude over the vent and the bed
          if (pos.y > 190) ctl.pitch = 0.35;
          else if (pos.y < 90) ctl.pitch = -0.3;
        }
        session.update(dt, ctl, thr);
        session.message = null;
      },
      render() {
        session.render();
      },
    });
    loop.start();
    return () => {
      loop.stop();
      session.dispose();
      renderer.dispose();
    };
  }, []);
}

interface Entry {
  icon: IconName;
  title: string;
  sub: string;
  onClick: () => void;
  tone?: string;
}

export function Title() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useAttract(canvas);
  const entries: Entry[] = [
    { icon: 'pin', title: 'Campaign', sub: 'A journey of places', onClick: () => go({ name: 'campaign' }), tone: 'var(--mustard)' },
    { icon: 'cards', title: 'Paper Trail', sub: 'Endless draft & fly runs', onClick: () => go({ name: 'trail' }) },
    { icon: 'calendar', title: 'Daily Flight', sub: "Today's house + twist", onClick: () => go({ name: 'daily' }) },
    { icon: 'target', title: 'Challenges', sub: 'Design puzzles', onClick: () => go({ name: 'challenges' }) },
    { icon: 'fold', title: 'Workshop', sub: 'Fold & share planes', onClick: () => go({ name: 'library' }) },
    { icon: 'chart', title: 'Test Hangar', sub: 'Sandbox & flight data', onClick: () => go({ name: 'hangar' }) },
  ];
  return (
    <div class="screen title">
      <canvas ref={canvas} class="title__bg pixelated" width={640} height={360} />
      <div class="title__shade" />
      <div class="title__left safe">
        <div class="title__logo" aria-label="Gliderama">
          {LETTERS.map((ch, i) => (
            <span class="title__tile" style={{ '--tile': TILE[i], '--rot': `${((i * 37) % 9) - 4}deg`, '--d': `${i * 60}ms` }}>
              {ch}
            </span>
          ))}
        </div>
        <div class="title__tag">
          <span class="tape">fold · fly · explore</span>
        </div>
      </div>
      <nav class="title__menu safe scroll">
        {entries.map((e, i) => (
          <button class="title__card" style={{ '--rot': `${((i * 53) % 5) - 2}deg`, '--accent': e.tone ?? 'var(--paper)' }} onClick={e.onClick}>
            <span class="title__card-icon">
              <Icon name={e.icon} />
            </span>
            <span class="title__card-text">
              <span class="title__card-title">{e.title}</span>
              <span class="title__card-sub">{e.sub}</span>
            </span>
          </button>
        ))}
        <div class="row" style={{ justifyContent: 'flex-end' }}>
          <button class="btn btn--small" onClick={() => go({ name: 'settings' })}>
            <Icon name="gear" /> Settings
          </button>
        </div>
      </nav>
    </div>
  );
}
