"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useState } from "react";
import { Play, AlertTriangle, CheckCircle2, Loader2, Gauge, Clock, MemoryStick, Activity } from "lucide-react";

type Mode = "FAST" | "BALANCED" | "DEEP";

export function SchedulePane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const setPane = useAppStore((s) => s.setPane);
  const setActiveVersionId = useAppStore((s) => s.setActiveVersionId);
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("BALANCED");
  const [allowPartial, setAllowPartial] = useState(true);
  const [provider, setProvider] = useState<"ortools" | "typescript" | undefined>(undefined);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [validation, setValidation] = useState<any | null>(null);

  const { data: runsData } = useQuery({
    queryKey: ["runs", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/scheduling/runs?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const runs = runsData?.runs || [];

  const validate = useMutation({
    mutationFn: async () => {
      setValidation(null);
      const r = await fetch("/api/scheduling/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId: activeSchoolId }),
      });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.error || "Validation failed");
      }
      return r.json();
    },
    onSuccess: (data) => {
      setValidation(data);
      if (data.canSchedule) {
        toast.success(lang === "ar" ? "كل البيانات صالحة" : "Data is valid");
      } else {
        toast.error(lang === "ar" ? `وجد ${data.failures.length} مشكلة` : `Found ${data.failures.length} issues`);
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const generate = useMutation({
    mutationFn: async () => {
      setResult(null);
      setProgress(0);
      setPhase(tr("validating", lang));
      setRunning(true);
      const phases = [
        { phase: tr("validating", lang), percent: 10, delay: 200 },
        { phase: tr("building", lang), percent: 25, delay: 300 },
        { phase: tr("solving", lang), percent: 50, delay: 800 },
        { phase: tr("optimizing", lang), percent: 80, delay: 400 },
        { phase: tr("saving", lang), percent: 95, delay: 200 },
      ];
      for (const p of phases) {
        setPhase(p.phase);
        setProgress(p.percent);
        await new Promise((r) => setTimeout(r, p.delay));
      }
      const r = await fetch("/api/scheduling/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId: activeSchoolId, mode, allowPartial, provider }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Generation failed");
      setProgress(100);
      setPhase("Completed");
      return j;
    },
    onSuccess: (data) => {
      setRunning(false);
      setResult(data);
      if (data.feasible) {
        toast.success(lang === "ar" ? `تم توليد الجدول! الجودة: ${data.qualityScore}%` : `Timetable generated! Quality: ${data.qualityScore}%`);
      } else if (data.partial) {
        toast.warning(lang === "ar" ? `جدول جزئي. الجودة: ${data.qualityScore}%` : `Partial timetable. Quality: ${data.qualityScore}%`);
      } else {
        toast.error(lang === "ar" ? `لا يمكن التوليد. الحالة: ${data.status}` : `Infeasible. Status: ${data.status}`);
      }
      setActiveVersionId(data.versionId);
      qc.invalidateQueries({ queryKey: ["runs", activeSchoolId] });
      qc.invalidateQueries({ queryKey: ["dashboard", activeSchoolId] });
      qc.invalidateQueries({ queryKey: ["versions", activeSchoolId] });
    },
    onError: (e: any) => {
      setRunning(false);
      toast.error(e.message);
    },
  });

  const statusColor = (s: string) => {
    if (s === "OPTIMAL" || s === "FEASIBLE") return "default";
    if (s === "INFEASIBLE" || s === "MODEL_INVALID") return "destructive";
    return "secondary";
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <h1 className="text-2xl font-bold">{tr("generate", lang)}</h1>

      {/* Validate + Generate */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Gauge className="w-4 h-4" /> {tr("nav_schedule", lang)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs mb-1 block">{tr("solver_mode", lang)}</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FAST">{tr("fast", lang)}</SelectItem>
                  <SelectItem value="BALANCED">{tr("balanced", lang)}</SelectItem>
                  <SelectItem value="DEEP">{tr("deep", lang)}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">{lang === "ar" ? "المحرك" : "Provider"}</Label>
              <Select value={provider || "ortools"} onValueChange={(v: any) => setProvider(v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ortools">OR-Tools CP-SAT (production)</SelectItem>
                  <SelectItem value="typescript">TypeScript fallback</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between p-2 border border-slate-200 dark:border-slate-800 rounded">
              <div>
                <Label className="text-xs">{lang === "ar" ? "حل جزئي مسموح" : "Allow partial"}</Label>
                <div className="text-[10px] text-slate-500">
                  {lang === "ar" ? "إذا تعذّر الإكمال، يُعاد حل جزئي" : "If infeasible, return best partial"}
                </div>
              </div>
              <Switch checked={allowPartial} onCheckedChange={setAllowPartial} />
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => validate.mutate()} disabled={validate.isPending || !activeSchoolId}>
              {validate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {tr("pre_validation", lang)}
            </Button>
            <Button onClick={() => generate.mutate()} disabled={generate.isPending || !activeSchoolId}>
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {tr("generate", lang)}
            </Button>
          </div>

          {running && (
            <div className="space-y-2">
              <div className="text-sm text-slate-500">{phase}…</div>
              <Progress value={progress} />
            </div>
          )}

          {validation && (
            <div className="border border-slate-200 dark:border-slate-800 rounded p-3 space-y-2 text-sm">
              <div className="flex items-center gap-2 font-medium">
                {validation.canSchedule ? (
                  <><CheckCircle2 className="w-4 h-4 text-emerald-500" /> {lang === "ar" ? "يمكن الجدولة" : "Can schedule"}</>
                ) : (
                  <><AlertTriangle className="w-4 h-4 text-amber-500" /> {validation.failures.length} {lang === "ar" ? "مشكلة" : "issue(s)"}</>
                )}
                {validation.schedulerReachable && <Badge variant="secondary" className="ms-2">OR-Tools online</Badge>}
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Stat label={tr("teachers", lang)} value={validation.stats?.teachers} />
                <Stat label={tr("classes", lang)} value={validation.stats?.sections} />
                <Stat label={tr("subjects", lang)} value={validation.stats?.subjects} />
                <Stat label={tr("rooms", lang)} value={validation.stats?.rooms} />
                <Stat label={tr("lessons", lang)} value={validation.stats?.lessons} />
                <Stat label={tr("nav_duties", lang)} value={validation.stats?.duties} />
              </div>
              {validation.failures?.length > 0 && (
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  <div className="text-xs font-medium">{lang === "ar" ? "أسباب الفشل:" : "Failures:"}</div>
                  {validation.failures.slice(0, 8).map((f: any, i: number) => (
                    <div key={i} className="text-xs text-red-600 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded p-2">
                      <div className="font-mono">{f.scope}{f.entityId ? `:${f.entityId.slice(-4)}` : ""}</div>
                      <div>{f.reason}</div>
                      <div className="text-slate-500 mt-1">→ {f.suggestion}</div>
                    </div>
                  ))}
                  {validation.failures.length > 8 && (
                    <div className="text-xs text-slate-500">+ {validation.failures.length - 8} more</div>
                  )}
                </div>
              )}
            </div>
          )}

          {result && (
            <div className={`border rounded p-4 space-y-3 text-sm ${
              result.feasible ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950"
              : result.partial ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950"
              : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950"
            }`}>
              <div className="flex items-center gap-2 font-medium flex-wrap">
                {result.feasible ? (
                  <><CheckCircle2 className="w-4 h-4 text-emerald-500" /> {lang === "ar" ? "تم بنجاح" : "Success"}</>
                ) : result.partial ? (
                  <><AlertTriangle className="w-4 h-4 text-amber-500" /> {lang === "ar" ? "جدول جزئي" : "PARTIAL TIMETABLE"}</>
                ) : (
                  <><AlertTriangle className="w-4 h-4 text-red-500" /> {lang === "ar" ? "غير ممكن" : "INFEASIBLE"}</>
                )}
                <Badge variant={statusColor(result.status)}>{result.status}</Badge>
                {result.partial && <Badge variant="destructive">{lang === "ar" ? "جدول غير مكتمل" : "NOT COMPLETE"}</Badge>}
                <Badge variant="secondary">{tr("version", lang)} #{result.version}</Badge>
                <Badge variant="default">{tr("quality", lang)}: {result.qualityScore}%</Badge>
                {result.provider && <Badge variant="outline">{result.provider}</Badge>}
              </div>

              {/* Strict success criteria panel */}
              <div className="border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900 p-3 font-mono text-xs">
                <div className="font-sans font-medium mb-2">Solver Status</div>
                <div>------------------------------------------------</div>
                <div>{result.status}</div>
                <div>&nbsp;</div>
                <div>{tr("required", lang) || "Required:"} {result.requiredOccurrences}</div>
                <div>{tr("scheduled", lang) || "Scheduled:"} {result.scheduledOccurrences}</div>
                <div>{lang === "ar" ? "غير مجدول:" : "Unscheduled:"} {result.unscheduledOccurrences}</div>
                <div>&nbsp;</div>
                <div>{lang === "ar" ? "تعارضات صلبة:" : "Hard conflicts:"} {result.hardViolations}</div>
                <div>{lang === "ar" ? "العقوبة الناعمة:" : "Soft penalty:"} {result.softPenalty}</div>
                <div>{lang === "ar" ? "التحسين:" : "Optimization:"} {result.qualityScore}%</div>
                {result.objectiveValue !== null && result.objectiveValue !== undefined && (
                  <div>{lang === "ar" ? "قيمة الهدف:" : "Objective:"} {result.objectiveValue}</div>
                )}
              </div>

              {/* Timing */}
              {result.timing && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <TimingStat icon={Activity} label={lang === "ar" ? "بناء النموذج" : "Model build"} ms={result.timing.modelGenerationMs} />
                  <TimingStat icon={Clock} label={lang === "ar" ? "الحل" : "Solver"} ms={result.timing.solverMs} />
                  <TimingStat icon={Activity} label={lang === "ar" ? "الإجمالي" : "Wall"} ms={result.timing.wallMs} />
                  <TimingStat icon={MemoryStick} label={lang === "ar" ? "الذاكرة" : "Memory"} mb={result.timing.memoryMb} />
                </div>
              )}

              {/* Stats grid */}
              {result.stats && (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-2 text-xs">
                  <Stat label={tr("teachers", lang) + " " + (lang === "ar" ? "تعارض" : "conflicts")} value={result.stats.teacherConflicts} />
                  <Stat label={tr("classes", lang) + " " + (lang === "ar" ? "تعارض" : "conflicts")} value={result.stats.classConflicts} />
                  <Stat label={tr("rooms", lang) + " " + (lang === "ar" ? "تعارض" : "conflicts")} value={result.stats.roomConflicts} />
                  <Stat label={lang === "ar" ? "توفر" : "Avail. violations"} value={result.stats.availabilityViolations} />
                  <Stat label={lang === "ar" ? "إشغالات" : "Duty conflicts"} value={result.stats.dutyConflicts} />
                  <Stat label={lang === "ar" ? "ثابتة" : "Fixed violations"} value={result.stats.fixedLessonViolations} />
                  <Stat label={lang === "ar" ? "سعة" : "Capacity violations"} value={result.stats.capacityViolations} />
                  <Stat label={lang === "ar" ? "فجوات" : "Teacher gaps"} value={result.stats.teacherGaps} />
                  <Stat label={lang === "ar" ? "انحراف السابعة" : "7th dev."} value={result.stats.seventhDeviation} />
                  <Stat label={lang === "ar" ? "تكدس" : "Cluster"} value={result.stats.subjectCluster} />
                  <Stat label={lang === "ar" ? "انحراف النصاب" : "WL dev."} value={result.stats.workloadDeviation} />
                  <Stat label={lang === "ar" ? "حصص غير مرغوبة" : "Unwanted"} value={result.stats.unwantedSlots} />
                </div>
              )}

              {result.partial && (
                <div className="border border-amber-300 dark:border-amber-800 bg-amber-100 dark:bg-amber-950 rounded p-2 text-xs font-medium">
                  {lang === "ar"
                    ? `هذا الجدول غير مكتمل. تم جدولة ${result.scheduledOccurrences} من أصل ${result.requiredOccurrences}.`
                    : `This timetable is NOT complete. Scheduled ${result.scheduledOccurrences} of ${result.requiredOccurrences}.`}
                </div>
              )}

              {!result.feasible && !result.partial && result.failures?.length > 0 && (
                <div className="border border-red-300 dark:border-red-800 bg-red-100 dark:bg-red-950 rounded p-2 text-xs">
                  <div className="font-medium mb-1">{lang === "ar" ? "الأسباب الرئيسية:" : "Primary problems:"}</div>
                  <ol className="list-decimal ms-4 space-y-1">
                    {result.failures.slice(0, 5).map((f: any, i: number) => (
                      <li key={i}>{f.reason}</li>
                    ))}
                  </ol>
                  {result.failures.length > 5 && (
                    <div className="text-slate-500 mt-1">+ {result.failures.length - 5} more</div>
                  )}
                </div>
              )}

              {result.suggestions?.length > 0 && (
                <div className="mt-2 text-xs">
                  <div className="font-medium">{tr("suggestions", lang)}:</div>
                  {result.suggestions.map((s: string, i: number) => (
                    <div key={i} className="text-slate-600 dark:text-slate-300 mt-1">→ {s}</div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 mt-3 flex-wrap">
                {result.feasible || result.partial ? (
                  <Button size="sm" onClick={() => setPane("timetable")}>{tr("nav_timetable", lang)} →</Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => setPane("conflicts")}>
                  {tr("nav_conflicts", lang)} ({result.conflicts?.length || 0})
                </Button>
                {result.feasible || result.partial ? (
                  <Button size="sm" variant="outline" onClick={() => setPane("reports")}>{tr("nav_reports", lang)} →</Button>
                ) : null}
                {result.feasible || result.partial ? (
                  <Button size="sm" variant="outline" onClick={() => setPane("excel")}>{tr("nav_excel", lang)} →</Button>
                ) : null}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent runs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tr("recent_runs", lang)}</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <div className="text-sm text-slate-500">{tr("noData", lang)}</div>
          ) : (
            <div className="space-y-1">
              {runs.slice(0, 10).map((r: any) => (
                <div key={r.id} className="flex items-center justify-between text-xs border-b border-slate-100 dark:border-slate-800 py-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{r.mode}</Badge>
                    <Badge variant={r.status === "COMPLETED" ? "default" : r.status === "FAILED" ? "destructive" : "secondary"}>{r.status}</Badge>
                    {r.solverStatus && <Badge variant="outline" className="text-[10px]">{r.solverStatus}</Badge>}
                    {r.version && <span className="text-slate-500">{tr("version", lang)} #{r.version.version}</span>}
                  </div>
                  <div className="flex items-center gap-2 text-slate-500">
                    {r.progress && <span>{r.progress}%</span>}
                    <span>{new Date(r.startedAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded p-1.5">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-sm font-bold">{value ?? "—"}</div>
    </div>
  );
}

function TimingStat({ icon: Icon, label, ms, mb }: { icon: any; label: string; ms?: number; mb?: number | null }) {
  const val = ms !== undefined ? `${ms} ms` : mb !== undefined && mb !== null ? `${mb} MB` : "—";
  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded p-1.5">
      <div className="text-[10px] text-slate-500 flex items-center gap-1"><Icon className="w-3 h-3" /> {label}</div>
      <div className="text-sm font-bold">{val}</div>
    </div>
  );
}
