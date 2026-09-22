import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { parseDays, type DayCode } from "@/lib/scheduling/engine";
import ExcelJS from "exceljs";

// POST /api/excel/export { schoolId, versionId, scope } where scope is one of
// "school" | "teachers" | "classes" | "rooms" | "workload" | "conflicts" | "duties" | "free" | "all"
// Returns a streamed .xlsx file.
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await req.json();
  const schoolId = body.schoolId || s.schoolId;
  if (!schoolId) return NextResponse.json({ error: "NO_SCHOOL" }, { status: 400 });

  const school = await db.school.findUnique({ where: { id: schoolId } });
  if (!school) return NextResponse.json({ error: "SCHOOL_NOT_FOUND" }, { status: 404 });

  const days = parseDays(school.workingDays);
  const periodsPerDay = school.periodsPerDay;
  const rtl = school.rtl !== false;

  let versionId = body.versionId;
  if (!versionId) {
    const cur = await db.timetableVersion.findFirst({ where: { schoolId, isCurrent: true } });
    versionId = cur?.id || null;
  }
  const version = versionId ? await db.timetableVersion.findUnique({ where: { id: versionId } }) : null;
  const entries = versionId ? await db.timetableEntry.findMany({
    where: { versionId },
    include: { lesson: { include: { teacher: true, subject: true, section: true, room: true } }, duty: true, teacher: true, subject: true, section: true, room: true },
  }) : [];

  const teachers = await db.teacher.findMany({ where: { schoolId }, orderBy: { name: "asc" } });
  const sections = await db.section.findMany({ where: { schoolId, active: true }, orderBy: { name: "asc" } });
  const rooms = await db.room.findMany({ where: { schoolId }, orderBy: { name: "asc" } });
  const subjects = await db.subject.findMany({ where: { schoolId }, orderBy: { name: "asc" } });

  const wb = new ExcelJS.Workbook();
  wb.creator = school.name;
  wb.created = new Date();

  // Helper: build a sheet for a single entity (teacher/section/room)
  function buildSheet(name: string, dayPeriodFilter: (e: any) => any) {
    const ws = wb.addWorksheet(name, {
      views: rtl ? [{ rightToLeft: true }] : undefined,
      pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
    });
    ws.headerFooter.oddHeader = `&L${school.name}&R${school.principalName || ""}`;
    ws.headerFooter.oddFooter = `&CPage &P of &N`;

    // Title
    ws.addRow([name]);
    ws.addRow(["Academic Year", school.currentYear ? "2026/2027" : "—"]);
    ws.addRow([]);

    // Header row
    const header = ["Day", ...Array.from({ length: periodsPerDay }, (_, i) => `P${i + 1}`)];
    ws.addRow(header);
    ws.getRow(ws.rowCount).font = { bold: true };
    ws.getRow(ws.rowCount).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    ws.getRow(ws.rowCount).font = { bold: true, color: { argb: "FFFFFFFF" } };

    for (const d of days) {
      const row: any[] = [d];
      for (let p = 1; p <= periodsPerDay; p++) {
        const e = entries.find((x) => x.day === d && x.period === p && dayPeriodFilter(x));
        if (!e) {
          row.push("");
          continue;
        }
        let cell = "";
        if (e.cellType === "DUTY" || e.cellType === "SUPERVISION" || e.cellType === "RESERVE") {
          cell = `${e.cellType}`;
          if (e.duty) cell = `${e.duty.title}`;
        } else if (e.lesson) {
          cell = `${e.lesson.subject?.name || ""} | ${e.lesson.teacher?.name || ""} | ${e.lesson.room?.name || ""}`;
        }
        row.push(cell);
      }
      ws.addRow(row);
    }
    ws.columns.forEach((c) => { c.width = 32; });
    ws.getColumn(1).width = 12;
    return ws;
  }

  const scope: string = body.scope || "all";

  if (scope === "school" || scope === "all") {
    // One master sheet with all sections side-by-side is too wide — instead, build a sheet per section (handled below),
    // and a summary sheet here.
    const ws = wb.addWorksheet("School Overview", {
      views: rtl ? [{ rightToLeft: true }] : undefined,
      pageSetup: { orientation: "landscape" },
    });
    ws.addRow([school.name]);
    ws.addRow([`Principal: ${school.principalName || "—"}`]);
    ws.addRow([`Academic Year: 2026/2027`]);
    ws.addRow([`Teachers: ${teachers.length}  Classes: ${sections.length}  Subjects: ${subjects.length}  Rooms: ${rooms.length}`]);
    ws.addRow([]);
    ws.addRow([`Version: ${version?.version || "—"} (${version?.name || ""})`]);
    if (version?.statistics) {
      try {
        const st = JSON.parse(version.statistics);
        ws.addRow([`Quality: ${st.qualityScore ?? "—"}/100`]);
        ws.addRow([`Placed: ${st.placed} Unplaced: ${st.unplaced} Gaps: ${st.teacherGaps}`]);
      } catch {}
    }
    ws.addRow([]);
    ws.addRow(["Sections covered:"]);
    for (const sec of sections) ws.addRow(["", `${sec.name} (${sec.code})`]);
    ws.columns.forEach((c) => { c.width = 32; });
  }

  if (scope === "teachers" || scope === "all") {
    for (const t of teachers) {
      const sheetName = `T-${t.employeeNumber}`.slice(0, 28);
      buildSheet(`Teacher ${t.name}`.slice(0, 31), (e) => e.teacherId === t.id);
    }
  }

  if (scope === "classes" || scope === "all") {
    for (const sec of sections) {
      const sheetName = `C-${sec.code}`.slice(0, 28);
      buildSheet(`Class ${sec.name}`.slice(0, 31), (e) => e.sectionId === sec.id);
    }
  }

  if (scope === "rooms" || scope === "all") {
    for (const r of rooms) {
      buildSheet(`Room ${r.name}`.slice(0, 31), (e) => e.roomId === r.id);
    }
  }

  if (scope === "workload" || scope === "all") {
    const ws = wb.addWorksheet("Workload Report", { views: rtl ? [{ rightToLeft: true }] : undefined });
    ws.addRow(["Teacher", "Required", "Teaching", "Duties", "Reserve", "Total", "Remaining", "Seventh", "Days Off"]);
    ws.getRow(ws.rowCount).font = { bold: true };
    const dayOffs = await db.teacherDayOff.groupBy({
      by: ["teacherId"],
      where: { teacher: { schoolId } },
      _count: true,
    });
    const dom: Record<string, number> = {};
    for (const d of dayOffs) dom[d.teacherId] = d._count;
    for (const t of teachers) {
      const teaching = entries.filter((e) => e.teacherId === t.id && e.cellType === "TEACHING").length;
      const duties = entries.filter((e) => e.teacherId === t.id && ["DUTY", "SUPERVISION"].includes(e.cellType)).length;
      const reserve = entries.filter((e) => e.teacherId === t.id && e.cellType === "RESERVE").length;
      const seventh = entries.filter((e) => e.teacherId === t.id && e.cellType === "TEACHING" && e.period === periodsPerDay).length;
      const total = teaching + duties + reserve;
      ws.addRow([t.name, t.requiredWorkload, teaching, duties, reserve, total, Math.max(0, t.requiredWorkload - total), seventh, dom[t.id] || 0]);
    }
    ws.columns.forEach((c) => { c.width = 18; });
  }

  if (scope === "duties" || scope === "all") {
    const ws = wb.addWorksheet("Duties", { views: rtl ? [{ rightToLeft: true }] : undefined });
    ws.addRow(["Teacher", "Type", "Title", "Day", "Period", "Location"]);
    ws.getRow(ws.rowCount).font = { bold: true };
    const dutyEntries = entries.filter((e) => ["DUTY", "SUPERVISION", "RESERVE"].includes(e.cellType));
    for (const e of dutyEntries) {
      const teacherName = e.teacher?.name || "";
      ws.addRow([
        teacherName,
        e.duty?.type || e.cellType,
        e.duty?.title || "",
        e.day,
        e.period,
        e.duty?.location || "",
      ]);
    }
    ws.columns.forEach((c) => { c.width = 22; });
  }

  if (scope === "free" || scope === "all") {
    const ws = wb.addWorksheet("Free Periods", { views: rtl ? [{ rightToLeft: true }] : undefined });
    ws.addRow(["Teacher", "Free Count", "Free Slots"]);
    ws.getRow(ws.rowCount).font = { bold: true };
    for (const t of teachers) {
      const slots: string[] = [];
      for (const d of days) {
        for (let p = 1; p <= periodsPerDay; p++) {
          const e = entries.find((x) => x.teacherId === t.id && x.day === d && x.period === p);
          if (!e) slots.push(`${d}-P${p}`);
        }
      }
      ws.addRow([t.name, slots.length, slots.join(", ")]);
    }
    ws.columns.forEach((c) => { c.width = 22; });
  }

  if (scope === "conflicts" || scope === "all") {
    const ws = wb.addWorksheet("Conflicts", { views: rtl ? [{ rightToLeft: true }] : undefined });
    ws.addRow(["Type", "Day", "Period", "Message", "Entity IDs"]);
    ws.getRow(ws.rowCount).font = { bold: true };
    // Detect conflicts (same as /api/reports/conflicts)
    const teacherMap: Record<string, any[]> = {};
    const classMap: Record<string, any[]> = {};
    const roomMap: Record<string, any[]> = {};
    for (const e of entries) {
      const k1 = `${e.day}_${e.period}_${e.teacherId}`;
      (teacherMap[k1] = teacherMap[k1] || []).push(e);
      const k2 = `${e.day}_${e.period}_${e.sectionId}`;
      (classMap[k2] = classMap[k2] || []).push(e);
      if (e.roomId) {
        const k3 = `${e.day}_${e.period}_${e.roomId}`;
        (roomMap[k3] = roomMap[k3] || []).push(e);
      }
    }
    for (const [k, list] of Object.entries(teacherMap)) {
      if (list.length > 1) {
        const [day, period] = k.split("_");
        ws.addRow(["TEACHER", day, period, `Teacher ${list[0].teacherId || "—"} double-booked`, list.map((l) => l.id).join(", ")]);
      }
    }
    for (const [k, list] of Object.entries(classMap)) {
      if (list.length > 1) {
        const [day, period] = k.split("_");
        ws.addRow(["CLASS", day, period, `Class ${list[0].sectionId || "—"} double-booked`, list.map((l) => l.id).join(", ")]);
      }
    }
    for (const [k, list] of Object.entries(roomMap)) {
      if (list.length > 1) {
        const [day, period] = k.split("_");
        ws.addRow(["ROOM", day, period, `Room ${list[0].roomId} double-booked`, list.map((l) => l.id).join(", ")]);
      }
    }
    ws.columns.forEach((c) => { c.width = 30; });
  }

  // Stream file
  const buf = await wb.xlsx.writeBuffer();
  // Use ASCII-only filename in Content-Disposition (Arabic in headers breaks ByteString)
  const fname = `timetable_${scope}_v${version?.version || "draft"}.xlsx`;
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
