"use client";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useState } from "react";
import { Download, Loader2, FileSpreadsheet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

const SCOPES = [
  { code: "all", label_ar: "الكل (شامل)", label_en: "All (complete)" },
  { code: "school", label_ar: "نظرة المدرسة", label_en: "School overview" },
  { code: "teachers", label_ar: "جداول المعلمين", label_en: "Teachers' timetables" },
  { code: "classes", label_ar: "جداول الصفوف", label_en: "Classes' timetables" },
  { code: "rooms", label_ar: "جداول القاعات", label_en: "Rooms' timetables" },
  { code: "workload", label_ar: "نصاب المعلمين", label_en: "Teacher workload" },
  { code: "duties", label_ar: "الإشغالات", label_en: "Duties" },
  { code: "free", label_ar: "الحصص الفارغة", label_en: "Free periods" },
  { code: "conflicts", label_ar: "التعارضات", label_en: "Conflicts" },
];

export function ExcelPane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const activeVersionId = useAppStore((s) => s.activeVersionId);
  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState(false);

  const { data: versionsData } = useQuery({
    queryKey: ["versions", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/timetable/versions?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const versions = versionsData?.versions || [];

  const handleExport = async () => {
    if (!activeSchoolId) {
      toast.error(lang === "ar" ? "اختر مدرسة" : "Select a school");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/excel/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId: activeSchoolId,
          versionId: activeVersionId,
          scope,
        }),
      });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.error || "Export failed");
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g, "") || "timetable.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(lang === "ar" ? "تم التصدير" : "Exported");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <FileSpreadsheet className="w-6 h-6" /> {tr("nav_excel", lang)}
      </h1>

      <Card>
        <CardHeader><CardTitle className="text-base">{lang === "ar" ? "خيارات التصدير" : "Export Options"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">{tr("version", lang)}</Label>
            <Select value={activeVersionId || undefined} onValueChange={(v) => useAppStore.getState().setActiveVersionId(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{versions.map((v: any) => <SelectItem key={v.id} value={v.id}>v#{v.version}{v.isCurrent ? " (current)" : ""}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs mb-1 block">{lang === "ar" ? "نطاق التصدير" : "Scope"}</Label>
            <div className="space-y-2">
              {SCOPES.map((s) => (
                <label key={s.code} className="flex items-center gap-2 cursor-pointer p-2 rounded border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <input
                    type="radio"
                    name="scope"
                    value={s.code}
                    checked={scope === s.code}
                    onChange={() => setScope(s.code)}
                  />
                  <span className="text-sm">{lang === "ar" ? s.label_ar : s.label_en}</span>
                  <Badge variant="outline" className="ms-auto text-[10px]">{s.code}</Badge>
                </label>
              ))}
            </div>
          </div>
          <Button onClick={handleExport} disabled={busy || !activeSchoolId || !activeVersionId}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {tr("export", lang)} .xlsx
          </Button>
          {!activeVersionId && (
            <div className="text-xs text-amber-600">
              {lang === "ar" ? "لا يوجد إصدار جدول. ولّد جدولاً أولاً." : "No timetable version. Generate one first."}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">{lang === "ar" ? "ما الذي سيتم تصديره:" : "What will be exported:"}</CardTitle></CardHeader>
        <CardContent>
          <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
            <li>• {lang === "ar" ? "نظرة عامة على المدرسة مع إحصائيات الإصدار" : "School overview sheet with version statistics"}</li>
            <li>• {lang === "ar" ? "ورقة لكل معلم تعرض جدوله الأسبوعي" : "One sheet per teacher with weekly grid"}</li>
            <li>• {lang === "ar" ? "ورقة لكل صف تعرض جدوله الأسبوعي" : "One sheet per class with weekly grid"}</li>
            <li>• {lang === "ar" ? "ورقة لكل قاعة تعرض استخدامها" : "One sheet per room with usage"}</li>
            <li>• {lang === "ar" ? "تقرير النصاب الكامل للمعلمين" : "Complete teacher workload report"}</li>
            <li>• {lang === "ar" ? "تقرير الإشغالات والتعارضات والحصص الفارغة" : "Duties, conflicts, and free-period reports"}</li>
            <li>• {lang === "ar" ? "RTL وتنسيق احترافي مع ترويسة المدرسة وأرقام الصفحات" : "RTL formatting with school header and page numbers"}</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
