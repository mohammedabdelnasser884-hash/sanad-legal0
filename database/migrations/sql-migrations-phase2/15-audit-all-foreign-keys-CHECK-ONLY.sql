-- استعلام تشخيصي فقط (SELECT بس، مفيش تعديل خالص) — شغّله وابعتلي النتيجة
-- كصورة أو نص، عشان أقارنها بالملفات الموثقة في المشروع وأحدد بالظبط
-- فين الفجوات، وأكتبلك ملف توثيق واحد شامل بدل ما نلحق كل حالة لوحدها.

SELECT string_agg(
  format(
    '%s.%s -> %s.id | delete_rule=%s | constraint=%s',
    tc.table_name, kcu.column_name, ccu.table_name, rc.delete_rule, tc.constraint_name
  ),
  E'\n'
  ORDER BY ccu.table_name, tc.table_name, kcu.column_name
) AS "كل_الـ_FK_في_خلية_واحدة"
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public';
