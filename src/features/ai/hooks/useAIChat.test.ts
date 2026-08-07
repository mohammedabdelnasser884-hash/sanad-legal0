import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAIChat } from './useAIChat';
import type { AIMessage } from './aiAssistantTypes';

// ══════════════════════════════════════════════════════════════════
// اختبار useAIChat — أول تغطية فعلية له خالص (كان الملف الوحيد بين
// وحدات المساعد الذكي المعتمدة على callAI/recordError من غير أي تست).
// المرحلة 5 (sanad-ai-assistant-plan-20.md قسم 6، نفس نمط
// useAIDocumentGenerator.test.ts / ClientMessage.test.tsx): معالجة أخطاء
// callAI (مفتاح غلط / نفاد السقف اليومي / رسالة عربية واضحة من السيرفر /
// فشل تقني عام). بيغطي كمان فيكس بند 4.1 (6 أغسطس 2026): نفاد السقف
// اليومي بقى بيفتح مودال "مفتاح شخصي" تلقائيًا (setShowKeyInput) بدل ما
// يسيب المستخدم يدوّر عليه بنفسه.
// ══════════════════════════════════════════════════════════════════

const recordError = vi.fn();
vi.mock('../../../systemHealth', () => ({ recordError: (...a: unknown[]) => recordError(...a) }));

function setup(callAIImpl?: () => Promise<string>) {
  const callAI = vi.fn(callAIImpl || (() => Promise.resolve('رد المساعد')));
  const retrieveLegalArticles = vi.fn(() => Promise.resolve([]));
  const buildLegalContextBlock = vi.fn(() => '');
  const setShowKeyInput = vi.fn();
  const setMessages = vi.fn();
  const messages: AIMessage[] = [];

  const { result, rerender } = renderHook(
    (props: { messages: AIMessage[] }) =>
      useAIChat({
        messages: props.messages,
        setMessages,
        hasKey: true,
        keyLoading: false,
        setShowKeyInput,
        selectedCase: null,
        retrieveLegalArticles,
        buildLegalContextBlock,
        callAI,
      }),
    { initialProps: { messages } }
  );
  return { result, rerender, callAI, setShowKeyInput, setMessages };
}

describe('useAIChat — sendMessage ومعالجة الأخطاء', () => {
  beforeEach(() => vi.clearAllMocks());

  it('رد ناجح: بينادي callAI مرة واحدة ويضيف رسالة assistant بالرد', async () => {
    const { result, callAI, setMessages } = setup(() => Promise.resolve('أهلاً، إزاي أقدر أساعدك؟'));
    act(() => { result.current.setInput('عايز أعرف حكم كذا'); });
    await act(async () => { await result.current.sendMessage(); });
    expect(callAI).toHaveBeenCalledTimes(1);
    // آخر نداء لـsetMessages بيضيف رسالة الـassistant بالرد
    const lastUpdater = setMessages.mock.calls.at(-1)?.[0] as (p: AIMessage[]) => AIMessage[];
    expect(lastUpdater([]).at(-1)).toEqual(expect.objectContaining({ role: 'assistant', text: 'أهلاً، إزاي أقدر أساعدك؟' }));
  });

  it('نص فاضي: مبينادّيش callAI خالص', async () => {
    const { result, callAI } = setup();
    act(() => { result.current.setInput('   '); });
    await act(async () => { await result.current.sendMessage(); });
    expect(callAI).not.toHaveBeenCalled();
  });

  it('مفتاح غلط (401): رسالة "🔑 API Key غير صحيح"، من غير setShowKeyInput ومن غير recordError', async () => {
    const { result, setShowKeyInput, setMessages } = setup(() => Promise.reject(new Error('401 Unauthorized')));
    act(() => { result.current.setInput('سؤال'); });
    await act(async () => { await result.current.sendMessage(); });
    const lastUpdater = setMessages.mock.calls.at(-1)?.[0] as (p: AIMessage[]) => AIMessage[];
    expect(lastUpdater([]).at(-1)?.text).toBe('🔑 API Key غير صحيح. اضغط زر المفتاح لتحديثه.');
    expect(setShowKeyInput).not.toHaveBeenCalled();
    expect(recordError).not.toHaveBeenCalled();
  });

  it('نفاد السقف اليومي: الرسالة بتتذيّل بتنويه فتح النافذة، وsetShowKeyInput(true) بيتنادى، من غير recordError', async () => {
    const quotaMsg = 'وصلت للحد المجاني اليومي للمساعد الذكي. تقدر تضيف مفتاح Groq شخصي مجاني من الإعدادات لاستخدام أكبر.';
    const { result, setShowKeyInput, setMessages } = setup(() => Promise.reject(new Error(quotaMsg)));
    act(() => { result.current.setInput('سؤال'); });
    await act(async () => { await result.current.sendMessage(); });
    const lastUpdater = setMessages.mock.calls.at(-1)?.[0] as (p: AIMessage[]) => AIMessage[];
    const shown = lastUpdater([]).at(-1)?.text as string;
    expect(shown.startsWith(quotaMsg)).toBe(true);
    expect(shown).toContain('فتحنا لك نافذة إضافة المفتاح');
    expect(setShowKeyInput).toHaveBeenCalledWith(true);
    expect(recordError).not.toHaveBeenCalled();
  });

  it('رسالة عربية واضحة تانية من السيرفر (زي "الحساب معطّل"): بتتعرض زي ما هي من غير recordError ومن غير فتح المودال', async () => {
    const serverMsg = 'الحساب معطّل';
    const { result, setShowKeyInput, setMessages } = setup(() => Promise.reject(new Error(serverMsg)));
    act(() => { result.current.setInput('سؤال'); });
    await act(async () => { await result.current.sendMessage(); });
    const lastUpdater = setMessages.mock.calls.at(-1)?.[0] as (p: AIMessage[]) => AIMessage[];
    expect(lastUpdater([]).at(-1)?.text).toBe(serverMsg);
    expect(setShowKeyInput).not.toHaveBeenCalled();
    expect(recordError).not.toHaveBeenCalled();
  });

  it('فشل تقني عام (رسالة غير عربية): رسالة عامة بـ⚠️ وrecordError بيتنادى بمفتاح ai_chat', async () => {
    const { result, setMessages } = setup(() => Promise.reject(new Error('Failed to fetch')));
    act(() => { result.current.setInput('سؤال'); });
    await act(async () => { await result.current.sendMessage(); });
    const lastUpdater = setMessages.mock.calls.at(-1)?.[0] as (p: AIMessage[]) => AIMessage[];
    const shown = lastUpdater([]).at(-1)?.text as string;
    expect(shown.startsWith('⚠️ تعذّر الحصول على رد')).toBe(true);
    expect(recordError).toHaveBeenCalledWith('ai_chat', 'Failed to fetch', expect.objectContaining({ label: 'المساعد الذكي' }));
  });
});
