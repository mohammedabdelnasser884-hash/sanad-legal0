import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { MappedCase } from '../../hooks/useAppData';
import type { ClientRow } from '../../types';

// ══════════════════════════════════════════════════════════════════
// اختبار ClientMessage — يغطي بند "اختبار قضايا ناقصة/كاملة البيانات"
// (المرحلة 5، sanad-ai-assistant-plan-20.md قسم 6). الـ validation نفسه
// (missingCritical على type/status) كان موجود من المرحلة 3 من غير أي
// تست — هنا أول تغطية فعلية له. بنعمل mock لـ loadOfficeSetting بس من
// '../../constants' (باقي الموديول حقيقي عبر importOriginal) عشان الملف
// ده بيستخدم db فعليًا، ومش جزء من منطق الـ validation المطلوب اختباره.
// ══════════════════════════════════════════════════════════════════
afterEach(() => { cleanup(); });

vi.mock('../../supabaseClient', () => ({ db: {} }));

vi.mock('../../constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../constants')>();
  return { ...actual, loadOfficeSetting: vi.fn(() => Promise.resolve('مكتب المحامي سالم')) };
});

const toast = vi.fn();
vi.mock('../../shared/lib/notifications', () => ({ toast: (...a: unknown[]) => toast(...a) }));

const recordError = vi.fn();
vi.mock('../../systemHealth', () => ({ recordError: (...a: unknown[]) => recordError(...a) }));

import ClientMessage from './ClientMessage';

function makeCase(overrides: Partial<MappedCase> = {}): MappedCase {
  return {
    id: 'case-1', number: '10', title: 'قضية مدنية', court: 'محكمة الجيزة', type: 'مدني',
    status: 'نشطة', client_id: 'client-1',
    ...overrides,
  } as MappedCase;
}
const client: ClientRow = { id: 'client-1', full_name: 'أحمد محمد', phone: '01012345678' } as ClientRow;

describe('ClientMessage — validation قبل كتابة الرسالة', () => {
  beforeEach(() => vi.clearAllMocks());

  it('قضية ناقصة (بدون نوع/حالة): بطاقة "بيانات ناقصة" تظهر والزرار معطّل ومبينادّيش callAI', () => {
    const callAI = vi.fn(() => Promise.resolve('رسالة'));
    const c = makeCase({ type: '', status: '' });
    render(React.createElement(ClientMessage, { cases: [c], clients: [client], callAI }));
    expect(screen.getByText(/مينفعش نكتب رسالة قبل ما تستكمل/).textContent).toContain('نوع القضية');
    expect(screen.getByText(/مينفعش نكتب رسالة قبل ما تستكمل/).textContent).toContain('حالة القضية');
    const btn = screen.getByText(/اكتب رسالة للعميل بالذكاء الاصطناعي/).closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(callAI).not.toHaveBeenCalled();
  });

  it('قضية كاملة البيانات: مفيش بطاقة تحذير، الزرار متاح، والضغط عليه بينادي callAI ويعرض الرسالة', async () => {
    const callAI = vi.fn(() => Promise.resolve('أهلاً أحمد، قضيتك لسه في مرحلة النظر.'));
    const c = makeCase();
    render(React.createElement(ClientMessage, { cases: [c], clients: [client], callAI }));
    expect(screen.queryByText(/بيانات ناقصة/)).toBeNull();
    const btn = screen.getByText(/اكتب رسالة للعميل بالذكاء الاصطناعي/).closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/أهلاً أحمد/)).toBeTruthy());
  });

  it('نفاد السقف اليومي: بتتعرض حالة UsageLimitState (⏳ بدون زرار إعادة محاولة) ومن غير recordError', async () => {
    const quotaMsg = 'وصلت للحد المجاني اليومي للمساعد الذكي. تقدر تضيف مفتاح Groq شخصي مجاني من الإعدادات لاستخدام أكبر.';
    const callAI = vi.fn(() => Promise.reject(new Error(quotaMsg)));
    const c = makeCase();
    render(React.createElement(ClientMessage, { cases: [c], clients: [client], callAI }));
    const btn = screen.getByText(/اكتب رسالة للعميل بالذكاء الاصطناعي/).closest('button') as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText(quotaMsg)).toBeTruthy());
    expect(screen.queryByText('إعادة المحاولة')).toBeNull();
    expect(recordError).not.toHaveBeenCalled();
  });

  it('فشل المزود (رسالة غير عربية): رسالة عامة + زرار إعادة محاولة + recordError بيتنادى', async () => {
    const callAI = vi.fn(() => Promise.reject(new Error('Failed to fetch')));
    const c = makeCase();
    render(React.createElement(ClientMessage, { cases: [c], clients: [client], callAI }));
    const btn = screen.getByText(/اكتب رسالة للعميل بالذكاء الاصطناعي/).closest('button') as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText(/تعذّر كتابة الرسالة/)).toBeTruthy());
    expect(screen.getByText('إعادة المحاولة')).toBeTruthy();
    expect(recordError).toHaveBeenCalledWith('ai_client_message', 'Failed to fetch', expect.objectContaining({ label: 'رسالة عميل مختصرة' }));
  });
});
