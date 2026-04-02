# توثيق المنصة الكامل

## 1. نظرة عامة

هذه المنصة هي **AI App Builder** تعمل داخل المتصفح، وتجمع بين:
- واجهة محادثة لتوجيه النموذج.
- محرر ملفات متكامل.
- بيئة تشغيل داخلية عبر `WebContainer`.
- توليد مشاريع متعددة الملفات.
- وضع `Multi-Agent Orchestration` للتخطيط والتنفيذ والمراجعة والإصلاح.
- إدارة مشاريع محلية محفوظة في `localStorage`.

المنصة موجهة لبناء:
- مواقع ويب.
- تطبيقات React Frontend.
- تطبيقات Backend.
- تطبيقات Full-Stack.
- مشاريع بربط قواعد بيانات مثل `Supabase` و`Firebase`.

المنصة لا تعمل كمجرد شات يكتب كود، بل كنظام بناء تفاعلي فيه:
- تخطيط.
- تنفيذ فعلي على الملفات.
- تشغيل داخل بيئة افتراضية.
- فحص جودة.
- إصلاح موجه.

---

## 2. فكرة المنتج

الفكرة الأساسية للمنصة هي تحويل الطلب النصي من المستخدم إلى مشروع فعلي يحتوي:
- ملفات منظمة.
- هيكل مشروع واضح.
- تشغيل مباشر في المعاينة.
- متابعة عبر اللوج.
- حفظ تاريخ التعديلات.

بدل أن ينتج النموذج كودًا داخل الرسائل فقط، النظام مصمم لكي:
1. يحلل الطلب.
2. يخطط للمشروع.
3. ينشئ ملفات الخطة.
4. ينفذ الملفات الفعلية.
5. يراجع المشروع الناتج.
6. يطبق إصلاحات إضافية عند الحاجة.

---

## 3. التقنيات الأساسية المستخدمة

## الواجهة الأمامية
- `React 19`
- `TypeScript`
- `Vite`
- `Tailwind CSS`
- `lucide-react`
- `react-resizable-panels`
- `react-markdown`
- `motion`

## بيئة التوليد والتشغيل
- `Ollama` كنقطة تشغيل للنماذج المحلية.
- `@webcontainer/api` لتشغيل المشاريع داخل المتصفح.
- `xterm` و `@xterm/addon-fit` لعرض اللوج والـ terminal.
- `Monaco Editor` عبر `@monaco-editor/react` لتحرير الملفات.

## أدوات التصدير
- `JSZip` للتصدير كملف ZIP.
- `@stackblitz/sdk` للتصدير إلى StackBlitz.

## أدوات أخرى
- `zod`
- `express` موجود ضمن اعتماديات المنصة لأن النظام يسمح بتوليد مشاريع Backend وFull-Stack.

---

## 4. لغات البرمجة وأطر العمل داخل المنصة

المنصة نفسها مبنية أساسًا بـ:
- `TypeScript`
- `TSX`
- `CSS`

أما المشاريع التي تولدها المنصة فقد تتضمن:
- `React + TypeScript`
- `Node.js + Express + TypeScript`
- `Tailwind CSS`
- تكاملات مع `Supabase`
- تكاملات مع `Firebase`

---

## 5. البنية العامة للمشروع الحالي

الملفات الأساسية في `src/`:

- `App.tsx`: نقطة تجميع التطبيق.
- `main.tsx`: نقطة إدخال React.
- `hooks/`: منطق الحالة والتشغيل.
- `components/`: الواجهة والمودالات والمحرر والمعاينة.
- `utils/`: التحليل، orchestration، الجودة، التصدير، إدارة manifests.
- `constants/`: البرومبت الافتراضي والملفات الافتراضية.
- `lib/`: ربط Ollama.
- `services/`: خدمات الويب سيرش.
- `types/`: الأنواع المركزية.

---

## 6. الوحدات الرئيسية في المنصة

## 6.1 واجهة المحادثة
المكونات الأساسية:
- `src/components/chat/ChatSidebar.tsx`
- `src/components/chat/ChatHistory.tsx`
- `src/components/chat/ChatMessage.tsx`
- `src/components/chat/ChatInput.tsx`
- `src/components/chat/ChatHeader.tsx`
- `src/components/chat/EmptyState.tsx`

وظيفتها:
- استقبال الطلبات من المستخدم.
- عرض رسائل النظام والموديل.
- عرض حالة التوليد.
- عرض الـ multi-agent state.
- عرض مخرجات الـ generation summary ونتائج الـ gates.

## 6.2 محرر الكود
المكونات الأساسية:
- `src/components/editor/CodeView.tsx`
- `src/components/editor/FileExplorer.tsx`

وظيفته:
- عرض الملفات الناتجة.
- تحرير الملفات يدويًا.
- إظهار شجرة ملفات تفاعلية.
- عرض الملفات المعدلة حديثًا.
- دعم شجرة مجلدات قابلة للتوسعة.
- إظهار عداد الملفات.
- دعم context menu ووظائف التفاعل على الشجرة.

## 6.3 المعاينة والكونسول
المكونات الأساسية:
- `src/components/preview/PreviewPanel.tsx`
- `src/components/preview/PreviewErrorBoundary.tsx`

وظيفتها:
- عرض الـ preview داخل iframe.
- عرض اللوج من `xterm`.
- عرض حالة الـ workspace runtime.
- عرض targets الجارية في وضع `paired`.

## 6.4 شريط الأدوات
المكون الأساسي:
- `src/components/toolbar/MainToolbar.tsx`

وظيفته:
- التنقل بين `Preview / Code / Logs`.
- التحكم في device preview size.
- فتح package manager.
- فتح GitHub modal.
- فتح database modal.
- التصدير والحفظ.

## 6.5 المودالات الجانبية
المكونات الأساسية:
- `SettingsModal.tsx`
- `ProjectsSidebar.tsx`
- `PackageManagerModal.tsx`
- `GitHubModal.tsx`
- `DatabaseModal.tsx`

وظائفها:
- إعدادات Ollama.
- إدارة المشاريع.
- إدارة الاعتماديات.
- التصدير إلى GitHub.
- إعداد قواعد البيانات.

---

## 7. مسار العمل الأساسي للمستخدم

المستخدم عادة يمر بهذه الدورة:
1. يكتب طلبًا داخل الشات.
2. المنصة تضيف الرسالة إلى المشروع الحالي.
3. يبدأ التوليد عبر `useChat`.
4. إذا كان وضع `multi-agent` مفعلًا، يبدأ orchestration متعدد المراحل.
5. يتم تحديث الملفات لحظيًا.
6. تنتقل الملفات إلى شجرة المشروع.
7. إذا وجد مشروع قابل للتشغيل، يبدأ `WebContainer`.
8. تظهر المعاينة واللوج.
9. يمكن للمستخدم تعديل الملفات أو تثبيت حزم أو تصدير المشروع.

---

## 8. إدارة المشاريع والحفظ المحلي

الملف المسؤول:
- `src/hooks/useProjects.ts`

المهام التي يديرها:
- إنشاء مشاريع متعددة.
- التبديل بينها.
- حذف المشاريع.
- حفظ الرسائل والملفات في `localStorage`.
- الاحتفاظ بتاريخ للتراجع والإعادة.
- ترحيل البيانات القديمة من حالة المشروع الواحد إلى النظام الحالي متعدد المشاريع.

مفاتيح التخزين المحلي المستخدمة:
- `stitch_projects`
- `stitch_current_project`
- مفاتيح legacy قديمة مثل `stitch_messages` و`stitch_files`

النظام يحتفظ لكل مشروع بـ:
- `messages`
- `files`
- `history`
- `historyIndex`
- `updatedAt`

---

## 9. ربط Ollama والنماذج

الملفات الأساسية:
- `src/lib/ollama.ts`
- `src/hooks/useOllamaModels.ts`

الوظائف الأساسية:
- جلب قائمة النماذج من Ollama.
- إرسال رسائل الشات إلى Ollama عبر stream.
- استقبال الاستجابة chunk-by-chunk.
- تنظيف الرسائل قبل إرسالها لتقليل الحجم، مثل إزالة `filesGenerated` من الرسائل المرسلة.

النظام يعتمد على endpoint قابل للتعديل من الإعدادات.

---

## 10. وضع التوليد العادي مقابل وضع Multi-Agent

## 10.1 الوضع العادي
في هذا الوضع، يوجد agent واحد فعليًا يقوم بالتوليد المباشر.

## 10.2 وضع Multi-Agent
في هذا الوضع، المنصة تستخدم orchestrated pipeline بدل الرد المباشر.

المكوّن الأساسي:
- `src/utils/orchestration.ts`

الأدوار المنطقية الحالية:
- `Planner`
- `Builder`
- `Reviewer`
- `Fixer`

### دور Planner
ينشئ فقط 3 ملفات تخطيط في جذر المشروع:
- `implementation.md`
- `structure.md`
- `task.md`

هذه الملفات تعتبر المرجع الرسمي للخطة.

### دور Builder
يقرأ ملفات الخطة الثلاثة ويبدأ تنفيذها فعليًا داخل الملفات.

### دور Reviewer
يراجع:
- الكود الناتج.
- ملفات الخطة.
- توافق التنفيذ مع الخطة.
- مشكلات البناء والاعتماديات والمسارات.

### دور Fixer
يدخل فقط إذا وجدت quality gate failures.
ويفترض به أن يصلح الملفات الفاشلة الفعلية أولًا، ثم artifacts التخطيطية إذا احتاج الأمر.

---

## 11. ملفات الخطة ودورها

## 11.1 `implementation.md`
يصف:
- نوع التطبيق.
- الأهداف.
- المعمارية.
- معايير القبول.

## 11.2 `structure.md`
يصف:
- شجرة المشروع المستهدفة.
- الملفات الأساسية المطلوبة.

## 11.3 `task.md`
يصف:
- قائمة المهام التنفيذية.
- كل مهمة مرتبطة بملفاتها.
- حالات الإنجاز على مستوى البنود والملفات.

النظام الحالي يربط `task.md` بالتنفيذ، بحيث يمكن تعليم الملفات أو المهام وفق ما تم تنفيذه فعليًا.

---

## 12. Quality Gates

الملف المسؤول:
- `src/utils/quality-gates.ts`

المنصة تحتوي بوابات جودة منظمة بدل الاكتفاء بالرد النصي.

أمثلة على الفحوص الحالية:
- وجود ملفات الخطة الثلاثة.
- صحة بنية `implementation.md`.
- وجود عدد كافٍ من المهام في `task.md`.
- ربط المهام بملفات فعلية.
- تغطية `structure.md` داخل `task.md`.
- وجود الملفات المخططة فعليًا.
- وجود `package.json` صالح.
- وجود `dev script`.
- منع تسريب أسرار داخل كود العميل.
- منع بقاء markdown code fences داخل ملفات المصدر.
- فحوص متخصصة لـ `frontend`.
- فحوص متخصصة لـ `backend`.
- فحوص متخصصة لـ `full-stack`.

أنواع النتائج:
- `pass`
- `warn`
- `fail`

الفكرة من الـ gates هي منع اعتماد ناتج يبدو جيدًا في الشات لكنه مكسور وظيفيًا.

---

## 13. Project Classifier

الملف المسؤول:
- `src/utils/project-classifier.ts`

هذا الجزء يبني `BuildSpec` ويصنّف الطلب إلى أحد الأنماط التالية:
- `frontend`
- `backend`
- `full-stack`

ويُستخدم هذا التصنيف في:
- نوع الخطة.
- نوع الـ quality gates.
- طريقة التنفيذ المتوقعة.

---

## 14. File Parser ونظام تطبيق الملفات

الملف المسؤول:
- `src/utils/file-parser.ts`

المنصة تعتمد على parser يقرأ مخرجات النموذج بصيغتين:
- `<file path="...">...</file>` للملفات الجديدة.
- `<edit file="...">` لتعديل ملفات موجودة.

النظام الحالي تم تشديده ليعمل فقط على blocks مغلقة بالكامل، بهدف منع:
- الملفات الجزئية.
- الملفات المبتورة.
- مزج الكلام العادي مع محتوى ملفات غير مكتمل.

---

## 15. البرومبت المركزي للنظام

الملف المسؤول:
- `src/constants/system-prompt.ts`

هذا البرومبت يحدد قواعد البناء العامة، مثل:
- جودة التصميم.
- تنوع أساليب الواجهة.
- استخدام Tailwind.
- استخدام الحركة.
- استخدام Feature-Based Architecture.
- قواعد React وTypeScript.
- دعم routing.
- دعم قواعد البيانات.
- دعم full-stack مع Express.
- ضرورة استخدام `<file>` و`<edit>`.
- عدم ترك كود خارج tags.
- إمكانية استخدام web search.

هذا البرومبت هو الطبقة العليا التي توجه النموذج، بينما الـ orchestration والـ gates هما الطبقة التنفيذية والرقابية.

---

## 16. Web Search

الملف المسؤول:
- `src/services/SearchService.ts`

المنصة تدعم web search اختياريًا.

آلية العمل الحالية:
- DuckDuckGo HTML scraping عبر proxies.
- Wikipedia بالإنجليزية والعربية.

ملاحظات مهمة:
- البحث يتم عبر proxies خارجية في بعض الحالات.
- هذا يفيد في التحديث الزمني لكنه ليس طبقة enterprise search كاملة.
- النظام يدرج النتائج داخل prompt التوليد بصيغة منظمة.

---

## 17. WebContainer Runtime

الملف المسؤول:
- `src/hooks/useWebContainer.ts`

هذا الجزء هو القلب التشغيلي للمنصة.

وظائفه الأساسية:
- Boot بيئة `WebContainer` داخل المتصفح.
- Mount الملفات داخل الـ filesystem الافتراضي.
- تثبيت الاعتماديات.
- تشغيل `npm run dev`.
- استقبال `server-ready`.
- عرض اللوج داخل terminal.
- مزامنة الملفات مع المشروع الحالي.
- إعادة الضبط reset.
- تثبيت وإزالة الحزم من manifests محددة.

### الحالة التشغيلية الحالية
المنصة تدعم:
- `single workspace mode`
- `paired workspace mode`

### paired mode
إذا اكتشف النظام وجود:
- frontend target واضح
- backend target واضح

فإنه يشغل الاثنين معًا:
- backend في الخلفية.
- frontend كهدف المعاينة.

ويعرض حالة كل target داخل `PreviewPanel`.

### الحالات الداخلية المهمة
- `idle`
- `booting`
- `installing`
- `starting`
- `ready`
- `error`

### اللوج
اللوج يُجمع داخليًا ويعرض في terminal.
كما يتم حفظ أجزاء منه في `localStorage` لتقليل فقدان السياق.

---

## 18. اكتشاف manifests المتعددة

الملف المسؤول:
- `src/utils/package-manifests.ts`

هذا الجزء يكتشف كل `package.json` داخل المشروع، ويستنتج:
- `role: frontend`
- `role: backend`
- `role: unknown`

يعتمد في ذلك على:
- اسم المجلد.
- السكربتات.
- الاعتماديات.

ويستخدم هذا الاستنتاج لبناء:
- `DevWorkspacePlan`
- `installTargets`
- `runTargets`
- `previewTarget`

هذا التطوير مهم لأنه أضاف دعمًا حقيقيًا لمشاريع مثل:
- `client/package.json`
- `server/package.json`
- `frontend/package.json`
- `backend/package.json`

بدل الافتراض القديم بأن كل مشروع عنده `package.json` واحد في الروت.

---

## 19. Package Manager

الملف المسؤول:
- `src/components/modals/PackageManagerModal.tsx`

وظيفته:
- عرض الاعتماديات المثبتة.
- البحث في npm.
- تثبيت حزمة جديدة.
- حذف حزمة.
- اختيار `manifest scope` محدد.

حاليًا يدعم أكثر من manifest، ويتيح إدارة الحزم لكل scope على حدة.

أمثلة:
- تثبيت حزمة في `client/package.json`
- تثبيت حزمة أخرى في `server/package.json`

---

## 20. دعم قواعد البيانات

الملفات الأساسية:
- `src/components/modals/DatabaseModal.tsx`
- `src/utils/database-config.ts`

المنصة تدعم مزودين حاليًا:
- `Supabase`
- `Firebase`

ما الذي يحدث عند الحفظ:
- إنشاء `database.config.json`
- إنشاء ملفات config legacy للمزود إن لزم
- تحديث `.env.example`
- جعل البرومبت الأساسي والإيجنتات تلتزم بالمزود المحدد

هذا يسمح للنظام بأن يبني مشاريع تعتمد على قاعدة البيانات المختارة بدل التخمين الحر.

---

## 21. دعم GitHub

الملف الأساسي:
- `src/components/modals/GitHubModal.tsx`

الوظيفة:
- رفع المشروع إلى GitHub.
- التعامل مع إنشاء commit وpush.
- تم تحسين المنطق سابقًا ليتعامل بشكل أفضل مع الفرع الافتراضي بدل افتراض `main` أو `master` فقط.

---

## 22. التصدير

الملف الأساسي:
- `src/utils/export.ts`

المنصة تدعم:
- تصدير ZIP.
- التصدير إلى StackBlitz.

وقد تم مؤخرًا تحويل أدوات التصدير الثقيلة إلى dynamic imports لتخفيف الـ bundle الأولي.

---

## 23. تحسينات الأداء الحديثة المطبقة

تمت إضافة تحسينات مهمة على الأداء، أهمها:
- `lazy loading` للأجزاء الثقيلة مثل:
  - `CodeView`
  - `ProjectsSidebar`
  - `SettingsModal`
  - `PackageManagerModal`
  - `GitHubModal`
  - `DatabaseModal`
- تقسيم bundle في `Vite` إلى chunks مثل:
  - `runtime`
  - `editor`
  - `vendor-react`
  - `vendor-ui`
  - `export-tools`
- تحميل ديناميكي لـ:
  - `@webcontainer/api`
  - `xterm`
  - `@xterm/addon-fit`
  - `xterm/css/xterm.css`

النتيجة:
- تقليل الحمولة على المسار الأول.
- نقل الأجزاء الثقيلة خارج التحميل الأولي.
- تحسين قابلية الكاش وتوزيع الكود.

---

## 24. التصميم وتجربة الاستخدام

المنصة تقدم:
- واجهة داكنة موجهة للمطورين.
- تخطيط split-pane على الشاشات الكبيرة.
- تبويبات `Preview / Code / Logs`.
- شريط أدوات سريع.
- مودالات وظيفية للتكوين.
- شجرة ملفات تفاعلية.
- دعم أفضل للموبايل في الشجرة والمودالات واللوج.

---

## 25. ما الذي تفعله المنصة فعليًا بشكل احترافي الآن

المنصة حاليًا ليست مجرد واجهة شات، بل نظام فيه:
- إدارة مشاريع متعددة.
- تاريخ وتراجع وإعادة.
- توليد متعدد الملفات.
- وضع multi-agent منطقي.
- plan artifacts.
- quality gates.
- fixer.
- بيئة تشغيل داخل المتصفح.
- دعم manifests متعددة.
- paired runtime للمشاريع full-stack الواضحة.
- package scopes متعددة.
- database provider configuration.
- export workflows.

---

## 26. القيود الحالية المهمة

رغم أن المنصة متقدمة، هناك حدود حالية يجب فهمها:
- نجاح التوليد ما زال يعتمد جزئيًا على التزام النموذج نفسه.
- web search الحالي ليس enterprise-grade search stack.
- runtime pairing يدعم السيناريوهات الواضحة أكثر من monorepos المعقدة جدًا.
- جودة المشاريع المولدة قوية، لكنها ليست ضمانًا كاملًا لمستوى production النهائي بدون مراجعة إضافية.
- بعض الملفات المرجعية القديمة مثل `README.md` قد تحتوي إشارات قديمة من النسخة السابقة وتحتاج تحديثًا منفصلًا.

---

## 27. أهم الملفات المرجعية داخل المشروع

### النواة
- `src/App.tsx`
- `src/main.tsx`
- `src/types/index.ts`

### التوليد والإيجنتات
- `src/hooks/useChat.ts`
- `src/utils/orchestration.ts`
- `src/utils/project-classifier.ts`
- `src/utils/quality-gates.ts`
- `src/utils/file-parser.ts`
- `src/constants/system-prompt.ts`

### التشغيل والمعاينة
- `src/hooks/useWebContainer.ts`
- `src/components/preview/PreviewPanel.tsx`
- `src/components/editor/CodeView.tsx`
- `src/components/editor/FileExplorer.tsx`

### المشاريع والحفظ
- `src/hooks/useProjects.ts`

### الحزم والـ workspace
- `src/utils/package-manifests.ts`
- `src/components/modals/PackageManagerModal.tsx`

### قواعد البيانات
- `src/utils/database-config.ts`
- `src/components/modals/DatabaseModal.tsx`

### التصدير
- `src/utils/export.ts`

### البحث
- `src/services/SearchService.ts`

---

## 28. ملخص معماري نهائي

المنصة =
- **واجهة React**
- + **محرر ملفات**
- + **محرك توليد عبر Ollama**
- + **Orchestration متعدد الأدوار**
- + **Plan artifacts**
- + **Quality gates**
- + **Fix loop**
- + **WebContainer runtime**
- + **Package/workspace awareness**
- + **Database configuration layer**
- + **Export layer**

وهذا يجعلها منصة بناء تطبيقات ذكية متقدمة، وليست مجرد مولد كود بسيط.

---

## 29. اقتراحات تطوير مستقبلية

للوصول لدرجة أعلى أكثر، يمكن إضافة:
- smoke tests تلقائية داخل WebContainer بعد التوليد.
- فحوص build/runtime لكل مشروع مولد قبل اعتماده نهائيًا.
- دعم أوسع للـ monorepos وworkspaces.
- مزودات نماذج متعددة بجانب Ollama.
- تحديث README الافتراضي ليتوافق تمامًا مع النسخة الحالية.
- توثيق API داخلي للـ hooks والأنواع.
- telemetry اختيارية لتتبع نسب نجاح الجولات.

---

## 30. ملاحظة تشغيلية مهمة

التوثيق هنا مبني على **الكود الحالي الفعلي** داخل المشروع وقت الكتابة، وليس على وصف نظري أو خطة قديمة. لذلك يعتبر هذا الملف مرجعًا أعلى من README القديمة إذا وجد تعارض بينهما.
