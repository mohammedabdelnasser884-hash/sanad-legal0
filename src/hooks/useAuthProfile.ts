import { useState, useEffect, useCallback } from 'react';
import { db } from '../supabaseClient';
import { toast } from '../shared/lib/notifications';
import { recordError } from '../systemHealth';
import { setCurrentTenantId } from '../constants';
import type { ProfileRow } from '../types';

// ─────────────────────────────────────────────────────────
//  ⚡ NEW (فيكس "نظام الأوفلاين ملوش قيمة، جزء 2" — 9 أغسطس 2026):
//  الفيكس القديم (الـtoast الواضح) كان بيبيّن السبب بس مش بيحل المشكلة —
//  لو نداء تحميل البروفايل فشل بسبب مفيش نت، profile كانت بتفضل null
//  للأبد، وبالتبعية authLoading (اللي بيتقفل بس لو profile!==null) كان
//  بيفضل true للأبد كمان → المستخدم عالق في شاشة التحميل، ومحدش بيوصله
//  لأي شاشة فيها بيانات حتى لو الأوفلاين كاش (القضايا/الموكلين) شغال
//  تمام. هنا بنخزّن آخر بروفايل ناجح في localStorage (بمفتاح مربوط
//  بـuser.id)، ولو الفشل بسبب مفيش نت (مفيش error.message من نوع رفض
//  حقيقي زي RLS/تكرار — التمييز صعب من نص الرسالة، فبنستخدم أبسط إشارة
//  متاحة: navigator.onLine)، بنرجع للنسخة المحفوظة بدل ما نسيب profile
//  فاضية. وأهم حاجة: authLoading دلوقتي بيتقفل (false) في كل المسارات،
//  مش بس لو profile بقى غير null — فمفيش سيناريو تاني ممكن يسيب المستخدم
//  عالق في اللودينج للأبد.
// ─────────────────────────────────────────────────────────
const PROFILE_CACHE_KEY = 'sanad_cached_profile_v1';

function saveProfileCache(userId: string, profile: ProfileRow) {
    try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ userId, profile })); } catch { /* localStorage غير متاح — تجاهل */ }
}

function loadProfileCache(userId: string): ProfileRow | null {
    try {
        const raw = localStorage.getItem(PROFILE_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { userId: string; profile: ProfileRow };
        if (parsed.userId !== userId) return null;
        return parsed.profile;
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────────────────
//  useAuthProfile — منقول حرفيًا من App.tsx.
//  بيجمّع: profile/authUser/authLoading state + loadProfile +
//  effect الاستماع لـ onAuthStateChange + effect ضبط tenant_id.
//  ⚠️ أخطر جزء في المشروع كله (auth) — صفر تغيير في المنطق أو
//  الترتيب، نفس الكود بالظبط بس جوه hook منفصل.
// ─────────────────────────────────────────────────────────
export function useAuthProfile() {
    const [profile,    setProfile]    = useState<ProfileRow | null>(null);
    const [authUser,   setAuthUser]   = useState<{ id: string; email?: string | null } | null>(null);
    const [authLoading,setAuthLoading]= useState(true);

    // ── Auth ──────────────────────────────────────────────────
    // ⚠️ FIX: قبل كده كان الكود بيتجاهل error تحميل البروفايل تمامًا.
    // لو المستخدم مسجّل دخول فعليًا في Supabase Auth بس صف البروفايل
    // مش موجود (لسه ما اتضبطش) أو RLS رافضة القراءة، .single() كانت
    // بترجع error والـ data بترجع undefined من غير أي رسالة — فالمستخدم
    // كان بيترمى تاني على شاشة اللوجن من غير أي تفسير ليه (يبان "مش قادر
    // أدخل" من غير سبب واضح). استخدمنا .maybeSingle() (مبترميش error لو
    // الصف مش موجود) وبنعرض toast واضح لو حصل أي error فعلي (زي تكرار
    // بيانات أو رفض RLS).
    const loadProfile = useCallback(async (user: { id: string; email?: string | null } | null) => {
        if (!user) { setProfile(null); setAuthUser(null); return; }
        setAuthUser(user);
        // ⚡ NEW (فيكس "شاشة اللوجو بتفضل ثابتة كتير" — 9 أغسطس 2026):
        // النداء ده مكنش عليه أي timeout خالص (بعكس نفس فكرة الـ8 ثواني
        // المستخدمة في useDbConnectivity)، فلو الاتصال ضعيف/متقطع (مش
        // offline بالكامل بحيث navigator.onLine يبقى false، بس الطلب
        // فعليًا معلّق/بياخد وقت طويل قبل ما يفشل)، شاشة التحميل كانت
        // تفضل عالقة لحد ما الطلب يفشل من نفسه (ممكن يستغرق وقت طويل جدًا
        // حسب المتصفح/الشبكة). دلوقتي: 1) لو navigator.onLine=false من
        // الأساس منحاولش نتصل بالسيرفر خالص ونروح على الكاش فورًا، 2) لو
        // فعلاً هنحاول الاتصال، بنقفله بعد 8 ثواني كحد أقصى (AbortController)
        // زي useDbConnectivity بالظبط.
        let data: ProfileRow | null = null;
        let error: { message: string } | null = null;
        let timedOut = false;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            error = { message: 'offline' };
        } else {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
            try {
                const res = await db.from('profiles').select('*').eq('user_id', user.id).abortSignal(controller.signal).maybeSingle();
                data = res.data;
                error = res.error;
            } catch (err) {
                error = { message: timedOut ? 'timeout' : (err as { message?: string })?.message || 'fetch failed' };
            } finally {
                clearTimeout(timeoutId);
            }
        }
        if (error) {
            // ⚡ لو السبب المرجّح إننا أوف لاين (أو الطلب طوّل واتقفل بالـ
            // timeout فوق)، جرّب ترجع لآخر نسخة بروفايل محفوظة لنفس
            // المستخدم بدل ما تسيب الشاشة عالقة.
            const cached = (!navigator.onLine || timedOut) ? loadProfileCache(user.id) : null;
            if (cached) {
                setProfile(cached);
                toast('أنت أوف لاين — بتشوف بيانات حسابك المحفوظة');
                setAuthLoading(false);
                return;
            }
            recordError('auth_profile_load', error.message, {
                label: 'تحميل بيانات الحساب',
                message: 'تعذّر تحميل بيانات حسابك. أعد تحميل الصفحة. لو المشكلة استمرت، تواصل مع الدعم.',
            });
            toast('تعذّر تحميل بيانات حسابك. أعد تحميل الصفحة. لو المشكلة استمرت، تواصل مع الدعم.');
            setProfile(null);
            setAuthLoading(false);
            return;
        }
        if (!data) {
            toast('لا يوجد ملف شخصي مرتبط بهذا الحساب — تواصل مع مدير المكتب');
            setProfile(null);
            setAuthLoading(false);
            return;
        }
        saveProfileCache(user.id, data);
        setProfile(data);
        setAuthLoading(false);
    }, []);

    useEffect(() => {
        db.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) loadProfile(session.user);
            else setAuthLoading(false);
        });
        const { data: listener } = db.auth.onAuthStateChange((_event, session) => {
            if (session?.user) loadProfile(session.user);
            else { setProfile(null); setAuthUser(null); }
        });
        return () => listener.subscription.unsubscribe();
    }, [loadProfile]);

    // ── ضبط tenant_id الحالي لكل قراءات/كتابات office_settings —
    // لازم يحصل قبل أي نداء لـ loadOfficeSetting/saveOfficeSetting، وكمان
    // عند تسجيل الخروج (profile=null) عشان منفضلش شايلين tenant قديم في
    // الكاش لمستخدم بعده على نفس الجهاز. ──
    useEffect(() => {
        setCurrentTenantId(profile?.tenant_id ?? null);
    }, [profile]);

    useEffect(() => {
        if (profile !== null) setAuthLoading(false);
    }, [profile]);

    return { profile, setProfile, authUser, setAuthUser, authLoading, loadProfile };
}
