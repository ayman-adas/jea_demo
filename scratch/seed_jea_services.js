const path = require('path');
require('dotenv').config();

const { Employee, ServiceCategory, QA, sequelize } = require('../src/models');

async function seedJeaServices() {
  try {
    // 1. Fetch first employee to assign as QA maintainer
    const emp = await Employee.findOne();
    if (!emp) {
      console.error('No employee found in database! Please seed employees first.');
      process.exit(1);
    }
    console.log(`Assigned employee for QAs: ${emp.id}`);

    // 2. Set up detailed QA entries with localized templates and actual files links
    const jeaQAs = [
      {
        id: 'svc_health_enroll',
        service_category_id: 'health_insurance',
        content: `🏥 الاشتراك وتجديد التأمين الصحي لنقابة المهندسين الأردنيين:
شروط الاشتراك العام:
1. تسديد كافة الذمم والاشتراكات السنوية للنقابة والتقاعد حتى تاريخ تقديم الطلب.
2. اشتراك المهندس وجميع أفراد عائلته (المنتفعين) تحت برنامج تأميني واحد ودرجة واحدة.
3. التغطية الطبية تكون ضمن شبكة المراكز والمستشفيات المعتمدة من النقابة.
4. تحميل وقراءة الوثائق الرسمية الفعلية:
   - [تحميل تعليمات التأمين الصحي لعام 2026 PDF](https://www.jea.org.jo/EBV4.0/Root_Storage/AR/تعليمات_التأمين_الصحي_2026.pdf)
   - [تحميل برامج التأمين الصحي للمهندسين وعائلاتهم PDF](https://www.jea.org.jo/EBV4.0/Root_Storage/AR/برامج_المهندسين_وعائلاتهم.pdf)

الرجاء تعبئة النموذج التالي ورفعه لإتمام طلبك:
[الرقم الهندسي: <الرقم>]
[البرنامج المطلوب: <أمان / شفاء / بوليصة الوالدين / المهندسين الشباب>]
[الدرجة التأمينية: <الأولى / الثانية / الثالثة>]
[أفراد العائلة وأعمارهم: <الاسم1 (العمر)، الاسم2 (العمر)>]`,
        content_type: 'TEXT',
        employee_assigned: emp.id,
        status: 'ACTIVE'
      },
      {
        id: 'svc_health_card_info',
        service_category_id: 'health_insurance',
        content: `💳 عرض وتجديد معلومات بطاقة التأمين الصحي:
تتيح لك هذه الخدمة الاستعلام عن صلاحية بطاقتك التأمينية، سقف التغطية المتبقي، والشبكة الطبية الخاصة بك.
* ملاحظة: يجب أن تكون مسجلاً مسبقاً في إحدى درجات التأمين لتفعيل البطاقة الرقمية.

الرجاء تعبئة النموذج التالي للاستعلام عن تفاصيل بطاقتك:
[الرقم الهندسي: <الرقم>]
[رقم التأمين الصحي: <الرقم>]
[الرقم الوطني للمشترك: <الرقم>]`,
        content_type: 'TEXT',
        employee_assigned: emp.id,
        status: 'ACTIVE'
      },
      {
        id: 'svc_membership_cert',
        service_category_id: 'membership_service',
        content: `📜 إصدار شهادة العضوية / الهوية النقابية:
متطلبات إصدار شهادة العضوية:
1. صورة عن بطاقة الأحوال المدنية الذكية.
2. صورة شخصية حديثة للمهندس.
3. تسديد رسوم الاشتراك السنوي للعام الحالي (قيمة الاشتراك 30 ديناراً).
4. بعد تقديم الطلب، يتطلب الاستلام الحضور الشخصي للمهندس أو ووكيل قانوني معتمد إلى مقر النقابة أو الفروع.
5. تحميل وقراءة الأدلة الإرشادية الرسمية الفعلية:
   - [تحميل دليل الخدمات النقابية PDF](https://www.jea.org.jo/EBV4.0/Root_Storage/AR/دليل_الخدمات.pdf)
   - [تحميل دليل إصدار شهادات العضوية والهوية النقابية PDF](https://www.jea.org.jo/EBV4.0/Root_Storage/AR/إصدار_شهادة_عضوية-هوية_نقابية.pdf)

يرجى تعبئة النموذج أدناه لطلب إصدار شهادة العضوية:
[الرقم الهندسي: <الرقم>]
[الاسم الرباعي باللغة العربية: <الاسم>]
[الرقم الوطني: <الرقم>]
[الفرع المراد الاستلام منه: <المركز الرئيسي عمان / إربد / الزرقاء / العقبة / السلط / الكرك>]`,
        content_type: 'TEXT',
        employee_assigned: emp.id,
        status: 'ACTIVE'
      }
    ];

    // 3. Insert or update the QAs in the database
    console.log('Upserting new JEA service QAs...');
    for (const qaData of jeaQAs) {
      await QA.upsert(qaData);
      console.log(`Successfully seeded/updated QA: ${qaData.id}`);
    }

    console.log('Database seeding completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Failed to seed JEA services data:', err);
    process.exit(1);
  }
}

seedJeaServices();
