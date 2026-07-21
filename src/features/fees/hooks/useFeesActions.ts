import React, { useState, useEffect, useCallback } from 'react';
import { toast } from '../../../shared/lib/notifications';
import { safeUpdate, logActivity } from '../../../shared/lib/dataAccess';
import { ilikeOrClause } from '../../../shared/lib/sanitize';
import { COUNTRY_CONFIGS } from '../../../constants';
import { db } from '../../../supabaseClient';
import { formatArNumber, formatArDate } from '../../../shared/ui/arabicLocale';
import { computeFeeStatus } from '../feeStatus';
import type { ClientRow, CaseFeeRow, FeePaymentRow, ProfileRow, PaymentsByFeeId } from '../../../types';
import type { MappedCase } from '../../../hooks/useAppData';

const PAGE_SIZE = 15;

// شكل بيانات مودال الفاتورة (مبني من fee + payment وقت الإصدار في FeeCard.tsx)
export interface InvoiceModalState {
    payment: FeePaymentRow;
    fee: CaseFeeRow;
    invoiceNum: string;
    caseName: string;
    clientName: string;
    receivedBy: string;
    amount: string;
    payDate: string;
    issueDate: string;
    totalFees: string;
    paidFees: string;
    remaining: string;
    isFullyPaid: boolean;
    notes: string;
}

// شكل تأكيد حذف دفعة (مبني في FeeCard.tsx)
export interface ConfirmDeletePayState {
    payId: string;
    fee: CaseFeeRow;
    amount: number;
    payDate: string | null;
}

// شكل فورم إضافة/تعديل الأتعاب (مستخدم فعليًا كـ strings في كل مكان —
// إدخالات نصية/رقمية بتتقارن أو تتحول بـ parseFloat لاحقًا في handleSave)
export interface FeeFormState {
    case_id: string;
    client_id: string;
    client_name_manual: string;
    client_name_text: string;
    receiver: string;
    total: string;
    paid: string;
    payment_date: string;
    notes: string;
}

export function useFeesActions(cases: MappedCase[], clients: ClientRow[], country?: string, profile?: ProfileRow | null) {
    const [fees, setFees] = useState<CaseFeeRow[]>([]);
    const [payments, setPayments] = useState<PaymentsByFeeId>({}); // keyed by fee_id
    const [expandedPayments, setExpandedPayments] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState<FeeFormState>({case_id:'', client_id:'', client_name_manual:'', client_name_text:'', receiver:'', total:'', paid:'', payment_date:'', notes:''});
    const [saving, setSaving] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [addPaymentFor, setAddPaymentFor] = useState<string | null>(null);
    // 🔒 FIX (تقرير الموثوقية الشامل — H-1): زرار "تسجيل" دفعة أتعاب كان الوحيد
    // من غير حماية دبل كليك/دبل تاب (بعكس باقي أزرار الحفظ في المشروع). بنقفل
    // بـ id الأتعاب الحالية فورًا في أول سطر من handleAddPayment، نفس فلسفة
    // "نتيجة 0" (saving/savingCase/... إلخ) المطبّقة في باقي المشروع.
    const [payingFeeId, setPayingFeeId] = useState<string | null>(null);
    const [payAmount, setPayAmount] = useState('');
    const [payDate, setPayDate] = useState('');
    const [payNote, setPayNote] = useState('');
    const [confirmDeletePay, setConfirmDeletePay] = useState<ConfirmDeletePayState | null>(null);
    const [confirmDeleteFee, setConfirmDeleteFee] = useState<CaseFeeRow | null>(null);
    const [invoiceModal, setInvoiceModal] = useState<InvoiceModalState | null>(null);
    const [payReceiver, setPayReceiver] = useState('');
    const [payClientName, setPayClientName] = useState('');
    const [payClientNameText, setPayClientNameText] = useState('');
    const [feesSearch, setFeesSearch] = useState('');
    const [feesFilter, setFeesFilter] = useState<'collected'|'deferred'|'open'>('deferred');

    // ── pagination state ──
    const [feesPage, setFeesPage]   = useState(0);
    const [feesTotal, setFeesTotal] = useState(0);
    const [feesMore, setFeesMore]   = useState(false);

    // ── FIX: الملخص المالي الإجمالي (كل الأتعاب، مش الصفحة الحالية) ──
    const [grandTotalAll, setGrandTotalAll] = useState(0);
    const [grandPaidAll,  setGrandPaidAll]  = useState(0);
    const [loadingSummary, setLoadingSummary] = useState(false);

    // ── عدد كل تاب من السيرفر مباشرة (بديل feesByCategory.length المُهمَل) ──
    const [statusCounts, setStatusCounts] = useState<Record<string, number>>({collected:0,deferred:0,open:0});

    const fetchStatusCounts = useCallback(async () => {
        if (!profile) return;
        const [c1, c2, c3] = await Promise.all([
            db.from('case_fees').select('id', { count: 'exact', head: true }).eq('status','collected').is('deleted_at', null),
            db.from('case_fees').select('id', { count: 'exact', head: true }).eq('status','deferred').is('deleted_at', null),
            db.from('case_fees').select('id', { count: 'exact', head: true }).eq('status','open').is('deleted_at', null),
        ]);
        setStatusCounts({ collected: c1.count||0, deferred: c2.count||0, open: c3.count||0 });
    }, [profile]);

    const fetchGrandSummary = useCallback(async () => {
        if (!profile) return;
        setLoadingSummary(true);
        const { data, error } = await db.from('case_fees').select('total_fees,paid_fees').is('deleted_at', null);
        if (error) { setLoadingSummary(false); return; }
        const t = (data || []).reduce((s: number, f: { total_fees: number | null }) => s + (f.total_fees || 0), 0);
        const p = (data || []).reduce((s: number, f: { paid_fees: number | null }) => s + (f.paid_fees  || 0), 0);
        setGrandTotalAll(t);
        setGrandPaidAll(p);
        setLoadingSummary(false);
    }, [profile]);

    useEffect(() => { fetchGrandSummary(); fetchStatusCounts(); }, [fetchGrandSummary, fetchStatusCounts]);

    // ── عملة الدولة المختارة ──
    const currency = COUNTRY_CONFIGS[country||'EG']?.currency || 'جنيه مصري';

    // ── جلب الأتعاب من DB (paginated + server-side search + status filter) ──
    const fetchFees = useCallback(async (page = 0, status = feesFilter, search = feesSearch, append = false) => {
        if (!profile) return;
        setLoading(true);
        const from = page * PAGE_SIZE;
        const to   = from + PAGE_SIZE - 1;

        let q = db.from('case_fees')
            .select('*', { count: 'exact' })
            .eq('status', status)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (search.trim()) {
            const s = search.trim();
            // FIX: فاصلة أو قوس في نص البحث كان بيكسر صياغة فلتر .or()
            q = q.or([ilikeOrClause('client_name', s), ilikeOrClause('notes', s)].join(','));
        }

        const { data, error, count } = await q;
        if (error) { setLoading(false); return; }

        const list = data || [];

        // جلب الدفعات للصفحة الحالية بس
        const feeIds = list.map((f) => f.id);
        const grouped: PaymentsByFeeId = {};
        if (feeIds.length > 0) {
            const { data: pays } = await db.from('fee_payments')
                .select('*')
                .in('fee_id', feeIds)
                .order('payment_date', { ascending: false });
            (pays || []).forEach((p) => {
                const key = p.fee_id as string;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(p);
            });
        }

        if (append) {
            setFees((prev) => [...prev, ...list]);
            setPayments((prev) => ({ ...prev, ...grouped }));
        } else {
            setFees(list);
            setPayments(grouped);
        }

        setFeesTotal(count || 0);
        setFeesPage(page);
        setFeesMore((page + 1) * PAGE_SIZE < (count || 0));
        setLoading(false);
    }, [profile, feesFilter, feesSearch]);

    useEffect(() => { fetchFees(0, feesFilter, feesSearch, false); }, [fetchFees, feesFilter, feesSearch]);

    // ── عند تغيير التاب أو البحث ──
    const handleFilterChange = (newFilter: 'collected'|'deferred'|'open') => {
        setFeesFilter(newFilter);
        setFeesSearch('');
        fetchFees(0, newFilter, '', false);
    };

    const handleSearch = (term: string) => {
        setFeesSearch(term);
        fetchFees(0, feesFilter, term, false);
    };

    const handleSave = async () => {
        if (!form.case_id) { toast('❌ حقل "القضية" مطلوب — يرجى اختيار القضية', true); return; }
        const parsedTotal = parseFloat(form.total);
        if (!form.total || isNaN(parsedTotal)) { toast('❌ حقل "إجمالي الأتعاب" مطلوب', true); return; }
        if (parsedTotal < 0) { toast('❌ خطأ: إجمالي الأتعاب لا يمكن أن يكون سالباً', true); return; }
        setSaving(true);
        let clientId: string | null = null;
        let clientName: string | null = null;
        if (form.client_name_manual === '__manual__') {
            clientName = form.client_name_text || null;
            clientId = null;
        } else if (form.client_id) {
            const matchedClient = clients.find((cl) => cl.id === form.client_id);
            clientName = matchedClient?.full_name || null;
            clientId = form.client_id;
        }
        const payload = {
            case_id: form.case_id,
            case_title: cases.find((c) => c.id === form.case_id)?.title || null,
            client_id: clientId,
            client_name: clientName,
            receiver: form.receiver||null,
            total_fees: parsedTotal,
            notes: form.notes||null,
        };
        if(editId){
            const editFee = fees.find((f) => f.id === editId);
            const newTotal = payload.total_fees;
            const currentPaid = editFee?.paid_fees || 0;
            const payloadWithStatus = { ...payload, status: computeFeeStatus(newTotal, currentPaid) };
            const { conflict } = await safeUpdate(db, 'case_fees', editId, payloadWithStatus, editFee?.updated_at || null);
            if (conflict) { setSaving(false); return; }
            toast('✅ تم تحديث الأتعاب');
            logActivity(db, 'تعديل أتعاب', {
                entity_type: 'fee', entity_id: editId, details: clientName || form.case_id,
                client_name: clientName || null,
                case_name: cases.find((c) => c.id === form.case_id)?.title || null,
                case_type: cases.find((c) => c.id === form.case_id)?.type || null,
            });
        } else {
            const initialPaidAmount = parseFloat(form.paid) > 0 ? parseFloat(form.paid) : 0;
            // 🔒 قرار عمل محسوم مع صاحب المشروع (21 يوليو — المرحلة 6): إضافة
            // سجل أتعاب جديد (بدفعة مبدئية أو من غيرها) بتُمنع تمامًا أوفلاين
            // برضو — رسالة صريحة "يتطلب اتصال بالإنترنت" بدل التقييد في
            // الطابور. نفس فلسفة تسجيل/حذف الدفعة (منطق مالي، أفضل نمنعه
            // كامل من إنه يتقيّد وينفّذ بعدين في وقت مختلف تمامًا).
            if (!navigator.onLine) {
                toast('⚠️ إضافة أتعاب جديدة يتطلب اتصالاً بالإنترنت — أعد المحاولة عند توفر الاتصال', true);
                setSaving(false);
                return;
            }
            const {data:inserted, error} = await db.from('case_fees')
                .insert([{...payload, paid_fees:0, status: computeFeeStatus(payload.total_fees, initialPaidAmount)}]).select().single();
            if(error){ toast('❌ فشل حفظ الأتعاب الجديدة — تحقق من الاتصال وأعد المحاولة', true); setSaving(false); return; }
            if(inserted && initialPaidAmount>0){
                await db.from('fee_payments').insert([{
                    fee_id: inserted.id,
                    amount: initialPaidAmount,
                    payment_date: form.payment_date||new Date().toISOString().slice(0,10),
                    notes: 'مقدم أتعاب',
                    received_by: form.receiver||null,
                    client_id: clientId,
                    client_name: clientName
                }]);
                const {data:allPays} = await db.from('fee_payments').select('amount').eq('fee_id',inserted.id);
                const realPaid = (allPays||[]).reduce((s: number, p: { amount: number | null }) => s+(p.amount||0), 0);
                await db.from('case_fees').update({
                    paid_fees: realPaid,
                    status: computeFeeStatus(payload.total_fees, realPaid),
                    last_payment_date: form.payment_date||new Date().toISOString().slice(0,10)
                }).eq('id',inserted.id);
            }
            toast('✅ تم إضافة الأتعاب');
            logActivity(db, 'إضافة أتعاب', {
                entity_type: 'fee', entity_id: inserted?.id, details: clientName || form.case_id,
                client_name: clientName || null,
                case_name: cases.find((c) => c.id === form.case_id)?.title || null,
                case_type: cases.find((c) => c.id === form.case_id)?.type || null,
            });
        }
        setSaving(false);
        setShowForm(false); setForm({case_id:'',client_id:'',client_name_manual:'',client_name_text:'',receiver:'',total:'',paid:'',payment_date:'',notes:''}); setEditId(null);
        fetchFees(0, feesFilter, feesSearch, false);
        fetchGrandSummary();
        fetchStatusCounts();
    };

    const handleAddPayment = async (fee: CaseFeeRow) => {
        if (payingFeeId) return; // دفعة تانية لسه شغالة — تجاهل أي استدعاء إضافي
        setPayingFeeId(fee.id);
        const amount = parseFloat(payAmount)||0;
        if(amount<=0){ toast('أدخل مبلغاً صحيحاً',true); setPayingFeeId(null); return; }
        // 🔒 قرار عمل محسوم مع صاحب المشروع (21 يوليو — المرحلة 6، توسيع
        // الأوفلاين): تسجيل دفعة بينادي RPC ذرّية (record_fee_payment) —
        // نظام طابور الأوفلاين (__dbWrite) بيدعم بس INSERT/UPDATE/DELETE على
        // جدول، مش نداء RPC. بنمنع العملية بالكامل أوفلاين (رسالة صريحة) بدل
        // ما نبني نسخة أوفلاين متعددة الخطوات وترجعنا لمشكلة الـ partial-save
        // اللي المرحلة 4 حلّتها أصلاً.
        if (!navigator.onLine) {
            toast('⚠️ تسجيل الدفعة يتطلب اتصالاً بالإنترنت — أعد المحاولة عند توفر الاتصال', true);
            setPayingFeeId(null);
            return;
        }
        const remaining = (fee.total_fees || 0) - (fee.paid_fees || 0);
        if ((fee.total_fees || 0) > 0 && amount > remaining) {
            toast(`⚠️ المبلغ (${formatArNumber(amount)}) يتجاوز المتبقي (${formatArNumber(remaining)} ${currency}). تأكد من الصحة.`, true);
        }
        let resolvedClientId: string | null = null;
        let resolvedClientName: string | null = null;
        if (payClientName === '__manual__') {
            resolvedClientName = payClientNameText || null;
            resolvedClientId = null;
        } else if (payClientName) {
            const matchedClient = clients.find((cl) => cl.id === payClientName);
            resolvedClientName = matchedClient?.full_name || null;
            resolvedClientId = payClientName;
        } else {
            resolvedClientName = fee.client_name || null;
            resolvedClientId = fee.client_id || null;
        }
        // 🔒 FIX (تقرير الموثوقية الشامل — H-2، المرحلة 4): كان ده 3
        // استعلامات منفصلة (insert → select → update) بلا transaction
        // حقيقية بينهم — فشل نت فى النص كان بيسيب دفعة متسجلة والإجمالي
        // مش متحدّث (partial save موثّق فى الكود القديم). دلوقتي التلاتة
        // بقوا جوه RPC واحدة (record_fee_payment) بتتنفذ فى transaction
        // حقيقية على مستوى القاعدة — إما تنجح كلها أو ترجع كلها.
        const { error: rpcError } = await db.rpc('record_fee_payment', {
            p_fee_id: fee.id,
            p_amount: amount,
            p_payment_date: payDate || null,
            p_notes: payNote || null,
            p_received_by: payReceiver || null,
            p_client_id: resolvedClientId,
            p_client_name: resolvedClientName,
        });
        if(rpcError){ toast('❌ فشل تسجيل الدفعة، يرجى المحاولة مرة أخرى', true); setPayingFeeId(null); return; }
        toast('✅ تم تسجيل الدفعة');
        logActivity(db, 'تسجيل دفعة', {
            entity_type: 'fee', entity_id: fee.id,
            details: `${formatArNumber(amount)} ${currency} — ${resolvedClientName || fee.client_name || ''}`,
            client_name: resolvedClientName || fee.client_name || null,
            case_name: cases.find((c) => c.id === fee.case_id)?.title || null,
            case_type: cases.find((c) => c.id === fee.case_id)?.type || null,
        });
        setPayingFeeId(null);
        setAddPaymentFor(null); setPayAmount(''); setPayDate(''); setPayNote(''); setPayReceiver(''); setPayClientName(''); setPayClientNameText('');
        fetchFees(0, feesFilter, feesSearch, false);
        fetchGrandSummary();
        fetchStatusCounts();
    };

    const handleDeletePayment = async (payId: string, fee: CaseFeeRow) => {
        // 🔒 قرار عمل (21 يوليو — المرحلة 6): حذف دفعة عملية خطوتين متعتمدتين
        // (حذف الدفعة → إعادة حساب paid_fees من مجموع الباقي → تحديث case_fees)
        // بنفس طبيعة تسجيل دفعة بالظبط — بتُمنع تمامًا أوفلاين لنفس السبب
        // (تجنّب partial-save لو الخطوة الأولى نجحت والتانية اتقيّدت في طابور
        // منفصل هيتنفذ فى وقت مختلف تمامًا وقت المزامنة).
        if (!navigator.onLine) {
            toast('⚠️ حذف الدفعة يتطلب اتصالاً بالإنترنت — أعد المحاولة عند توفر الاتصال', true);
            return;
        }
        const { error: deleteError } = await window.__dbWrite({ type: 'DELETE', table: 'fee_payments', id: payId });
        if(deleteError){ toast('❌ فشل حذف الدفعة، يرجى المحاولة مرة أخرى', true); return; }
        const {data:allPays} = await db.from('fee_payments').select('amount').eq('fee_id',fee.id);
        const realPaid = (allPays||[]).reduce((s: number, p: { amount: number | null }) => s+(p.amount||0), 0);
        const { error: updateError } = await window.__dbWrite({
            type: 'UPDATE', table: 'case_fees',
            data: {paid_fees: realPaid, status: computeFeeStatus(fee.total_fees || 0, realPaid)},
            id: fee.id,
        });
        if(updateError){ toast('⚠️ تم حذف الدفعة لكن فشل تحديث إجمالي المدفوع، يرجى تحديث الصفحة', true); fetchFees(0, feesFilter, feesSearch, false); fetchGrandSummary(); return; }
        toast('🗑 تم حذف الدفعة');
        logActivity(db, 'حذف دفعة', {
            entity_type: 'fee', entity_id: fee.id, details: fee.client_name || null,
            client_name: fee.client_name || null,
            case_name: cases.find((c) => c.id === fee.case_id)?.title || null,
            case_type: cases.find((c) => c.id === fee.case_id)?.type || null,
        });
        fetchFees(0, feesFilter, feesSearch, false);
        fetchGrandSummary();
        fetchStatusCounts();
    };

    // ─ حذف سجل أتعاب نهائيًا من قاعدة البيانات (مرحلة 2 — مكتمل، مفيش كود إضافي مطلوب) ─
    // ⚠️ القرار المحسوم فى الخطة (18 يوليو 2026): حذف أتعاب نهائيًا يحذف سجل
    // الأتعاب فقط، وميحذفش قضية ولا موكل. الـ FK الحقيقية بتغطي الباقي تلقائيًا:
    //   - fee_payments.fee_id → CASCADE (الدفعات جزء من سجل الأتعاب نفسه، منطقي تتحذف معاه)
    //   - invoices.fee_payment_id/case_id/client_id → SET NULL (الفواتير تفضل موجودة بسجلها كامل)
    // يعني الدالة دي مش محتاجة أي كاسكيد يدوي.
    const handlePermanentDeleteFee = async (id: string) => {
        const targetFee = fees.find((f) => f.id === id);
        const { error, offline, queued } = await window.__dbWrite({ type: 'DELETE', table: 'case_fees', id });
        if (offline && queued) { toast('📥 الحذف محفوظ محلياً — سيُزامن عند عودة الإنترنت'); return; }
        if (error) { toast('❌ فشل حذف الأتعاب نهائياً — تحقق من الاتصال وأعد المحاولة', true); return; }
        toast('🗑️ تم حذف الأتعاب نهائياً');
        logActivity(db, 'حذف أتعاب نهائياً', {
            entity_type: 'fee', entity_id: id,
            client_name: targetFee?.client_name || null,
            case_name: cases.find((c) => c.id === targetFee?.case_id)?.title || null,
            case_type: cases.find((c) => c.id === targetFee?.case_id)?.type || null,
        });
        fetchFees(0, feesFilter, feesSearch, false);
        fetchGrandSummary();
        fetchStatusCounts();
    };

    // ─ أرشفة سجل أتعاب (بدل حذف نهائي — البند 8 من قائمة الإجراءات) ─
    const handleDelete = async (id: string) => {
        const targetFee = fees.find((f) => f.id === id);
        const { error: feeError, offline, queued } = await window.__dbWrite({
            type: 'UPDATE', table: 'case_fees', data: { deleted_at: new Date().toISOString() }, id
        });
        if (offline && queued) { toast('📥 الأرشفة محفوظة محلياً — ستُزامن عند عودة الإنترنت'); return; }
        if(feeError){ toast('❌ فشل أرشفة الأتعاب — تحقق من الاتصال وأعد المحاولة', true); return; }
        toast('📦 تم نقل الأتعاب للأرشيف');
        logActivity(db, 'أرشفة أتعاب', {
            entity_type: 'fee', entity_id: id,
            client_name: targetFee?.client_name || null,
            case_name: cases.find((c) => c.id === targetFee?.case_id)?.title || null,
            case_type: cases.find((c) => c.id === targetFee?.case_id)?.type || null,
        });
        fetchFees(0, feesFilter, feesSearch, false);
        fetchGrandSummary();
        fetchStatusCounts();
    };

    // ─ استرجاع أتعاب من الأرشيف ─
    const handleRestoreFee = async (id: string) => {
        const { error, offline, queued } = await window.__dbWrite({ type: 'UPDATE', table: 'case_fees', data: { deleted_at: null }, id });
        if (offline && queued) { toast('📥 الاسترجاع محفوظ محلياً — سيُزامن عند عودة الإنترنت'); return; }
        if (error) { toast('❌ فشل استرجاع الأتعاب — تحقق من الاتصال وأعد المحاولة', true); return; }
        toast('✅ تم استرجاع الأتعاب');
        logActivity(db, 'استرجاع أتعاب من الأرشيف', { entity_type: 'fee', entity_id: id });
        fetchFees(0, feesFilter, feesSearch, false);
        fetchGrandSummary();
        fetchStatusCounts();
    };

    const fmt = (n: number | string | null | undefined) => n!=null ? formatArNumber(Number(n),{maximumFractionDigits:0}) : '0';
    const fmtDate = (d: string | null | undefined) => d ? formatArDate(d,{year:'numeric',month:'short',day:'numeric'}) : '';

    // getFeeCategory تفيد في عرض الكارد بس (مش للتصنيف في DB)
    const getFeeCategory = (fee: CaseFeeRow) => {
        const total = fee.total_fees || 0;
        const paid  = fee.paid_fees  || 0;
        if (total <= 0) return 'open';
        if (paid >= total) return 'collected';
        return 'deferred';
    };

    const feesSections = [
        {
            key: 'deferred' as const,
            label: 'مؤجلة',
            emoji: '⏳',
            desc: 'فلوس في الطريق',
            activeBg: 'bg-amber-500/20 border-amber-500/40',
            activeText: 'text-amber-300',
            countActiveBg: 'bg-amber-500/30 text-amber-200',
        },
        {
            key: 'open' as const,
            label: 'مفتوحة',
            emoji: '⚠️',
            desc: 'محتاجة تتحدد',
            activeBg: 'bg-rose-500/20 border-rose-500/40',
            activeText: 'text-rose-300',
            countActiveBg: 'bg-rose-500/30 text-rose-200',
        },
        {
            key: 'collected' as const,
            label: 'محصّلة',
            emoji: '✅',
            desc: 'أرباحك الفعلية',
            activeBg: 'bg-emerald-500/20 border-emerald-500/40',
            activeText: 'text-emerald-300',
            countActiveBg: 'bg-emerald-500/30 text-emerald-200',
        },
    ];

    const totalAll  = fees.reduce((s, f) => s+(f.total_fees||0), 0);
    const paidAll   = fees.reduce((s, f) => s+(f.paid_fees||0), 0);
    const remaining = totalAll - paidAll;

    const filteredFees = fees;
    const feesAfterCategoryFilter = fees;
    const feesByCategory: Record<string, CaseFeeRow[]> = { collected: [], deferred: [], open: [] }; // deprecated

    const grandTotal     = grandTotalAll;
    const grandPaid      = grandPaidAll;
    const grandRemaining = grandTotalAll - grandPaidAll;

  return {
    fees, setFees, payments, setPayments, expandedPayments, setExpandedPayments,
    loading, showForm, setShowForm, form, setForm, saving, editId, setEditId,
    addPaymentFor, setAddPaymentFor, payingFeeId, payAmount, setPayAmount, payDate, setPayDate,
    payNote, setPayNote, confirmDeletePay, setConfirmDeletePay,
    confirmDeleteFee, setConfirmDeleteFee, invoiceModal, setInvoiceModal,
    payReceiver, setPayReceiver, payClientName, setPayClientName,
    payClientNameText, setPayClientNameText, feesSearch, setFeesSearch,
    feesFilter, setFeesFilter,

    // pagination
    feesPage, feesTotal, feesMore,
    fetchFees, handleFilterChange, handleSearch,

    handleSave, handleAddPayment, handleDeletePayment, handleDelete, handlePermanentDeleteFee, handleRestoreFee,

    getFeeCategory,
    feesSections,
    feesByCategory,
    feesAfterCategoryFilter,
    filteredFees,

    totalAll, paidAll, remaining,
    grandTotal, grandPaid, grandRemaining, loadingSummary, fetchGrandSummary,
    statusCounts, fetchStatusCounts,
    fmt, fmtDate,
  };
}
