"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useState } from "react";
import { Plus, Trash2, Pencil, X, Lock } from "lucide-react";

export function LessonsPane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [filterSection, setFilterSection] = useState("");
  const [filterTeacher, setFilterTeacher] = useState("");
  const [form, setForm] = useState<any>({
    teacherId: "", subjectId: "", sectionId: "", roomId: "",
    weeklyOccurrences: 3, duration: 1, lessonType: "THEORY", priority: 100,
    requiredConsecutive: 0, preferredSlots: "", forbiddenSlots: "",
    fixed: false, fixedDay: "", fixedPeriod: "", locked: false,
  });

  const { data: lessonsData } = useQuery({
    queryKey: ["lessons", activeSchoolId, filterSection, filterTeacher],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (activeSchoolId) p.set("schoolId", activeSchoolId);
      if (filterSection) p.set("sectionId", filterSection);
      if (filterTeacher) p.set("teacherId", filterTeacher);
      const r = await fetch(`/api/lessons?${p}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const { data: teachersData } = useQuery({
    queryKey: ["teachers", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/teachers?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const { data: subjectsData } = useQuery({
    queryKey: ["subjects", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/subjects?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const { data: sectionsData } = useQuery({
    queryKey: ["sections", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/sections?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const { data: roomsData } = useQuery({
    queryKey: ["rooms", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/rooms?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });

  const lessons = lessonsData?.lessons || [];
  const teachers = teachersData?.teachers || [];
  const subjects = subjectsData?.subjects || [];
  const sections = sectionsData?.sections || [];
  const rooms = roomsData?.rooms || [];

  const save = useMutation({
    mutationFn: async () => {
      const url = editing ? `/api/lessons/${editing.id}` : "/api/lessons";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, schoolId: activeSchoolId }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم الحفظ" : "Saved");
      setShowForm(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["lessons", activeSchoolId] });
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/lessons/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lessons", activeSchoolId] }),
  });

  const totalWeekly = lessons.reduce((s: number, l: any) => s + l.weeklyOccurrences, 0);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {tr("nav_lessons", lang)} ({lessons.length} · {totalWeekly} {lang === "ar" ? "حصة أسبوعية" : "weekly"})
        </h1>
        <div className="flex gap-2 items-center">
          <Select value={filterSection} onValueChange={setFilterSection}>
            <SelectTrigger className="w-40"><SelectValue placeholder={tr("classes", lang)} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">{tr("classes", lang)} (all)</SelectItem>
              {sections.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterTeacher} onValueChange={setFilterTeacher}>
            <SelectTrigger className="w-40"><SelectValue placeholder={tr("teachers", lang)} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">{tr("teachers", lang)} (all)</SelectItem>
              {teachers.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => { setShowForm(true); setEditing(null); }}>
            <Plus className="w-4 h-4" /> {tr("add", lang)}
          </Button>
        </div>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label={tr("nav_teachers", lang)}>
              <Select value={form.teacherId} onValueChange={(v) => setForm({ ...form, teacherId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{teachers.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={tr("nav_subjects", lang)}>
              <Select value={form.subjectId} onValueChange={(v) => setForm({ ...form, subjectId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{subjects.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={tr("classes", lang)}>
              <Select value={form.sectionId} onValueChange={(v) => setForm({ ...form, sectionId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{sections.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={tr("rooms", lang)}>
              <Select value={form.roomId || "_"} onValueChange={(v) => setForm({ ...form, roomId: v === "_" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_">{lang === "ar" ? "تلقائي" : "Auto"}</SelectItem>
                  {rooms.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <FieldNum label={lang === "ar" ? "أسبوعية" : "Weekly"} value={form.weeklyOccurrences} onChange={(v) => setForm({ ...form, weeklyOccurrences: v })} />
            <FieldNum label={lang === "ar" ? "مدة" : "Duration"} value={form.duration} onChange={(v) => setForm({ ...form, duration: v })} />
            <FieldNum label={lang === "ar" ? "أولوية" : "Priority"} value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} />
            <Field label={tr("type", lang)}>
              <Select value={form.lessonType} onValueChange={(v) => setForm({ ...form, lessonType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="THEORY">Theory</SelectItem>
                  <SelectItem value="PRACTICAL">Practical</SelectItem>
                  <SelectItem value="LABORATORY">Laboratory</SelectItem>
                  <SelectItem value="SPORT">Sport</SelectItem>
                  <SelectItem value="ACTIVITY">Activity</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-end gap-2">
              <Switch checked={form.fixed} onCheckedChange={(c) => setForm({ ...form, fixed: c })} />
              <Label className="text-xs">{lang === "ar" ? "مثبتة" : "Fixed"}</Label>
            </div>
            {form.fixed && (
              <>
                <Field label={lang === "ar" ? "اليوم" : "Day"}>
                  <Select value={form.fixedDay} onValueChange={(v) => setForm({ ...form, fixedDay: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <FieldNum label={lang === "ar" ? "الحصة" : "Period"} value={Number(form.fixedPeriod) || 1} onChange={(v) => setForm({ ...form, fixedPeriod: v })} />
              </>
            )}
            <div className="flex justify-end md:col-span-4 gap-2">
              <Button variant="ghost" onClick={() => setShowForm(false)}><X className="w-4 h-4" /></Button>
              <Button onClick={() => save.mutate()} disabled={!form.teacherId || !form.subjectId || !form.sectionId}>{tr("save", lang)}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("nav_teachers", lang)}</TableHead>
                <TableHead>{tr("nav_subjects", lang)}</TableHead>
                <TableHead>{tr("classes", lang)}</TableHead>
                <TableHead>{tr("rooms", lang)}</TableHead>
                <TableHead>Weekly</TableHead>
                <TableHead>{tr("type", lang)}</TableHead>
                <TableHead>{lang === "ar" ? "ثابتة" : "Fixed"}</TableHead>
                <TableHead>{tr("actions", lang)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lessons.map((l: any) => (
                <TableRow key={l.id}>
                  <TableCell>{l.teacher?.name}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2 h-2 rounded" style={{ background: l.subject?.color || "#888" }} />
                      {l.subject?.name}
                    </span>
                  </TableCell>
                  <TableCell>{l.section?.name}</TableCell>
                  <TableCell>{l.room?.name || "—"}</TableCell>
                  <TableCell><Badge variant="outline">{l.weeklyOccurrences}</Badge></TableCell>
                  <TableCell>{l.lessonType}</TableCell>
                  <TableCell>
                    {l.fixed && <Badge variant="default"><Lock className="w-3 h-3" /> {l.fixedDay} P{l.fixedPeriod}</Badge>}
                    {l.locked && <Badge variant="secondary">{tr("locked", lang)}</Badge>}
                  </TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => {
                      setEditing(l);
                      setForm({
                        teacherId: l.teacherId, subjectId: l.subjectId, sectionId: l.sectionId, roomId: l.roomId || "",
                        weeklyOccurrences: l.weeklyOccurrences, duration: l.duration, lessonType: l.lessonType, priority: l.priority,
                        requiredConsecutive: l.requiredConsecutive, preferredSlots: l.preferredSlots || "",
                        forbiddenSlots: l.forbiddenSlots || "", fixed: l.fixed, fixedDay: l.fixedDay || "",
                        fixedPeriod: l.fixedPeriod ?? "", locked: l.locked,
                      });
                      setShowForm(true);
                    }}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => del.mutate(l.id)}>
                      <Trash2 className="w-3 h-3 text-red-600" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
function FieldNum({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
