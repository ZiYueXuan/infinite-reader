import { describe, expect, it } from 'vitest';
import { requestLocale, translate } from '../../shared/i18n';
import messages from '../../shared/messages.json';
import { Client, makeEnv } from './helpers';
import { termsBody } from '../src/legal/terms-2026-10-29';

const placeholders = (text: string) => [...new Set(text.match(/\{\d+\}/g) ?? [])].sort();
describe('bilingual interface catalog', () => {
  it('provides both languages and the same interpolation arguments for every message', () => {
    for (const [key, [zh, en]] of Object.entries(messages)) {
      expect(zh.trim(), key).not.toBe(''); expect(en.trim(), key).not.toBe('');
      expect(placeholders(zh), key).toEqual(placeholders(en));
      expect(translate(key, 'zh-CN'), key).toBe(zh);
      expect(translate(key, 'en'), key).toBe(en);
    }
  });
  it('translates saved server statuses and interpolated costs without interpreting parameter contents', () => {
    expect(translate('部分操作未返回计量，仅展示已知部分（2 项缺失）', 'en')).toContain('(2 missing)');
    expect(translate('tokens × $0.28 / 百万', 'en')).toBe('tokens × $0.28 / million');
    expect(translate('调用进行中或用量尚未落库', 'en')).toBe('Call in progress or usage not yet saved');
    expect(translate('Account: {0}', 'zh-CN', '<script>$&{0}</script>')).toBe('账号：<script>$&{0}</script>');
    expect(translate('__proto__', 'en')).toBe('__proto__');
    expect(translate('A reader’s own title', 'zh-CN')).toBe('A reader’s own title');
  });
  it('uses explicit locale, preference cookie, then browser language', () => {
    const request = (query: string, cookie = '', language = 'en-US') => new Request('https://ereader.space/' + query, { headers: { cookie, 'accept-language': language } });
    expect(requestLocale(request('?lang=en', 'ir_locale=zh-CN', 'zh-HK'))).toBe('en');
    expect(requestLocale(request('', 'ir_locale=zh-CN'))).toBe('zh-CN');
    expect(requestLocale(request('', '', 'zh-TW, en;q=0.5'))).toBe('zh-CN');
    expect(requestLocale(request('?lang=invalid', '', 'fr-FR'))).toBe('en');
  });
});
describe('localized public pages', () => {
  it('renders each public page in the chosen language with safe cache and language headers', async () => {
    for (const [path, zh, en] of [['about', '登录方式', 'Signing in'], ['privacy', '我们收集的信息', 'What we collect'], ['terms', '版权投诉', 'Copyright complaint']]) {
      for (const locale of ['zh-CN', 'en']) {
        const client = new Client(makeEnv());
        const res = await client.fetch(`/${path}?lang=${locale}`);
        const body = await res.text();
        expect(body).toContain(`<html lang="${locale}">`);
        expect(body).toContain(locale === 'en' ? en : zh);
        expect(res.headers.get('content-language')).toBe(locale);
        expect(res.headers.get('cache-control')).toContain('no-store');
        expect(res.headers.get('set-cookie')).toContain('ir_locale=' + locale);
      }
    }
  });
  it('uses the exact existing agreement sections without changing the accepted version', async () => {
    const env = makeEnv(); const published = termsBody(env.env.APP_NAME, env.env.CONTACT_EMAIL);
    for (const [locale, section] of [['en', 'english'], ['zh-CN', 'chinese']]) {
      const response = await new Client(env).fetch('/terms?lang=' + locale);
      const text = await response.text();
      const original = published.match(new RegExp(`<section id="${section}"[\\s\\S]*?</section>`))![0];
      expect(text).toContain(original);
      expect(text).not.toContain(`id="${section === 'english' ? 'chinese' : 'english'}"`);
    }
  });
});
