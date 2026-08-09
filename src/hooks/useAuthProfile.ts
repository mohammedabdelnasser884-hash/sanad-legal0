import { useState, useEffect, useCallback } from 'react';
import { db } from '../supabaseClient';
import { toast } from '../shared/lib/notifications';
import { recordError } from '../systemHealth';
import { setCurrentTenantId } from '../constants';
import type { ProfileRow } from '../types';

// ─────────────────────────────────────────────────────────
//  useAuthProfile — منقول حرفيًا من App.tsx.
//  بيجمّع: profile/authUser/authLoading state + loadProfile +
//  effect الاستماع لـ onAuthStateChange + effect ضبط tenant_id.
//  ⚠️ أخطر جزء في المشروع كله (auth) — صفر تغيير في المنطق أو
//  الترتيب، نفس الكود بالظبط بس جوه hook منفصل.
// ─────────────────────────────────────────────────────────
// مفتاح تخزين آخر بروفايل نجح تحميله — نفس المستخدم بس (بيتفحص عن طريق
// userId المخزّن جنبه) — مستخدم كـfallback لما نداء الشبكة يفشل أوف لاين.
const PROFILE_CACHE_KEY = 'sanad_cached_profile_v1';

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
    //
    // ⚡ FIX (باگ "عالق على الشعار أوف لاين للأبد" — 9 أغسطس 2026): كان
    // فيه مسار واحد بس بيقفل authLoading (profile!==null useEffect تحت)
    // — فلو نداء الشبكة فشل (أوف لاين تمامًا، أو حتى خطأ RLS/شبكة عادي
    // أونلاين) authLoading كان فاضل true للأبد وشاشة الشعار (AppLoadingScreen)
    // ما كانتش بتقفل خالص، حتى لو المستخدم عنده سيشن Auth محفوظة محليًا.
    // الحل جزئين:
    //   1. try/catch/finally حوالين نداء الشبكة — finally بينادي
    //      setAuthLoading(false) دايمًا (نجاح أو فشل)، فمفيش مسار بيسيب
    //      المستخدم عالق تاني.
    //   2. تخزين آخر بروفايل نجح تحميله في localStorage، واستخدامه
    //      كـfallback لو النداء فشل بسبب مفيش نت (offline) — عشان
    //      المستخدم فعلاً يقدر يدخل التطبيق أوف لاين بدل ما يوقف عند
    //      شاشة اللوجن/اللوجو، وده اللي بيدي لنظام الأوفلاين قيمة حقيقية.
    const loadProfile = useCallback(async (user: { id: string; email?: string | null } | null) => {
        if (!user) { setProfile(null); setAuthUser(null); return; }
        setAuthUser(user);
        try {
            const { data, error } = await db.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
            if (error) {
                recordError('auth_profile_load', error.message, {
                    label: 'تحميل بيانات الحساب',
                    message: 'تعذّر تحميل بيانات حسابك. أعد تحميل الصفحة. لو المشكلة استمرت، تواصل مع الدعم.',
                });
                toast('تعذّر تحميل بيانات حسابك. أعد تحميل الصفحة. لو المشكلة استمرت، تواصل مع الدعم.');
                setProfile(null);
                return;
            }
            if (!data) {
                toast('لا يوجد ملف شخصي مرتبط بهذا الحساب — تواصل مع مدير المكتب');
                setProfile(null);
                return;
            }
            setProfile(data);
            try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ userId: user.id, profile: data })); } catch { /* localStorage غير متاح — تجاهل */ }
        } catch (err) {
            // نداء الشبكة نفسه فشل (أغلب الوقت: أوف لاين تمامًا) — نجرّب
            // نرجع لآخر بروفايل محفوظ لنفس المستخدم بدل ما نوقف المستخدم
            // بره التطبيق خالص.
            let cached: { userId: string; profile: ProfileRow } | null = null;
            try {
                const raw = localStorage.getItem(PROFILE_CACHE_KEY);
                cached = raw ? JSON.parse(raw) : null;
            } catch { /* تجاهل */ }
            if (cached && cached.userId === user.id) {
                setProfile(cached.profile);
                toast('أنت أوف لاين — بتشتغل على آخر نسخة محفوظة من بياناتك');
            } else {
                recordError('auth_profile_load_network', err instanceof Error ? err.message : String(err), {
                    label: 'تحميل بيانات الحساب',
                    message: 'تعذّر تحميل بيانات حسابك. تأكد من الاتصال بالإنترنت.',
                });
                toast('تعذّر تحميل بيانات حسابك. تأكد من الاتصال بالإنترنت.');
                setProfile(null);
            }
        } finally {
            setAuthLoading(false);
        }
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

    // ⚡ ملحوظة: authLoading دلوقتي بيتقفل من جوه loadProfile نفسها
    // (finally block فوق) — مش محتاجين نعتمد على تغيّر profile هنا زي
    // الأول، لأن ده بالظبط كان سبب باگ "عالق على الشعار للأبد" لو
    // profile فضل null بعد فشل التحميل.

    return { profile, setProfile, authUser, setAuthUser, authLoading, loadProfile };
}
