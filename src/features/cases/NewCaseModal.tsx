import React, { useState } from 'react';
import { toast } from '../../shared/lib/notifications';
import { I } from '../../constants';
import { Inp } from '@/shared/ui/Inp';
import { Sel } from '@/shared/ui/Sel';
import DatePicker from '@/shared/ui/DatePicker';
import { usePartyFields } from '@/shared/parties/usePartyFields';
import { PartyFieldsGroup } from '@/shared/parties/PartyFieldsGroup';
import type { PartyFieldValue } from '@/shared/parties/partyTypes';
import type { ClientRow, ProfileRow } from '../../types';
import type { CaseFormSubmitData } from './hooks/useCaseActions';
import type { ClientModalContext } from '../clients/hooks/useClientActions';

interface NewCaseModalProps {
    onClose: () => void;
    onSave: (form: CaseFormSubmitData) => void;
    loading?: boolean;
    lawyers: ProfileRow[];
    isAdmin: boolean;
    clients: ClientRow[];
    countryCourts?: string[];
    countryCaseTypes?: string[];
    // ⚡ NEW (خطة تطوير أطراف الدعوى — مرحلة 4 خطوة 2، 23 يوليو 2026): فتح
    // موديل "إنشاء موكل جديد" الموحّد (نفس اللي بيستخدمه CaseDetailView)
    // من جوه كارت أي طرف — راجع App.tsx (openNewClientModal) وAppModals.tsx.
    openNewClientModal?: (ctx: ClientModalContext) => void;
}

interface NewCaseForm {
    title: string; court: string; court_floor: string; court_hall: string;
    type: string; caseNum: string; caseYear: string;
    court_level: string; court_level_other: string; circuit_number: string; date: string; session_time: string;
    session_hall: string; secretary_hall: string; secretary_name: string; secretary_mobile: string;
    // ⚡ ملحوظة (مرحلة 4 — خطة تعدد الأطراف، 22 يوليو 2026): بيانات
    // الموكل/الخصم (الاسم/الصفة/الرقم القومي/العنوان/التوكيل/الربط
    // بموكل من النظام) بقت كلها جوه usePartyFields() تحت (array أطراف)
    // بدل حقول مفردة هنا — راجع PartyFieldsGroup في الـ JSX تحت.
}

// خيارات وقت الجلسة — كانت زرارين، دلوقتي select واحد عشان تقدر تقعد جنب
// حقل التاريخ في نفس السطر (طلب مباشر، 22 يوليو 2026).
const SESSION_TIME_OPTIONS = [
    { value: 'صباحي', label: '🌅 صباحي' },
    { value: 'مسائي', label: '🌆 مسائي' },
];

function NewCaseModal({onClose,onSave,loading,lawyers,isAdmin,clients,countryCourts,countryCaseTypes,openNewClientModal}: NewCaseModalProps){
    const [form,setForm]=useState<NewCaseForm>({
        title:'',court:'',court_floor:'',court_hall:'',type:'',caseNum:'',caseYear:'',
        court_level:'',court_level_other:'',circuit_number:'',date:'',session_time:'صباحي',
        session_hall:'',secretary_hall:'',secretary_name:'',secretary_mobile:'',
    });
    const s=<K extends keyof NewCaseForm>(k: K,v: NewCaseForm[K])=>setForm((p) =>({...p,[k]:v}));

    // ⚡ NEW (مرحلة 4 — خطة تعدد الأطراف): array أطراف الدعوى (مدعين
    // ومدعى عليهم، بلا حدود) بدل حقلي "الموكل"/"الخصم" المفردين القدامى.
    const partyFields = usePartyFields();

    // ربط طرف بعينه بموكل موجود من النظام — بيملى الاسم/الرقم القومي/
    // التوكيل/العنوان دفعة واحدة من بيانات الموكل الحقيقية (نفس سلوك
    // الربط القديم، بس دلوقتي لأي طرف عليه ⭐ مش للموكل الوحيد بس).
    const linkClientToParty = (partyId: string, clientId: string) => {
        if(!clientId){ partyFields.updateParty(partyId,'client_id',null); return; }
        const picked = clients.find((c: ClientRow) =>c.id===clientId);
        if(!picked) return;
        partyFields.updateParty(partyId,'client_id',clientId);
        partyFields.updateParty(partyId,'name',picked.full_name || '');
        partyFields.updateParty(partyId,'national_id',picked.national_id || '');
        partyFields.updateParty(partyId,'power_of_attorney',picked.cr_number || '');
        partyFields.updateParty(partyId,'address',picked.address || '');
    };

    // ⚡ NEW (خطة تطوير أطراف الدعوى — مرحلة 4 خطوة 2): بعد ما موديل
    // "إنشاء موكل جديد" الموحّد يحفظ الموكل فعليًا (هدف ربط 'localParty' —
    // مفيش case حقيقي لسه)، بنطبّق بياناته على الطرف محليًا فورًا (بدل ما
    // نستنى تحديث قائمة clients اللي بتتحدث async وغير مضمون توقيتها).
    const applyCreatedClientToParty = (partyId: string, clientId: string, form?: {full_name:string; national_id:string; cr_number:string; address:string}) => {
        partyFields.updateParty(partyId,'client_id',clientId);
        if(form){
            partyFields.updateParty(partyId,'name',form.full_name || '');
            partyFields.updateParty(partyId,'national_id',form.national_id || '');
            partyFields.updateParty(partyId,'power_of_attorney',form.cr_number || '');
            partyFields.updateParty(partyId,'address',form.address || '');
        }
    };

    // سلوت "ربط بموكل من النظام" + "إنشاء موكل جديد" — بيتعرض بس فوق اسم
    // أي طرف عليه ⭐ (قسم 4 من الخطة: "تفعيلها يبين حقل ربط بموكل من
    // النظام فوق اسم الطرف ده تحديدًا"). الوظيفتان معًا (الأولى والثانية من
    // الثلاث المذكورة في قسم 6-د) — قفل readOnly (الثالثة) بيتم من الفورم
    // الأب في المراحل اللي هتتحدد لاحقًا.
    const renderPartyExtra = (party: PartyFieldValue) => {
        if(!party.is_client) return null;
        return React.createElement('div',{className:'space-y-2'},
            clients.length>0 && React.createElement(Sel,{
                label:"ربط بموكل من النظام (اختياري)",
                value:party.client_id || '',
                onChange:(e: React.ChangeEvent<HTMLSelectElement>) =>linkClientToParty(party.id,e.target.value),
                options:[{value:'',label:'— بدون ربط (بيانات يدوية) —'},...clients.map((c: ClientRow) =>({value:c.id,label:c.full_name}))]
            }),
            !party.client_id && openNewClientModal && React.createElement('button',{
                type:'button',
                onClick:()=>openNewClientModal({
                    initialData:{full_name:party.name || '', national_id:party.national_id || '', cr_number:party.power_of_attorney || '', address:party.address || ''},
                    linkTarget:{type:'localParty'},
                    contextLabel:'سيتم ربطه بهذا الطرف تلقائيًا بعد الحفظ',
                    onLinked:(_target,clientId,form)=>applyCreatedClientToParty(party.id,clientId,form),
                }),
                className:'text-[10px] font-bold text-emerald-400 mt-1',
                'data-testid':'new-case-create-client-'+party.id,
            },'➕ إنشاء موكل جديد من هذه البيانات')
        );
    };

    const inputCls = "w-full p-3 text-xs rounded-xl border border-white/10 bg-premium-bg text-white placeholder-slate-600 transition-colors";
    const inpStyle = {fontFamily:'Cairo,sans-serif'};

    return React.createElement('div',{className:"fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm",onClick:(e: React.MouseEvent<HTMLDivElement>) =>{if(e.target===e.currentTarget)onClose();}},
        React.createElement('div',{className:"bg-premium-card w-full max-w-lg rounded-t-3xl border-t border-white/10 p-6 pb-10 shadow-2xl slide-up max-h-[90vh] overflow-y-auto no-scrollbar"},
            React.createElement('div',{className:"w-10 h-1 bg-white/20 rounded-full mx-auto mb-5"}),
            React.createElement('div',{className:"flex items-center justify-between mb-5"},
                React.createElement('h3',{className:"text-sm font-black text-white flex items-center gap-2"},
                    React.createElement('span',{className:"w-1 h-4 bg-premium-gold rounded-full"}),
                    "تقييد دعوى جديدة في سند"
                ),
                React.createElement('button',{onClick:onClose,className:"w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 active:scale-90 transition-all shrink-0"},React.createElement(I.X))
            ),
            React.createElement('div',{className:"space-y-4"},

                // ══════════════ بيانات القيد الرسمي ══════════════
                React.createElement('div',{className:"pt-1"},
                    React.createElement('p',{className:"text-[10px] font-black text-slate-500 mb-3"},"— بيانات القيد الرسمي —")
                ),

                // ١. موضوع الدعوى
                React.createElement(Inp,{label:"موضوع ومسمى الدعوى",value:form.title,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('title',e.target.value),placeholder:"مثال: نزاع تجاري بين شركة .. وآخرين",required:true,'data-testid':'new-case-title'}),

                // ٢. المحكمة المختصة
                // ⚡ FIX (طلب مباشر من جيمي، 22 يوليو 2026): كان مربع اختيار
                // (Sel) بيجبر اختيار "أخرى" الأول قبل ما تقدر تكتب اسم محكمة
                // مش موجود في قايمة الدولة — تجربة مزعجة. دلوقتي مربع نص حر
                // دايمًا، مع datalist للاقتراح بس (مش إجبار) من قايمة محاكم
                // الدولة لو موجودة — الكتابة الحرة فيه شغالة زي أي input عادي.
                React.createElement('div',null,
                    React.createElement('label',{className:"block text-[10px] font-bold text-slate-400 mb-1.5"},"المحكمة المختصة"),
                    React.createElement('input',{
                        value:form.court,
                        onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('court',e.target.value),
                        placeholder:"اكتب اسم المحكمة",
                        className:inputCls, style:inpStyle,
                        list: (countryCourts && countryCourts.length>0) ? 'new-case-courts-list' : undefined,
                    }),
                    countryCourts && countryCourts.length>0 && React.createElement('datalist',{id:'new-case-courts-list'},
                        countryCourts.map((c: string) => React.createElement('option',{key:c,value:c}))
                    )
                ),

                // ٣. رقم الدعوى الرسمي + السنة
                React.createElement('div',null,
                    React.createElement('label',{className:"block text-[10px] font-bold text-slate-400 mb-1.5"},"رقم الدعوى الرسمي"),
                    React.createElement('div',{className:"flex gap-2 items-center"},
                        React.createElement('input',{value:form.caseNum,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('caseNum',e.target.value),placeholder:"رقم الدعوى",className:"flex-1 p-3 text-xs rounded-xl border border-white/10 bg-premium-bg text-white placeholder-slate-600 text-center",style:inpStyle}),
                        React.createElement('span',{className:"text-slate-500 font-black text-sm shrink-0"},"/"),
                        React.createElement('input',{value:form.caseYear,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('caseYear',e.target.value),placeholder:"السنة",maxLength:4,className:"w-24 p-3 text-xs rounded-xl border border-white/10 bg-premium-bg text-white placeholder-slate-600 text-center",style:inpStyle})
                    )
                ),

                // ٤. تصنيف الدعوى + رقم الدائرة (نفس السطر)
                // ⚡ FIX (طلب مباشر من جيمي، 22 يوليو 2026): تصنيف الدعوى نص حر
                // دايمًا، مع datalist للاقتراح بس من قايمة تصنيفات الدولة.
                React.createElement('div',{className:"grid grid-cols-2 gap-2"},
                    React.createElement('div',null,
                        React.createElement('label',{className:"block text-[10px] font-bold text-slate-400 mb-1.5"},"تصنيف الدعوى"),
                        React.createElement('input',{
                            value:form.type,
                            onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('type',e.target.value),
                            placeholder:"مدني / تجاري...",
                            className:inputCls, style:inpStyle,
                            list: (countryCaseTypes && countryCaseTypes.length>0) ? 'new-case-types-list' : undefined,
                        }),
                        countryCaseTypes && countryCaseTypes.length>0 && React.createElement('datalist',{id:'new-case-types-list'},
                            countryCaseTypes.map((t: string) => React.createElement('option',{key:t,value:t}))
                        )
                    ),
                    React.createElement('div',null,
                        React.createElement('label',{className:"block text-[10px] font-bold text-slate-400 mb-1.5"},"رقم الدائرة"),
                        React.createElement('input',{value:form.circuit_number,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('circuit_number',e.target.value),placeholder:"مثال: 12 تجاري",className:inputCls,style:inpStyle})
                    )
                ),

                // ٥. تاريخ الجلسة القادمة + وقت الجلسة (نفس السطر، وقت الجلسة
                // بيظهر بس بعد ما التاريخ يتحدد — قبل كده بياخد العرض كله لوحده).
                form.date
                    ? React.createElement('div',{className:"grid grid-cols-2 gap-2 items-start"},
                        React.createElement(DatePicker,{label:"تاريخ الجلسة القادمة",value:form.date,onChange:(v: string) =>s("date",v)}),
                        React.createElement(Sel,{
                            label:"وقت الجلسة",
                            value:form.session_time,
                            onChange:(e: React.ChangeEvent<HTMLSelectElement>) =>s('session_time',e.target.value),
                            options:SESSION_TIME_OPTIONS,
                        })
                    )
                    : React.createElement(DatePicker,{label:"تاريخ الجلسة القادمة",value:form.date,onChange:(v: string) =>s("date",v)}),

                // ٦. درجة التقاضي
                React.createElement('div',null,
                    React.createElement('label',{className:"block text-[10px] font-bold text-slate-400 mb-1.5"},"درجة التقاضي"),
                    React.createElement('div',{className:"flex gap-2"},
                        ['ابتدائي','استئناف','نقض','أخرى'].map((lvl: string) =>React.createElement('button',{
                            key:lvl,type:"button",
                            onClick:()=>s('court_level',lvl),
                            className:`flex-1 py-2.5 rounded-xl text-[10px] font-black transition-all active:scale-95 ${form.court_level===lvl?'bg-premium-gold text-premium-bg':'bg-white/5 border border-white/10 text-slate-400'}`
                        },lvl))
                    ),
                    form.court_level==='أخرى'&&React.createElement('input',{
                        value:form.court_level_other,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('court_level_other',e.target.value),
                        placeholder:"اكتب درجة التقاضي",
                        className:"w-full mt-2 p-3 text-xs rounded-xl border border-white/10 bg-premium-bg text-white placeholder-slate-600",
                        style:inpStyle
                    })
                ),

                // ══════════════ أطراف الدعوى ══════════════
                // ⚡ CHANGED (مرحلة 4 — خطة تعدد الأطراف، 22 يوليو 2026): بدل
                // حقلي "الموكل"/"الخصم" المفردين، PartyFieldsGroup بيدعم عدد
                // بلا حدود من المدعين والمدعى عليهم، وأي عدد منهم ممكن يتحدد
                // كـ"موكلنا" (⭐) — راجع قسم 2 و4 من الخطة. سلوت "ربط بموكل من
                // النظام" بيظهر تلقائيًا فوق اسم أي طرف عليه ⭐ (renderPartyExtra
                // فوق) بدل ما يكون فوق حقل الموكل بس زي الشكل القديم.
                React.createElement('div',{className:"border-t border-white/5 pt-4 mt-2"}),
                React.createElement(PartyFieldsGroup,{controller:partyFields,renderPartyExtra,testIdPrefix:'new-case'}),

                // ══════════════ بيانات إضافية ══════════════
                React.createElement('div',{className:"border-t border-white/10 pt-4 mt-2"},
                    React.createElement('p',{className:"text-[10px] font-black text-slate-500 mb-3"},"— بيانات إضافية (غير ضرورية) —")
                ),

                React.createElement('div',null,
                    React.createElement('label',{className:"block text-[10px] font-bold text-slate-400 mb-1.5"},"الطابق وقاعة الجلسة"),
                    React.createElement('input',{value:form.session_hall,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('session_hall',e.target.value),placeholder:"مثال: الدور الأول - قاعة 5",className:inputCls,style:inpStyle})
                ),
                React.createElement('div',null,
                    React.createElement('label',{className:"block text-[10px] font-bold text-slate-400 mb-1.5"},"قاعة سكرتير الجلسة"),
                    React.createElement('input',{value:form.secretary_hall,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('secretary_hall',e.target.value),placeholder:"رقم أو اسم قاعة السكرتير",className:inputCls,style:inpStyle})
                ),
                React.createElement('div',{className:"grid grid-cols-2 gap-2"},
                    React.createElement('div',null,
                        React.createElement('label',{className:"block text-[10px] font-bold text-slate-400 mb-1.5"},"اسم سكرتير الجلسة"),
                        React.createElement('input',{value:form.secretary_name,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('secretary_name',e.target.value),placeholder:"اسم السكرتير",className:inputCls,style:inpStyle})
                    ),
                    React.createElement('div',null,
                        React.createElement('label',{className:"block text-[10px] font-bold text-slate-400 mb-1.5"},"موبايل سكرتير الجلسة"),
                        React.createElement('input',{value:form.secretary_mobile,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('secretary_mobile',e.target.value.replace(/\D/g,'').slice(0,11)),placeholder:"رقم الموبايل",inputMode:"numeric",maxLength:11,className:inputCls,style:inpStyle})
                    )
                ),

                // زر الحفظ
                React.createElement('button',{
                    disabled:loading,
                    'data-testid':'new-case-save',
                    onClick:()=>{
                        if(!form.title.trim()){toast('يرجى إدخال موضوع ومسمى الدعوى',true);return;}
                        // ⚡ CHANGED (مرحلة 4 — خطة تعدد الأطراف): فاليديشن أطراف
                        // الدعوى كلها بقت من casePartiesValidation.ts (اسم/صفة كل
                        // طرف، الرقم القومي لمن عليه ⭐، طرف واحد ⭐ على الأقل، عدم
                        // تكرار الرقم القومي) — مش فحوصات مفردة هنا زي الشكل القديم.
                        if(!partyFields.validation.valid){toast(partyFields.validation.message || 'يرجى مراجعة بيانات أطراف الدعوى',true);return;}
                        const number = form.caseNum&&form.caseYear ? form.caseNum+'/'+form.caseYear : form.caseNum||form.caseYear||'';
                        const finalCourtLevel = form.court_level==='أخرى' ? form.court_level_other : form.court_level;
                        const finalCourt = form.court.trim() || '—';
                        const finalType  = form.type.trim() || 'عام';
                        // ⚡ NEW (مرحلة 4): الأعمدة القديمة (plaintiff/defendant/...)
                        // لسه موجودة على cases (قسم 3 من الخطة)، فبنبعت لها نسخة من
                        // "الطرف الأساسي" في كل جهة — أولوية لمن عليه ⭐ (موكل
                        // المكتب الفعلي)، وإلا أول طرف في الجهة. حفظ كل الأطراف
                        // فعليًا في case_parties هيتضاف في مرحلة 4 التالية (ربط
                        // useCaseActions.ts بالجدول الجديد — مش جزء من الخطوة دي).
                        const primaryPlaintiff = partyFields.plaintiffs.find((p) =>p.is_client) || partyFields.plaintiffs[0];
                        const primaryDefendant = partyFields.defendants.find((p) =>p.is_client) || partyFields.defendants[0];
                        onSave({
                            ...form,
                            number,
                            court: finalCourt,
                            type: finalType,
                            court_level: finalCourtLevel,
                            client_id: primaryPlaintiff?.client_id || undefined,
                            plaintiff: primaryPlaintiff?.name || undefined,
                            plaintiff_role: primaryPlaintiff?.capacity || undefined,
                            plaintiff_national_id: primaryPlaintiff?.national_id || undefined,
                            plaintiff_power_of_attorney: primaryPlaintiff?.power_of_attorney || undefined,
                            plaintiff_address: primaryPlaintiff?.address || undefined,
                            defendant: primaryDefendant?.name || undefined,
                            defendant_role: primaryDefendant?.capacity || undefined,
                            defendant_national_id: primaryDefendant?.national_id || undefined,
                            // 🆕 (خطة "المسمى القانوني" — مرحلة 3): بتوصل فاضية
                            // ('') لو الجهة فيها شخص واحد بس — نفس افتراضي
                            // usePartyFields()/validateParties.
                            plaintiff_legal_title: partyFields.legalTitles.plaintiff || undefined,
                            defendant_legal_title: partyFields.legalTitles.defendant || undefined,
                            // ⚡ NEW (مرحلة 4.2): array الأطراف الكامل — useCaseActions.ts
                            // بيكتب صف في case_parties لكل طرف فيه (بالإضافة لمزامنة
                            // الأعمدة القديمة فوق من الطرف الأساسي بس).
                            parties: partyFields.parties,
                        });
                    },
                    className:"w-full py-3.5 bg-gradient-to-tr from-premium-gold to-amber-200 text-premium-bg rounded-xl font-black text-sm shadow-md flex items-center justify-center gap-2 disabled:opacity-60 active:scale-95 transition-transform mt-2"
                },loading?React.createElement(I.Spin):React.createElement(I.Plus),loading?'جاري الحفظ...':'حفظ وتقييد الدعوى')
            )
        )
    );
}

export default NewCaseModal;
