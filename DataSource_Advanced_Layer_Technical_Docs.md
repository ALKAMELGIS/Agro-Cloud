# طبقة Data Source المتقدمة (Multi-Check Select Layer)

هذه الوثيقة تشرح تصميم وتنفيذ طبقة اختيار طبقات Data Source المتقدمة داخل صفحة إعدادات **Workflow & Data Sources**، مع دعم:
- اختيار متعدد عبر checkboxes
- بحث وتصفية ديناميكية
- طرق عرض: قائمة (List)، شبكة (Grid)، شجرة (Tree)
- تحديد/إلغاء تحديد الكل
- اختصارات لوحة المفاتيح
- وصولية (Accessibility)
- استيراد بيانات من مصادر خارجية (API / JSON) + الاعتماد على قاعدة البيانات المحلية (IndexedDB)
- حالات تحميل واضحة ومعالجة أخطاء والتحقق من صحة البيانات

## مكان التنفيذ
- مكون الإعدادات: [Settings.tsx](file:///c:/Users/mohamed.abass.WUSOOM/Downloads/RAK/D/Map/Logo/ESRI/Map/Agri/src/pages/account/Settings.tsx)
- مكون إدارة مصادر البيانات: [datasourcefieldspanel.tsx](file:///c:/Users/mohamed.abass.WUSOOM/Downloads/RAK/D/Map/Logo/ESRI/Map/Agri/src/pages/data-entry/components/datasourcefieldspanel.tsx)

## نظرة عامة على السلوك
### 1) طبقات Available
- تعرض قائمة الطبقات المتاحة من:
  - قاعدة البيانات المحلية (IndexedDB) ضمن `GisMapStore/layers` المفتاح `savedLayers`
  - استيراد خارجي من URL (API) أو ملف JSON
- تدعم:
  - اختيار متعدد بالـ checkboxes
  - بحث نصي (بالاسم أو الـ id)
  - فلترة نوع (All / ArcGIS / GeoJSON / URL / Custom)
  - عرض Selected only
  - طرق عرض: List/Grid/Tree
  - Select all / Clear تعمل على “النتائج المرشّحة الحالية” فقط

### 2) قائمة Selected
- تعرض الطبقات المختارة مع:
  - إعادة ترتيب Drag & Drop
  - زر Remove
- يتم الحفاظ على ترتيب المستخدم عند الحفظ.

## الأداء (Large Data)
- عرض List يستخدم windowing بسيط (virtualized slice) لتجنب رسم آلاف العناصر دفعة واحدة.
- الاعتماد على `useMemo` لتقليل عمليات الفلترة/التجميع المتكررة.

## الوصولية (Accessibility)
- كل مدخل checkbox له `aria-label` واضح.
- قائمة List تستخدم `role="listbox"` مع `aria-multiselectable="true"`.
- عناصر التحكم (الأزرار/الحقول) قابلة للاستخدام عبر لوحة المفاتيح.

## اختصارات لوحة المفاتيح
داخل منطقة اختيار الطبقات:
- Ctrl/Cmd + A: تحديد كل النتائج المرشحة الحالية
- Esc: إلغاء تحديد كل النتائج المرشحة الحالية

## التكامل مع مصادر خارجية
### استيراد من URL (API)
من خلال حقل URL وزر Import يتم جلب JSON من URL.

**الصيغ المدعومة للاستجابة:**
1) Array مباشرة:
```json
[
  { "id": "layer-1", "name": "Layer 1", "fields": ["A", "B"] },
  { "id": "layer-2", "name": "Layer 2" }
]
```
2) Object يحتوي layers:
```json
{
  "layers": [
    { "id": "layer-1", "name": "Layer 1", "fields": ["A", "B"] }
  ]
}
```

**قواعد التحقق (Validation):**
- `id` إلزامي ويجب أن يكون نصًا غير فارغ بعد trim
- `name` اختياري (يُستخدم id كبديل)
- `fields` اختياري؛ إن وُجد يجب أن يكون مصفوفة نصوص
- يتم إزالة التكرار في fields، وترتيبها أبجديًا
- يتم إزالة التكرار على مستوى الطبقات حسب `id`

### استيراد من ملف JSON
رفع ملف `.json` بنفس الصيغ أعلاه.

## حالات التحميل والأخطاء
- عند تحميل طبقات IndexedDB: يظهر “Loading saved layers…”
- عند فشل التحميل/الاستيراد: تظهر رسالة خطأ واضحة داخل بطاقة Available
- يتم منع الضغط على Import أثناء التحميل

## الحفظ (Persistence)
- الحفظ يتم داخل LocalStorage المفتاح:
  - `form_data_source_bindings_v1`
- البنية تشمل:
  - `sourceIds` للطبقات المختارة
  - `fieldConfigsBySource` لإعدادات الحقول لكل طبقة
  - `managementLayer` لإعداد طبقة الإدارة (إن وجدت)

## الاختبارات
### Unit/Component Tests (Vitest)
- [AdvancedLayerMultiSelect.test.tsx](file:///c:/Users/mohamed.abass.WUSOOM/Downloads/RAK/D/Map/Logo/ESRI/Map/Agri/src/pages/data-entry/components/AdvancedLayerMultiSelect.test.tsx)
  - يتحقق من:
    - Normalize payload الخارجي
    - البحث + Select all filtered
    - اختصارات Ctrl/Cmd+A و Esc

### Integration/E2E (Playwright)
- [data-source-advanced-layer.spec.ts](file:///c:/Users/mohamed.abass.WUSOOM/Downloads/RAK/D/Map/Logo/ESRI/Map/Agri/tests/data-source-advanced-layer.spec.ts)
  - يتحقق من ظهور واجهة الاختيار المتقدم داخل صفحة Settings.

