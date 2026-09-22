"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useState, useEffect } from "react";

export function SchoolPane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const setActiveSchoolId = useAppStore((s) => s.setActiveSchoolId);
  const qc = useQueryClient();

  const { data: listData } = useQuery({
    queryKey: ["schools"],
    queryFn: async () => {
      const r = await fetch("/api/schools", { cache: "no-store" });
      return r.json();
    },
  });

  const schools = listData?.schools || [];

  // Auto-select first school if none selected
  useEffect(() => {
    if (!activeSchoolId && schools.length > 0) {
      setActiveSchoolId(schools[0].id);
    }
  }, [schools, activeSchoolId, setActiveSchoolId]);

  const { data: schoolData } = useQuery({
    queryKey: ["school", activeSchoolId],
    queryFn: async () => {
      if (!activeSchoolId) return null;
      const r = await fetch(`/api/schools/${activeSchoolId}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });

  const school = schoolData?.school;
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    if (school) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        name: school.name || "",
        principalName: school.principalName || "",
        address: school.address || "",
        phone: school.phone || "",
        email: school.email || "",
        workingDays: school.workingDays || "SUN,MON,TUE,WED,THU",
        periodsPerDay: school.periodsPerDay || 7,
        periodDuration: school.periodDuration || 45,
        breakDuration: school.breakDuration || 15,
        startTime: school.startTime || "07:30",
        endTime: school.endTime || "14:00",
        currentSemester: school.currentSemester || "First",
        rtl: school.rtl ?? true,
      });
    }
  }, [school]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/schools/${activeSchoolId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error("Save failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم الحفظ" : "Saved");
      qc.invalidateQueries({ queryKey: ["school", activeSchoolId] });
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.error || "Create failed");
      }
      return r.json();
    },
    onSuccess: (data) => {
      setActiveSchoolId(data.school.id);
      toast.success(lang === "ar" ? "تم إنشاء المدرسة" : "School created");
      qc.invalidateQueries({ queryKey: ["schools"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const dayOptions = [
    { code: "SAT", ar: "السبت", en: "Saturday" },
    { code: "SUN", ar: "الأحد", en: "Sunday" },
    { code: "MON", ar: "الاثنين", en: "Monday" },
    { code: "TUE", ar: "الثلاثاء", en: "Tuesday" },
    { code: "WED", ar: "الأربعاء", en: "Wednesday" },
    { code: "THU", ar: "الخميس", en: "Thursday" },
    { code: "FRI", ar: "الجمعة", en: "Friday" },
  ];
  const toggleDay = (code: string) => {
    const arr = (form.workingDays || "").split(",").filter(Boolean);
    const idx = arr.indexOf(code);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(code);
    setForm({ ...form, workingDays: arr.join(",") });
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{tr("nav_school", lang)}</h1>
        <div className="flex items-center gap-2">
          {schools.length > 0 && (
            <Select value={activeSchoolId || undefined} onValueChange={setActiveSchoolId}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Select school" /></SelectTrigger>
              <SelectContent>
                {schools.map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setForm({
                name: "", principalName: "", address: "", phone: "", email: "",
                workingDays: "SUN,MON,TUE,WED,THU", periodsPerDay: 7,
                periodDuration: 45, breakDuration: 15, startTime: "07:30",
                endTime: "14:00", currentSemester: "First", rtl: true,
              });
              setActiveSchoolId(null);
            }}
          >
            {tr("add", lang)}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{activeSchoolId ? tr("edit", lang) : tr("add", lang)} {tr("nav_school", lang)}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <Field label={tr("school_name", lang)}>
            <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={tr("principal", lang)}>
            <Input value={form.principalName || ""} onChange={(e) => setForm({ ...form, principalName: e.target.value })} />
          </Field>
          <Field label={tr("academicYear", lang)}>
            <Input defaultValue="2026/2027" disabled />
          </Field>
          <Field label={tr("semester", lang)}>
            <Select value={form.currentSemester} onValueChange={(v) => setForm({ ...form, currentSemester: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="First">{lang === "ar" ? "الأول" : "First"}</SelectItem>
                <SelectItem value="Second">{lang === "ar" ? "الثاني" : "Second"}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={tr("workingDays", lang)}>
            <div className="flex flex-wrap gap-1">
              {dayOptions.map((d) => {
                const arr = (form.workingDays || "").split(",");
                const on = arr.includes(d.code);
                return (
                  <button
                    key={d.code}
                    type="button"
                    onClick={() => toggleDay(d.code)}
                    className={`px-2 py-1 rounded text-xs border ${on ? "bg-slate-900 text-white border-slate-900" : "bg-white dark:bg-slate-900 border-slate-200"}`}
                  >
                    {lang === "ar" ? d.ar : d.en}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label={tr("periodsPerDay", lang)}>
            <Input type="number" min={1} max={10} value={form.periodsPerDay || 7} onChange={(e) => setForm({ ...form, periodsPerDay: Number(e.target.value) })} />
          </Field>
          <Field label={tr("periodDuration", lang)}>
            <Input type="number" value={form.periodDuration || 45} onChange={(e) => setForm({ ...form, periodDuration: Number(e.target.value) })} />
          </Field>
          <Field label={tr("breakDuration", lang)}>
            <Input type="number" value={form.breakDuration || 15} onChange={(e) => setForm({ ...form, breakDuration: Number(e.target.value) })} />
          </Field>
          <Field label={tr("startTime", lang)}>
            <Input type="time" value={form.startTime || "07:30"} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
          </Field>
          <Field label={tr("endTime", lang)}>
            <Input type="time" value={form.endTime || "14:00"} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
          </Field>
          <Field label={tr("email", lang)}>
            <Input value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label={tr("status", lang)}>
            <div className="flex items-center gap-2 h-10">
              <Switch checked={form.rtl} onCheckedChange={(c) => setForm({ ...form, rtl: c })} />
              <span className="text-sm">RTL / {tr("status", lang)}</span>
            </div>
          </Field>
          <Field label="العنوان / Address">
            <Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label="الهاتف / Phone">
            <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        {activeSchoolId ? (
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "..." : tr("save", lang)}
          </Button>
        ) : (
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.name}>
            {createMutation.isPending ? "..." : tr("add", lang)}
          </Button>
        )}
      </div>

      {school && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{lang === "ar" ? "نظرة عامة" : "Quick Stats"}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label={tr("teachers", lang)} value={school._count?.teachers ?? 0} />
            <Stat label={tr("classes", lang)} value={school._count?.sections ?? 0} />
            <Stat label={tr("subjects", lang)} value={school._count?.subjects ?? 0} />
            <Stat label={tr("rooms", lang)} value={school._count?.rooms ?? 0} />
            <Stat label={tr("lessons", lang)} value={school._count?.lessons ?? 0} />
            <Stat label={tr("nav_duties", lang)} value={school._count?.duties ?? 0} />
            <Stat label={tr("nav_constraints", lang)} value={school._count?.constraints ?? 0} />
            <Stat label={tr("periodsPerDay", lang)} value={school.periodsPerDay} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-slate-500 mb-1 block">{label}</Label>
      {children}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}
