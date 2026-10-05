import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeDesign, encodeDesign } from '../src/paper/codec';
import { blankDesign } from '../src/paper/design';
import { designShareUrl, parseImportFromHash, shareOrCopy } from '../src/core/share';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('designShareUrl', () => {
  it('is <origin><base>#/import/<code>', () => {
    vi.stubEnv('BASE_URL', '/Gliderama/');
    vi.stubGlobal('location', { href: 'https://someone.github.io/Gliderama/#/workshop', origin: 'https://someone.github.io' });
    expect(designShareUrl('GLD1-abc_-')).toBe('https://someone.github.io/Gliderama/#/import/GLD1-abc_-');
  });

  it('works at the site root (dev server)', () => {
    vi.stubEnv('BASE_URL', '/');
    vi.stubGlobal('location', { href: 'http://localhost:5173/', origin: 'http://localhost:5173' });
    expect(designShareUrl('GLD1-x')).toBe('http://localhost:5173/#/import/GLD1-x');
  });

  it('resolves a relative base against the page', () => {
    vi.stubEnv('BASE_URL', './');
    vi.stubGlobal('location', { href: 'https://example.com/games/gliderama/?x=1#/menu', origin: 'https://example.com' });
    expect(designShareUrl('GLD1-x')).toBe('https://example.com/games/gliderama/#/import/GLD1-x');
  });

  it('degrades to a root-relative link without a browser', () => {
    vi.stubEnv('BASE_URL', '/Gliderama/');
    vi.stubGlobal('location', undefined);
    expect(designShareUrl('GLD1-x')).toBe('/Gliderama/#/import/GLD1-x');
  });

  it('round-trips with parseImportFromHash and decodeDesign', () => {
    vi.stubEnv('BASE_URL', '/Gliderama/');
    vi.stubGlobal('location', { href: 'https://someone.github.io/Gliderama/', origin: 'https://someone.github.io' });
    const design = blankDesign();
    design.name = 'Roundtrip';
    const url = designShareUrl(encodeDesign(design));
    const hash = url.slice(url.indexOf('#'));
    const code = parseImportFromHash(hash);
    expect(code).not.toBeNull();
    expect(decodeDesign(code as string)?.name).toBe('Roundtrip');
  });
});

describe('parseImportFromHash', () => {
  const code = encodeDesign(blankDesign());

  it('extracts the code', () => {
    expect(parseImportFromHash(`#/import/${code}`)).toBe(code);
    expect(parseImportFromHash(`/import/${code}`)).toBe(code);
    expect(parseImportFromHash(`#import/${code}`)).toBe(code);
    expect(parseImportFromHash(`#/import/${code}/`)).toBe(code);
    expect(parseImportFromHash(`  #/import/${code}\n`)).toBe(code);
    expect(parseImportFromHash(`#/import/${code}?from=chat`)).toBe(code);
    expect(parseImportFromHash('#/import/GLD1-AbC_-123')).toBe('GLD1-AbC_-123');
  });

  it('accepts later format versions so the import screen can say "update the app"', () => {
    expect(parseImportFromHash('#/import/GLD2-abcdef')).toBe('GLD2-abcdef');
  });

  it('returns null for everything else', () => {
    for (const hash of ['', '#', '#/', '#/workshop', '#/import', '#/import/', '#/import/abc', '#/import/GLD1-', '#/import/GLD1-a b', '#/import/GLD1-a!b', '#/import/xGLD1-abc', '#/other/GLD1-abc', `#/import/${code}#more`, '#/import/GLD1-abc/extra']) {
      expect(parseImportFromHash(hash), JSON.stringify(hash)).toBeNull();
    }
    expect(parseImportFromHash(undefined as unknown as string)).toBeNull();
    expect(parseImportFromHash(null as unknown as string)).toBeNull();
  });

  it('survives malformed percent-escapes', () => {
    expect(parseImportFromHash('#/import/GLD1-abc%')).toBeNull();
    expect(parseImportFromHash('#/import/GLD1%2Dabc')).toBe('GLD1-abc');
  });
});

describe('shareOrCopy', () => {
  const payload = { title: 'My plane', text: 'Check out my plane!', url: 'https://x.test/#/import/GLD1-abc' };

  function stubNavigator(nav: Record<string, unknown>) {
    vi.stubGlobal('navigator', nav);
  }
  function clipboard(impl?: (text: string) => Promise<void>) {
    return { writeText: vi.fn(impl ?? (async () => {})) };
  }
  const abort = () => Object.assign(new Error('Share canceled'), { name: 'AbortError' });

  it('uses the share sheet when there is one', async () => {
    const share = vi.fn(async () => {});
    const cb = clipboard();
    stubNavigator({ share, clipboard: cb });
    expect(await shareOrCopy(payload)).toBe('shared');
    expect(share).toHaveBeenCalledWith(payload);
    expect(cb.writeText).not.toHaveBeenCalled();
  });

  it('asks canShare first, and falls back to the clipboard when it says no', async () => {
    const share = vi.fn(async () => {});
    const cb = clipboard();
    stubNavigator({ share, canShare: vi.fn(() => false), clipboard: cb });
    expect(await shareOrCopy(payload)).toBe('copied');
    expect(share).not.toHaveBeenCalled();
  });

  it('does not copy behind the player\'s back when they dismiss the share sheet', async () => {
    const cb = clipboard();
    stubNavigator({ share: vi.fn(async () => { throw abort(); }), clipboard: cb });
    expect(await shareOrCopy(payload)).toBe('failed');
    expect(cb.writeText).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard when sharing is refused for another reason', async () => {
    const cb = clipboard();
    stubNavigator({ share: vi.fn(async () => { throw Object.assign(new Error('no gesture'), { name: 'NotAllowedError' }); }), clipboard: cb });
    expect(await shareOrCopy(payload)).toBe('copied');
    expect(cb.writeText).toHaveBeenCalledWith(`${payload.text}\n${payload.url}`);
  });

  it('copies text and url (or whichever exists) when there is no share sheet', async () => {
    const cb = clipboard();
    stubNavigator({ clipboard: cb });
    expect(await shareOrCopy(payload)).toBe('copied');
    expect(cb.writeText).toHaveBeenLastCalledWith(`${payload.text}\n${payload.url}`);
    expect(await shareOrCopy({ url: payload.url })).toBe('copied');
    expect(cb.writeText).toHaveBeenLastCalledWith(payload.url);
    expect(await shareOrCopy({ text: 'only text' })).toBe('copied');
    expect(cb.writeText).toHaveBeenLastCalledWith('only text');
  });

  it('fails when there is nothing to copy', async () => {
    const cb = clipboard();
    stubNavigator({ clipboard: cb });
    expect(await shareOrCopy({ title: 'only a title' })).toBe('failed');
    expect(cb.writeText).not.toHaveBeenCalled();
  });

  it('fails when neither sharing nor copying works', async () => {
    stubNavigator({ clipboard: clipboard(async () => { throw new Error('denied'); }) });
    vi.stubGlobal('document', undefined);
    expect(await shareOrCopy(payload)).toBe('failed');
  });

  it('fails without a navigator at all', async () => {
    vi.stubGlobal('navigator', undefined);
    expect(await shareOrCopy(payload)).toBe('failed');
  });

  it('falls back to execCommand when the async clipboard API is missing or refuses', async () => {
    const created: Array<Record<string, unknown>> = [];
    const field = {
      value: '',
      style: { cssText: '' },
      setAttribute: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      remove: vi.fn(),
    };
    const fakeDocument = {
      body: { appendChild: vi.fn((el: Record<string, unknown>) => created.push(el)) },
      createElement: vi.fn(() => field),
      getSelection: vi.fn(() => null),
      execCommand: vi.fn(() => true),
    };
    vi.stubGlobal('document', fakeDocument);

    stubNavigator({});
    expect(await shareOrCopy(payload)).toBe('copied');
    expect(field.value).toBe(`${payload.text}\n${payload.url}`);
    expect(fakeDocument.execCommand).toHaveBeenCalledWith('copy');
    expect(field.remove).toHaveBeenCalled();

    stubNavigator({ clipboard: clipboard(async () => { throw new Error('denied'); }) });
    expect(await shareOrCopy(payload)).toBe('copied');

    fakeDocument.execCommand.mockReturnValue(false);
    expect(await shareOrCopy(payload)).toBe('failed');
  });
});
