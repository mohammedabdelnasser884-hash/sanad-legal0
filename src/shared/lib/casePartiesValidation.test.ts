import { describe, it, expect } from 'vitest';
import { validateParties } from './casePartiesValidation';
import { createEmptyParty, type PartyFieldValue } from '../parties/partyTypes';

// ══════════════════════════════════════════════════════════════════
// تستات validateParties — خطة تعدد الأطراف، مرحلة 3 (22 يوليو 2026).
// كل حالة هنا مطابقة لقاعدة موثّقة صراحة في قسم 4 ("فاليديشن وقت
// الحفظ") أو قسم 7-أ ("تكرار الرقم القومي") من الخطة، مش افتراض.
// ══════════════════════════════════════════════════════════════════

function party(overrides: Partial<PartyFieldValue> & { side: PartyFieldValue['side']; id: string }): PartyFieldValue {
    return { ...createEmptyParty(overrides.side, overrides.id), ...overrides };
}

describe('validateParties', () => {
    it('بينجح لسيناريو بسيط: موكل واحد مدعي + خصم واحد مدعى عليه (الحالة الحالية العادية)', () => {
        const parties = [
            party({ id: 'p1', side: 'plaintiff', is_client: true, name: 'أحمد محمد علي', capacity: 'مدعي', national_id: '12345678901234' }),
            party({ id: 'd1', side: 'defendant', is_client: false, name: 'محمود سعيد إبراهيم', capacity: 'مدعى عليه' }),
        ];
        const result = validateParties(parties);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('بيرفض لو الاسم فاضي لأي طرف', () => {
        const parties = [party({ id: 'p1', side: 'plaintiff', is_client: true, name: '', capacity: 'مدعي', national_id: '12345678901234' })];
        const result = validateParties(parties);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.partyId === 'p1' && e.field === 'name')).toBe(true);
    });

    it('بيرفض لو الصفة فاضية لأي طرف', () => {
        const parties = [party({ id: 'p1', side: 'plaintiff', is_client: true, name: 'أحمد محمد علي', capacity: '', national_id: '12345678901234' })];
        const result = validateParties(parties);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.partyId === 'p1' && e.field === 'capacity')).toBe(true);
    });

    it('بيرفض لو is_client=true ومفيش رقم قومي خالص', () => {
        const parties = [party({ id: 'p1', side: 'plaintiff', is_client: true, name: 'أحمد محمد علي', capacity: 'مدعي', national_id: '' })];
        const result = validateParties(parties);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.partyId === 'p1' && e.field === 'national_id')).toBe(true);
    });

    it('بيرفض لو is_client=true والرقم القومي أقل من 14 رقم', () => {
        const parties = [party({ id: 'p1', side: 'plaintiff', is_client: true, name: 'أحمد محمد علي', capacity: 'مدعي', national_id: '123' })];
        const result = validateParties(parties);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.partyId === 'p1' && e.field === 'national_id')).toBe(true);
    });

    it('بيقبل طرف مش موكل (is_client=false) من غير رقم قومي خالص', () => {
        const parties = [
            party({ id: 'p1', side: 'plaintiff', is_client: true, name: 'أحمد محمد علي', capacity: 'مدعي', national_id: '12345678901234' }),
            party({ id: 'p2', side: 'plaintiff', is_client: false, name: 'كريم', capacity: 'منضم' }),
        ];
        // شخصان تحت "مدعي" — لازم مسمى قانوني (قاعدة 6 الجديدة)
        const result = validateParties(parties, { plaintiff: 'الشركاء', defendant: '' });
        expect(result.valid).toBe(true);
    });

    it('بيرفض لو طرف مش موكل كتب رقم قومي لكن مش 14 رقم بالظبط', () => {
        const parties = [
            party({ id: 'p1', side: 'plaintiff', is_client: true, name: 'أحمد محمد علي', capacity: 'مدعي', national_id: '12345678901234' }),
            party({ id: 'p2', side: 'plaintiff', is_client: false, name: 'كريم', capacity: 'منضم', national_id: '999' }),
        ];
        const result = validateParties(parties);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.partyId === 'p2' && e.field === 'national_id')).toBe(true);
    });

    it('بيرفض لو مفيش أي طرف is_client=true خالص', () => {
        const parties = [
            party({ id: 'p1', side: 'plaintiff', is_client: false, name: 'أحمد محمد علي', capacity: 'مدعي' }),
            party({ id: 'd1', side: 'defendant', is_client: false, name: 'محمود سعيد إبراهيم', capacity: 'مدعى عليه' }),
        ];
        const result = validateParties(parties);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.partyId === '' && e.field === 'name')).toBe(true);
    });

    it('بيقبل أكتر من طرف is_client=true في نفس الوقت (الأب والابن الاتنين مدعيين)', () => {
        const parties = [
            party({ id: 'p1', side: 'plaintiff', is_client: true, name: 'الأب أحمد علي', capacity: 'مدعي', national_id: '11111111111111' }),
            party({ id: 'p2', side: 'plaintiff', is_client: true, name: 'الابن محمد أحمد', capacity: 'مدعي', national_id: '22222222222222' }),
        ];
        // شخصان تحت "مدعي" — لازم مسمى قانوني (قاعدة 6 الجديدة)
        const result = validateParties(parties, { plaintiff: 'ورثة المرحوم علي أحمد', defendant: '' });
        expect(result.valid).toBe(true);
    });

    it('بيقبل is_client=true على طرف من جهة المدعى عليه (خصم-موكل)', () => {
        const parties = [
            party({ id: 'd1', side: 'defendant', is_client: true, name: 'خصم موكل', capacity: 'مدعى عليه', national_id: '33333333333333' }),
        ];
        const result = validateParties(parties);
        expect(result.valid).toBe(true);
    });

    it('بيرفض اسم مدعى عليه (مش موكل) أقل من ثلاثي', () => {
        const parties = [
            party({ id: 'p1', side: 'plaintiff', is_client: true, name: 'أحمد محمد علي', capacity: 'مدعي', national_id: '12345678901234' }),
            party({ id: 'd1', side: 'defendant', is_client: false, name: 'محمود سعيد', capacity: 'مدعى عليه' }),
        ];
        const result = validateParties(parties);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.partyId === 'd1' && e.field === 'name')).toBe(true);
    });

    it('مش بيفرض فحص الاسم الثلاثي على مدعى عليه هو نفسه موكل المكتب', () => {
        const parties = [
            party({ id: 'd1', side: 'defendant', is_client: true, name: 'محمود سعيد', capacity: 'مدعى عليه', national_id: '44444444444444' }),
        ];
        const result = validateParties(parties);
        expect(result.valid).toBe(true);
    });

    it('مش بيفرض فحص الاسم الثلاثي على مدعي مش موكل (الفحص خاص بالمدعى عليه بس)', () => {
        const parties = [
            party({ id: 'p1', side: 'plaintiff', is_client: true, name: 'أحمد محمد علي', capacity: 'مدعي', national_id: '12345678901234' }),
            party({ id: 'p2', side: 'plaintiff', is_client: false, name: 'كريم', capacity: 'منضم' }),
        ];
        // شخصان تحت "مدعي" — لازم مسمى قانوني (قاعدة 6 الجديدة)
        const result = validateParties(parties, { plaintiff: 'الشركاء', defendant: '' });
        expect(result.valid).toBe(true);
    });

    it('بيرفض تكرار نفس الرقم القومي بين طرفين في نفس القضية (قسم 7-أ — منع تام)', () => {
        const parties = [
            party({ id: 'p1', side: 'plaintiff', is_client: true, name: 'أحمد محمد علي', capacity: 'مدعي', national_id: '12345678901234' }),
            party({ id: 'p2', side: 'plaintiff', is_client: false, name: 'كريم عادل حسن', capacity: 'منضم', national_id: '12345678901234' }),
        ];
        const result = validateParties(parties);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.partyId === 'p2' && e.field === 'national_id' && e.message.includes('مكرر'))).toBe(true);
        // أول طرف (p1) مش المفروض ياخد خطأ تكرار — هو أول ظهور للرقم
        expect(result.errors.some((e) => e.partyId === 'p1' && e.message.includes('مكرر'))).toBe(false);
    });

    it('message بيرجع أول خطأ بالترتيب، جاهز لعرضه في toast واحد', () => {
        const parties = [party({ id: 'p1', side: 'plaintiff', is_client: true, name: '', capacity: '', national_id: '' })];
        const result = validateParties(parties);
        expect(result.message).toBe(result.errors[0].message);
    });

    // ══════════════════════════════════════════════════════════
    // قاعدة 6 (جديدة) — إلزامية "المسمى القانوني" عند تعدد الأشخاص
    // (مرحلة 2 من خطة "المسمى القانوني" — 23 يوليو 2026).
    // ══════════════════════════════════════════════════════════
    describe('قاعدة 6 — المسمى القانوني الجامع عند تعدد الأشخاص تحت طرف واحد', () => {
        it('بيقبل طرف واحد بس بدون أي مسمى قانوني (الحالة العادية — 99% من القضايا)', () => {
            const parties = [
                party({ id: 'p1', side: 'plaintiff', is_client: true, name: 'أحمد محمد علي', capacity: 'مدعي', national_id: '12345678901234' }),
                party({ id: 'd1', side: 'defendant', is_client: false, name: 'محمود سعيد إبراهيم', capacity: 'مدعى عليه' }),
            ];
            const result = validateParties(parties); // legalTitles غير متبعتة خالص — لازم يفضل يشتغل زي ما هو
            expect(result.valid).toBe(true);
        });

        it('بيرفض لو المدعي شخصان فأكثر والمسمى القانوني فاضي', () => {
            const parties = [
                party({ id: 'p1', side: 'plaintiff', is_client: true, name: 'محمد أحمد', capacity: 'وارث', national_id: '11111111111111' }),
                party({ id: 'p2', side: 'plaintiff', is_client: false, name: 'محمود أحمد سعيد', capacity: 'وارث' }),
            ];
            const result = validateParties(parties, { plaintiff: '', defendant: '' });
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.partyId === '' && e.field === 'legal_title')).toBe(true);
        });

        it('بيقبل لو المدعي شخصان فأكثر والمسمى القانوني مكتوب', () => {
            const parties = [
                party({ id: 'p1', side: 'plaintiff', is_client: true, name: 'محمد أحمد', capacity: 'وارث', national_id: '11111111111111' }),
                party({ id: 'p2', side: 'plaintiff', is_client: false, name: 'محمود أحمد سعيد', capacity: 'وارث' }),
            ];
            const result = validateParties(parties, { plaintiff: 'ورثة المرحوم أحمد علي', defendant: '' });
            expect(result.valid).toBe(true);
        });

        it('بيرفض لو المدعى عليه شخصان فأكثر والمسمى القانوني فاضي (الفحص مستقل لكل طرف)', () => {
            const parties = [
                party({ id: 'p1', side: 'plaintiff', is_client: true, name: 'أحمد محمد علي', capacity: 'مدعي', national_id: '12345678901234' }),
                party({ id: 'd1', side: 'defendant', is_client: false, name: 'محمود سعيد إبراهيم', capacity: 'مدعى عليه' }),
                party({ id: 'd2', side: 'defendant', is_client: false, name: 'كريم سعيد إبراهيم', capacity: 'مدعى عليه' }),
            ];
            const result = validateParties(parties, { plaintiff: '', defendant: '' });
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.field === 'legal_title' && e.message.includes('المدعى عليه'))).toBe(true);
            // طرف المدعي (شخص واحد بس) ما يفروضش عليه مسمى قانوني
            expect(result.errors.some((e) => e.field === 'legal_title' && e.message.includes('المدعي)'))).toBe(false);
        });

        it('بيقبل لو الطرفين شخصان فأكثر والمسمى القانوني مكتوب لكل واحد فيهم', () => {
            const parties = [
                party({ id: 'p1', side: 'plaintiff', is_client: true, name: 'محمد أحمد', capacity: 'مستأنف', national_id: '11111111111111' }),
                party({ id: 'p2', side: 'plaintiff', is_client: false, name: 'محمود أحمد سعيد', capacity: 'مستأنف' }),
                party({ id: 'd1', side: 'defendant', is_client: false, name: 'كريم سعيد إبراهيم', capacity: 'مستأنف ضده' }),
                party({ id: 'd2', side: 'defendant', is_client: false, name: 'سعيد إبراهيم علي', capacity: 'مستأنف ضده' }),
            ];
            const result = validateParties(parties, { plaintiff: 'الشركاء في شركة كذا', defendant: 'ورثة المرحوم إبراهيم علي' });
            expect(result.valid).toBe(true);
        });
    });
});
