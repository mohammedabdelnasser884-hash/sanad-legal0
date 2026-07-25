// شكل خطأ استدعاء edge function (duck-typing — نفس النمط الأصلي في
// useAdminLegalLibrary.ts::getFnErrorMessage — context ممكن يكون Response
// حقيقي فيه json()/text())
export interface EdgeFunctionError {
  message?: string;
  context?: {
    json?: () => Promise<{ error?: string } | null>;
    text?: () => Promise<string>;
  };
}

// ── استخراج رسالة الخطأ الحقيقية من جسم استجابة Edge Function ──
// supabase-js بيرجّع error.message عام بالإنجليزي ("Edge Function returned
// a non-2xx status code") لأي رد بـstatus غير 2xx، حتى لو الفانكشن نفسها
// رجّعت رسالة عربية مقصودة جوه الجسم (زي "الجلسة منتهية"، "محاولات كثيرة
// فاشلة"...). الدالة دي بتحاول توصل للرسالة الحقيقية جوه error.context.
//
// بترجع null لو مفيش رسالة قابلة للاستخراج (فشل شبكة، رد غير متوقع...)
// — الكولر هو اللي يقرر الفولباك المناسب لسياقه (عادةً بفحص لو الرسالة
// عربية عشان يتأكد إنها فعلاً رسالة مقصودة للمستخدم مش نص تقني خام).
export async function getEdgeFunctionErrorMessage(
  error: EdgeFunctionError | null | undefined,
): Promise<string | null> {
  if (!error) return null;
  try {
    if (error.context && typeof error.context.json === 'function') {
      const body = await error.context.json();
      if (body?.error) return body.error;
    }
    if (error.context && typeof error.context.text === 'function') {
      const text = await error.context.text();
      if (text) return text;
    }
  } catch (_) { /* تجاهل */ }
  return null;
}

// فحص سريع لو النص فيه حروف عربية — بنستخدمه كمعيار عملي لتمييز رسالة
// مقصودة للمستخدم (عربية) عن نص تقني خام (إنجليزي، زي أخطاء الشبكة).
export function looksArabicUserMessage(text: string | null | undefined): boolean {
  return !!text && /[\u0600-\u06FF]/.test(text);
}
