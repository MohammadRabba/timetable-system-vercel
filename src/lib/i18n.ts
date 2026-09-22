// Internationalization dictionary — Arabic (primary) + English (secondary)
// Arabic-first, RTL default

export type Lang = "ar" | "en";

export const AR_DAYS = ["SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI"] as const;
export type DayCode = typeof AR_DAYS[number];

export const DAY_LABELS: Record<Lang, Record<DayCode, string>> = {
  ar: {
    SAT: "السبت",
    SUN: "الأحد",
    MON: "الاثنين",
    TUE: "الثلاثاء",
    WED: "الأربعاء",
    THU: "الخميس",
    FRI: "الجمعة",
  },
  en: {
    SAT: "Sat",
    SUN: "Sun",
    MON: "Mon",
    TUE: "Tue",
    WED: "Wed",
    THU: "Thu",
    FRI: "Fri",
  },
};

type Dict = Record<string, { ar: string; en: string }>;

export const t: Dict = {
  appName: { ar: "نظام الجدول المدرسي", en: "School Timetable System" },
  appTagline: {
    ar: "إدارة وجدولة فصلية احترافية بمحرك قيود حقيقي",
    en: "Professional scheduling with a real constraint engine",
  },

  // Navigation
  nav_dashboard: { ar: "لوحة المعلومات", en: "Dashboard" },
  nav_school: { ar: "المدرسة", en: "School" },
  nav_academic: { ar: "الهيكل الأكاديمي", en: "Academic Structure" },
  nav_subjects: { ar: "المواد", en: "Subjects" },
  nav_teachers: { ar: "المعلمون", en: "Teachers" },
  nav_rooms: { ar: "القاعات", en: "Rooms" },
  nav_lessons: { ar: "الحصص", en: "Lessons" },
  nav_duties: { ar: "الإشغالات", en: "Duties" },
  nav_constraints: { ar: "القيود", en: "Constraints" },
  nav_schedule: { ar: "توليد الجدول", en: "Generate Timetable" },
  nav_timetable: { ar: "عرض الجدول", en: "Timetable Views" },
  nav_conflicts: { ar: "مركز التعارضات", en: "Conflict Center" },
  nav_reports: { ar: "التقارير", en: "Reports" },
  nav_excel: { ar: "تصدير Excel", en: "Excel Export" },
  nav_audit: { ar: "سجل التدقيق", en: "Audit Log" },
  nav_settings: { ar: "الإعدادات", en: "Settings" },

  // Common
  save: { ar: "حفظ", en: "Save" },
  cancel: { ar: "إلغاء", en: "Cancel" },
  delete: { ar: "حذف", en: "Delete" },
  edit: { ar: "تعديل", en: "Edit" },
  add: { ar: "إضافة", en: "Add" },
  search: { ar: "بحث", en: "Search" },
  filter: { ar: "تصفية", en: "Filter" },
  actions: { ar: "إجراءات", en: "Actions" },
  name: { ar: "الاسم", en: "Name" },
  code: { ar: "الرمز", en: "Code" },
  type: { ar: "النوع", en: "Type" },
  count: { ar: "العدد", en: "Count" },
  status: { ar: "الحالة", en: "Status" },
  created: { ar: "تاريخ الإنشاء", en: "Created" },
  noData: { ar: "لا توجد بيانات", en: "No data" },
  loading: { ar: "جارٍ التحميل…", en: "Loading…" },
  required: { ar: "مطلوب", en: "Required" },
  optional: { ar: "اختياري", en: "Optional" },
  confirm: { ar: "تأكيد", en: "Confirm" },
  yes: { ar: "نعم", en: "Yes" },
  no: { ar: "لا", en: "No" },
  close: { ar: "إغلاق", en: "Close" },
  print: { ar: "طباعة", en: "Print" },
  export: { ar: "تصدير", en: "Export" },
  import: { ar: "استيراد", en: "Import" },

  // Dashboard
  dashboard_title: { ar: "نظرة عامة على المدرسة", en: "School Overview" },
  teachers: { ar: "المعلمون", en: "Teachers" },
  classes: { ar: "الصفوف", en: "Classes" },
  subjects: { ar: "المواد", en: "Subjects" },
  rooms: { ar: "القاعات", en: "Rooms" },
  lessons: { ar: "الحصص", en: "Lessons" },
  scheduled: { ar: "مجدولة", en: "Scheduled" },
  conflicts: { ar: "التعارضات", en: "Conflicts" },
  workload_balance: { ar: "توازن النصاب", en: "Workload Balance" },
  seventh_balance: { ar: "توازن السابعة", en: "Seventh Balance" },
  quality: { ar: "جودة الجدول", en: "Timetable Quality" },
  recent_runs: { ar: "آخر عمليات التوليد", en: "Recent Scheduling Runs" },

  // School form
  school_name: { ar: "اسم المدرسة", en: "School Name" },
  principal: { ar: "مدير المدرسة", en: "Principal" },
  academicYear: { ar: "العام الدراسي", en: "Academic Year" },
  semester: { ar: "الفصل", en: "Semester" },
  workingDays: { ar: "أيام العمل", en: "Working Days" },
  periodsPerDay: { ar: "عدد الحصص/يوم", en: "Periods/Day" },
  periodDuration: { ar: "مدة الحصة (دقيقة)", en: "Period Duration (min)" },
  breakDuration: { ar: "مدة الاستراحة (دقيقة)", en: "Break Duration (min)" },
  startTime: { ar: "وقت البدء", en: "Start Time" },
  endTime: { ar: "وقت الانتهاء", en: "End Time" },

  // Schedule
  generate: { ar: "توليد الجدول", en: "Generate Timetable" },
  solver_mode: { ar: "وضع الحل", en: "Solver Mode" },
  fast: { ar: "سريع (10ث)", en: "Fast (10s)" },
  balanced: { ar: "متوازن (60ث)", en: "Balanced (60s)" },
  deep: { ar: "تحسين عميق (300ث)", en: "Deep (300s)" },
  validating: { ar: "التحقق من البيانات…", en: "Validating data…" },
  building: { ar: "بناء القيود…", en: "Building constraints…" },
  solving: { ar: "البحث عن حل…", en: "Finding solution…" },
  optimizing: { ar: "التحسين…", en: "Optimizing…" },
  saving: { ar: "حفظ الجدول…", en: "Saving timetable…" },
  pre_validation: { ar: "التحقق المسبق", en: "Pre-Solver Validation" },
  solver_output: { ar: "نتائج الحل", en: "Solver Output" },
  quality_score: { ar: "نقاط الجودة", en: "Quality Score" },
  solver_failed: { ar: "تعذر إيجاد جدول قابل للتطبيق", en: "No feasible timetable found" },
  suggestions: { ar: "اقتراحات", en: "Suggestions" },

  // Timetable
  school_view: { ar: "عرض المدرسة", en: "School View" },
  teacher_view: { ar: "عرض المعلم", en: "Teacher View" },
  class_view: { ar: "عرض الصف", en: "Class View" },
  room_view: { ar: "عرض القاعة", en: "Room View" },
  subject_view: { ar: "عرض المادة", en: "Subject View" },
  free: { ar: "فارغ", en: "Free" },
  rest: { ar: "راحة", en: "Rest" },
  duty: { ar: "إشغال", en: "Duty" },
  supervision: { ar: "إشراف", en: "Supervision" },
  reserve: { ar: "احتياط", en: "Reserve" },
  unavailable: { ar: "غير متاح", en: "Unavailable" },
  teaching: { ar: "تدريس", en: "Teaching" },
  locked: { ar: "مقفل", en: "Locked" },
  lock: { ar: "قفل", en: "Lock" },
  unlock: { ar: "إلغاء القفل", en: "Unlock" },
  swap: { ar: "تبديل", en: "Swap" },
  undo: { ar: "تراجع", en: "Undo" },
  redo: { ar: "إعادة", en: "Redo" },

  // Conflict center
  conflict_critical: { ar: "حرج", en: "Critical" },
  conflict_warning: { ar: "تحذير", en: "Warning" },
  conflict_optimization: { ar: "تحسين", en: "Optimization" },
  teacher_conflict: { ar: "تعارض معلم", en: "Teacher conflict" },
  class_conflict: { ar: "تعارض صف", en: "Class conflict" },
  room_conflict: { ar: "تعارض قاعة", en: "Room conflict" },
  no_conflicts: { ar: "لا توجد تعارضات", en: "No conflicts" },

  // Reports
  report_workload: { ar: "نصاب المعلمين", en: "Teacher Workload" },
  report_free: { ar: "الحصص الفارغة", en: "Free Periods" },
  report_duties: { ar: "الإشغالات", en: "Duties" },
  report_conflicts: { ar: "التعارضات", en: "Conflicts" },
  report_room: { ar: "استخدام القاعات", en: "Room Utilization" },
  report_quality: { ar: "مقاييس الجودة", en: "Quality Metrics" },

  // Auth
  login: { ar: "تسجيل الدخول", en: "Login" },
  logout: { ar: "تسجيل الخروج", en: "Logout" },
  email: { ar: "البريد الإلكتروني", en: "Email" },
  password: { ar: "كلمة المرور", en: "Password" },
  signIn: { ar: "دخول", en: "Sign In" },
  welcome: { ar: "مرحباً", en: "Welcome" },

  // Misc
  version: { ar: "إصدار", en: "Version" },
  restore: { ar: "استعادة", en: "Restore" },
  compare: { ar: "مقارنة", en: "Compare" },
  duplicate: { ar: "نسخ", en: "Duplicate" },
};

export function tr(key: keyof typeof t | string, lang: Lang): string {
  const entry = (t as Dict)[key as string];
  if (!entry) return key as string;
  return entry[lang];
}
