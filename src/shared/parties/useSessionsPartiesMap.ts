// ══════════════════════════════════════════════════════════════
//  useSessionsPartiesMap — خطة تفكيك الأعمدة القديمة، المرحلة B.1.
//
//  بيجيب صفوف case_parties فعليًا لمجموعة جلسات دفعة واحدة (نداءين بالكتير
//  بغض النظر عن عدد الجلسات — مش نداء لكل جلسة على حدة)، ويبني index بسيط
//  يُستخدم وقت العرض. نفس نمط fetchPartiesByCaseId في
//  supabase/functions/session-alerts/index.ts، لكن ممتد كمان لمستوى الجلسة
//  (session_id) عشان الجلسات المستقلة (case_id = null) اللي أطرافها متسجلة
//  على مستوى الجلسة نفسها مش على مستوى قضية.
//
//  للجلسات التابعة لقضية (case_id != null): الأطراف بتتسجل على مستوى
//  القضية (case_parties.case_id) — ده تصميم مقصود موثّق في تقرير المراجعة
//  الشاملة (قسم 1.5، "false positive" check).
// ══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { db } from '../../supabaseClient';
import { createFetchGuard } from '../lib/offlineGuard';
import type { PartyDisplayRow } from './partiesDisplay';

export interface SessionsPartiesIndex {
    byCaseId: Record<string, PartyDisplayRow[]>;
    bySessionId: Record<string, PartyDisplayRow[]>;
}

const EMPTY_INDEX: SessionsPartiesIndex = { byCaseId: {}, bySessionId: {} };

export interface PartiesSourceSession {
    id: string;
    case_id?: string | null;
}

export function useSessionsPartiesMap(sessions: PartiesSourceSession[]): SessionsPartiesIndex {
    // مفاتيح مستقرة (نص مرتب) عشان الـeffect ميعيدش الجلب لمجرد إعادة
    // بناء array الجلسات بنفس المحتوى (كل render في الأبوين).
    const caseIdsKey = [...new Set(sessions.filter((s) => s.case_id).map((s) => s.case_id as string))].sort().join(',');
    const standaloneIdsKey = [...new Set(sessions.filter((s) => !s.case_id).map((s) => s.id))].sort().join(',');

    const [index, setIndex] = useState<SessionsPartiesIndex>(EMPTY_INDEX);

    useEffect(() => {
        const caseIds = caseIdsKey ? caseIdsKey.split(',') : [];
        const standaloneIds = standaloneIdsKey ? standaloneIdsKey.split(',') : [];
        if (caseIds.length === 0 && standaloneIds.length === 0) { setIndex(EMPTY_INDEX); return; }

        // ⚡ NEW (فيكس "تأخير محسوس عند التنقل أوف لاين، جزء 5" — 9 أغسطس
        // 2026): نداء مصاحب على نفس شاشات الجلسات (الداشبورد/الكالندر/قائمة
        // الشهر/الفائتة) كان من غير أي حماية — offline من الأساس يرجع
        // EMPTY_INDEX فورًا (نفس سلوك التدهور الطبيعي الموجود أصلاً لو
        // الاستعلام فشل)، بدل ما يفضل معلّق. أونلاين بطيء/متقطع يتقفل بعد
        // 8 ثواني.
        const guard = createFetchGuard();
        if (guard.offline) { setIndex(EMPTY_INDEX); return; }

        let cancelled = false;
        Promise.all([
            caseIds.length
                ? db.from('case_parties').select('case_id,side,name,capacity,client_id').in('case_id', caseIds).order('sort_order', { ascending: true }).abortSignal(guard.controller.signal)
                : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
            standaloneIds.length
                ? db.from('case_parties').select('session_id,side,name,capacity,client_id').in('session_id', standaloneIds).order('sort_order', { ascending: true }).abortSignal(guard.controller.signal)
                : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
        ]).then(([byCaseRes, bySessionRes]) => {
            guard.cleanup();
            if (cancelled) return;
            const byCaseId: Record<string, PartyDisplayRow[]> = {};
            (byCaseRes.data || []).forEach((p: Record<string, unknown>) => {
                if (!p.case_id) return;
                (byCaseId[p.case_id as string] ||= []).push(p as unknown as PartyDisplayRow);
            });
            const bySessionId: Record<string, PartyDisplayRow[]> = {};
            (bySessionRes.data || []).forEach((p: Record<string, unknown>) => {
                if (!p.session_id) return;
                (bySessionId[p.session_id as string] ||= []).push(p as unknown as PartyDisplayRow);
            });
            setIndex({ byCaseId, bySessionId });
        });
        return () => { cancelled = true; guard.cleanup(); };
    }, [caseIdsKey, standaloneIdsKey]);

    return index;
}

/** بيرجع صفوف case_parties الصحيحة لجلسة معيّنة من الـindex — قضية
 * (case_id) بتاخد أولوية، وإلا session_id (جلسة مستقلة). */
export function lookupParties(s: PartiesSourceSession, index: SessionsPartiesIndex): PartyDisplayRow[] {
    return s.case_id ? (index.byCaseId[s.case_id] || []) : (index.bySessionId[s.id] || []);
}
