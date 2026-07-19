import { describe, it, expect } from 'vitest';
import { isQuotaExceededMessage } from './TaskResultKit';

// ══════════════════════════════════════════════════════════════════
// اختبار isQuotaExceededMessage — الدالة المشتركة اللي بتحدد هل رسالة
// الخطأ الراجعة من ai-chat/index.ts هي نفاد السقف اليومي ولا لأ (بيتم
// الاعتماد عليها في CaseSummary.tsx/ClientMessage.tsx/useAIDocumentGenerator.ts
// عشان تحدد تعرض UsageLimitState ولا ErrorState). جزء من بند "اختبار
// غياب رصيد AI / فشل المزود" (المرحلة 5).
// ══════════════════════════════════════════════════════════════════

describe('isQuotaExceededMessage', () => {
  it('بيرجع true لرسالة نفاد السقف الفعلية الراجعة من ai-chat/index.ts', () => {
    expect(isQuotaExceededMessage('وصلت للحد المجاني اليومي للمساعد الذكي. تقدر تضيف مفتاح Groq شخصي مجاني من الإعدادات لاستخدام أكبر.')).toBe(true);
  });

  it('بيرجع false لرسالة خطأ عربية عادية مش متعلقة بالسقف', () => {
    expect(isQuotaExceededMessage('تعذّر توليد التلخيص. حاول تاني بعد قليل. لو المشكلة استمرت، تواصل مع الدعم.')).toBe(false);
  });

  it('بيرجع false لرسالة خطأ فشل مزود (غير عربية)', () => {
    expect(isQuotaExceededMessage('Failed to fetch')).toBe(false);
  });
});
