"use client";
import { AppShell } from "@/components/app-shell";
import { useAppStore } from "@/lib/store";
import { DashboardPane } from "@/components/panes/dashboard-pane";
import { SchoolPane } from "@/components/panes/school-pane";
import { AcademicPane } from "@/components/panes/academic-pane";
import { SubjectsPane } from "@/components/panes/subjects-pane";
import { TeachersPane } from "@/components/panes/teachers-pane";
import { RoomsPane } from "@/components/panes/rooms-pane";
import { LessonsPane } from "@/components/panes/lessons-pane";
import { DutiesPane } from "@/components/panes/duties-pane";
import { ConstraintsPane } from "@/components/panes/constraints-pane";
import { SchedulePane } from "@/components/panes/schedule-pane";
import { TimetablePane } from "@/components/panes/timetable-pane";
import { ConflictsPane } from "@/components/panes/conflicts-pane";
import { ReportsPane } from "@/components/panes/reports-pane";
import { ExcelPane } from "@/components/panes/excel-pane";
import { AuditPane } from "@/components/panes/audit-pane";
import { SettingsPane } from "@/components/panes/settings-pane";

export default function Home() {
  const pane = useAppStore((s) => s.pane);

  return (
    <AppShell>
      {pane === "dashboard" && <DashboardPane />}
      {pane === "school" && <SchoolPane />}
      {pane === "academic" && <AcademicPane />}
      {pane === "subjects" && <SubjectsPane />}
      {pane === "teachers" && <TeachersPane />}
      {pane === "rooms" && <RoomsPane />}
      {pane === "lessons" && <LessonsPane />}
      {pane === "duties" && <DutiesPane />}
      {pane === "constraints" && <ConstraintsPane />}
      {pane === "schedule" && <SchedulePane />}
      {pane === "timetable" && <TimetablePane />}
      {pane === "conflicts" && <ConflictsPane />}
      {pane === "reports" && <ReportsPane />}
      {pane === "excel" && <ExcelPane />}
      {pane === "audit" && <AuditPane />}
      {pane === "settings" && <SettingsPane />}
    </AppShell>
  );
}
