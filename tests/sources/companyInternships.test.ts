import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchCompanyInternships } from '../../lib/sources/companyInternships.js';

const ITIDA_HTML_VALID = `
<html><body>
  <div class="internship-item">
    <div class="title">برنامج التدريب الصيفي لتكنولوجيا المعلومات</div>
    <a href="/programs/summer-training-2026">تفاصيل</a>
    <div class="deadline">الموعد النهائي: 15 أغسطس 2026</div>
    <div class="description">برنامج تدريبي مكثف لخريجي وطلاب تكنولوجيا المعلومات في مصر.</div>
  </div>
</body></html>`;

const ITIDA_HTML_MALFORMED = `
<html><body>
  <div class="internship-item">
    <!-- no .title element at all — the page structure changed -->
    <a href="/programs/summer-training-2026">تفاصيل</a>
  </div>
</body></html>`;

const ITI_HTML_VALID = `
<html><body>
  <div class="announcement">
    <h3>مخيم آي تي آي البرمجي الصيفي 2026</h3>
    <a href="/announcements/summer-code-camp-2026">رابط</a>
    <div class="date">تاريخ الإعلان: 1 يوليو 2026</div>
    <p>تفاصيل التقديم لمخيم البرمجة الصيفي لطلاب الجامعات المصرية.</p>
  </div>
</body></html>`;

const ITI_HTML_MALFORMED = `
<html><body>
  <div class="announcement">
    <!-- no headline/h3 -->
    <a href="/announcements/summer-code-camp-2026">رابط</a>
  </div>
</body></html>`;

const WUZZUF_HTML_VALID = `
<html><body>
  <div class="job-card">
    <h2>متدرب هندسة برمجيات</h2>
    <a href="/jobs/software-engineering-intern-12345">رابط الوظيفة</a>
    <div class="company">شركة التقنية المصرية</div>
    <div class="posted-date">نُشر منذ يومين</div>
    <div class="job-description">فرصة تدريب لمدة ثلاثة أشهر في فريق الهندسة.</div>
  </div>
</body></html>`;

const WUZZUF_HTML_MALFORMED = `
<html><body>
  <div class="job-card">
    <!-- no h2/.job-title -->
    <a href="/jobs/software-engineering-intern-12345">رابط الوظيفة</a>
  </div>
</body></html>`;

function stubFetchWith(html: { itida: string; iti: string; wuzzuf: string }) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (url.includes('itida.gov.eg')) {
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', text: async () => html.itida });
      }
      if (url.includes('iti.gov.eg')) {
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', text: async () => html.iti });
      }
      if (url.includes('wuzzuf.net')) {
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', text: async () => html.wuzzuf });
      }
      throw new Error(`Unexpected URL in test: ${url}`);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCompanyInternships', () => {
  it('parses valid Arabic-language fixtures from all three sub-sources into a raw intermediate shape', async () => {
    stubFetchWith({ itida: ITIDA_HTML_VALID, iti: ITI_HTML_VALID, wuzzuf: WUZZUF_HTML_VALID });

    const result = await fetchCompanyInternships();
    expect(result.failures).toEqual([]);
    expect(result.items).toHaveLength(3);

    const itida = result.items.find((i) => i.kind === 'itida');
    expect(itida?.kind === 'itida' && itida.listing.title_ar).toContain('التدريب الصيفي');

    const iti = result.items.find((i) => i.kind === 'iti');
    expect(iti?.kind === 'iti' && iti.listing.program_title_ar).toContain('مخيم آي تي آي');

    const wuzzuf = result.items.find((i) => i.kind === 'wuzzuf');
    expect(wuzzuf?.kind === 'wuzzuf' && wuzzuf.listing.job_title_ar).toContain('متدرب هندسة برمجيات');
  });

  it('reports a distinct source_contract_changed failure per sub-source on malformed markup, without dropping the other two', async () => {
    stubFetchWith({
      itida: ITIDA_HTML_MALFORMED,
      iti: ITI_HTML_VALID,
      wuzzuf: WUZZUF_HTML_VALID,
    });

    const result = await fetchCompanyInternships();
    const itidaFailure = result.failures.find((f) => f.source === 'company_internships:itida');
    expect(itidaFailure?.kind).toBe('source_contract_changed');

    // ITI and Wuzzuf still succeeded despite ITIDA's markup changing shape.
    expect(result.items.some((i) => i.kind === 'iti')).toBe(true);
    expect(result.items.some((i) => i.kind === 'wuzzuf')).toBe(true);
  });

  it('isolates an ITI malformed-shape failure from ITIDA and Wuzzuf', async () => {
    stubFetchWith({ itida: ITIDA_HTML_VALID, iti: ITI_HTML_MALFORMED, wuzzuf: WUZZUF_HTML_VALID });

    const result = await fetchCompanyInternships();
    const itiFailure = result.failures.find((f) => f.source === 'company_internships:iti');
    expect(itiFailure?.kind).toBe('source_contract_changed');
    expect(result.items.some((i) => i.kind === 'itida')).toBe(true);
    expect(result.items.some((i) => i.kind === 'wuzzuf')).toBe(true);
  });

  it('isolates a Wuzzuf malformed-shape failure from ITIDA and ITI', async () => {
    stubFetchWith({ itida: ITIDA_HTML_VALID, iti: ITI_HTML_VALID, wuzzuf: WUZZUF_HTML_MALFORMED });

    const result = await fetchCompanyInternships();
    const wuzzufFailure = result.failures.find((f) => f.source === 'company_internships:wuzzuf');
    expect(wuzzufFailure?.kind).toBe('source_contract_changed');
    expect(result.items.some((i) => i.kind === 'itida')).toBe(true);
    expect(result.items.some((i) => i.kind === 'iti')).toBe(true);
  });
});
