import { useState } from 'preact/hooks';
import { back } from '../../app/nav';
import { settings, setSetting } from '../../core/settings';
import { exportSave, importSave } from '../../core/storage';
import type { Settings } from '../../core/types';
import { Icon } from '../icons';

function Toggle(props: { k: keyof Settings; label: string; hint?: string }) {
  const on = !!settings.value[props.k];
  return (
    <button class={`toggle ${on ? 'is-on' : ''}`} onClick={() => setSetting(props.k, !on as never)} title={props.hint}>
      <span class="toggle__box" />
      <span>
        {props.label}
        {props.hint && <span class="small muted"> — {props.hint}</span>}
      </span>
    </button>
  );
}

function Range(props: { k: 'musicVolume' | 'sfxVolume' | 'sliderTravel'; label: string; min: number; max: number; step: number }) {
  const v = settings.value[props.k];
  return (
    <label class="ws__slider" style={{ gridTemplateColumns: '9em 1fr 3em' }}>
      <span class="label">{props.label}</span>
      <input class="slider" type="range" min={props.min} max={props.max} step={props.step} value={v} onInput={(e) => setSetting(props.k, Number((e.target as HTMLInputElement).value))} />
      <span class="ws__slider-val">{props.k === 'sliderTravel' ? `${v}px` : `${Math.round(v * 100)}%`}</span>
    </label>
  );
}

export function SettingsScreen() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div class="screen desk safe scroll">
      <div class="row">
        <button class="btn btn--icon" onClick={() => back()} aria-label="Back">
          <Icon name="back" />
        </button>
        <h1 style={{ margin: 0, fontSize: '1.2em' }}>
          <span class="tape">Settings</span>
        </h1>
      </div>
      <div class="settings__grid">
        <section class="card">
          <h3>Sound</h3>
          <div class="col">
            <Range k="musicVolume" label="Music" min={0} max={1} step={0.05} />
            <Range k="sfxVolume" label="Effects" min={0} max={1} step={0.05} />
          </div>
        </section>
        <section class="card">
          <h3>Controls</h3>
          <div class="col">
            <Range k="sliderTravel" label="Slider travel" min={30} max={110} step={5} />
            <Toggle k="invertPitch" label="Invert pitch" hint="slide down to climb" />
            <Toggle k="leftHanded" label="Left-handed layout" />
            <Toggle k="haptics" label="Haptics" />
          </div>
        </section>
        <section class="card">
          <h3>Assists</h3>
          <div class="col">
            <Toggle k="autoTrim" label="Auto-trim" hint="every design glides at its best hands-off" />
            <Toggle k="slowMo" label="Slow motion" hint="extra time to react" />
            <Toggle k="flightData" label="Flight data" hint="speed, angle of attack, glide ratio" />
            <Toggle k="reducedMotion" label="Reduced motion" hint="less screen shake" />
          </div>
        </section>
        <section class="card">
          <h3>Your save</h3>
          <p class="small">Saves live in this browser. Export a backup to move between devices.</p>
          <div class="row">
            <button
              class="btn btn--small"
              onClick={async () => {
                const data = exportSave();
                try {
                  await navigator.clipboard.writeText(data);
                  setMsg('Backup copied to the clipboard.');
                } catch {
                  const blob = new Blob([data], { type: 'application/json' });
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = 'gliderama-save.json';
                  a.click();
                  setMsg('Backup downloaded.');
                }
              }}
            >
              <Icon name="copy" /> Export
            </button>
            <button
              class="btn btn--small"
              onClick={() => {
                const txt = prompt('Paste your Gliderama backup:');
                if (!txt) return;
                setMsg(importSave(txt) ? 'Backup restored!' : "That backup couldn't be read.");
              }}
            >
              <Icon name="refresh" /> Import
            </button>
          </div>
          {msg && <p class="small">{msg}</p>}
        </section>
        <section class="card card--plain">
          <h3>About</h3>
          <p class="small">
            Gliderama — fold your own paper planes and fly them through the house. A love letter to Glider 4.0 &amp; Glider PRO. Planes fly on a
            geometry-derived aerodynamics model: every fold changes how they fly.
          </p>
        </section>
      </div>
    </div>
  );
}
