import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { displayLocales, fallbackLng, languages } from './i18n.config';

const ROOT = join(__dirname, '..', '..', '..', '..');
const SOURCE_DIRS = [join(ROOT, 'apps', 'frontend', 'src'), join(ROOT, 'libraries')];
const LOCALES_DIR = join(__dirname, 'locales');
const TRANSLATION_KEY = /\bt\(\s*(['"`])([a-zA-Z0-9_\-.]+)\1/g;
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const listSourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules' || entry.startsWith('.')) {
      return [];
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return listSourceFiles(path);
    }
    return /\.tsx?$/.test(entry) && !entry.endsWith('.spec.ts') ? [path] : [];
  });

const sources = SOURCE_DIRS.flatMap(listSourceFiles).map((path) => ({
  path,
  content: readFileSync(path, 'utf8'),
}));

const loadLocale = (language: string): Record<string, string> =>
  JSON.parse(readFileSync(join(LOCALES_DIR, language, 'translation.json'), 'utf8'));

const placeholdersOf = (value: string): string[] =>
  Array.from(value.matchAll(PLACEHOLDER), (match) => match[1]).sort();

const usedKeys = Array.from(
  new Set(sources.flatMap(({ content }) => Array.from(content.matchAll(TRANSLATION_KEY), (match) => match[2])))
).sort();

const english = loadLocale(fallbackLng);
const portuguese = loadLocale('pt');

describe('tradução para português do Brasil', () => {
  it('oferece apenas inglês e português do Brasil', () => {
    expect(languages).toEqual(['en', 'pt']);
  });

  it('exibe o português como português do Brasil', () => {
    expect(displayLocales.pt).toBe('pt-BR');
  });

  it('tem no inglês todas as chaves usadas no código', () => {
    expect(usedKeys.filter((key) => !(key in english))).toEqual([]);
  });

  it('tem no português todas as chaves do inglês', () => {
    expect(Object.keys(english).filter((key) => !(key in portuguese))).toEqual([]);
  });

  it('mantém no português as mesmas variáveis de interpolação do inglês', () => {
    const mismatches = Object.keys(english).filter(
      (key) => key in portuguese && placeholdersOf(english[key]).join() !== placeholdersOf(portuguese[key]).join()
    );

    expect(mismatches).toEqual([]);
  });

  it('não deixa textos vazios no português', () => {
    expect(Object.keys(portuguese).filter((key) => !portuguese[key].trim())).toEqual([]);
  });
});
