import React from 'react';
import { createPortal } from 'react-dom';
import { I } from '../../constants';
import { Inp } from '@/shared/ui/Inp';
import DatePicker from '@/shared/ui/DatePicker';
import type { ReminderRow } from '../../types';

interface ReminderEditForm {
  title: string;
  due_date: string;
  notes: string;
}

interface EditReminderModalProps {
  editTarget: ReminderRow | null;
  setEditTarget: (r: ReminderRow | null) => void;
  editForm: ReminderEditForm;
  setEditForm: (fn: (p: ReminderEditForm) => ReminderEditForm) => void;
  handleEdit: () => void;
  editSaving: boolean;
}

function EditReminderModal({
  editTarget, setEditTarget, editForm, setEditForm, handleEdit, editSaving,
}: EditReminderModalProps) {
  return editTarget && createPortal(React.createElement('div',{
        className:"fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm",
        onClick:(e: React.MouseEvent<HTMLDivElement>) =>{ if(e.target===e.currentTarget) setEditTarget(null); }
    },
        // 🔒 FIX (27 يوليو 2026 — e2e/reminders-edit.spec.ts "فاليديشن" كانت
        // بتفشل 100% من المرات، مش flake): المودال ده bottom-sheet من غير
        // overflow-y-auto/max-h، وDatePicker بيفتح لوحة التقويم لأسفل
        // (absolute top-full) — فلما اللوحة بتوسّع المحتوى أكتر من ارتفاع
        // الشاشة، زرار "✕ مسح التاريخ" (آخر عنصر في اللوحة) بيتقفل برّه
        // viewport من غير أي scroll container يوصله بيه — Playwright بيحاول
        // يعمل scroll طول 30 ثانية ومش لاقي حاوية تتحرك. max-h + overflow-y-auto
        // بيدّي المودال نفسه قدرة يتمرجل لو محتواه زاد عن الشاشة.
        React.createElement('div',{className:"bg-premium-card w-full max-w-lg rounded-t-3xl border-t border-white/10 p-6 pb-10 shadow-2xl slide-up max-h-[85vh] overflow-y-auto",'data-testid':'reminder-edit-modal'},
            React.createElement('div',{className:"w-10 h-1 bg-white/20 rounded-full mx-auto mb-5"}),
            React.createElement('div',{className:"flex items-center justify-between mb-4"},
                React.createElement('h3',{className:"text-sm font-black text-white flex items-center gap-2"},
                    React.createElement('span',{className:"w-1 h-4 bg-premium-gold rounded-full"}),
                    "تعديل المهمة"
                ),
                React.createElement('button',{onClick:()=>setEditTarget(null),'data-testid':'reminder-edit-close',className:"w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-slate-400"},"✕")
            ),
            React.createElement('div',{className:"space-y-3"},
                React.createElement(Inp,{label:"عنوان المهمة",value:editForm.title,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>setEditForm((p: ReminderEditForm) =>({...p,title:e.target.value})),placeholder:"عنوان المهمة",required:true,'data-testid':'reminder-edit-title'}),
                React.createElement(DatePicker,{label:"تاريخ المهمة",value:editForm.due_date,onChange:(v: string) =>setEditForm((p: ReminderEditForm) =>({...p,due_date:v})),required:true,testId:'reminder-edit-date-trigger',dayTestId:'reminder-edit-date-day',clearTestId:'reminder-edit-date-clear'}),
                React.createElement(Inp,{label:"ملاحظات",value:editForm.notes,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>setEditForm((p: ReminderEditForm) =>({...p,notes:e.target.value})),placeholder:"تفاصيل إضافية...",'data-testid':'reminder-edit-notes'}),
                React.createElement('button',{
                    onClick:handleEdit, disabled:editSaving,
                    'data-testid':'reminder-edit-save',
                    className:"w-full py-3 bg-gradient-to-tr from-premium-gold to-amber-200 text-premium-bg rounded-xl font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-transform"
                }, editSaving?React.createElement(I.Spin):React.createElement(I.Check), "حفظ التعديلات")
            )
        )
    ), document.body);
}

export default EditReminderModal;
