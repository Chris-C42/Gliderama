/** Thin indirection so gameplay can trigger sounds whether or not the audio engine is loaded. */

export type SfxFn = (name: string, opts?: { vol?: number; pitch?: number }) => void;

let impl: SfxFn = () => {};

export function setSfxImpl(f: SfxFn): void {
  impl = f;
}

export function sfx(name: string, opts?: { vol?: number; pitch?: number }): void {
  try {
    impl(name, opts);
  } catch {
    /* never let audio break gameplay */
  }
}
