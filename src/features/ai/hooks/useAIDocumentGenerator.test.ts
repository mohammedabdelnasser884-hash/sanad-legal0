import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAIDocumentGenerator } from './useAIDocumentGenerator';
import type { CountryConfig } from '../../../constants';
import type { ProfileRow } from '../../../types';
import type { AIDocFields } from './aiAssistantTypes';

// ══════════════════════════════════════════════════════════════════
// اختبار useAIDocumentGenerator — يغطي بندين من المرحلة 5 (الثبات
// والاختبارات، sanad-ai-assistant-plan-20.md قسم 6): "Validation قبل
// توليد أي مستند/تلخيص" و"اختبار غياب رصيد AI / فشل المزود".
// useAIDocumentGenerator مفيهوش أي استدعاء لـ db (كل بياناته جايه من
// props/state محلي)، فمفيش داعي لـ mock supabaseClient هنا — بنعمل mock
// بس لـ retrieveLegalArticles/buildLegalContextBlock/callAI اللي بتتمرر
// كـ props زي ما هي فعليًا في useAIAssistant.ts، ولـ recordError من
// systemHealth عشان نتأكد إنها بتتنادى بس في حالة فشل المزود (مش نفاد
// السقف، اللي هو رسالة عربية واضحة للمستخدم مش خطأ تقني).
// ══════════════════════════════════════════════════════════════════

const recordError = vi.fn();
vi.mock('../../../systemHealth', () => ({ recordError: (...a: unknown[]) => recordError(...a) }));

const activeCfg = {
  name: 'مصر', flag: '🇪🇬', legalSystem: 'مدني', referenceCode: 'القانون المدني',
  courts: ['محكمة النقض'], docHeader: '', greeting: '', closing: '',
} as unknown as CountryConfig;

function setup(callAIImpl?: () => Promise<string>) {
  const callAI = vi.fn(callAIImpl || (() => Promise.resolve('نص المستند المولّد')));
  const retrieveLegalArticles = vi.fn(() => Promise.resolve([]));
  const buildLegalContextBlock = vi.fn(() => '');
  const profile = { full_name: 'محامي تجريبي' } as unknown as ProfileRow;

  const { result } = renderHook(() =>
    useAIDocumentGenerator({
      profile, activeCfg, today: '19 يوليو 2026', selectedCase: null,
      hasKey: true, setShowKeyInput: vi.fn(),
      retrieveLegalArticles, buildLegalContextBlock, callAI,
    })
  );
  return { result, callAI };
}

function fillRequiredFields(result: { current: { sf: (k: keyof AIDocFields, v: string) => void } }) {
  act(() => {
    result.current.sf('plaintiff', 'أحمد محمد');
    result.current.sf('defendant', 'شركة س');
    result.current.sf('subject', 'مطالبة مالية');
  });
}

describe('useAIDocumentGenerator — validation قبل التوليد', () => {
  beforeEach(() => vi.clearAllMocks());

  it('بيانات فاضية بالكامل: missingCritical فيها الموكل والخصم والموضوع، وcanGenerate false', () => {
    const { result } = setup();
    expect(result.current.missingCritical).toEqual(
      expect.arrayContaining(['الموكل', 'الخصم', 'الموضوع / العنوان'])
    );
    expect(result.current.canGenerate).toBe(false);
  });

  it('توكيل رسمي: الخصم مش مطلوب — missingCritical تحتوي بس الموكِّل والموضوع', () => {
    const { result } = setup();
    act(() => result.current.setDocType('توكيل_رسمي'));
    expect(result.current.missingCritical).toEqual(
      expect.arrayContaining(['اسم الموكِّل', 'الموضوع / العنوان'])
    );
    expect(result.current.missingCritical).not.toContain('الخصم');
  });

  it('استكمال الحقول الحرجة (الموكل/الخصم/الموضوع): missingCritical تفضى وcanGenerate true', () => {
    const { result } = setup();
    act(() => {
      result.current.sf('plaintiff', 'أحمد محمد');
      result.current.sf('defendant', 'شركة س');
      result.current.sf('subject', 'مطالبة مالية');
    });
    expect(result.current.missingCritical).toEqual([]);
    expect(result.current.canGenerate).toBe(true);
  });

  it('generateDocument بيانات ناقصة: بيرجع فورًا من غير ما ينادي callAI', async () => {
    const { result, callAI } = setup();
    await act(async () => { await result.current.generateDocument(); });
    expect(callAI).not.toHaveBeenCalled();
    expect(result.current.generatedDoc).toBe('');
  });

  it('generateDocument بيانات كاملة: بينادي callAI فعليًا ويعبّي generatedDoc', async () => {
    const { result, callAI } = setup();
    fillRequiredFields(result);
    await act(async () => { await result.current.generateDocument(); });
    expect(callAI).toHaveBeenCalledTimes(1);
    expect(result.current.generatedDoc).toContain('نص المستند المولّد');
  });

  it('نفاد السقف اليومي: generatedDoc بتبدأ بـ ⏳ + تلميح BYOK، ومن غير recordError', async () => {
    const quotaMsg = 'وصلت للحد المجاني اليومي للمساعد الذكي. تقدر تضيف مفتاح Groq شخصي مجاني من الإعدادات لاستخدام أكبر.';
    const { result } = setup(() => Promise.reject(new Error(quotaMsg)));
    fillRequiredFields(result);
    await act(async () => { await result.current.generateDocument(); });
    expect(result.current.generatedDoc.startsWith('⏳ ' + quotaMsg)).toBe(true);
    expect(result.current.generatedDoc).toContain('السقف بيترجع تلقائيًا بكرة');
    expect(recordError).not.toHaveBeenCalled();
  });

  it('فشل المزود (رسالة غير عربية): generatedDoc برسالة عامة تبدأ بـ ⚠️ + recordError بيتنادى', async () => {
    const { result } = setup(() => Promise.reject(new Error('Failed to fetch')));
    fillRequiredFields(result);
    await act(async () => { await result.current.generateDocument(); });
    expect(result.current.generatedDoc.startsWith('⚠️ تعذّر توليد المستند')).toBe(true);
    expect(recordError).toHaveBeenCalledWith('ai_document_generate', 'Failed to fetch', expect.objectContaining({ label: 'توليد المستندات' }));
  });
});
