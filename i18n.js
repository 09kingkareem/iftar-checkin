const translations = {
  en: {
    // Nav
    'nav.brand': 'Iftar Check-in',
    'nav.registration': 'Registration',
    'nav.event_details': 'Event Details',
    'nav.invitations': 'Invitations',
    'nav.reports': 'Reports',
    'nav.users': 'Users',
    'nav.walkin': 'Walk-in',
    'nav.kiosk': 'Kiosk',
    'nav.logout': 'Logout',

    // Stats
    'stats.total': 'Total Guests',
    'stats.checked_in': 'Checked In',
    'stats.pending': 'Pending',
    'stats.progress': 'Progress',

    // Dashboard
    'dashboard.live_activity': 'Live Activity',
    'dashboard.timeline': 'Check-in Timeline',
    'dashboard.waiting': 'Waiting for activity...',
    'dashboard.add_guest': 'Add Guest',
    'dashboard.bulk_import': 'Bulk Import',
    'dashboard.guest_list': 'Guest List',
    'dashboard.search': 'Search guests...',
    'dashboard.danger_zone': 'Danger Zone',
    'dashboard.clear_all': 'Clear All Guests',
    'dashboard.no_guests': 'No guests found',

    // Table headers
    'table.name': 'Name',
    'table.category': 'Category',
    'table.table': 'Table',
    'table.dietary': 'Dietary',
    'table.status': 'Status',
    'table.time': 'Time',
    'table.actions': 'Actions',

    // Buttons
    'btn.add_guest': 'Add Guest',
    'btn.import': 'Import Names',
    'btn.upload_csv': 'Upload CSV',
    'btn.download_tickets': 'Download Tickets PDF',
    'btn.export_csv': 'Export CSV',
    'btn.check_in': 'Check In',
    'btn.edit': 'Edit',
    'btn.ticket': 'Ticket',
    'btn.save': 'Save Changes',
    'btn.broadcast': 'Broadcast',

    // Form labels
    'form.guest_name': 'Guest Name *',
    'form.table_number': 'Table #',
    'form.dietary': 'Dietary restrictions',
    'form.phone': 'Phone',
    'form.email': 'Email',
    'form.paste_names': 'Paste guest names, one per line...',
    'form.csv_hint': 'Or upload a CSV with columns: name, category, dietary, table, phone, email',

    // Status
    'status.checked_in': 'Checked In',
    'status.pending_status': 'Pending',

    // Event Details
    'event.info': 'Event Information',
    'event.name': 'Event Name',
    'event.date': 'Date',
    'event.time': 'Time',
    'event.venue': 'Venue',
    'event.edit': 'Edit Event Settings',

    // Invitations
    'invite.title': 'Email Invitations',
    'invite.desc': 'Send styled invitation emails with PDF badges attached to all guests who have an email address.',
    'invite.send_all': 'Send Invitations to All',
    'invite.send_confirm': 'Send email invitations to all guests with email addresses?',
    'invite.n8n_hint': 'This will trigger the n8n workflow to email each guest their personalized invitation with badge PDF.',
    'invite.not_configured': 'n8n webhook not configured. Add N8N_WEBHOOK_URL to your environment variables to enable email invitations.',
    'invite.download': 'Download Tickets',
    'invite.download_desc': 'Download all guest badges as a single PDF for printing.',
    'invite.preview': 'Invitation Preview',
    'invite.preview_desc': 'This is how the email invitation looks to your guests:',
    'invite.cordially': 'You are cordially invited',

    // Feedback
    'feedback.title': 'Feedback Survey',
    'feedback.desc': 'Send the feedback form to all checked-in guests who have an email address.',
    'feedback.send': 'Send Feedback Survey',
    'feedback.confirm': 'Send feedback survey to all checked-in guests with email addresses?',

    // Reports
    'report.quick_stats': 'Quick Stats',
    'report.total': 'Total Registered',
    'report.checked': 'Checked In',
    'report.noshows': 'No-Shows',
    'report.rate': 'Attendance Rate',
    'report.download': 'Download Report',
    'report.download_desc': 'Generate a comprehensive PDF report with attendance stats, category breakdown, check-in timeline, and no-show list.',
    'report.download_btn': 'Download Post-Event Report PDF',

    // Announcements
    'announce.title': 'Broadcast Announcement',
    'announce.placeholder': 'Type announcement message...',
    'announce.info': 'Info',
    'announce.success': 'Success',
    'announce.warning': 'Warning',

    // Walk-in
    'walkin.title': 'Walk-in Registration',
    'walkin.register': 'Register & Check In',
    'walkin.success': 'Registered & Checked In',
    'walkin.redirect': 'Redirecting back to form...',
    'walkin.table': 'Table # (optional)',

    // Check-in page
    'checkin.invalid': 'Invalid QR Code',
    'checkin.invalid_msg': 'This QR code is not recognized. Please see a volunteer for help.',
    'checkin.already': 'Already Checked In',
    'checkin.welcome': 'Welcome,',
    'checkin.enjoy': "You're checked in. Enjoy the iftar!",
    'checkin.family_enjoy': 'All {count} family members are checked in. Enjoy the iftar!',
    'checkin.scan_count': 'Scan count:',

    // Users
    'users.title': 'User Management',
    'users.create': 'Create New User',
    'users.all': 'All Users',
    'users.username': 'Username',
    'users.password': 'Password',
    'users.display_name': 'Display Name',
    'users.role': 'Role',
    'users.status': 'Status',
    'users.last_login': 'Last Login',
    'users.active': 'Active',
    'users.inactive': 'Inactive',
    'users.activate': 'Activate',
    'users.deactivate': 'Deactivate',
    'users.you': 'You',

    // Categories
    'cat.guest': 'Guest',
    'cat.student': 'Student',
    'cat.parent': 'Parent',
    'cat.teacher': 'Teacher',
    'cat.vip': 'VIP',
    'cat.family': 'Family',

    // Login
    'login.title': 'Iftar Check-in',
    'login.subtitle': 'Sign in to continue',
    'login.username': 'Username',
    'login.password': 'Password',
    'login.submit': 'Sign In',

    // Misc
    'ramadan_kareem': 'Ramadan Kareem',
    'badge_attached': 'Badge PDF attached',
    'confirm_delete_all': 'This will DELETE ALL guests. Are you sure?',
  },

  ar: {
    // Nav
    'nav.brand': 'تسجيل الإفطار',
    'nav.registration': 'التسجيل',
    'nav.event_details': 'تفاصيل الحدث',
    'nav.invitations': 'الدعوات',
    'nav.reports': 'التقارير',
    'nav.users': 'المستخدمون',
    'nav.walkin': 'تسجيل حضوري',
    'nav.kiosk': 'كشك',
    'nav.logout': 'خروج',

    // Stats
    'stats.total': 'إجمالي الضيوف',
    'stats.checked_in': 'تم التسجيل',
    'stats.pending': 'قيد الانتظار',
    'stats.progress': 'التقدم',

    // Dashboard
    'dashboard.live_activity': 'النشاط المباشر',
    'dashboard.timeline': 'الجدول الزمني للتسجيل',
    'dashboard.waiting': 'في انتظار النشاط...',
    'dashboard.add_guest': 'إضافة ضيف',
    'dashboard.bulk_import': 'استيراد جماعي',
    'dashboard.guest_list': 'قائمة الضيوف',
    'dashboard.search': 'البحث عن ضيوف...',
    'dashboard.danger_zone': 'منطقة خطرة',
    'dashboard.clear_all': 'حذف جميع الضيوف',
    'dashboard.no_guests': 'لم يتم العثور على ضيوف',

    // Table headers
    'table.name': 'الاسم',
    'table.category': 'الفئة',
    'table.table': 'الطاولة',
    'table.dietary': 'حمية',
    'table.status': 'الحالة',
    'table.time': 'الوقت',
    'table.actions': 'إجراءات',

    // Buttons
    'btn.add_guest': 'إضافة ضيف',
    'btn.import': 'استيراد الأسماء',
    'btn.upload_csv': 'رفع CSV',
    'btn.download_tickets': 'تحميل تذاكر PDF',
    'btn.export_csv': 'تصدير CSV',
    'btn.check_in': 'تسجيل',
    'btn.edit': 'تعديل',
    'btn.ticket': 'تذكرة',
    'btn.save': 'حفظ التغييرات',
    'btn.broadcast': 'بث',

    // Form labels
    'form.guest_name': 'اسم الضيف *',
    'form.table_number': 'رقم الطاولة',
    'form.dietary': 'قيود غذائية',
    'form.phone': 'الهاتف',
    'form.email': 'البريد',
    'form.paste_names': 'الصق أسماء الضيوف، واحد في كل سطر...',
    'form.csv_hint': 'أو ارفع ملف CSV بالأعمدة: الاسم، الفئة، الحمية، الطاولة، الهاتف، البريد',

    // Status
    'status.checked_in': 'تم التسجيل',
    'status.pending_status': 'قيد الانتظار',

    // Event Details
    'event.info': 'معلومات الحدث',
    'event.name': 'اسم الحدث',
    'event.date': 'التاريخ',
    'event.time': 'الوقت',
    'event.venue': 'المكان',
    'event.edit': 'تعديل إعدادات الحدث',

    // Invitations
    'invite.title': 'دعوات البريد الإلكتروني',
    'invite.desc': 'إرسال دعوات بريد إلكتروني مع شارات PDF مرفقة لجميع الضيوف الذين لديهم عنوان بريد.',
    'invite.send_all': 'إرسال الدعوات للجميع',
    'invite.send_confirm': 'إرسال دعوات البريد الإلكتروني لجميع الضيوف الذين لديهم عناوين بريد؟',
    'invite.n8n_hint': 'سيؤدي هذا إلى تشغيل سير عمل n8n لإرسال بريد إلكتروني مخصص لكل ضيف مع شارة PDF.',
    'invite.not_configured': 'لم يتم تكوين webhook الخاص بـ n8n. أضف N8N_WEBHOOK_URL إلى متغيرات البيئة لتمكين الدعوات.',
    'invite.download': 'تحميل التذاكر',
    'invite.download_desc': 'تحميل جميع شارات الضيوف كملف PDF واحد للطباعة.',
    'invite.preview': 'معاينة الدعوة',
    'invite.preview_desc': 'هكذا تبدو دعوة البريد الإلكتروني لضيوفك:',
    'invite.cordially': 'أنتم مدعوون بكل ود',

    // Feedback
    'feedback.title': 'استبيان التقييم',
    'feedback.desc': 'إرسال نموذج التقييم لجميع الضيوف المسجلين الذين لديهم بريد إلكتروني.',
    'feedback.send': 'إرسال استبيان التقييم',
    'feedback.confirm': 'إرسال استبيان التقييم لجميع الضيوف المسجلين الذين لديهم عناوين بريد؟',

    // Reports
    'report.quick_stats': 'إحصائيات سريعة',
    'report.total': 'إجمالي المسجلين',
    'report.checked': 'تم التسجيل',
    'report.noshows': 'لم يحضروا',
    'report.rate': 'نسبة الحضور',
    'report.download': 'تحميل التقرير',
    'report.download_desc': 'إنشاء تقرير PDF شامل مع إحصائيات الحضور وتوزيع الفئات والجدول الزمني وقائمة الغياب.',
    'report.download_btn': 'تحميل تقرير ما بعد الحدث PDF',

    // Announcements
    'announce.title': 'بث إعلان',
    'announce.placeholder': 'اكتب رسالة الإعلان...',
    'announce.info': 'معلومات',
    'announce.success': 'نجاح',
    'announce.warning': 'تحذير',

    // Walk-in
    'walkin.title': 'تسجيل حضوري',
    'walkin.register': 'تسجيل وتحقق',
    'walkin.success': 'تم التسجيل والتحقق',
    'walkin.redirect': 'جارٍ إعادة التوجيه...',
    'walkin.table': 'رقم الطاولة (اختياري)',

    // Check-in page
    'checkin.invalid': 'رمز QR غير صالح',
    'checkin.invalid_msg': 'رمز QR هذا غير معروف. يرجى طلب المساعدة من أحد المتطوعين.',
    'checkin.already': 'تم التسجيل مسبقاً',
    'checkin.welcome': 'مرحباً،',
    'checkin.enjoy': 'تم تسجيلك. استمتع بالإفطار!',
    'checkin.family_enjoy': 'تم تسجيل جميع أفراد العائلة ({count}). استمتعوا بالإفطار!',
    'checkin.scan_count': 'عدد المسح:',

    // Users
    'users.title': 'إدارة المستخدمين',
    'users.create': 'إنشاء مستخدم جديد',
    'users.all': 'جميع المستخدمين',
    'users.username': 'اسم المستخدم',
    'users.password': 'كلمة المرور',
    'users.display_name': 'الاسم المعروض',
    'users.role': 'الدور',
    'users.status': 'الحالة',
    'users.last_login': 'آخر دخول',
    'users.active': 'نشط',
    'users.inactive': 'غير نشط',
    'users.activate': 'تفعيل',
    'users.deactivate': 'تعطيل',
    'users.you': 'أنت',

    // Categories
    'cat.guest': 'ضيف',
    'cat.student': 'طالب',
    'cat.parent': 'ولي أمر',
    'cat.teacher': 'معلم',
    'cat.vip': 'VIP',
    'cat.family': 'عائلة',

    // Login
    'login.title': 'تسجيل الإفطار',
    'login.subtitle': 'سجل الدخول للمتابعة',
    'login.username': 'اسم المستخدم',
    'login.password': 'كلمة المرور',
    'login.submit': 'تسجيل الدخول',

    // Misc
    'ramadan_kareem': 'رمضان كريم',
    'badge_attached': 'شارة PDF مرفقة',
    'confirm_delete_all': 'سيتم حذف جميع الضيوف. هل أنت متأكد؟',
  },
};

function t(lang, key) {
  const dict = translations[lang] || translations.en;
  return dict[key] || translations.en[key] || key;
}

module.exports = { t, translations };
