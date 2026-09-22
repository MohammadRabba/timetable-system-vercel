"use client";
import { useQuery } from "@tanstack/react-query";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Users, GraduationCap, BookOpen, DoorOpen, CalendarDays, AlertTriangle, Gauge, Calendar } from "lucide-react";

export function DashboardPane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const setPane = useAppStore((s) => s.setPane);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/dashboard${activeSchoolId ? `?schoolId=${activeSchoolId}` : ""}`, { cache: "no-store" });
      return r.json();
    },
  });

  if (isLoading || !data) {
    return <div className="p-6 text-slate-500">{tr("loading", lang)}</div>;
  }

  const s = data.stats || {};
  const school = data.school;
  const cur = data.currentVersion;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">{school?.name || tr("dashboard_title", lang)}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {school?.principalName && `${tr("principal", lang)}: ${school.principalName}`}
            {school?.currentSemester && ` · ${tr("semester", lang)}: ${school.currentSemester}`}
            {school && ` · ${tr("academicYear", lang)}: 2026/2027`}
          </p>
        </div>
        {cur && (
          <Badge variant="secondary" className="text-sm">
            {tr("version", lang)} #{cur.version} · {cur.name}
          </Badge>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard icon={Users} label={tr("teachers", lang)} value={s.teachers ?? 0} onClick={() => setPane("teachers")} />
        <StatCard icon={GraduationCap} label={tr("classes", lang)} value={s.classes ?? 0} onClick={() => setPane("academic")} />
        <StatCard icon={BookOpen} label={tr("subjects", lang)} value={s.subjects ?? 0} onClick={() => setPane("subjects")} />
        <StatCard icon={DoorOpen} label={tr("rooms", lang)} value={s.rooms ?? 0} onClick={() => setPane("rooms")} />
        <StatCard icon={CalendarDays} label={tr("lessons", lang)} value={s.lessons ?? 0} onClick={() => setPane("lessons")} />
        <StatCard icon={AlertTriangle} label={tr("conflicts", lang)} value={s.conflicts ?? 0} onClick={() => setPane("conflicts")} alert={(s.conflicts ?? 0) > 0} />
      </div>

      {/* Quality & balance */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gauge className="w-4 h-4" /> {tr("quality", lang)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{s.qualityScore ?? 0}%</div>
            <Progress value={s.qualityScore ?? 0} className="mt-2" />
            <div className="text-xs text-slate-500 mt-2">
              {tr("scheduled", lang)}: {s.scheduled ?? 0} / {s.lessons ?? 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{tr("workload_balance", lang)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {s.lessons && s.teachers ? Math.round((s.scheduled / Math.max(1, s.lessons)) * 100) : 0}%
            </div>
            <Progress value={s.lessons ? (s.scheduled / Math.max(1, s.lessons)) * 100 : 0} className="mt-2" />
            <div className="text-xs text-slate-500 mt-2">
              {s.teachers ?? 0} {tr("teachers", lang)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4" /> {tr("recent_runs", lang)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 max-h-40 overflow-y-auto">
            {(data.recentRuns || []).length === 0 && (
              <div className="text-xs text-slate-500">{tr("noData", lang)}</div>
            )}
            {(data.recentRuns || []).slice(0, 5).map((r: any) => (
              <div key={r.id} className="text-xs flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 py-1">
                <span className="font-mono">{r.mode}</span>
                <Badge variant={r.status === "COMPLETED" ? "default" : r.status === "FAILED" ? "destructive" : "secondary"}>
                  {r.status}
                </Badge>
                {r.qualityScore != null && <span className="text-slate-500">{r.qualityScore}%</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Quick action: Generate timetable */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tr("nav_schedule", lang)}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500 mb-3">
            {lang === "ar"
              ? "اضغط زر توليد الجدول لإنشاء جدول مدرسي كامل باستخدام محرك القيود. سيتم تطبيق القيود الصلبة أولاً ثم تحسين الجودة."
              : "Click Generate to create a complete school timetable using the constraint engine. Hard constraints are enforced first, then quality is optimized."}
          </p>
          <button
            onClick={() => setPane("schedule")}
            className="text-sm px-4 py-2 rounded-md bg-slate-900 text-white hover:bg-slate-700"
          >
            {tr("generate", lang)} →
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, alert, onClick }: { icon: any; label: string; value: number; alert?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-start rounded-lg border p-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 ${alert ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950" : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"}`}
    >
      <div className="flex items-center justify-between mb-2">
        <Icon className={`w-5 h-5 ${alert ? "text-red-600" : "text-slate-500"}`} />
        {alert && value > 0 && <Badge variant="destructive" className="text-[10px]">{value}</Badge>}
      </div>
      <div className={`text-2xl font-bold ${alert ? "text-red-700 dark:text-red-300" : ""}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </button>
  );
}
