// ══════════════════════════════════════════════════════
//  Edge Function: ai-chat
//
//  المهمة: استدعاء Groq API (المساعد القانوني AI) من السيرفر.
//
//  🆕 بعد إعادة الهيكلة (المرحلة 0 من sanad-ai-assistant-plan-3.md):
//  - المفتاح الأساسي بقى مفتاح واحد على مستوى المنصة
//    (GROQ_PLATFORM_API_KEY كـ secret على مستوى الفانكشن)، مش مفتاح
//    لكل مكتب. صفر احتكاك على المكتب، صفر تكلفة إضافية غير متحكم فيها.
//  - كل مكتب عنده سقف استخدام يومي (40 رسالة) متحكم فيه عبر
//    check_and_increment_ai_usage في قاعدة البيانات (migration
//    01-ai-platform-usage-cap.sql).
//  - لو المكتب وصل للسقف، بيتفحص لو عنده مفتاح Groq شخصي (BYOK،
//    زي الطريقة القديمة بالظبط) ولو موجود بيستخدمه من غير أي سقف
//    (لأنه مفتاحه هو، مش على حساب سند).
//  - لو مفتاح المنصة لسه مش متظبط أصلاً كـ secret (رول-اوت تدريجي)،
//    الفانكشن بترجع لنفس السلوك القديم بالكامل (BYOK فقط) تلقائيًا.
//    ده معناه كمان إن التستات الحالية (اللي مبتحطش GROQ_PLATFORM_API_KEY)
//    هتفضل شغالة زي ما هي من غير تعديل.
//
//  الإدخال:
//   { messages: [{role, content}], system_prompt: string, max_tokens?, temperature?, model? }
//
//  الخرج:
//   { ok: true, content: string, source: 'platform'|'byok' } أو { error: "..." }
// ══════════════════════════════════════════════════════

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  return null;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// 🆕 مفتاح المنصة — واحد بس، بيتضبط كـ secret على مستوى الفانكشن
// (supabase secrets set GROQ_PLATFORM_API_KEY=...)، مش في أي جدول
// ولا Vault لكل مكتب.
const PLATFORM_GROQ_KEY = Deno.env.get('GROQ_PLATFORM_API_KEY') ?? '';

// 🆕 السقف اليومي المجاني لكل مكتب على مفتاح المنصة — مؤكد في
// sanad-ai-assistant-plan-3.md: 40 رسالة/يوم.
const PLATFORM_DAILY_CAP = 40;

// النماذج المسموح بيها فقط — whitelist للحماية من أي محاولة حقن نموذج غير معتمد
const ALLOWED_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'llama-3.1-8b-instant',
] as const;
const DEFAULT_MODEL  = 'llama-3.3-70b-versatile'; // الافتراضي الأقوى
const MAX_TOKENS_CAP = 2000; // حماية من استهلاك مفرط لو الفرونت إند طلب رقم ضخم

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function rest(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.message || `status ${r.status}`);
  }
  return r.json();
}

async function rpc(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.message || `status ${r.status}`);
  }
  return r.json();
}

// مين الشخص اللي عامل الطلب ده فعليًا، من خلال جلسته الحالية
async function getCaller(req: Request) {
  const authHeader = req.headers.get('Authorization') || '';
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: ANON_KEY },
  });
  if (!r.ok) return null;
  const user = await r.json().catch(() => null);
  return user?.id ? user : null;
}

async function getCallerProfile(callerId: string) {
  const rows = await rest(`profiles?user_id=eq.${callerId}&select=tenant_id,is_active&limit=1`);
  return Array.isArray(rows) ? rows[0] : null;
}

async function getOfficeGroqKey(tenantId: string | null) {
  // مفتاح المكتب الشخصي (BYOK) — نفس الطريقة القديمة بالظبط، متخزن
  // في Vault. دلوقتي بقى fallback اختياري بس (لما السقف المجاني على
  // مفتاح المنصة يخلص، أو لو مفتاح المنصة مش متظبط) مش المصدر الأساسي.
  if (!tenantId) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_office_groq_key`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_tenant_id: tenantId }),
  });
  if (!r.ok) return null;
  const key = await r.json().catch(() => null);
  return typeof key === 'string' && key.length > 0 ? key : null;
}

// 🆕 يتحقق من سقف الاستخدام اليومي على مفتاح المنصة، ويزوّد العدّاد
// فعليًا لو الطلب مسموح. لو استعلام التتبّع نفسه فشل (مشكلة شبكة/DB
// مؤقتة)، بنسمح بالطلب (fail-open) عشان عطل مؤقت في التتبّع مايوقفش
// المساعد بالكامل — قرار مبدئي وسهل يتغيّر لـ fail-closed لو حابب.
async function checkPlatformUsageAllowed(tenantId: string): Promise<boolean> {
  try {
    const allowed = await rpc('check_and_increment_ai_usage', {
      p_tenant_id: tenantId,
      p_daily_cap: PLATFORM_DAILY_CAP,
    });
    return allowed === true;
  } catch {
    return true; // fail-open — راجع الملاحظة فوق
  }
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json().catch(() => ({}));

    const callerUser = await getCaller(req);
    if (!callerUser) return json({ error: 'الجلسة منتهية، سجّل الدخول من جديد' }, 401);

    const caller = await getCallerProfile(callerUser.id);
    if (!caller) return json({ error: 'حساب غير معروف' }, 403);
    if (caller.is_active === false) return json({ error: 'الحساب معطّل' }, 403);

    const tenantId: string | null = caller.tenant_id ?? null;

    // 🆕 تحديد مصدر المفتاح: مفتاح المنصة أولاً (ضمن السقف اليومي)،
    // وإلا مفتاح المكتب الشخصي (BYOK) لو موجود، وإلا رسالة واضحة.
    let groqKey: string | null = null;
    let usedPlatformKey = false;

    if (PLATFORM_GROQ_KEY && tenantId) {
      const allowed = await checkPlatformUsageAllowed(tenantId);
      if (allowed) {
        groqKey = PLATFORM_GROQ_KEY;
        usedPlatformKey = true;
      }
    }

    if (!groqKey) {
      groqKey = await getOfficeGroqKey(tenantId);
    }

    if (!groqKey) {
      // إما السقف المجاني اليومي خلص ومفيش مفتاح شخصي، أو مفتاح
      // المنصة لسه مش متظبط ومفيش مفتاح شخصي كمان.
      const message = PLATFORM_GROQ_KEY
        ? 'وصلت للحد المجاني اليومي للمساعد الذكي. تقدر تضيف مفتاح Groq شخصي مجاني من الإعدادات لاستخدام أكبر.'
        : 'لم يتم ضبط مفتاح المساعد القانوني لهذا المكتب بعد';
      return json({ error: message }, 400);
    }

    const messages = Array.isArray(body.messages) ? body.messages : null;
    if (!messages || messages.length === 0) return json({ error: 'messages مطلوبة' }, 400);

    const systemPrompt = String(body.system_prompt || '');
    const maxTokens = Math.min(Number(body.max_tokens) || 1500, MAX_TOKENS_CAP);
    const temperature = typeof body.temperature === 'number' ? body.temperature : 0.3;
    // اقبل المودل من الفرونت بس لو في الـ whitelist، وإلا استخدم الافتراضي الأقوى
    const requestedModel = String(body.model || '');
    const model = (ALLOWED_MODELS as readonly string[]).includes(requestedModel)
      ? requestedModel
      : DEFAULT_MODEL;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens: maxTokens,
        temperature,
      }),
    });

    const data = await groqRes.json().catch(() => ({}));
    if (!groqRes.ok || data.error) {
      return json({ error: data.error?.message || 'تعذر الاتصال بمزوّد الذكاء الاصطناعي' }, 502);
    }

    const content = data.choices?.[0]?.message?.content || '';
    return json({ ok: true, content, source: usedPlatformKey ? 'platform' : 'byok' });
  } catch (e) {
    const rawMessage = e instanceof Error ? e.message : String(e);
    console.error('[ai-chat]', rawMessage);
    return json({ error: 'تعذّر الحصول على رد من المساعد الذكي حاليًا. لو المشكلة استمرت، تواصل مع الدعم.' }, 500);
  }
});
