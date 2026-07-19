import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { MappedCase, MappedClient } from '../../hooks/useAppData';

// ══════════════════════════════════════════════════════════════════
// اختبار CaseSummary — يغطي بند "اختبار قضايا ناقصة/كاملة البيانات"
// (المرحلة 5، sanad-ai-assistant-plan-20.md قسم 6). الـ validation نفسه
// (missingCritical على type/court/number) كان موجود من المرحلة 3 من غير
// أي تست — هنا أول تغطية فعلية له.
// CaseSummary.tsx بتعمل Promise.all على case_sessions/case_documents/
// case_fees في useEffect (إحصائيات غير حرجة، مش جزء من الـ validation)،
// فبنعمل mock بسيط لـ db يرجّع نتيجة فاضية عشان الـ effect يخلص من غير
// ما يأثر على تست الـ validation نفسها.
// ══════════════════════════════════════════════════════════════════
afterEach(() => { cleanup(); });

const from = vi.fn((table: string) => {
  if (table === 'case_fees') {
    return { select: vi.fn(() => ({ eq: vi.fn(() => ({ is: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })) })) })) })) };
  }
  return { select: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ count: 0, data: null, error: null })) })) };
});
vi.mock('../../supabaseClient', () => ({ db: { from: (...a: Parameters<typeof from>) => from(...a) } }));

const recordError = vi.fn();
vi.mock('../../systemHealth', () => ({ recordError: (...a: unknown[]) => recordError(...a) }));

import CaseSummary from './CaseSummary';

function makeCase(overrides: Partial<MappedCase> = {}): MappedCase {
  return {
    id: 'case-1', number: '10', title: 'قضية مدنية', court: 'محكمة الجيزة', type: 'مدني',
    court_level: null, circuit_number: null, status: 'نشطة', date: '2026-07-01', client_id: 'client-1',
  } as MappedCase;
}
const client: MappedClient = { id: 'client-1', full_name: 'أحمد محمد' } as MappedClient;

describe('CaseSummary — validation قبل التلخيص', () => {
  beforeEach(() => vi.clearAllMocks());

  it('قضية ناقصة (بدون نوع/محكمة/رقم قيد): بطاقة "بيانات ناقصة" تظهر والزرار معطّل ومبينادّيش callAI', async () => {
    const callAI = vi.fn(() => Promise.resolve('تلخيص'));
    const c = makeCase({ type: '', court: '', number: '' });
    render(React.createElement(CaseSummary, {
      cases: [c], clients: [client], retrieveLegalArticles: vi.fn(() => Promise.resolve([])),
      buildLegalContextBlock: vi.fn(() => ''), callAI,
    }));
    await waitFor(() => expect(screen.getByText(/مينفعش نلخّص القضية دي قبل ما تستكمل/)).toBeTruthy());
    expect(screen.getByText(/مينفعش نلخّص القضية دي قبل ما تستكمل/).textContent).toContain('نوع القضية');
    expect(screen.getByText(/مينفعش نلخّص القضية دي قبل ما تستكمل/).textContent).toContain('المحكمة');
    expect(screen.getByText(/مينفعش نلخّص القضية دي قبل ما تستكمل/).textContent).toContain('رقم القيد');
    const btn = screen.getByText(/لخّص القضية بالذكاء الاصطناعي/).closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(callAI).not.toHaveBeenCalled();
  });

  it('قضية كاملة البيانات: مفيش بطاقة تحذير، الزرار متاح، والضغط عليه بينادي callAI ويعرض التلخيص', async () => {
    const callAI = vi.fn(() => Promise.resolve('القضية في مرحلة نظر أولى أمام محكمة الجيزة.'));
    const c = makeCase();
    render(React.createElement(CaseSummary, {
      cases: [c], clients: [client], retrieveLegalArticles: vi.fn(() => Promise.resolve([])),
      buildLegalContextBlock: vi.fn(() => ''), callAI,
    }));
    await waitFor(() => expect(screen.queryByText(/بيانات ناقصة/)).toBeNull());
    const btn = screen.getByText(/لخّص القضية بالذكاء الاصطناعي/).closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/القضية في مرحلة نظر أولى/)).toBeTruthy());
  });

  it('نفاد السقف اليومي: بتتعرض حالة UsageLimitState (⏳ بدون زرار إعادة محاولة) ومن غير recordError', async () => {
    const quotaMsg = 'وصلت للحد المجاني اليومي للمساعد الذكي. تقدر تضيف مفتاح Groq شخصي مجاني من الإعدادات لاستخدام أكبر.';
    const callAI = vi.fn(() => Promise.reject(new Error(quotaMsg)));
    const c = makeCase();
    render(React.createElement(CaseSummary, {
      cases: [c], clients: [client], retrieveLegalArticles: vi.fn(() => Promise.resolve([])),
      buildLegalContextBlock: vi.fn(() => ''), callAI,
    }));
    const btn = screen.getByText(/لخّص القضية بالذكاء الاصطناعي/).closest('button') as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText(quotaMsg)).toBeTruthy());
    expect(screen.queryByText('إعادة المحاولة')).toBeNull();
    expect(recordError).not.toHaveBeenCalled();
  });

  it('فشل المزود (رسالة غير عربية): رسالة عامة + زرار إعادة محاولة + recordError بيتنادى', async () => {
    const callAI = vi.fn(() => Promise.reject(new Error('Failed to fetch')));
    const c = makeCase();
    render(React.createElement(CaseSummary, {
      cases: [c], clients: [client], retrieveLegalArticles: vi.fn(() => Promise.resolve([])),
      buildLegalContextBlock: vi.fn(() => ''), callAI,
    }));
    const btn = screen.getByText(/لخّص القضية بالذكاء الاصطناعي/).closest('button') as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText(/تعذّر توليد التلخيص/)).toBeTruthy());
    expect(screen.getByText('إعادة المحاولة')).toBeTruthy();
    expect(recordError).toHaveBeenCalledWith('ai_case_summary', 'Failed to fetch', expect.objectContaining({ label: 'تلخيص القضية' }));
  });
});
