// ══════════════════════════════════════════════════════════════
//  partyDisplay.ts — منطق عرض موحّد لملخص "طرف" (مدعي/مدعى عليه) من
//  قائمة أشخاصه + مسماه القانوني (لو موجود) — نفس التنسيق المستخدم في
//  PartySideCard.tsx (فورم الإدخال)، بس هنا للعرض القرائي بس (بدون أي
//  حالة تفاعلية/أخطاء فاليديشن).
//
//  ⚠️ الهدف من وجود الملف ده: بند 5 من خطة "تطوير أطراف الدعوى" (نقاط
//  العرض التفصيلية) بيشترط عدم تكرار منطق عرض منفصل في كل مكان (InfoSection،
//  الهيدر العلوي، شاشات الجلسة المستقلة) تفاديًا لتعارض الصيغة بين موضع
//  وتاني لاحقًا. أي موضع عرض جديد للمسمى القانوني/ملخص طرف لازم يستخدم
//  الدالة دي بدل ما يبني تنسيقه الخاص.
//
//  خطة "تطوير أطراف الدعوى" — مرحلة 5 (24 يوليو 2026).
// ══════════════════════════════════════════════════════════════

export interface PartyPersonLike {
    name: string | null;
    capacity?: string | null;
}

export interface PartySideSummary {
    // اسم أول شخص مسمّى في الجهة (تجاهل أي صف اسمه فاضي)
    primaryName: string;
    // صفته (لو موجودة) — بتتعرض بس لو مفيش أكتر من شخص (شوف formatPartySideLine)
    primaryCapacity: string;
    // عدد باقي الأشخاص المسمّيين تحت نفس الجهة (0 لطرف شخص واحد)
    othersCount: number;
}

// بيرجع null لو مفيش أي شخص مسمّى خالص في الجهة دي (فاضية بالكامل).
export function summarizePartySide(persons: PartyPersonLike[]): PartySideSummary | null {
    const named = persons.filter((p) => p.name && p.name.trim());
    if (named.length === 0) return null;
    return {
        primaryName: named[0].name!.trim(),
        primaryCapacity: (named[0].capacity || '').trim(),
        othersCount: named.length - 1,
    };
}

// بيبني نص سطر واحد جاهز للعرض المختصر (بطاقة/هيدر) من ملخص الجهة + مسماها
// القانوني (لو موجود ومتعدد الأشخاص):
//   - طرف شخص واحد (الحالة الغالبة): "الاسم" — بلا أي تغيير عن الشكل القديم.
//   - طرف متعدد الأشخاص وله مسمى قانوني: "المسمى القانوني (+٢ آخرين)".
//   - طرف متعدد الأشخاص بلا مسمى قانوني بعد (حالة انتقالية نادرة، الفاليديشن
//     بتمنعها عند الحفظ لكن ممكن تظهر في بيانات قديمة قبل تفعيل القاعدة):
//     نفس فولباك PartySideCard — اسم أول شخص + "+N آخرين".
export function formatPartySideLine(persons: PartyPersonLike[], legalTitle?: string | null): string | null {
    const summary = summarizePartySide(persons);
    if (!summary) return null;
    if (summary.othersCount === 0) {
        return summary.primaryCapacity ? `${summary.primaryName} (${summary.primaryCapacity})` : summary.primaryName;
    }
    const trimmedTitle = (legalTitle || '').trim();
    const suffix = `+${summary.othersCount} ${summary.othersCount === 1 ? 'آخر' : 'آخرين'}`;
    if (trimmedTitle) return `${trimmedTitle} (${suffix})`;
    const fallbackName = summary.primaryCapacity ? `${summary.primaryName} (${summary.primaryCapacity})` : summary.primaryName;
    return `${fallbackName} ${suffix}`;
}
