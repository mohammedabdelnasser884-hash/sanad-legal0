import React, { useState, useEffect } from 'react';
import { I } from '../../constants';
import { Inp } from '@/shared/ui/Inp';
import { Sel } from '@/shared/ui/Sel';
import { toast } from '../../shared/lib/notifications';
import DatePicker from '@/shared/ui/DatePicker';
import { db } from '../../supabaseClient';
import { usePartyFields } from '@/shared/parties/usePartyFields';
import { PartyFieldsGroup } from '@/shared/parties/PartyFieldsGroup';
import type { PartyFieldValue, PartySide } from '@/shared/parties/partyTypes';
import type { MappedCase } from '../../hooks/useAppData';
import type { CaseFormSubmitData } from './hooks/useCaseActions';
import type { ClientRow } from '../../types';

interface EditCaseModalProps {
    caseData: MappedCase;
    onClose: () => void;
    onSave: (form: CaseFormSubmitData) => void;
    countryCourts?: string[];
    countryCaseTypes?: string[];
    // 🔒 FIX (تقرير الموثوقية — نتيجة 1): المودال ده ما كانش فيه أي حماية
    // دبل كليك خالص (بعكس NewCaseModal). بنستقبل نفس savingCase state من
    // App.tsx عشان نقفل الزرار أثناء الحفظ.
    saving?: boolean;
    // ⚡ NEW (خطة توحيد مصدر بيانات الموكل، مرحلة 2): لما caseData.client_id
    // موجود، الصفحة الأب (CaseDetailView) بتمرر هنا الموكل الحقيقي (الصف
    // الحي من جدول clients، مش النسخة المحفوظة جوه القضية). لو موجود:
    // بنقفل اسم الموكل + الرقم القومي + بيانات التوكيل + العنوان ونعرضهم
    // من هنا مباشرة (مصدر الحقيقة الوحيد). لو client_id موجود لكن الموكل
    // اتمسح (soft-deleted) فـ linkedClient بتوصل null — الحقول تفضل حرة
    // زي قضية مش مربوطة (fallback الموكل المحذوف، مرحلة 7 من الخطة، أولوية
    // منخفضة دلوقتي لأنه صفر حالة فعلية حاليًا).
    linkedClient?: ClientRow | null;
    // زرار "✏️ عدّل من ملف الموكل" — بيفتح تفاصيل الموكل نفسه بدل تصميم جديد.
    onOpenClientProfile?: () => void;
}

interface EditCaseForm {
    title: string; caseNum: string; caseYear: string;
    court: string; court_floor: string; court_hall: string;
    type: string;
    court_level: string; court_level_other: string; circuit_number: string;
    status: string; date: string; session_time: string;
    session_hall: string; secretary_hall: string; secretary_name: string; secretary_mobile: string;
    // ⚡ ملحوظة (مرحلة 5.1 — خطة تعدد الأطراف، 22 يوليو 2026): بيانات
    // الموكل/الخصم (اللي كانت هنا كـ client_name/client_capacity/opponent/
    // opponent_capacity/plaintiff_national_id/plaintiff_power_of_attorney/
    // defendant_national_id/plaintiff_address) بقت كلها جوه usePartyFields()
    // تحت (array أطراف)، بنفس التغيير اللي حصل في NewCaseModal.tsx (مرحلة
    // 4.1) — راجع PartyFieldsGroup في الـ JSX تحت.
}

// ⚡ شكل صف case_parties كما بيرجع من الداتابيز — case_parties لسه مش
// موجودة في database.types.ts (اتضافت بـ SQL مباشر، قسم 3 من الخطة، ومفيش
// طريقة نولّد بيها الأنواع من هنا من غير نت) — نفس القيد اللي خلّى
// useCaseActions.ts يستخدم window.__dbWrite بدل db.from() مباشرة لنفس
// الجدول ده.
interface CasePartyRow {
    id: string;
    side: PartySide;
    is_client: boolean;
    name: string;
    capacity: string;
    national_id: string | null;
    address: string | null;
    power_of_attorney: string | null;
    client_id: string | null;
    sort_order: number;
}

// خيارات وقت الجلسة — كانت زرارين، دلوقتي select واحد عشان تقدر تقعد جنب
// حقل التاريخ في نفس السطر (طلب مباشر، 22 يوليو 2026).
const SESSION_TIME_OPTIONS = [
    { value: 'صباحي', label: '🌅 صباحي' },
    { value: 'مسائي', label: '🌆 مسائي' },
];

// ══════════════════════════════════════════════════════════════
//  EditCaseModal (outer shell) — مرحلة 5.1 من خطة تعدد الأطراف: قبل ما
//  الفورم الحقيقي (EditCaseModalForm تحت) يتبني، لازم نجيب أطراف القضية
//  الموجودة فعلاً من case_parties (لو القضية دخلت عليها بيانات من قبل عن
//  طريق الفورم الجديد أو الـ backfill)، عشان usePartyFields() يتهيّأ بالقيم
//  الصح من أول رندر (initialPlaintiffs/initialDefendants بتتقرا مرة واحدة
//  بس وقت الـ mount). القضايا اللي معهاش أي صف في case_parties (الأغلبية
//  حاليًا — قسم 11، نتيجة مرحلة 2) بترجع array فاضية، والفورم الداخلي
//  بيعمل fallback لبيانات الأعمدة القديمة (plaintiff/defendant) زي ما كان
//  يحصل بالظبط قبل التعديل ده.
// ══════════════════════════════════════════════════════════════
function EditCaseModal(props: EditCaseModalProps) {
    const { caseData } = props;
    const [partiesState, setPartiesState] = useState<{ loaded: boolean; rows: CasePartyRow[] }>({ loaded: false, rows: [] });

    useEffect(() => {
        let cancelled = false;
        setPartiesState({ loaded: false, rows: [] });
        (async () => {
            // الكاست لـ 'cases' هنا نفس نمط dbFrom() الموجود فعلاً في
            // offlineQueue.ts — بيأثر بس على شكل الـ query builder وقت
            // الـ type-check، مش على اسم الجدول الفعلي وقت التشغيل.
            const { data, error } = await db.from('case_parties' as 'cases')
                .select('*')
                .eq('case_id', caseData.id)
                .order('sort_order', { ascending: true });
            if (cancelled) return;
            // لو الاستعلام فشل (مثلاً مشكلة اتصال): نرجع لسلوك fallback
            // (طرف واحد من الأعمدة القديمة) بدل ما نمنع فتح فورم التعديل
            // بالكامل — تحسين مستقبلي ممكن يعرض تنبيه، مش جزء من نطاق 5.1.
            setPartiesState({ loaded: true, rows: error ? [] : ((data as unknown as CasePartyRow[]) || []) });
        })();
        return () => { cancelled = true; };
    }, [caseData.id]);

    if (!partiesState.loaded) {
        return React.createElement('div', {className: "bg-premium-card w-full max-w-lg rounded-t-3xl border-t border-white/10 p-10 shadow-2xl slide-up flex items-center justify-center"},
            React.createElement(I.Spin)
        );
    }

    return React.createElement(EditCaseModalForm, { ...props, existingPartyRows: partiesState.rows });
}

interface EditCaseModalFormProps extends EditCaseModalProps {
    existingPartyRows: CasePartyRow[];
}

function EditCaseModalForm({caseData, onClose, onSave, countryCourts, countryCaseTypes, saving = false, linkedClient = null, onOpenClientProfile, existingPartyRows}: EditCaseModalFormProps){
    // ⚡ NEW: القضية مربوطة فعليًا بموكل حي لو client_id موجود واتلقّى
    // فعلاً صف الموكل من الأب (مش soft-deleted ولا orphaned).
    const isLinked = !!linkedClient;
    // ⚡ NEW (خطة توحيد مصدر بيانات الموكل، مرحلة 7 — fallback الموكل
    // المحذوف): القضية عندها client_id فعلي، لكن الأب مش لاقي صف الموكل
    // (اتمسح/soft-deleted). الحقول بترجع حرة تلقائيًا (isLinked=false)
    // من غير أي تغيير هنا — الإضافة الوحيدة هي تنبيه واضح للمستخدم بدل
    // ما يفتكر إن القضية دي مكانتش مربوطة بحد أصلاً.
    const isOrphaned = !!caseData.client_id && !isLinked;
    const splitNum = (num: string) => {
        if(!num||num==='—') return {n:'',y:''};
        const parts = num.split('/');
        return parts.length===2 ? {n:parts[0],y:parts[1]} : {n:num,y:''};
    };
    const split = splitNum(caseData.number);

    // ⚡ توحيد منطق مكان الجلسة: كان فيه حقلين منفصلين (court_floor +
    // court_hall) بالإضافة لحقل session_hall في "بيانات إضافية" —
    // نفس المعنى مكرر في 3 حقول. من دلوقتي session_hall هو المصدر
    // الوحيد. لو القضية قديمة ومعندهاش session_hall لكن عندها
    // court_floor/court_hall، بندمجهم هنا مرة واحدة عشان البيانات
    // القديمة متضيعش (بدون ما نلمس الأعمدة القديمة في الداتابيز).
    const mergedSessionHall = caseData.session_hall || [
        caseData.court_floor ? `الدور ${caseData.court_floor}` : '',
        caseData.court_hall ? `قاعة ${caseData.court_hall}` : '',
    ].filter(Boolean).join(' - ');

    // ⚡ FIX: الموكل والصفة كانوا بيتقروا بـ regex من نص plaintiff نفسه
    // (نمط "الاسم (الصفة)") — ده كان بيتعارض مع عمود plaintiff_role/
    // defendant_role الموجود فعليًا في جدول cases (ومُستخدم بالفعل في
    // الجلسات المستقلة). دلوقتي بنقرا الصفة من عمودها المخصص مباشرة.
    // الـ fallback على الـ regex اتسيب بس لأي صف قديم لسه معندوش
    // plaintiff_role متعبي (قبل تشغيل migration الـ backfill)، عشان
    // مايضيعش بيانات صفة قديمة كانت متخزنة جوه النص.
    //
    // ⚠️ FIX تاني: الموكل ممكن يكون شركة، وأسماء الشركات المصرية غالبًا
    // بتنتهي بـ"(ش.م.م)" أو "(ذ.م.م)" — ده جزء من اسم الشركة مش صفة
    // قانونية. عشان كده الـ fallback بيقسم بس لو اللي جوه القوسين فعلاً
    // كلمة صفة معروفة (مدعي/مدعى عليه/مستأنف/طاعن...)، وإلا بيسيب النص
    // كله زي ما هو كاسم (من غير ما يقطع جزء من اسم الشركة).
    const knownCapacityPattern = /مدعي|مدعى عليه|مستأنف|طاعن|مطعون ضده|متهم|مجني عليه|محكوم عليه|خصم|مدين|دائن|موكل|وكيل|طالب|مطلوب ضده|منفذ ضده/;
    const splitParty = (val: string | null) => {
        if(!val) return {name:'',capacity:''};
        const m = val.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
        if(m && knownCapacityPattern.test(m[2])) return {name:m[1].trim(), capacity:m[2].trim()};
        return {name:val, capacity:''};
    };
    const clientParts = caseData.plaintiff_role
        ? {name: caseData.plaintiff || '', capacity: caseData.plaintiff_role}
        : splitParty(caseData.plaintiff);
    const opponentParts = caseData.defendant_role
        ? {name: caseData.defendant || '', capacity: caseData.defendant_role}
        : splitParty(caseData.defendant);

    // تحديد لو درجة التقاضي هي أخرى
    const knownLevels = ['ابتدائي','استئناف','نقض'];
    const existingLevel = caseData.court_level || '';
    const isOther = existingLevel && !knownLevels.includes(existingLevel);

    // ⚡ FIX (طلب مباشر من جيمي، 22 يوليو 2026): المحكمة وتصنيف الدعوى بقوا
    // مربع نص حر دايمًا (شوف تعليق الرندر تحت) — مفيش داعي بعد كده لتفرقة
    // "أخرى" عن قيمة من القايمة، فبنقرا القيمتين مباشرة زي ما هما.
    const existingCourt = caseData.court==='—' ? '' : (caseData.court || '');
    const existingType = caseData.type==='عام' ? '' : (caseData.type || '');

    const [form, setForm] = useState<EditCaseForm>({
        title: caseData.title || '',
        caseNum: split.n,
        caseYear: split.y,
        court: existingCourt,
        court_floor: caseData.court_floor || '',
        court_hall: caseData.court_hall || '',
        type: existingType,
        court_level: isOther ? 'أخرى' : existingLevel,
        court_level_other: isOther ? existingLevel : '',
        circuit_number: caseData.circuit_number || '',
        status: caseData.status || 'نشطة',
        date: caseData.date==='—'?'':caseData.date || '',
        session_time: caseData.session_time || 'صباحي',
        session_hall: mergedSessionHall,
        secretary_hall: caseData.secretary_hall || '',
        secretary_name: caseData.secretary_name || '',
        secretary_mobile: caseData.secretary_mobile || '',
    });
    const s = <K extends keyof EditCaseForm>(k: K,v: EditCaseForm[K]) => setForm((p) =>({...p,[k]:v}));

    // ⚡ NEW (مرحلة 5.1 — خطة تعدد الأطراف): array أطراف الدعوى (مدعين
    // ومدعى عليهم، بلا حدود) بدل حقلي "الموكل"/"الخصم" المفردين القدامى —
    // نفس منطق NewCaseModal.tsx (مرحلة 4.1)، بس هنا القيم الابتدائية بتيجي
    // من case_parties لو القضية دي دخل عليها بيانات فعلاً من الفورم الجديد،
    // وإلا fallback لنفس منطق clientParts/opponentParts القديم (الأعمدة
    // القديمة plaintiff/defendant) — حساب لمرة واحدة بس وقت الـ mount
    // (useState lazy initializer)، مش بيتغيّر لو caseData اتغيّرت لاحقًا.
    const [initialParties] = useState<{ plaintiffs: PartyFieldValue[]; defendants: PartyFieldValue[] }>(() => {
        if (existingPartyRows.length > 0) {
            const toField = (row: CasePartyRow): PartyFieldValue => ({
                id: row.id,
                side: row.side,
                is_client: row.is_client,
                name: row.name || '',
                capacity: row.capacity || '',
                national_id: row.national_id || '',
                address: row.address || '',
                power_of_attorney: row.power_of_attorney || '',
                client_id: row.client_id || null,
            });
            return {
                plaintiffs: existingPartyRows.filter((r) => r.side === 'plaintiff').map(toField),
                defendants: existingPartyRows.filter((r) => r.side === 'defendant').map(toField),
            };
        }
        // fallback لقضية قديمة معهاش أي صف في case_parties لسه — طرف واحد
        // في كل جهة، بنفس القيم اللي كانت بتتعرض في الحقول المفردة القديمة
        // (بما فيها قفل بيانات الموكل المربوط لو isLinked).
        // ⚠️ الـ id هنا نص ثابت ('legacy-plaintiff'/'legacy-defendant') مش
        // UUID حقيقي من case_parties — علامة واضحة إن الصف ده لسه ملوش نظير
        // في الداتابيز، هيلزم وقت ربط الكتابة الفعلية (مرحلة 5.2) لتحديد
        // INSERT جديد بدل UPDATE.
        return {
            plaintiffs: [{
                id: 'legacy-plaintiff',
                side: 'plaintiff' as PartySide,
                is_client: true,
                name: isLinked ? (linkedClient!.full_name || '') : clientParts.name,
                capacity: clientParts.capacity,
                national_id: isLinked ? (linkedClient!.national_id || '') : (caseData.plaintiff_national_id || ''),
                address: isLinked ? (linkedClient!.address || '') : (caseData.plaintiff_address || ''),
                power_of_attorney: isLinked ? (linkedClient!.cr_number || '') : (caseData.plaintiff_power_of_attorney || ''),
                client_id: caseData.client_id || null,
            }],
            defendants: [{
                id: 'legacy-defendant',
                side: 'defendant' as PartySide,
                is_client: false,
                name: opponentParts.name,
                capacity: opponentParts.capacity,
                national_id: caseData.defendant_national_id || '',
                address: '',
                power_of_attorney: '',
                client_id: null,
            }],
        };
    });
    const partyFields = usePartyFields({ initialPlaintiffs: initialParties.plaintiffs, initialDefendants: initialParties.defendants });

    // الطرف اللي لازم يتقفل (readOnly) — الطرف المربوط فعليًا بموكل حي من
    // clients (نفس فكرة قفل حقول "الموكل" القديمة). بيتحدد بمطابقة client_id
    // (بيتحسب مرة واحدة وقت الـ mount زي initialParties فوق، ومش بيتغيّر لو
    // المستخدم بدّل ⭐ طرف تاني لاحقًا — نفس سلوك الحقول المقفولة القديمة
    // اللي كانت بتتحدد وقت فتح الفورم بس).
    const [linkedPartyId] = useState<string | null>(() => {
        if (!isLinked) return null;
        const all = [...initialParties.plaintiffs, ...initialParties.defendants];
        return all.find((p) => p.client_id === caseData.client_id)?.id ?? null;
    });
    const renderPartyReadOnly = (party: PartyFieldValue) => party.id === linkedPartyId;

    const inputCls = "w-full p-3 text-xs rounded-xl border border-white/10 bg-premium-bg text-white placeholder-slate-600 transition-colors";
    const inpStyle = {fontFamily:'Cairo,sans-serif'};

    return React.createElement('div', {className: "bg-premium-card w-full max-w-lg rounded-t-3xl border-t border-white/10 p-6 pb-10 shadow-2xl slide-up max-h-[90vh] overflow-y-auto no-scrollbar"},
        React.createElement('div', {className: "w-10 h-1 bg-white/20 rounded-full mx-auto mb-5"}),
        React.createElement('div', {className: "flex items-center justify-between mb-5"},
            React.createElement('h3', {className: "text-sm font-black text-white flex items-center gap-2"},
                React.createElement('span', {className: "w-1 h-4 bg-premium-gold rounded-full"}),
                "تعديل بيانات القضية"
            ),
            React.createElement('button', {onClick: onClose, className: "w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-slate-400"}, "✕")
        ),
        React.createElement('div', {className: "space-y-4"},

            // ══════════════ بيانات القيد الرسمي ══════════════
            React.createElement('div', {className:"pt-1"},
                React.createElement('p', {className:"text-[10px] font-black text-slate-500 mb-3"}, "— بيانات القيد الرسمي —")
            ),

            // ١. موضوع الدعوى
            React.createElement(Inp, {label:"موضوع الدعوى", value:form.title, onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('title',e.target.value), placeholder:"عنوان القضية", required:true}),

            // ٢. المحكمة المختصة
            // ⚡ FIX (طلب مباشر من جيمي، 22 يوليو 2026): كان مربع اختيار
            // (Sel) بيجبر اختيار "أخرى" الأول قبل ما تقدر تكتب اسم محكمة
            // مش موجود في قايمة الدولة — تجربة مزعجة خصوصًا في التعديل.
            // دلوقتي مربع نص حر دايمًا، مع datalist للاقتراح بس (مش إجبار)
            // من قايمة محاكم الدولة لو موجودة.
            React.createElement('div', null,
                React.createElement('label', {className:"block text-[10px] font-bold text-slate-400 mb-1.5"}, "المحكمة المختصة"),
                React.createElement('input', {
                    value:form.court,
                    onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('court',e.target.value),
                    placeholder:"اكتب اسم المحكمة",
                    className:inputCls, style:inpStyle,
                    list: (countryCourts && countryCourts.length>0) ? 'edit-case-courts-list' : undefined,
                }),
                countryCourts && countryCourts.length>0 && React.createElement('datalist',{id:'edit-case-courts-list'},
                    countryCourts.map((c: string) => React.createElement('option',{key:c,value:c}))
                )
            ),

            // ٣. رقم الدعوى الرسمي + السنة
            React.createElement('div', null,
                React.createElement('label', {className:"block text-[10px] font-bold text-slate-400 mb-1.5"}, "رقم الدعوى الرسمي"),
                React.createElement('div', {className:"flex gap-2 items-center"},
                    React.createElement('input', {value:form.caseNum, onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('caseNum',e.target.value), placeholder:"رقم الدعوى", className:"flex-1 p-3 text-xs rounded-xl border border-white/10 bg-premium-bg text-white placeholder-slate-600 text-center", style:inpStyle}),
                    React.createElement('span', {className:"text-slate-500 font-black text-sm shrink-0"}, "/"),
                    React.createElement('input', {value:form.caseYear, onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('caseYear',e.target.value), placeholder:"السنة", maxLength:4, className:"w-24 p-3 text-xs rounded-xl border border-white/10 bg-premium-bg text-white placeholder-slate-600 text-center", style:inpStyle})
                )
            ),

            // ٤. تصنيف الدعوى + رقم الدائرة (نفس السطر)
            // ⚡ FIX (طلب مباشر من جيمي، 22 يوليو 2026): نفس فيكس "المحكمة
            // المختصة" فوق بالظبط — نص حر دايمًا، مع datalist للاقتراح بس.
            React.createElement('div', {className:"grid grid-cols-2 gap-2"},
                React.createElement('div', null,
                    React.createElement('label', {className:"block text-[10px] font-bold text-slate-400 mb-1.5"}, "تصنيف الدعوى"),
                    React.createElement('input', {
                        value:form.type,
                        onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('type',e.target.value),
                        placeholder:"مدني / تجاري...",
                        className:inputCls, style:inpStyle,
                        list: (countryCaseTypes && countryCaseTypes.length>0) ? 'edit-case-types-list' : undefined,
                    }),
                    countryCaseTypes && countryCaseTypes.length>0 && React.createElement('datalist',{id:'edit-case-types-list'},
                        countryCaseTypes.map((t: string) => React.createElement('option',{key:t,value:t}))
                    )
                ),
                React.createElement('div', null,
                    React.createElement('label', {className:"block text-[10px] font-bold text-slate-400 mb-1.5"}, "رقم الدائرة"),
                    React.createElement('input', {value:form.circuit_number, onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('circuit_number',e.target.value), placeholder:"مثال: 12 تجاري", className:inputCls, style:inpStyle})
                )
            ),

            // ٥. تاريخ الجلسة القادمة + وقت الجلسة (نفس السطر، وقت الجلسة
            // بيظهر بس بعد ما التاريخ يتحدد — قبل كده بياخد العرض كله لوحده).
            form.date
                ? React.createElement('div',{className:"grid grid-cols-2 gap-2 items-start"},
                    React.createElement(DatePicker, {label:"تاريخ الجلسة القادمة", value:form.date, onChange:(v: string) =>s("date",v)}),
                    React.createElement(Sel,{
                        label:"وقت الجلسة",
                        value:form.session_time,
                        onChange:(e: React.ChangeEvent<HTMLSelectElement>) =>s('session_time',e.target.value),
                        options:SESSION_TIME_OPTIONS,
                    })
                )
                : React.createElement(DatePicker, {label:"تاريخ الجلسة القادمة", value:form.date, onChange:(v: string) =>s("date",v)}),

            // ٦. درجة التقاضي
            React.createElement('div', null,
                React.createElement('label', {className:"block text-[10px] font-bold text-slate-400 mb-1.5"}, "درجة التقاضي"),
                React.createElement('div', {className:"flex gap-2"},
                    ['ابتدائي','استئناف','نقض','أخرى'].map((lvl: string) =>React.createElement('button',{
                        key:lvl, type:"button",
                        onClick:()=>s('court_level',lvl),
                        className:`flex-1 py-2.5 rounded-xl text-[10px] font-black transition-all active:scale-95 ${form.court_level===lvl?'bg-premium-gold text-premium-bg':'bg-white/5 border border-white/10 text-slate-400'}`
                    },lvl))
                ),
                form.court_level==='أخرى'&&React.createElement('input',{
                    value:form.court_level_other, onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('court_level_other',e.target.value),
                    placeholder:"اكتب درجة التقاضي",
                    className:"w-full mt-2 p-3 text-xs rounded-xl border border-white/10 bg-premium-bg text-white placeholder-slate-600",
                    style:inpStyle
                })
            ),

            // ٧. حالة القضية [فورم التعديل بس — القضية الجديدة بتبدأ "نشطة"
            // افتراضيًا وملهاش داعي تُسأل عنها وقت التقييد]
            React.createElement('div', null,
                React.createElement('label', {className:"block text-[10px] font-bold text-slate-400 mb-1.5"}, "حالة القضية"),
                React.createElement('div', {className:"grid grid-cols-3 gap-2"},
                    [
                        {val:'نشطة',   emoji:'🟢', color:'emerald'},
                        {val:'مؤجلة',  emoji:'🟡', color:'amber'},
                        {val:'منتهية', emoji:'✅', color:'emerald'},
                    ].map(({val,emoji,color})=>
                        React.createElement('button',{
                            key:val, type:"button",
                            onClick:()=>s('status',val),
                            className:`py-2.5 rounded-xl text-[10px] font-black transition-all active:scale-95 border ${
                                form.status===val
                                    ? color==='emerald' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                                    : color==='amber'   ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                                    :                     'bg-slate-500/20 border-slate-500/50 text-slate-300'
                                    : 'bg-white/5 border-white/10 text-slate-500'
                            }`
                        }, emoji+' '+val)
                    )
                )
            ),

            // ══════════════ أطراف الدعوى ══════════════
            // ⚡ CHANGED (مرحلة 5.1 — خطة تعدد الأطراف، 22 يوليو 2026): بدل
            // حقلي "الموكل"/"الخصم" المفردين، PartyFieldsGroup بيدعم عدد بلا
            // حدود من المدعين والمدعى عليهم — نفس التغيير اللي حصل في
            // NewCaseModal.tsx (مرحلة 4.1). الطرف المربوط فعليًا بموكل حي
            // (linkedPartyId فوق) بيتقفل (readOnly) بنفس منطق القفل القديم.
            // مفيش "ربط بموكل من النظام" هنا (بعكس NewCaseModal) — ربط/فك
            // ربط القضية بموكل لسه بيتم من تاب بيانات القضية، مش من هنا
            // (نفس القرار الموثّق في الفورم القديم).
            React.createElement('div', {className:"border-t border-white/5 pt-4 mt-2"}),
            isLinked && React.createElement('div', {className:"flex items-center justify-between"},
                React.createElement('p', {className:"text-[9px] text-slate-500"}, "🔗 مربوط بموكل من النظام — بيانات الطرف ده بتتقرا من ملف الموكل"),
                React.createElement('div', {className:"flex items-center gap-3 shrink-0"},
                    onOpenClientProfile && React.createElement('button', {
                        type:"button", onClick:onOpenClientProfile,
                        className:"text-[9px] font-black text-premium-gold",
                        'data-testid':'edit-case-open-client-profile'
                    }, "✏️ عدّل من ملف الموكل")
                )
            ),
            // ⚡ NEW (مرحلة 7 — fallback الموكل المحذوف): القضية كانت
            // مربوطة بموكل اتحذف بعد كده. الحقول تحت رجعت حرة (نفس شكل
            // قضية مش مربوطة أصلاً) لكن بقيمها الأخيرة المحفوظة في عمود
            // القضية نفسه (مش فاضية ومفيش كراش). التنبيه ده بيوضح للمستخدم
            // إن القضية دي *كانت* مربوطة، عشان مايتفاجئش.
            isOrphaned && React.createElement('div', {className:"bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2", 'data-testid':'edit-case-orphaned-client-warning'},
                React.createElement('p', {className:"text-[9px] text-amber-400 font-bold leading-relaxed"},
                    "⚠️ الموكل محذوف — البيانات دي آخر ما هو معروف عن الموكل، وبقت قابلة للتعديل الحر. تقدر تربط القضية بموكل تاني من تاب البيانات."
                )
            ),
            React.createElement(PartyFieldsGroup, {controller:partyFields, testIdPrefix:'edit-case', renderPartyReadOnly}),

            // ══════════════ بيانات إضافية ══════════════
            React.createElement('div', {className:"border-t border-white/10 pt-4 mt-2"},
                React.createElement('p', {className:"text-[10px] font-black text-slate-500 mb-3"}, "— بيانات إضافية (غير ضرورية) —")
            ),

            React.createElement('div', null,
                React.createElement('label', {className:"block text-[10px] font-bold text-slate-400 mb-1.5"}, "الطابق وقاعة الجلسة"),
                React.createElement('input', {value:form.session_hall, onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('session_hall',e.target.value), placeholder:"مثال: الدور الأول - قاعة 5", className:inputCls, style:inpStyle})
            ),
            React.createElement('div', null,
                React.createElement('label', {className:"block text-[10px] font-bold text-slate-400 mb-1.5"}, "قاعة سكرتير الجلسة"),
                React.createElement('input', {value:form.secretary_hall, onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('secretary_hall',e.target.value), placeholder:"رقم أو اسم قاعة السكرتير", className:inputCls, style:inpStyle})
            ),
            React.createElement('div', {className:"grid grid-cols-2 gap-2"},
                React.createElement('div', null,
                    React.createElement('label', {className:"block text-[10px] font-bold text-slate-400 mb-1.5"}, "اسم سكرتير الجلسة"),
                    React.createElement('input', {value:form.secretary_name, onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('secretary_name',e.target.value), placeholder:"اسم السكرتير", className:inputCls, style:inpStyle})
                ),
                React.createElement('div', null,
                    React.createElement('label', {className:"block text-[10px] font-bold text-slate-400 mb-1.5"}, "موبايل سكرتير الجلسة"),
                    React.createElement('input', {value:form.secretary_mobile, onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('secretary_mobile',e.target.value.replace(/\D/g,'').slice(0,11)), placeholder:"رقم الموبايل", inputMode:"numeric", maxLength:11, className:inputCls, style:inpStyle})
                )
            ),

            // زر الحفظ
            React.createElement('button', {
                disabled: saving,
                onClick: () => {
                    if(saving) return;
                    if(!form.title.trim()){ toast('يرجى إدخال موضوع ومسمى الدعوى', true); return; }
                    // ⚡ CHANGED (مرحلة 5.1 — خطة تعدد الأطراف): فاليديشن
                    // أطراف الدعوى كلها بقت من casePartiesValidation.ts (نفس
                    // قواعد NewCaseModal.tsx مرحلة 4.1) بدل الفحوصات المفردة
                    // القديمة (اسم/صفة الموكل والخصم، الاسم الثلاثي، طول
                    // الرقم القومي).
                    if(!partyFields.validation.valid){ toast(partyFields.validation.message || 'يرجى مراجعة بيانات أطراف الدعوى', true); return; }
                    const number = form.caseNum&&form.caseYear ? form.caseNum+'/'+form.caseYear : form.caseNum||form.caseYear||'';
                    const finalCourtLevel = form.court_level==='أخرى' ? form.court_level_other : form.court_level;
                    const finalCourt = form.court.trim() || '—';
                    const finalType  = form.type.trim() || 'عام';
                    // ⚡ NEW (مرحلة 5.1): نفس منطق NewCaseModal.tsx — الأعمدة
                    // القديمة (plaintiff/defendant/...) بتاخد نسخة من "الطرف
                    // الأساسي" في كل جهة (أولوية لمن عليه ⭐، وإلا أول طرف).
                    // الكتابة الفعلية لكل الأطراف في case_parties (upsert
                    // بالـ id الحقيقي لو موجود، insert لو جديد، delete لو
                    // اتشال) هتتضاف في مرحلة 5.2 التالية — form.parties
                    // بيتبعت من دلوقتي بس useCaseActions.ts (handleUpdateCase)
                    // لسه مش بيستخدمه.
                    const primaryPlaintiff = partyFields.plaintiffs.find((p) =>p.is_client) || partyFields.plaintiffs[0];
                    const primaryDefendant = partyFields.defendants.find((p) =>p.is_client) || partyFields.defendants[0];
                    const saveData: CaseFormSubmitData = {
                        ...form,
                        number,
                        court: finalCourt,
                        type: finalType,
                        court_level: finalCourtLevel,
                        plaintiff: primaryPlaintiff?.name || undefined,
                        plaintiff_role: primaryPlaintiff?.capacity || undefined,
                        plaintiff_national_id: primaryPlaintiff?.national_id || undefined,
                        plaintiff_power_of_attorney: primaryPlaintiff?.power_of_attorney || undefined,
                        plaintiff_address: primaryPlaintiff?.address || undefined,
                        defendant: primaryDefendant?.name || undefined,
                        defendant_role: primaryDefendant?.capacity || undefined,
                        defendant_national_id: primaryDefendant?.national_id || undefined,
                        parties: partyFields.parties,
                        // ⚡ NEW (مرحلة 5.2): ids صفوف case_parties الحقيقية
                        // اللي كانت موجودة وقت فتح الفورم (existingPartyRows
                        // في EditCaseModal الخارجي) — useCaseActions.ts
                        // (handleUpdateCase) بيستخدمها عشان يفرّق تعديل عن
                        // إضافة جديدة، وعشان يحدد أي صف اتشال فيحذفه.
                        existingPartyIds: existingPartyRows.map((r) => r.id),
                    };
                    onSave(saveData);
                },
                className: "w-full py-3.5 bg-gradient-to-tr from-premium-gold to-amber-200 text-premium-bg rounded-xl font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform mt-2 disabled:opacity-60"
            }, React.createElement(I.Check), saving ? "⏳ جاري الحفظ..." : "حفظ التعديلات")
        )
    );
}

export default EditCaseModal;
