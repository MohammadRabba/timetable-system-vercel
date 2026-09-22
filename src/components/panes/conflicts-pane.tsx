"use client";
import { useQuery } from "@tanstack/react-query";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Info, AlertCircle } from "lucide-react";
import { useAppStore as _ } from "@/lib/store";

export function ConflictsPane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const activeVersionId = useAppStore((s) => s.activeVersionId);
  const setPane = useAppStore((s) => s.setPane);

  const { data, isLoading } = useQuery({
    queryKey: ["conflicts", activeVersionId],
    queryFn: async () => {
      if (!activeSchoolId) return { conflicts: [] };
      const p = new URLSearchParams();
      if (activeVersionId) p.set("versionId", activeVersionId);
      const r = await fetch(`/api/reports/conflicts?${p}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });

  const conflicts: any[] = data?.conflicts || [];
  const critical = conflicts.filter((c) => c.severity === "CRITICAL");
  const warnings = conflicts.filter((c) => c.severity === "WARNING");
  const optimizations = conflicts.filter((c) => c.severity === "OPTIMIZATION");

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">{tr("nav_conflicts", lang)}</h1>

      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={AlertTriangle} label={tr("conflict_critical", lang)} value={critical.length} color="text-red-600" />
        <StatCard icon={AlertCircle} label={tr("conflict_warning", lang)} value={warnings.length} color="text-amber-600" />
        <StatCard icon={Info} label={tr("conflict_optimization", lang)} value={optimizations.length} color="text-blue-600" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tr("conflict_critical", lang)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {critical.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="w-4 h-4" /> {tr("no_conflicts", lang)}
            </div>
          )}
          {critical.map((c, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950"
            >
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">{c.type}</Badge>
                  <span className="text-sm">{c.message}</span>
                </div>
                <div className="text-xs text-slate-500 mt-1">{c.day} P{c.period}</div>
              </div>
              <button
                onClick={() => setPane("timetable")}
                className="text-xs text-blue-600 hover:underline"
              >
                {lang === "ar" ? "انتقل" : "Go to"} →
              </button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{tr("conflict_warning", lang)}</CardTitle></CardHeader>
        <CardContent>
          {warnings.length === 0 ? (
            <div className="text-sm text-slate-500">{tr("no_conflicts", lang)}</div>
          ) : (
            <div className="space-y-2">
              {warnings.map((c, i) => (
                <div key={i} className="text-sm p-2 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950">
                  <Badge variant="secondary" className="me-2">{c.type}</Badge>
                  <span>{c.message}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color?: string }) {
  return (
    <div className="rounded border border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900">
      <Icon className={`w-5 h-5 mb-2 ${color || "text-slate-500"}`} />
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
