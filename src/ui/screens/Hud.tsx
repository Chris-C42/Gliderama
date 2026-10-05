import type { HudState } from '../../game/session';
import { Icon } from '../icons';

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/** Throws seen this app session: the how-to-throw hint is only for the first few. */
let throwsSeen = 0;
let lastPhase = '';

export function Hud(props: { hud: HudState; onPause: () => void; flightData: boolean }) {
  const h = props.hud;
  const dmgColor = h.damage < 25 ? 'var(--teal-l)' : h.damage < 60 ? 'var(--mustard)' : 'var(--red)';
  const sheets = Math.max(0, h.sheets);
  if (lastPhase === 'aim' && h.phase === 'fly') throwsSeen++;
  lastPhase = h.phase;
  const showHint = throwsSeen < 3 && !(h.message && /throw/i.test(h.message));
  return (
    <div class="hud safe">
      <div class="hud__top">
        <div class="hud__group">
          <span class="hud__pill" title="Spare sheets">
            {h.infiniteSheets ? (
              <>
                <Icon name="sheet" class="hud__sheet" /> ∞
              </>
            ) : sheets <= 6 ? (
              Array.from({ length: sheets }, () => <Icon name="sheet" class="hud__sheet" />)
            ) : (
              <>
                <Icon name="sheet" class="hud__sheet" /> ×{sheets}
              </>
            )}
            {sheets === 0 && !h.infiniteSheets && <span class="small">last sheet!</span>}
          </span>
          {h.starsTotal > 0 && (
            <span class="hud__pill" title="Stars">
              <Icon name="star" class="hud__star" /> {h.stars}/{h.starsTotal}
            </span>
          )}
          {h.goal && <span class="hud__pill hud__goal">{h.goal}</span>}
        </div>
        <div class="hud__center">
          <span class="tape hud__room">{h.roomName}</span>
        </div>
        <div class="hud__group hud__group--right">
          {h.burning && (
            <span class="hud__pill hud__alert" title="On fire! Find water">
              <Icon name="flame" />
            </span>
          )}
          {h.soak > 0.15 && (
            <span class="hud__pill" title="Soggy">
              <Icon name="drop" /> {Math.round(h.soak * 100)}%
            </span>
          )}
          {h.gadget === 'battery' && (
            <span class="hud__pill" title="Battery boosts">
              <Icon name="battery" /> {h.charges.boost}
            </span>
          )}
          {h.gadget === 'helium' && (
            <span class="hud__pill" title="Helium">
              <Icon name="balloon" /> {h.charges.helium}
            </span>
          )}
          <span class="hud__pill" title="Damage" style={{ '--dmg': dmgColor }}>
            <Icon name="plane" class="hud__plane" /> {h.damage}%
          </span>
          <button class="hud__pause" data-ui onClick={props.onPause} aria-label="Pause">
            <Icon name="pause" />
          </button>
        </div>
      </div>
      {h.message && (
        <div class="hud__msg">
          <span class="card card--plain">{h.message}</span>
        </div>
      )}
      {h.phase === 'aim' && (
        <div class="hud__aim">
          <div class="hud__meter" title="Throw power">
            <div class="hud__meter-fill" style={{ height: `${Math.round(h.power * 100)}%` }} />
            <div class="hud__meter-ideal" style={{ bottom: `${Math.round(h.idealPower * 100)}%` }} />
          </div>
          {showHint && <span class="hud__hint">{COARSE ? 'Drag back anywhere, then let go to throw' : 'Drag back & release to throw · or ↑↓ aim, hold Space'}</span>}
        </div>
      )}
      {props.flightData && h.phase === 'fly' && (
        <div class="hud__data">
          <span>{h.speed.toFixed(1)} m/s</span>
          <span>α {h.alpha.toFixed(0)}°</span>
          <span>L/D {h.ld.toFixed(1)}</span>
          {h.stall > 0.5 && <span class="hud__alert">STALL</span>}
        </div>
      )}
    </div>
  );
}
