import { useMemo, useRef, useState } from 'preact/hooks';
import { back, go, type WorkshopSpec } from '../../app/nav';
import { activeDesign, isUnlocked, saveDesign } from '../../app/library';
import { analyzeDesign } from '../../paper/aero';
import { buildMesh } from '../../paper/build';
import {
  PAPER_SIZES,
  PAPER_STOCKS,
  cloneDesign,
  sheetDims,
  type CoatingId,
  type Design,
  type FoldOp,
  type GadgetId,
  type PaperSizeId,
  type PaperStockId,
  type PatternId,
} from '../../paper/design';
import { RECIPES } from '../../paper/recipes';
import { encodeDesign } from '../../paper/codec';
import { designShareUrl, shareOrCopy } from '../../core/share';
import { settings, setSetting } from '../../core/settings';
import { FoldMat, type MatStep } from '../workshop/FoldMat';
import { Preview3D } from '../workshop/Preview3D';
import { FriendlyStats } from '../components/Stats';
import { Modal } from '../components/Modal';
import { Icon } from '../icons';
import { sfx } from '../../audio/bridge';
import './workshop.css';

const STEPS: { id: MatStep; label: string; icon: string }[] = [
  { id: 'paper', label: 'Paper', icon: 'sheet' },
  { id: 'fold', label: 'Fold', icon: 'fold' },
  { id: 'wing', label: 'Wings', icon: 'wing' },
  { id: 'shape', label: 'Shape', icon: 'plane' },
  { id: 'extras', label: 'Extras', icon: 'clip' },
  { id: 'look', label: 'Look', icon: 'star' },
];

const COLORS = ['#f4efe2', '#ffffff', '#e9eef6', '#f6e7c8', '#f1d9d2', '#dfe9e3', '#d9534f', '#3e5a8e', '#3e8c78', '#dcb446', '#845c96', '#2b2340', '#f09a72', '#96c2e4'];
const INKS = ['#8aa0c8', '#2b2340', '#b8413e', '#3e8c78', '#b08a5a', '#c98a7c', '#7fa894', '#dcb446', '#ffffff'];
const PATTERNS: PatternId[] = ['plain', 'lined', 'graph', 'newspaper', 'kraft', 'dots', 'stars', 'waves', 'chevron', 'camo', 'blueprint', 'flames'];

export function Workshop(props: { spec: WorkshopSpec }) {
  const spec = props.spec;
  const limits = spec.limits ?? {};
  const [design, setDesignRaw] = useState<Design>(() => {
    const d = cloneDesign(spec.design ?? activeDesign());
    if (limits.stock) d.paper.stock = limits.stock;
    if (limits.size) d.paper.size = limits.size;
    return d;
  });
  const undo = useRef<Design[]>([]);
  const redo = useRef<Design[]>([]);
  const [step, setStep] = useState<MatStep>(spec.design ? 'fold' : 'fold');
  const [mountain, setMountain] = useState(false);
  const [flapMode, setFlapMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [recipes, setRecipes] = useState(false);
  const [share, setShare] = useState<string | null>(null);
  const toastTimer = useRef(0);

  const toolOk = (id: string) => (limits.tools ? limits.tools.includes(id) : isUnlocked('folds', id));
  const gadgetOk = (id: string) => id === 'none' || (limits.gadgets ? limits.gadgets.includes(id) : isUnlocked('gadgets', id));
  const paperOk = (id: string) => (limits.papers ? limits.papers.includes(id) : isUnlocked('papers', id));
  const recipeOk = (id: string) => (limits.recipes ? limits.recipes.includes(id) : isUnlocked('recipes', id));

  const flash = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };

  const setDesign = (mut: (d: Design) => void, record = true) => {
    setDesignRaw((prev) => {
      const next = cloneDesign(prev);
      mut(next);
      if (record) {
        undo.current.push(prev);
        if (undo.current.length > 60) undo.current.shift();
        redo.current = [];
      }
      return next;
    });
  };

  const analysis = useMemo(() => {
    const { build, aero } = analyzeDesign(design);
    const mesh = buildMesh(build, aero.cg);
    return { build, aero, mesh };
  }, [design]);
  const { aero, mesh, build } = analysis;
  const sheet = { width: build.width, length: build.length };
  const maxFolds = limits.maxFolds ?? 12;

  const onFold = (op: FoldOp) => {
    setDesign((d) => {
      d.folds.push(op);
    });
    sfx('fold');
  };

  const doUndo = () => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(design);
    setDesignRaw(prev);
    sfx('unfold');
  };
  const doRedo = () => {
    const nxt = redo.current.pop();
    if (!nxt) return;
    undo.current.push(design);
    setDesignRaw(nxt);
  };

  const finish = (d: Design | null) => {
    if (spec.onDone) spec.onDone(d);
    else back();
  };

  const saveAndExit = () => {
    saveDesign(design);
    sfx('select');
    finish(design);
  };

  const doShare = async () => {
    const code = encodeDesign(design);
    setShare(code);
  };

  const engineer = settings.value.engineerView;

  return (
    <div class="screen ws desk">
      <header class="ws__top safe">
        <button class="btn btn--icon" onClick={() => finish(null)} aria-label="Back">
          <Icon name="back" />
        </button>
        <input
          class="ws__name"
          value={design.name}
          maxLength={24}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setDesign((d) => {
              d.name = v;
            }, false);
          }}
          aria-label="Plane name"
        />
        <nav class="ws__tabs">
          {STEPS.map((s) => (
            <button class={`ws__tab ${step === s.id ? 'is-on' : ''}`} onClick={() => setStep(s.id)}>
              <Icon name={s.icon} />
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
        <div class="ws__actions">
          {spec.context === 'library' ? (
            <>
              <button class="btn btn--small" onClick={doShare} title="Share">
                <Icon name="share" />
              </button>
              <button class="btn btn--small btn--blue" onClick={() => go({ name: 'hangar', design })} title="Test in the hangar">
                <Icon name="chart" />
              </button>
              <button class="btn btn--primary" onClick={saveAndExit}>
                <Icon name="check" /> Save
              </button>
            </>
          ) : (
            <button
              class="btn btn--primary"
              onClick={() => {
                if (aero.SM < 0 && !confirm('This design is unstable and will tumble. Fly it anyway?')) return;
                finish(design);
              }}
            >
              <Icon name="check" /> Fly this
            </button>
          )}
        </div>
      </header>

      <main class="ws__mat">
        <FoldMat
          design={design}
          step={step}
          mountain={mountain}
          flapMode={flapMode}
          canFold={design.folds.length < maxFolds}
          onFold={onFold}
          onError={(m) => {
            flash(m);
            sfx('error');
          }}
          onWing={(d0, d1) =>
            setDesign((d) => {
              d.wing = { d0, d1 };
            }, false)
          }
          onWinglet={(x) =>
            setDesign((d) => {
              if (d.shape.winglet) d.shape.winglet.x = x;
            }, false)
          }
          onElevatorDepth={(depth) =>
            setDesign((d) => {
              if (d.shape.elevator) d.shape.elevator.depth = depth;
            }, false)
          }
          onClips={(clips) =>
            setDesign((d) => {
              d.extras.clips = clips.slice(0, limits.maxClips ?? 3);
            })
          }
        />
        {limits.title && <span class="tape ws__limit">{limits.title}</span>}
        {toast && (
          <div class="ws__toast">
            <span class="card card--plain">{toast}</span>
          </div>
        )}
      </main>

      <aside class="ws__side">
        <div class="ws__preview card card--plain">
          <Preview3D mesh={mesh} look={design.look} sheet={sheet} />
          <span class="ws__mass muted small">
            {(aero.mass * 1000).toFixed(1)} g · {(aero.span * 100).toFixed(0)} cm span
          </span>
        </div>
        <div class="card ws__stats">
          <div class="row">
            <span class="label">Flight report</span>
            <span class="grow" />
            <button class={`btn btn--small ${engineer ? 'is-on' : ''}`} onClick={() => setSetting('engineerView', !engineer)}>
              <Icon name="info" /> Engineer
            </button>
          </div>
          <FriendlyStats aero={aero} details={engineer} />
          {engineer && <EngineerView aero={aero} />}
          {aero.warnings.length > 0 && (
            <ul class="ws__warn">
              {aero.warnings.map((w) => (
                <li>{w}</li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <footer class="ws__panel safe">
        {step === 'paper' && (
          <PaperPanel
            design={design}
            limits={limits}
            paperOk={paperOk}
            onSize={(size) =>
              setDesign((d) => {
                d.paper.size = size;
                d.folds = [];
              })
            }
            onLandscape={(l) =>
              setDesign((d) => {
                d.paper.landscape = l;
                d.folds = [];
              })
            }
            onStock={(stock) =>
              setDesign((d) => {
                d.paper.stock = stock;
              })
            }
            onRecipes={() => setRecipes(true)}
          />
        )}
        {step === 'fold' && (
          <div class="ws__tools">
            <div class="ws__seg">
              <button class={`btn btn--small ${!mountain ? 'is-on' : ''}`} onClick={() => setMountain(false)}>
                Valley
              </button>
              <button
                class={`btn btn--small ${mountain ? 'is-on' : ''}`}
                disabled={!toolOk('mountain')}
                onClick={() => setMountain(true)}
                title={toolOk('mountain') ? 'Fold the flap underneath' : 'Unlock in the campaign'}
              >
                {!toolOk('mountain') && <Icon name="lock" />} Mountain
              </button>
            </div>
            <button
              class={`btn btn--small ${flapMode ? 'is-on' : ''}`}
              disabled={!toolOk('flap')}
              onClick={() => setFlapMode(!flapMode)}
              title="Fold only the top flap, not every layer"
            >
              {!toolOk('flap') && <Icon name="lock" />} Top flap only
            </button>
            <span class="grow" />
            <span class="chip">
              {design.folds.length}/{maxFolds} folds
            </span>
            <button class="btn btn--small btn--icon" onClick={doUndo} disabled={!undo.current.length} aria-label="Undo">
              <Icon name="undo" />
            </button>
            <button class="btn btn--small btn--icon" onClick={doRedo} disabled={!redo.current.length} aria-label="Redo">
              <Icon name="redo" />
            </button>
            <button
              class="btn btn--small btn--red"
              onClick={() =>
                setDesign((d) => {
                  d.folds = [];
                })
              }
              disabled={!design.folds.length}
            >
              <Icon name="trash" /> Unfold
            </button>
            <button class="btn btn--small" onClick={() => setRecipes(true)}>
              <Icon name="cards" /> Recipes
            </button>
            <p class="ws__hint">Drag any corner of the paper to where it should land. Circles mark handy snap points.</p>
          </div>
        )}
        {step === 'wing' && (
          <div class="ws__tools">
            <div class="ws__seg">
              <button class={`btn btn--small ${!design.flapsOutside ? 'is-on' : ''}`} onClick={() => setDesign((d) => void (d.flapsOutside = false))}>
                Flaps inside
              </button>
              <button class={`btn btn--small ${design.flapsOutside ? 'is-on' : ''}`} onClick={() => setDesign((d) => void (d.flapsOutside = true))}>
                Flaps outside
              </button>
            </div>
            <Slider
              label="Keel at nose"
              min={0}
              max={Math.floor(sheetDims(design).width / 2 - 12)}
              value={design.wing.d0}
              unit="mm"
              onChange={(v) => setDesign((d) => void (d.wing.d0 = v), false)}
            />
            <Slider
              label="Keel at tail"
              min={0}
              max={Math.floor(sheetDims(design).width / 2 - 12)}
              value={design.wing.d1}
              unit="mm"
              onChange={(v) => setDesign((d) => void (d.wing.d1 = v), false)}
            />
            <p class="ws__hint">The red line is where the wings fold down. Everything inside it becomes the keel.</p>
          </div>
        )}
        {step === 'shape' && <ShapePanel design={design} toolOk={toolOk} setDesign={setDesign} />}
        {step === 'extras' && <ExtrasPanel design={design} gadgetOk={gadgetOk} toolOk={toolOk} setDesign={setDesign} limits={limits} />}
        {step === 'look' && <LookPanel design={design} setDesign={setDesign} />}
      </footer>

      {recipes && (
        <Modal onClose={() => setRecipes(false)}>
          <h2>Recipes</h2>
          <p class="muted small">Start from a classic. Your current folds will be replaced.</p>
          <div class="ws__recipes">
            {RECIPES.map((r) => {
              const ok = recipeOk(r.id);
              return (
                <button
                  class="ws__recipe card card--plain"
                  disabled={!ok}
                  onClick={() => {
                    const fresh = r.make();
                    setDesign((d) => {
                      const keepId = d.id;
                      const keepName = d.name;
                      Object.assign(d, cloneDesign(fresh));
                      d.id = keepId;
                      d.name = keepName === 'Untitled' || keepName.startsWith('My First') ? fresh.name : keepName;
                      if (limits.stock) d.paper.stock = limits.stock;
                    });
                    setRecipes(false);
                    sfx('select');
                  }}
                >
                  <span class="label">
                    {!ok && <Icon name="lock" />} {r.name}
                  </span>
                  <span class="small muted">{ok ? r.blurb : 'Unlock it in the campaign.'}</span>
                  <span class="small">{'★'.repeat(r.difficulty)}</span>
                </button>
              );
            })}
          </div>
        </Modal>
      )}
      {share && (
        <Modal onClose={() => setShare(null)}>
          <h2>Share this plane</h2>
          <p class="small">Anyone with this code (or link) can fold your exact design.</p>
          <textarea class="ws__code" readOnly rows={3} value={share} onFocus={(e) => (e.target as HTMLTextAreaElement).select()} />
          <div class="row">
            <button
              class="btn btn--primary"
              onClick={async () => {
                const r = await shareOrCopy({ title: `Gliderama: ${design.name}`, text: `Fold my paper plane "${design.name}" in Gliderama!`, url: designShareUrl(share) });
                flash(r === 'shared' ? 'Shared!' : r === 'copied' ? 'Link copied!' : 'Could not share');
              }}
            >
              <Icon name="share" /> Share link
            </button>
            <button
              class="btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(share);
                  flash('Code copied!');
                } catch {
                  flash('Select the code and copy it');
                }
              }}
            >
              <Icon name="copy" /> Copy code
            </button>
            <span class="grow" />
            <button class="btn btn--ghost" onClick={() => setShare(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Slider(props: { label: string; min: number; max: number; step?: number; value: number; unit?: string; onChange(v: number): void; disabled?: boolean }) {
  return (
    <label class={`ws__slider ${props.disabled ? 'is-off' : ''}`}>
      <span class="label">{props.label}</span>
      <input
        class="slider"
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        disabled={props.disabled}
        onInput={(e) => props.onChange(Number((e.target as HTMLInputElement).value))}
      />
      <span class="ws__slider-val">
        {props.value}
        {props.unit ?? ''}
      </span>
    </label>
  );
}

function PaperPanel(props: {
  design: Design;
  limits: NonNullable<WorkshopSpec['limits']>;
  paperOk(id: string): boolean;
  onSize(s: PaperSizeId): void;
  onLandscape(l: boolean): void;
  onStock(s: PaperStockId): void;
  onRecipes(): void;
}) {
  const d = props.design;
  return (
    <div class="ws__tools">
      <div class="ws__seg">
        {(Object.keys(PAPER_SIZES) as PaperSizeId[]).map((id) => {
          const ok = (props.paperOk(id) || id === 'square') && (!props.limits.size || props.limits.size === id);
          const allowed = ok && (id !== 'square' || props.paperOk('square'));
          return (
            <button class={`btn btn--small ${d.paper.size === id ? 'is-on' : ''}`} disabled={!allowed} onClick={() => props.onSize(id)}>
              {!allowed && <Icon name="lock" />} {PAPER_SIZES[id].name}
            </button>
          );
        })}
      </div>
      <div class="ws__seg">
        <button class={`btn btn--small ${!d.paper.landscape ? 'is-on' : ''}`} onClick={() => props.onLandscape(false)}>
          Portrait
        </button>
        <button class={`btn btn--small ${d.paper.landscape ? 'is-on' : ''}`} onClick={() => props.onLandscape(true)}>
          Landscape
        </button>
      </div>
      <div class="ws__seg">
        {(Object.keys(PAPER_STOCKS) as PaperStockId[]).map((id) => {
          const ok = props.paperOk(id) && (!props.limits.stock || props.limits.stock === id);
          return (
            <button class={`btn btn--small ${d.paper.stock === id ? 'is-on' : ''}`} disabled={!ok} title={PAPER_STOCKS[id].blurb} onClick={() => props.onStock(id)}>
              {!ok && <Icon name="lock" />} {PAPER_STOCKS[id].name} <span class="muted">{PAPER_STOCKS[id].gsm}g</span>
            </button>
          );
        })}
      </div>
      <button class="btn btn--small" onClick={props.onRecipes}>
        <Icon name="cards" /> Recipes
      </button>
      <p class="ws__hint">{PAPER_STOCKS[d.paper.stock].blurb} Changing size or orientation unfolds the sheet.</p>
    </div>
  );
}

function ShapePanel(props: { design: Design; toolOk(id: string): boolean; setDesign(m: (d: Design) => void, rec?: boolean): void }) {
  const d = props.design;
  const set = props.setDesign;
  const half = sheetDims(d).width / 2;
  return (
    <div class="ws__tools">
      <Slider label="Dihedral" min={-10} max={30} value={d.shape.dihedral} unit="°" onChange={(v) => set((x) => void (x.shape.dihedral = v), false)} />
      <button
        class={`btn btn--small ${d.shape.elevator ? 'is-on' : ''}`}
        onClick={() => set((x) => void (x.shape.elevator = x.shape.elevator ? null : { depth: 14, from: 0.35, to: 1, angle: 6 }))}
      >
        Elevators
      </button>
      {d.shape.elevator && (
        <>
          <Slider label="Elev. bend" min={-20} max={40} value={d.shape.elevator.angle} unit="°" onChange={(v) => set((x) => void (x.shape.elevator!.angle = v), false)} />
          <Slider label="Elev. depth" min={4} max={60} value={d.shape.elevator.depth} unit="mm" onChange={(v) => set((x) => void (x.shape.elevator!.depth = v), false)} />
          <Slider
            label="Elev. start"
            min={0}
            max={90}
            value={Math.round(d.shape.elevator.from * 100)}
            unit="%"
            onChange={(v) => set((x) => void (x.shape.elevator!.from = Math.min(v, x.shape.elevator!.to * 100 - 10) / 100), false)}
          />
        </>
      )}
      <button
        class={`btn btn--small ${d.shape.winglet ? 'is-on' : ''}`}
        disabled={!props.toolOk('winglets')}
        onClick={() => set((x) => void (x.shape.winglet = x.shape.winglet ? null : { x: Math.round(half - 20), angle: 75 }))}
      >
        {!props.toolOk('winglets') && <Icon name="lock" />} Winglets
      </button>
      {d.shape.winglet && (
        <Slider label="Winglet" min={-90} max={90} value={d.shape.winglet.angle} unit="°" onChange={(v) => set((x) => void (x.shape.winglet!.angle = v), false)} />
      )}
      <p class="ws__hint">Bend the elevators up to stop a nose-dive; drag the green hinge or blue winglet line on the mat.</p>
    </div>
  );
}

function ExtrasPanel(props: {
  design: Design;
  limits: NonNullable<WorkshopSpec['limits']>;
  gadgetOk(id: string): boolean;
  toolOk(id: string): boolean;
  setDesign(m: (d: Design) => void, rec?: boolean): void;
}) {
  const d = props.design;
  const set = props.setDesign;
  const coatings: { id: CoatingId; name: string; tip: string }[] = [
    { id: 'none', name: 'Bare', tip: 'Plain paper' },
    { id: 'wax', name: 'Wax', tip: 'Waterproof; a touch heavier' },
    { id: 'foil', name: 'Foil', tip: 'Heat-shield against flames; heavier' },
  ];
  const gadgets: { id: GadgetId; name: string; icon: string }[] = [
    { id: 'none', name: 'None', icon: 'close' },
    { id: 'battery', name: 'Prop', icon: 'battery' },
    { id: 'helium', name: 'Helium', icon: 'balloon' },
  ];
  return (
    <div class="ws__tools">
      <span class="chip">
        <Icon name="clip" /> {d.extras.clips.length}/3 clips
      </span>
      <button
        class="btn btn--small"
        disabled={d.extras.clips.length >= (props.limits.maxClips ?? 3)}
        onClick={() => set((x) => void x.extras.clips.push(Math.round(sheetDims(x).length * 0.15)))}
      >
        <Icon name="plus" /> Clip
      </button>
      <button class="btn btn--small" disabled={!d.extras.clips.length} onClick={() => set((x) => void x.extras.clips.pop())}>
        <Icon name="minus" /> Clip
      </button>
      <div class="ws__seg">
        {coatings.map((c) => {
          const ok = c.id === 'none' || props.toolOk(c.id);
          return (
            <button class={`btn btn--small ${d.extras.coating === c.id ? 'is-on' : ''}`} disabled={!ok} title={c.tip} onClick={() => set((x) => void (x.extras.coating = c.id))}>
              {!ok && <Icon name="lock" />} {c.name}
            </button>
          );
        })}
      </div>
      <div class="ws__seg">
        {[0, 1, 2, 3].map((n) => (
          <button class={`btn btn--small ${d.extras.tape === n ? 'is-on' : ''}`} disabled={n > 0 && !props.toolOk('tape')} onClick={() => set((x) => void (x.extras.tape = n))}>
            {n === 0 ? 'No tape' : `Tape ×${n}`}
          </button>
        ))}
      </div>
      <div class="ws__seg">
        {gadgets.map((g) => {
          const ok = props.gadgetOk(g.id);
          return (
            <button class={`btn btn--small ${d.extras.gadget === g.id ? 'is-on' : ''}`} disabled={!ok} onClick={() => set((x) => void (x.extras.gadget = g.id))}>
              {!ok ? <Icon name="lock" /> : <Icon name={g.icon} />} {g.name}
            </button>
          );
        })}
      </div>
      <p class="ws__hint">Tap the centre crease on the mat to place a paperclip; drag clips along it, or off the paper to remove.</p>
    </div>
  );
}

function LookPanel(props: { design: Design; setDesign(m: (d: Design) => void, rec?: boolean): void }) {
  const d = props.design;
  const set = props.setDesign;
  return (
    <div class="ws__tools ws__tools--look">
      <div class="ws__swatches">
        <span class="label">Front</span>
        {COLORS.map((c) => (
          <button class={`ws__swatch ${d.look.color === c ? 'is-on' : ''}`} style={{ background: c }} onClick={() => set((x) => void (x.look.color = c), false)} aria-label={c} />
        ))}
      </div>
      <div class="ws__swatches">
        <span class="label">Back</span>
        {COLORS.map((c) => (
          <button class={`ws__swatch ${d.look.backColor === c ? 'is-on' : ''}`} style={{ background: c }} onClick={() => set((x) => void (x.look.backColor = c), false)} aria-label={c} />
        ))}
      </div>
      <div class="ws__swatches">
        <span class="label">Print</span>
        {PATTERNS.map((p) => {
          const ok = p === 'plain' || isUnlocked('cosmetics', p);
          return (
            <button class={`btn btn--small ${d.look.pattern === p ? 'is-on' : ''}`} disabled={!ok} onClick={() => set((x) => void (x.look.pattern = p), false)}>
              {!ok && <Icon name="lock" />} {p}
            </button>
          );
        })}
      </div>
      <div class="ws__swatches">
        <span class="label">Ink</span>
        {INKS.map((c) => (
          <button class={`ws__swatch ${d.look.ink === c ? 'is-on' : ''}`} style={{ background: c }} onClick={() => set((x) => void (x.look.ink = c), false)} aria-label={c} />
        ))}
      </div>
    </div>
  );
}

function EngineerView(props: { aero: import('../../paper/aero').AeroModel }) {
  const a = props.aero;
  const t = a.perf.trim;
  const DEG = 180 / Math.PI;
  const rows: [string, string][] = [
    ['Mass', `${(a.mass * 1000).toFixed(2)} g`],
    ['Wing area', `${(a.S * 1e4).toFixed(0)} cm²`],
    ['Span · AR', `${(a.span * 100).toFixed(1)} cm · ${a.AR.toFixed(2)}`],
    ['Sweep · dihedral', `${(a.sweepLE * DEG).toFixed(0)}° · ${(a.dihedral * DEG).toFixed(0)}°`],
    ['Wing loading', `${a.wingLoading.toFixed(2)} N/m²`],
    ['CG · NP (from nose)', `${a.posCG.toFixed(0)} · ${a.posAC.toFixed(0)} mm`],
    ['Static margin', `${(a.SM * 100).toFixed(1)}%`],
    ['Lift slope', `${a.CLa.toFixed(2)} /rad`],
    ['Stall angle', `${(a.alphaStall * DEG).toFixed(1)}°`],
    ['CD0 · e', `${a.CD0.toFixed(4)} · ${a.e.toFixed(2)}`],
    ['Best L/D', `${a.perf.LDmax.toFixed(2)} at ${a.perf.vBest.toFixed(1)} m/s`],
    ['Stall speed', `${a.perf.vStall.toFixed(2)} m/s`],
    ['Hands-off trim', t ? `${(t.alpha * DEG).toFixed(1)}° · ${t.v.toFixed(2)} m/s · L/D ${t.LD.toFixed(1)}` : 'none (dives)'],
    ['Min sink', `${a.perf.sinkMin.toFixed(2)} m/s`],
  ];
  // CG vs NP strip
  const L = Math.max(1, a.length * 1000);
  return (
    <div class="ws__eng">
      <div class="ws__cgnp" title="Centre of gravity (●) should sit ahead of the neutral point (▲)">
        <span class="ws__cgnp-bar" />
        <span class="ws__cgnp-cg" style={{ left: `${(a.posCG / L) * 100}%` }}>
          ●
        </span>
        <span class="ws__cgnp-np" style={{ left: `${(a.posAC / L) * 100}%` }}>
          ▲
        </span>
        <span class="ws__cgnp-nose small">nose</span>
      </div>
      <dl>
        {rows.map(([k, v]) => (
          <>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </>
        ))}
      </dl>
    </div>
  );
}
