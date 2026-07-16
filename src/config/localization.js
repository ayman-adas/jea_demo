const translations = {
  en: {
    contactSupport: "Please contact customer support.",
    welcomeNoCategories: "Hello, {name}! 👋 No service categories are currently active. Please try again later.",
    welcomePrompt: "Hello, {name}! 👋 Welcome to the Jordan Engineers Association Digital Assistant.\n\nPlease select a service category by replying with its number:\n{list}",
    invalidSelectionCategory: "Invalid selection. Please choose a category by entering its number or name.",
    noServicesAvailable: "There are no services available for your role under \"{category}\". Reply \"hello\" to return to the menu.",
    selectServicePrompt: "You selected \"{category}\".\n\nPlease select a service by entering its number:\n{list}",
    invalidSelectionService: "Invalid selection. Please choose a service by entering its number or service ID.",
    templatePrompt: "Selected Service: {service}\n\n{content}\n\nTo complete this request, please reply with the template filled out.",
    requestSuccess: "✅ Request Success!\n\nYour request has been successfully registered under ticket ref: {ticketId}.\n\nReply \"hello\" at any time to return to the main menu.",
    requestFailed: "❌ Request Failed!\n\nIt looks like you didn't fill out the template correctly. Please make sure to keep the format like [Field: Value] and try again.",
    corruptState: "Something went wrong. Let's restart. Reply with 'hello'.",
    supportWelcome: "Hello! Please choose the category to connect with customer support:\n{list}",
    supportInvalid: "Invalid selection. Please choose a category by entering its number.",
    supportHandoverConfirm: "A customer support agent will assist you shortly. Thank you!",
    handoverFallback: "We will hand you over to a customer support agent. Please select the category for routing:\n{list}",
    ratingPrompt: "Thank you! Your request has been registered.\n\nPlease rate our service from 1 to 5 stars (1 = Lowest, 5 = Highest):",
    ratingInvalid: "Invalid rating. Please reply with a single number from 1 to 5:",
    commentPrompt: "Thank you for rating! You can now optionally write any comment/feedback. Reply with 'none' or 'no' if you do not want to add comments.",
    ratingSuccess: "✅ Request and evaluation registered successfully!\n\nTicket Ref: {ticketId}\nRating: {rating} Stars\n\nReply 'hello' at any time to return to the main menu.",
    cantAnswerMsg: "⚠️ I couldn't find a confident answer to your question (Confidence: {score}%).\n\nWould you like to open a support ticket to follow up with our team?\n1. Yes, open a ticket\n2. No, return to main menu",
    ticketCancel: "Understood. Returning to the main menu. Send 'hello' to start again."
  },
  ar: {
    contactSupport: "يرجى التواصل مع خدمة العملاء.",
    welcomeNoCategories: "وعليكم السلام ورحمة الله وبركاته، {name}! 👋 لا توجد أقسام خدمة مفعلة حالياً. يرجى المحاولة لاحقاً.",
    welcomePrompt: "وعليكم السلام ورحمة الله وبركاته، {name}! 👋 أهلاً بك في المساعد الرقمي لنقابة المهندسين الأردنيين.\n\nيرجى اختيار القسم بإرسال رقمه:\n{list}",
    invalidSelectionCategory: "اختيار غير صحيح. يرجى اختيار القسم بإرسال رقمه أو اسمه.",
    noServicesAvailable: "لا توجد خدمات متاحة لصلاحياتك حالياً تحت قسم \"{category}\". أرسل \"مرحبا\" للعودة إلى القائمة الرئيسية.",
    selectServicePrompt: "لقد اخترت \"{category}\".\n\nيرجى اختيار الخدمة بإرسال رقمها:\n{list}",
    invalidSelectionService: "اختيار غير صحيح. يرجى اختيار الخدمة بإرسال رقمها أو المعرف الخاص بها.",
    templatePrompt: "الخدمة المحددة: {service}\n\n{content}\n\nلإكمال الطلب، يرجى الرد بتعبئة القالب الموضح أعلاه.",
    requestSuccess: "✅ تم تسجيل طلبك بنجاح!\n\nرقم التذكرة الخاص بك هو: {ticketId}.\n\nأرسل \"مرحبا\" في أي وقت للعودة إلى القائمة الرئيسية.",
    requestFailed: "❌ فشل تسجيل الطلب!\n\nيبدو أنك لم تقم بتعبئة القالب بشكل صحيح. يرجى التأكد من الحفاظ على التنسيق مثل [اسم الحقل: القيمة] والمحاولة مرة أخرى.",
    corruptState: "حدث خطأ ما. دعنا نبدأ من جديد. أرسل \"مرحبا\".",
    supportWelcome: "وعليكم السلام! يرجى اختيار القسم المناسب للتواصل مع خدمة العملاء:\n{list}",
    supportInvalid: "اختيار غير صحيح. يرجى اختيار القسم بإدخال الرقم المناسب له.",
    supportHandoverConfirm: "سيقوم موظف خدمة العملاء بخدمتك قريباً. شكراً لك!",
    handoverFallback: "سنقوم بتحويلك لموظف خدمة العملاء. يرجى اختيار القسم المناسب للتوجيه:\n{list}",
    ratingPrompt: "شكراً لك! تم تسجيل طلبك بنجاح.\n\nيرجى تقييم جودة الخدمة من 1 إلى 5 درجات (حيث 1 الأدنى و 5 الأعلى):",
    ratingInvalid: "تقييم غير صحيح. يرجى الرد برقم واحد من 1 إلى 5:",
    commentPrompt: "شكراً لك على التقييم! يمكنك الآن كتابة أي ملاحظة أو تعليق إضافي بشكل اختياري. أرسل 'لا' أو 'none' إذا كنت لا ترغب في إضافة تعليق.",
    ratingSuccess: "✅ تم تسجيل طلبك وتقييمك بنجاح!\n\nرقم التذكرة: {ticketId}\nالتقييم: {rating} درجات\n\nأرسل 'مرحبا' في أي وقت للعودة إلى القائمة الرئيسية.",
    cantAnswerMsg: "⚠️ لم أتمكن من العثور على إجابة مؤكدة لسؤالك (درجة الثقة: {score}%).\n\nهل ترغب في فتح تذكرة دعم لمتابعة طلبك مع الفريق المختص؟\n1. نعم، افتح تذكرة\n2. لا، العودة للقائمة الرئيسية",
    ticketCancel: "تم الإلغاء. العودة إلى القائمة الرئيسية. أرسل 'مرحبا' للبدء من جديد."
  }
};

/**
 * Get translated text for a given key and language, substituting placeholders
 * @param {string} lang - 'en' or 'ar'
 * @param {string} key - Translation key
 * @param {Object} [params] - Substitutions dictionary
 * @returns {string} - Substituted translation string
 */
const getTranslation = (lang, key, params = {}) => {
  const dict = translations[lang] || translations.en;
  let text = dict[key] || translations.en[key] || '';
  Object.keys(params).forEach(p => {
    text = text.replace(`{${p}}`, params[p]);
  });
  return text;
};

module.exports = {
  getTranslation
};
