import { test, expect } from '@playwright/test';
import { login } from './utils';

// مرحلة 5 من مرحلة 7 (E2E) — مساعد الذكاء الاصطناعي، وضع "توليد مستند" فقط
// (باقي أوضاع المساعد — الشات، التلخيص، إلخ — بره نطاق هذه المرحلة).
//
// ⚠️ تصحيح مهم عن التقرير السابق: المشروع لا ينادي api.anthropic.com ولا
// أي مزوّد ذكاء اصطناعي مباشرة من المتصفح. المسار الحقيقي:
// useAILegalEngine.callAI() → db.functions.invoke('ai-chat', ...) →
// Supabase Edge Function `ai-chat` (وهي اللي بتنادي Groq من على السيرفر).
// فنقطة الاعتراض الصحيحة في Playwright هي مسار الإيدج فانكشن نفسه:
// '**/functions/v1/ai-chat' — مش api.anthropic.com.

const AI_CHAT_ROUTE = '**/functions/v1/ai-chat';

// ⚠️ FIX (27 يوليو 2026): sw.js بيعمل event.respondWith(fetch(...)) لأي
// ريكوست فيه supabase.co (استراتيجية "Network Only") — ده fetch حقيقي من
// جوه الـ Service Worker نفسه، خارج نطاق page.route() تمامًا. فموك
// page.route(AI_CHAT_ROUTE) هنا بالتحديد كان بيتسجل بس الريكوست الحقيقي
// يعدّي من غيره ويوصل للإيدج فانكشن الحقيقي على السيرفر.
//
// ⚠️ ملحوظة مهمّة: أول حل جُرّب كان حجب serviceWorkers على مستوى
// playwright.config.ts كله (globally) — ده رجّع الاختبارين دول، لكنه كسر
// 5 اختبارات تانية بتعتمد فعليًا على سلوك الـ SW (خصوصًا اختبارات حفظ
// أوفلاين اللي بتستخدم context.setOffline، لأن offlineQueue.ts بينتظر
// navigator.serviceWorker.ready كجزء من مسار تسجيل الكتابة). فالحجب هنا
// محصور بملف الاختبار ده بس (test.use على مستوى الملف) — الاختبارات
// الباقية كلها بتفضل شغالة بسلوك الـ SW الطبيعي.
test.use({ serviceWorkers: 'block' });

test.describe('مساعد الذكاء الاصطناعي — توليد مستند (mock عبر اعتراض ai-chat)', () => {
  test('توليد مستند بنجاح يعرض محتوى الرد من الإيدج فانكشن', async ({ page }) => {
    await login(page);

    // mock رد ناجح (200) بنفس شكل استجابة ai-chat الحقيقية (json({ok:true, content, source}))
    await page.route(AI_CHAT_ROUTE, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          content: 'هذا نص تجريبي لمذكرة الدفاع تم توليده عبر mock اختبار E2E.',
          source: 'platform',
        }),
      });
    });

    await page.getByTestId('nav-ai-center').click();
    await page.getByTestId('ai-assistant-panel').waitFor({ state: 'visible', timeout: 10_000 });

    // فتح وضع "توليد مستند" من لوحة المهام
    await page.getByTestId('ai-task-card-generate').click();

    // تعبئة الحقول الحرجة المطلوبة لنوع المستند الافتراضي (مذكرة_دفاع):
    // الموكل + الخصم + الموضوع (missingCritical في useAIDocumentGenerator.ts)
    await page.getByTestId('ai-doc-field-plaintiff').fill('موكل اختبار E2E');
    await page.getByTestId('ai-doc-field-defendant').fill('خصم اختبار E2E');
    await page.getByTestId('ai-doc-field-subject').fill('موضوع اختبار E2E');

    await page.getByTestId('ai-generate-doc-submit').click();

    const generatedDoc = page.getByTestId('ai-generated-doc');
    await generatedDoc.waitFor({ state: 'visible', timeout: 15_000 });
    await expect(generatedDoc).toContainText('نص تجريبي لمذكرة الدفاع تم توليده عبر mock');
  });

  // 🆕 هذا الاختبار بالتحديد كان بيفشل قبل إصلاح callAI في
  // useAILegalEngine.ts: supabase-js كان بيرجّع error.message عام
  // بالإنجليزي ("Edge Function returned a non-2xx status code") بدل
  // الرسالة العربية الحقيقية جوه جسم استجابة الإيدج فانكشن، فرسالة
  // "وصلت للحد المجاني اليومي..." كانت بتتحول لرسالة عامة (⚠️) بدل
  // رسالة السقف (⏳) الصح. الإصلاح بيستخدم getFnErrorMessage (نفس نمط
  // useAdminLegalLibrary.ts) لاستخراج الرسالة الحقيقية عبر error.context.json().
  test('تجاوز السقف اليومي يعرض الرسالة العربية الحقيقية من الإيدج فانكشن', async ({ page }) => {
    await login(page);

    // mock رد خطأ (400) بنفس شكل استجابة ai-chat الحقيقية عند نفاد السقف
    // المجاني اليومي (راجع supabase/functions/ai-chat/index.ts)
    const quotaMessage = 'وصلت للحد المجاني اليومي للمساعد الذكي. تقدر تضيف مفتاح Groq شخصي مجاني من الإعدادات لاستخدام أكبر.';
    await page.route(AI_CHAT_ROUTE, async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: quotaMessage }),
      });
    });

    await page.getByTestId('nav-ai-center').click();
    await page.getByTestId('ai-assistant-panel').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('ai-task-card-generate').click();

    await page.getByTestId('ai-doc-field-plaintiff').fill('موكل اختبار E2E');
    await page.getByTestId('ai-doc-field-defendant').fill('خصم اختبار E2E');
    await page.getByTestId('ai-doc-field-subject').fill('موضوع اختبار E2E');

    await page.getByTestId('ai-generate-doc-submit').click();

    const generatedDoc = page.getByTestId('ai-generated-doc');
    await generatedDoc.waitFor({ state: 'visible', timeout: 15_000 });
    // لازم تظهر الرسالة العربية الحقيقية بتاعة السقف اليومي، مش الرسالة
    // العامة "تعذّر توليد المستند..."
    await expect(generatedDoc).toContainText('وصلت للحد المجاني اليومي');
    await expect(generatedDoc).not.toContainText('تعذّر توليد المستند. حاول مرة أخرى');
  });
});
