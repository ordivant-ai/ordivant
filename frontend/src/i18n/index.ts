import { useEffect, useSyncExternalStore } from 'react';
import type { FormInstance } from 'antd';

export type Locale = 'zh-TW' | 'zh-CN' | 'en';
export const localeStorageKey = 'ordivant.locale';
export const supportedLocales: Locale[] = ['zh-TW', 'zh-CN', 'en'];
type Values = Record<string, string | number | LocalizedMessage>;
export type LocalizedMessage = { source: string; values?: Values };
export function localized(source: string, values?: Values): LocalizedMessage { return { source, values }; }
type Catalog = Record<string, string>;
const englishModules = import.meta.glob<{ default: Catalog }>('./catalogs/*.en.ts', { eager: true });
const simplifiedModules = import.meta.glob<{ default: Catalog }>('./catalogs/*.zh-CN.json', { eager: true });
const merge = (modules: Record<string, { default: Catalog }>): Catalog => Object.assign({}, ...Object.values(modules).map((entry) => entry.default));
const catalogs = { en: merge(englishModules), 'zh-CN': merge(simplifiedModules) };

export function resolveLocale(preferences: readonly string[]): Locale {
  for (const preference of preferences) {
    const tag = preference.toLowerCase().replaceAll('_', '-');
    if (/^zh-(hant|tw|hk|mo)(-|$)/.test(tag)) return 'zh-TW';
    if (/^zh(-|$)/.test(tag)) return 'zh-CN';
    if (/^en(-|$)/.test(tag)) return 'en';
  }
  return 'zh-TW';
}

function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-TW';
  try {
    const saved = window.localStorage.getItem(localeStorageKey);
    if (supportedLocales.includes(saved as Locale)) return saved as Locale;
  } catch { /* A blocked storage policy must not prevent sign-in. */ }
  return resolveLocale(window.navigator.languages ?? [window.navigator.language]);
}

let locale = initialLocale();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getLocale = () => locale;

function updateDocument() {
  if (typeof document !== 'undefined') document.documentElement.lang = locale === 'zh-TW' ? 'zh-Hant' : locale === 'zh-CN' ? 'zh-Hans' : 'en';
}
export function setLocale(next: Locale) {
  if (!supportedLocales.includes(next)) return;
  locale = next;
  try { window.localStorage.setItem(localeStorageKey, next); } catch { /* Session-only selection still works. */ }
  updateDocument();
  listeners.forEach((listener) => listener());
}
if (typeof window !== 'undefined') {
  updateDocument();
  window.addEventListener('storage', (event) => {
    if (event.key !== localeStorageKey || !supportedLocales.includes(event.newValue as Locale)) return;
    locale = event.newValue as Locale;
    updateDocument();
    listeners.forEach((listener) => listener());
  });
}

/** Source keys are interface copy only. Never pass user-authored content here. */
export function t(source: string | LocalizedMessage, values: Values = {}): string {
  if (typeof source !== 'string') return t(source.source, source.values);
  const text = locale === 'zh-TW' ? source : catalogs[locale][source] ?? source;
  return text.replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) => Object.hasOwn(values, key) ? (typeof values[key] === 'object' ? t(values[key]) : String(values[key])) : placeholder);
}
export function useI18n() {
  const current = useSyncExternalStore(subscribe, getLocale, () => 'zh-TW' as Locale);
  return { locale: current, setLocale, t };
}
export function formatDate(value: string | number | Date | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, options ?? { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/** Revalidate only visible errors; language changes never submit or reset drafts. */
export function useLocalizedForm<T>(form: FormInstance<T>) {
  const { locale } = useI18n();
  useEffect(() => {
    const fields = form.getFieldsError().filter(field => field.errors.length > 0).map(field => field.name);
    if (fields.length) void form.validateFields(fields).catch(() => undefined);
  }, [form, locale]);
}
