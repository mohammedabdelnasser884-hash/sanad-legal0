import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePartyFields } from './usePartyFields';

// ══════════════════════════════════════════════════════════════════
// تستات usePartyFields — خطة تعدد الأطراف، مرحلة 3 (22 يوليو 2026).
// معيار القبول الموثّق في الخطة: "إضافة/حذف/تفعيل ⭐ شغالين بصريًا،
// الفاليديشن (رقم قومي إجباري لو is_client) شغالة" — كل تست هنا بيغطي
// جزء من المعيار ده مباشرة، بدون أي نداء db (الهوك بمعزل تام).
// ══════════════════════════════════════════════════════════════════

describe('usePartyFields', () => {
    it('بيبدأ بطرف واحد فاضي لكل جهة لو مفيش initial values', () => {
        const { result } = renderHook(() => usePartyFields());
        expect(result.current.plaintiffs).toHaveLength(1);
        expect(result.current.defendants).toHaveLength(1);
        expect(result.current.plaintiffs[0].side).toBe('plaintiff');
        expect(result.current.defendants[0].side).toBe('defendant');
    });

    it('addParty بيضيف طرف جديد في نفس الجهة، من غير ما يأثر على الجهة التانية', () => {
        const { result } = renderHook(() => usePartyFields());
        act(() => result.current.addParty('plaintiff'));
        expect(result.current.plaintiffs).toHaveLength(2);
        expect(result.current.defendants).toHaveLength(1);
    });

    it('addParty ممكن ينادى أكتر من مرة (بلا حدود — قسم 2 من الخطة)', () => {
        const { result } = renderHook(() => usePartyFields());
        act(() => {
            result.current.addParty('defendant');
            result.current.addParty('defendant');
            result.current.addParty('defendant');
        });
        expect(result.current.defendants).toHaveLength(4);
    });

    it('canRemove بيرجع false لأول طرف في جهته، true لأي طرف بعده', () => {
        const { result } = renderHook(() => usePartyFields());
        const firstId = result.current.plaintiffs[0].id;
        act(() => result.current.addParty('plaintiff'));
        const secondId = result.current.plaintiffs[1].id;

        expect(result.current.canRemove(firstId)).toBe(false);
        expect(result.current.canRemove(secondId)).toBe(true);
    });

    it('removeParty بيمسح طرف إضافي بنجاح', () => {
        const { result } = renderHook(() => usePartyFields());
        act(() => result.current.addParty('plaintiff'));
        const secondId = result.current.plaintiffs[1].id;

        act(() => result.current.removeParty(secondId));
        expect(result.current.plaintiffs).toHaveLength(1);
    });

    it('removeParty بيرفض يمسح أول/آخر طرف متبقي في جهته حتى لو اتنادى مباشرة', () => {
        const { result } = renderHook(() => usePartyFields());
        const firstId = result.current.plaintiffs[0].id;

        act(() => result.current.removeParty(firstId));
        expect(result.current.plaintiffs).toHaveLength(1);
        expect(result.current.plaintiffs[0].id).toBe(firstId);
    });

    it('toggleIsClient بيقلب is_client من غير ما يمسح باقي القيم المكتوبة', () => {
        const { result } = renderHook(() => usePartyFields());
        const id = result.current.plaintiffs[0].id;

        act(() => result.current.updateParty(id, 'name', 'أحمد محمد علي'));
        act(() => result.current.toggleIsClient(id));
        expect(result.current.plaintiffs[0].is_client).toBe(true);
        expect(result.current.plaintiffs[0].name).toBe('أحمد محمد علي');

        act(() => result.current.toggleIsClient(id));
        expect(result.current.plaintiffs[0].is_client).toBe(false);
        expect(result.current.plaintiffs[0].name).toBe('أحمد محمد علي'); // القيمة لسه موجودة
    });

    it('toggleIsClient ممكن يتفعّل لأكتر من طرف في نفس الوقت', () => {
        const { result } = renderHook(() => usePartyFields());
        act(() => result.current.addParty('plaintiff'));
        const [id1, id2] = result.current.plaintiffs.map((p) => p.id);

        act(() => {
            result.current.toggleIsClient(id1);
            result.current.toggleIsClient(id2);
        });
        expect(result.current.plaintiffs[0].is_client).toBe(true);
        expect(result.current.plaintiffs[1].is_client).toBe(true);
    });

    it('updateParty بيعدّل حقل واحد بس من غير ما يأثر على باقي حقول نفس الطرف', () => {
        const { result } = renderHook(() => usePartyFields());
        const id = result.current.plaintiffs[0].id;

        act(() => result.current.updateParty(id, 'national_id', '12345678901234'));
        act(() => result.current.updateParty(id, 'capacity', 'مدعي'));

        expect(result.current.plaintiffs[0].national_id).toBe('12345678901234');
        expect(result.current.plaintiffs[0].capacity).toBe('مدعي');
    });

    it('validation.valid بيبقى false لحد ما رقم قومي الموكل يتملى صح (14 رقم)', () => {
        const { result } = renderHook(() => usePartyFields());
        const id = result.current.plaintiffs[0].id;

        act(() => {
            result.current.updateParty(id, 'name', 'أحمد محمد علي');
            result.current.updateParty(id, 'capacity', 'مدعي');
            result.current.toggleIsClient(id);
        });
        // فضل is_client لكن من غير رقم قومي، وطرف المدعى عليه لسه فاضي
        expect(result.current.validation.valid).toBe(false);

        act(() => result.current.updateParty(id, 'national_id', '12345678901234'));
        act(() => result.current.updateParty(result.current.defendants[0].id, 'name', 'محمود سعيد إبراهيم'));
        act(() => result.current.updateParty(result.current.defendants[0].id, 'capacity', 'مدعى عليه'));

        expect(result.current.validation.valid).toBe(true);
    });

    it('بيقبل initialPlaintiffs/initialDefendants جاهزين (وضع تعديل قضية موجودة)', () => {
        const { result } = renderHook(() => usePartyFields({
            initialPlaintiffs: [
                { id: 'existing-1', side: 'plaintiff', is_client: true, name: 'أحمد', capacity: 'مدعي', national_id: '12345678901234', address: '', power_of_attorney: '', client_id: null },
            ],
        }));
        expect(result.current.plaintiffs).toHaveLength(1);
        expect(result.current.plaintiffs[0].id).toBe('existing-1');
        // defendants لسه بيبدأ بطرف فاضي افتراضي لأنه مش متبعت
        expect(result.current.defendants).toHaveLength(1);
    });
});
