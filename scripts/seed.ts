// Seed script — creates a realistic demo school with 30 teachers, 15 classes,
// 12 subjects, 18 rooms, 180 weekly lessons (= 540 weekly occurrences),
// 60 duties and the default hard+soft constraint set.
//
// Feasibility budget (must hold for OR-Tools CP-SAT to schedule 540/540):
//   - School: 5 working days × 8 periods/day = 40 slots/section.
//   - Per-section lesson load: 5+4+5+4+3+3+2+2+3+2+2+1 = 36 ≤ 40. ✓
//   - Per-teacher load: 4 working days (1 day off) × 8 = 32 slots, max load ≤ 29. ✓
//   - Lab/practical/sport/activity rooms: roomId=null so the solver
//     enumerates ALL compatible rooms (avoiding single-room overload).
//
// Run with: bun run /home/z/my-project/scripts/seed.ts

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth";

const db = new PrismaClient();

const ARABIC_NAMES = {
  teachers: [
    "محمد أحمد", "فاطمة علي", "خالد حسن", "نورا سعيد", "يوسف إبراهيم",
    "مريم عبد الله", "عبد الرحمن محمد", "سارة خالد", "أحمد يوسف", "هند ناصر",
    "عمر فاروق", "ليلى أحمد", "حسن إبراهيم", "زينب محمد", "كريم وليد",
    "رنا سامي", "طارق عادل", "دعاء محمود", "أنس عماد", "آلة منير",
    "بسمة وليد", "زيد ماهر", "رغد فادي", "وسيم لطفي", "إيمان رياض",
    "بلال حافظ", "ميس قصي", "سلمى نزار", "حديث نضال", "وليد رشاد",
  ],
  subjects: [
    { name: "اللغة العربية", code: "AR", type: "THEORY", weekly: 5, color: "#0ea5e9" },
    { name: "اللغة الإنجليزية", code: "EN", type: "THEORY", weekly: 4, color: "#16a34a" },
    { name: "الرياضيات", code: "MA", type: "THEORY", weekly: 5, color: "#dc2626" },
    { name: "الفيزياء", code: "PH", type: "THEORY", weekly: 4, color: "#9333ea" },
    { name: "الكيمياء", code: "CH", type: "LABORATORY", weekly: 3, color: "#ea580c" },
    { name: "الأحياء", code: "BI", type: "LABORATORY", weekly: 3, color: "#22c55e" },
    { name: "التاريخ", code: "HI", type: "THEORY", weekly: 2, color: "#a16207" },
    { name: "الجغرافيا", code: "GE", type: "THEORY", weekly: 2, color: "#0891b2" },
    { name: "التربية الإسلامية", code: "IS", type: "THEORY", weekly: 3, color: "#0f766e" },
    { name: "الحاسوب", code: "CS", type: "PRACTICAL", weekly: 2, color: "#1e3a8a" },
    { name: "التربية الرياضية", code: "PE", type: "SPORT", weekly: 2, color: "#facc15" },
    { name: "التربية الفنية", code: "AR2", type: "ACTIVITY", weekly: 1, color: "#f472b6" },
  ],
  grades: [
    { stage: "Secondary", name: "الصف العاشر", order: 10 },
    { stage: "Secondary", name: "الصف الحادي عشر", order: 11 },
    { stage: "Secondary", name: "الصف الثاني عشر", order: 12 },
  ],
  rooms: [
    { name: "غرفة 101", code: "R101", type: "CLASSROOM", capacity: 30 },
    { name: "غرفة 102", code: "R102", type: "CLASSROOM", capacity: 30 },
    { name: "غرفة 103", code: "R103", type: "CLASSROOM", capacity: 35 },
    { name: "غرفة 104", code: "R104", type: "CLASSROOM", capacity: 30 },
    { name: "غرفة 105", code: "R105", type: "CLASSROOM", capacity: 35 },
    { name: "غرفة 201", code: "R201", type: "CLASSROOM", capacity: 30 },
    { name: "غرفة 202", code: "R202", type: "CLASSROOM", capacity: 30 },
    { name: "غرفة 203", code: "R203", type: "CLASSROOM", capacity: 35 },
    { name: "غرفة 204", code: "R204", type: "CLASSROOM", capacity: 30 },
    { name: "غرفة 205", code: "R205", type: "CLASSROOM", capacity: 30 },
    // Five additional classrooms (R301..R305) — one home room per section
    // (15 sections vs 10 base classrooms would otherwise force two sections
    // to share a room, making the room-conflict hard constraint infeasible
    // since each section needs 25 theory slots in its home room).
    { name: "غرفة 301", code: "R301", type: "CLASSROOM", capacity: 30 },
    { name: "غرفة 302", code: "R302", type: "CLASSROOM", capacity: 30 },
    { name: "غرفة 303", code: "R303", type: "CLASSROOM", capacity: 30 },
    { name: "غرفة 304", code: "R304", type: "CLASSROOM", capacity: 30 },
    { name: "غرفة 305", code: "R305", type: "CLASSROOM", capacity: 30 },
    { name: "مختبر الكيمياء", code: "LAB-CHEM", type: "LABORATORY", capacity: 30 },
    { name: "مختبر الفيزياء", code: "LAB-PHY", type: "LABORATORY", capacity: 30 },
    { name: "مختبر الأحياء", code: "LAB-BIO", type: "LABORATORY", capacity: 30 },
    { name: "مختبر الحاسوب 1", code: "LAB-CS1", type: "COMPUTER_LAB", capacity: 30 },
    { name: "مختبر الحاسوب 2", code: "LAB-CS2", type: "COMPUTER_LAB", capacity: 30 },
    { name: "قاعة الرياضية", code: "GYM", type: "SPORTS_HALL", capacity: 100 },
    { name: "قاعة الفنون", code: "ART", type: "ACTIVITY_ROOM", capacity: 30 },
    { name: "قاعة الكبار", code: "AUD", type: "AUDITORIUM", capacity: 200 },
  ],
  sections: [
    { name: "10-أ", code: "10A", grade: 10, branch: null as string | null, students: 28 },
    { name: "10-ب", code: "10B", grade: 10, branch: null, students: 27 },
    { name: "10-ج", code: "10C", grade: 10, branch: null, students: 29 },
    { name: "10-د", code: "10D", grade: 10, branch: null, students: 26 },
    { name: "10-هـ", code: "10E", grade: 10, branch: null, students: 28 },
    { name: "11-علمي-أ", code: "11SA", grade: 11, branch: "Scientific", students: 25 },
    { name: "11-علمي-ب", code: "11SB", grade: 11, branch: "Scientific", students: 24 },
    { name: "11-أدبي-أ", code: "11LA", grade: 11, branch: "Literary", students: 27 },
    { name: "11-أدبي-ب", code: "11LB", grade: 11, branch: "Literary", students: 26 },
    { name: "12-علمي-أ", code: "12SA", grade: 12, branch: "Scientific", students: 22 },
    { name: "12-علمي-ب", code: "12SB", grade: 12, branch: "Scientific", students: 23 },
    { name: "12-أدبي-أ", code: "12LA", grade: 12, branch: "Literary", students: 25 },
    { name: "12-أدبي-ب", code: "12LB", grade: 12, branch: "Literary", students: 24 },
    { name: "12-أدبي-ج", code: "12LC", grade: 12, branch: "Literary", students: 26 },
    { name: "12-أدبي-د", code: "12LD", grade: 12, branch: "Literary", students: 23 },
  ],
};

async function seed() {
  console.log("🌱 Starting seed...");

  // Ensure super admin exists
  const adminEmail = "admin@school.tt";
  let admin = await db.user.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    const pwHash = await hashPassword("admin123");
    let org = await db.organization.findFirst();
    if (!org) org = await db.organization.create({ data: { name: "Ministry of Education", code: "MOE" } });
    admin = await db.user.create({
      data: { email: adminEmail, name: "Super Admin", passwordHash: pwHash, role: "SUPER_ADMIN", organizationId: org.id },
    });
    console.log("✓ Created super admin (admin@school.tt / admin123)");
  }

  // Create demo school
  let school = await db.school.findFirst({ where: { name: "مدرسة النجاح الثانوية" } });
  if (!school) {
    const org = await db.organization.findFirst();
    school = await db.school.create({
      data: {
        organizationId: org!.id,
        name: "مدرسة النجاح الثانوية",
        principalName: "أحمد علي",
        address: "شارع الملك فهد، الرياض",
        phone: "+966 11 234 5678",
        email: "info@najah.tt",
        workingDays: "SUN,MON,TUE,WED,THU",
        periodsPerDay: 8,
        periodDuration: 45,
        breakDuration: 15,
        startTime: "07:30",
        endTime: "14:30",
        currentSemester: "First",
        rtl: true,
      },
    });
    console.log("✓ Created school:", school.name);
  }

  // Academic year
  let year = await db.academicYear.findFirst({ where: { schoolId: school.id } });
  if (!year) {
    year = await db.academicYear.create({
      data: {
        schoolId: school.id,
        name: "2026/2027",
        startDate: new Date("2026-09-01"),
        endDate: new Date("2027-06-30"),
        semesters: "First,Second",
        active: true,
      },
    });
    await db.school.update({ where: { id: school.id }, data: { currentYearId: year.id } });
    console.log("✓ Created academic year");
  }

  // Periods — 8 teaching periods/day. Period 7 retains the historical
  // "Seventh" label/type (used by the SOFT_SEVENTH_EQUAL objective); period 8
  // is a regular teaching period that gives the section capacity headroom.
  if ((await db.period.count({ where: { schoolId: school.id } })) === 0) {
    for (let i = 1; i <= 8; i++) {
      await db.period.create({
        data: {
          schoolId: school.id,
          yearId: year.id,
          order: i,
          label: i === 7 ? `Period ${i} (Seventh)` : `Period ${i}`,
          startTime: "07:30",
          endTime: "08:15",
          type: i === 7 ? "SEVENTH" : "TEACHING",
          isBreak: false,
        },
      });
    }
    console.log("✓ Created 8 periods (1..8, period 7 = Seventh)");
  }

  // Grades
  const grades: Record<number, string> = {};
  for (const g of ARABIC_NAMES.grades) {
    let grade = await db.grade.findFirst({ where: { schoolId: school.id, name: g.name } });
    if (!grade) {
      grade = await db.grade.create({ data: { schoolId: school.id, stage: g.stage, name: g.name, order: g.order } });
    }
    grades[g.order] = grade.id;
  }
  console.log("✓ Grades ready");

  // Branches (unique names within school)
  const branchSci = await db.branch.upsert({
    where: { schoolId_name: { schoolId: school.id, name: "علمي 11" } },
    create: { schoolId: school.id, gradeId: grades[11], name: "علمي 11" },
    update: {},
  });
  const branchSci12 = await db.branch.upsert({
    where: { schoolId_name: { schoolId: school.id, name: "علمي 12" } },
    create: { schoolId: school.id, gradeId: grades[12], name: "علمي 12" },
    update: {},
  });
  const branchLit11 = await db.branch.upsert({
    where: { schoolId_name: { schoolId: school.id, name: "أدبي 11" } },
    create: { schoolId: school.id, gradeId: grades[11], name: "أدبي 11" },
    update: {},
  });
  const branchLit12 = await db.branch.upsert({
    where: { schoolId_name: { schoolId: school.id, name: "أدبي 12" } },
    create: { schoolId: school.id, gradeId: grades[12], name: "أدبي 12" },
    update: {},
  });
  console.log("✓ Branches ready");

  // Rooms
  const rooms: Record<string, string> = {};
  for (const r of ARABIC_NAMES.rooms) {
    let room = await db.room.findFirst({ where: { schoolId: school.id, code: r.code } });
    if (!room) {
      room = await db.room.create({
        data: { schoolId: school.id, name: r.name, code: r.code, type: r.type, capacity: r.capacity },
      });
    }
    rooms[r.code] = room.id;
  }
  console.log("✓ Rooms ready:", Object.keys(rooms).length);

  // Subjects
  const subjects: Record<string, string> = {};
  for (const s of ARABIC_NAMES.subjects) {
    let sub = await db.subject.findFirst({ where: { schoolId: school.id, code: s.code } });
    if (!sub) {
      sub = await db.subject.create({
        data: {
          schoolId: school.id,
          name: s.name,
          code: s.code,
          type: s.type,
          defaultWeekly: s.weekly,
          maxPerDay: 2,
          minGap: 0,
          consecutive: false,
          preferredPeriods: "",
          forbiddenPeriods: "",
          requiredRoomType:
            s.type === "LABORATORY" ? "LABORATORY" :
            s.type === "PRACTICAL" ? "COMPUTER_LAB" :
            s.type === "SPORT" ? "SPORTS_HALL" :
            s.type === "ACTIVITY" ? "ACTIVITY_ROOM" : null,
          priority: 100,
          color: s.color,
        },
      });
    }
    subjects[s.code] = sub.id;
  }
  console.log("✓ Subjects ready:", Object.keys(subjects).length);

  // Sections
  const sections: Record<string, string> = {};
  for (const sec of ARABIC_NAMES.sections) {
    let s = await db.section.findFirst({ where: { schoolId: school.id, code: sec.code } });
    if (!s) {
      const gradeId = grades[sec.grade];
      const branchId =
        sec.branch === "Scientific" && sec.grade === 11 ? branchSci.id :
        sec.branch === "Scientific" && sec.grade === 12 ? branchSci12.id :
        sec.branch === "Literary" && sec.grade === 11 ? branchLit11.id :
        sec.branch === "Literary" && sec.grade === 12 ? branchLit12.id : null;
      // One unique home classroom per section (15 sections ↔ 15 classrooms).
      // Sharing a classroom between two sections would force 50 theory
      // lessons into 40 weekly room-slots — a hard room-conflict violation.
      const classroomRoomCodes = [
        "R101", "R102", "R103", "R104", "R105",
        "R201", "R202", "R203", "R204", "R205",
        "R301", "R302", "R303", "R304", "R305",
      ];
      const classroomRoomCode = classroomRoomCodes[Object.keys(sections).length % classroomRoomCodes.length];
      s = await db.section.create({
        data: {
          schoolId: school.id,
          yearId: year.id,
          gradeId,
          branchId,
          name: sec.name,
          code: sec.code,
          studentCount: sec.students,
          roomId: rooms[classroomRoomCode],
          active: true,
        },
      });
    }
    sections[sec.code] = s.id;
  }
  console.log("✓ Sections ready:", Object.keys(sections).length);

  // Teachers
  const teachers: string[] = [];
  for (let i = 0; i < ARABIC_NAMES.teachers.length; i++) {
    const name = ARABIC_NAMES.teachers[i];
    const empNo = `T${String(i + 1).padStart(3, "0")}`;
    let t = await db.teacher.findFirst({ where: { schoolId: school.id, employeeNumber: empNo } });
    if (!t) {
      t = await db.teacher.create({
        data: {
          schoolId: school.id,
          name,
          employeeNumber: empNo,
          specialization: ["Mathematics", "Science", "Languages", "Social Studies", "Islamic Studies", "Computer Science"][i % 6],
          email: `${empNo.toLowerCase()}@najah.tt`,
          phone: `+9665${String(i + 1).padStart(8, "0")}`,
          status: "ACTIVE",
          requiredWorkload: 24,
          maxDailyPeriods: 7,
          minDailyPeriods: 0,
          requiredSeventh: 0,
          maxSeventh: 3,
        },
      });
    }
    teachers.push(t.id);
  }
  console.log("✓ Teachers ready:", teachers.length);

  // Teacher-Subject assignments
  const subjectCodes = Object.keys(subjects);
  for (let i = 0; i < teachers.length; i++) {
    const tId = teachers[i];
    const subj1 = subjects[subjectCodes[i % subjectCodes.length]];
    const subj2 = subjects[subjectCodes[(i + 1) % subjectCodes.length]];
    await db.teacherSubject.upsert({
      where: { teacherId_subjectId: { teacherId: tId, subjectId: subj1 } },
      create: { teacherId: tId, subjectId: subj1, priority: 0 },
      update: {},
    });
    if (subj1 !== subj2) {
      await db.teacherSubject.upsert({
        where: { teacherId_subjectId: { teacherId: tId, subjectId: subj2 } },
        create: { teacherId: tId, subjectId: subj2, priority: 0 },
        update: {},
      });
    }
  }
  console.log("✓ Teacher-subject assignments ready");

  // Teacher-Section assignments
  const sectionCodes = Object.keys(sections);
  for (const secCode of sectionCodes) {
    const secId = sections[secCode];
    const assignedTeachers = teachers.slice(0, 5);
    for (const tId of assignedTeachers) {
      await db.teacherSection.upsert({
        where: { teacherId_sectionId: { teacherId: tId, sectionId: secId } },
        create: { teacherId: tId, sectionId: secId },
        update: {},
      }).catch(() => null);
    }
  }
  console.log("✓ Teacher-section assignments ready");

  // Teacher availability
  const days = ["SUN", "MON", "TUE", "WED", "THU"];
  for (let i = 0; i < teachers.length; i++) {
    const tId = teachers[i];
    const dayOff = days[i % 5];
    await db.teacherDayOff.upsert({
      where: { teacherId_day: { teacherId: tId, day: dayOff } },
      create: { teacherId: tId, day: dayOff },
      update: {},
    });
    for (const d of days) {
      if (d === dayOff) continue;
      await db.teacherAvailability.upsert({
        where: { teacherId_day_period: { teacherId: tId, day: d, period: 1 } },
        create: { teacherId: tId, day: d, period: 1, state: "PREFERRED" },
        update: {},
      });
    }
  }
  console.log("✓ Teacher availability ready");

  // Lessons — distribute each subject's lessons across multiple teachers
  // to balance the workload. For each (subject, section), pick the next teacher
  // in round-robin fashion from the list of teachers who can teach this subject.
  let lessonCount = 0;

  // subjectId -> [teacherId, ...] teachers who can teach it
  const subjectTeachers: Record<string, string[]> = {};
  for (const sc of Object.keys(subjects)) {
    const subjId = subjects[sc];
    const tss = await db.teacherSubject.findMany({
      where: { subjectId: subjId, teacher: { schoolId: school.id } },
      select: { teacherId: true },
    });
    subjectTeachers[subjId] = tss.map((t) => t.teacherId);
  }
  const subjPointer: Record<string, number> = {};
  for (const k of Object.keys(subjectTeachers)) subjPointer[k] = 0;

  for (const secCode of sectionCodes) {
    const secId = sections[secCode];
    for (const s of ARABIC_NAMES.subjects) {
      const subjId = subjects[s.code];
      const candidates = subjectTeachers[subjId] || [];
      if (candidates.length === 0) continue;
      const idx = subjPointer[subjId] % candidates.length;
      const tId = candidates[idx];
      subjPointer[subjId]++;

      // roomId intentionally left NULL for lab/practical/sport/activity
      // lessons. The OR-Tools model enumerates ALL compatible rooms of the
      // subject.requiredRoomType — pinning every Chemistry/Biology lesson
      // to a single lab would make the room-conflict hard constraint
      // mathematically infeasible (90 occurrences > 35 slots in one room).
      // Theory lessons use the section's home room (also left NULL here so
      // the model can pick the section's assigned classroom).
      const roomId: string | null = null;

      const exists = await db.lesson.findFirst({
        where: { schoolId: school.id, teacherId: tId, subjectId: subjId, sectionId: secId },
      });
      if (exists) continue;

      await db.lesson.create({
        data: {
          schoolId: school.id,
          yearId: year.id,
          teacherId: tId,
          subjectId: subjId,
          sectionId: secId,
          roomId,
          weeklyOccurrences: s.weekly,
          duration: 1,
          lessonType: s.type,
          priority: 100,
          requiredConsecutive: 0,
          preferredSlots: "",
          forbiddenSlots: "",
          fixed: false,
          locked: false,
        },
      });
      lessonCount++;
    }
  }
  console.log("✓ Lessons created:", lessonCount);

  // Duties
  const dutyTitles = [
    { title: "ساحة الصباح", type: "SUPERVISION" },
    { title: "إشراف الفسحة", type: "SUPERVISION" },
    { title: "إشغال المخبر", type: "DUTY" },
    { title: "احتياط", type: "RESERVE" },
    { title: "إشراف البوابة", type: "SUPERVISION" },
  ];
  for (let i = 0; i < teachers.length; i++) {
    const tId = teachers[i];
    for (let j = 0; j < 2; j++) {
      const duty = dutyTitles[(i + j) % dutyTitles.length];
      const day = days[i % 5];
      const period = (j + 1) * 2;
      await db.duty.create({
        data: {
          schoolId: school.id,
          teacherId: tId,
          type: duty.type,
          title: duty.title,
          day,
          period,
          location: "School",
        },
      }).catch(() => null);
    }
  }
  console.log("✓ Duties created");

  // Demo user accounts
  const seedAccounts = [
    { email: "scheduler@najah.tt", name: "Scheduler", role: "SCHEDULER" as const },
    { email: "viewer@najah.tt", name: "Viewer", role: "VIEWER" as const },
    { email: "schooladmin@najah.tt", name: "School Admin", role: "SCHOOL_ADMIN" as const },
  ];
  for (const a of seedAccounts) {
    const existing = await db.user.findUnique({ where: { email: a.email } });
    if (!existing) {
      const pwHash = await hashPassword("demo123");
      await db.user.create({
        data: { email: a.email, name: a.name, passwordHash: pwHash, role: a.role, schoolId: school.id, organizationId: school.organizationId },
      });
    }
  }
  console.log("✓ Demo user accounts created");

  console.log("\n✅ Seed complete! Total lessons:", lessonCount);
  console.log("Login: admin@school.tt / admin123");
}

seed()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
