"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

export function AcademicPane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const qc = useQueryClient();

  const [showGradeForm, setShowGradeForm] = useState(false);
  const [showSectionForm, setShowSectionForm] = useState(false);
  const [gradeForm, setGradeForm] = useState({ stage: "Secondary", name: "", order: 10 });
  const [sectionForm, setSectionForm] = useState({ name: "", code: "", gradeId: "", branchId: "", studentCount: 25, roomId: "" });

  const { data: gradesData } = useQuery({
    queryKey: ["grades", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/grades?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
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
  const { data: branchesData } = useQuery({
    queryKey: ["branches", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/branches?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });

  const grades = gradesData?.grades || [];
  const sections = sectionsData?.sections || [];
  const rooms = roomsData?.rooms || [];
  const branches = branchesData?.branches || [];

  const createGrade = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/grades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...gradeForm, schoolId: activeSchoolId }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم إنشاء الصف" : "Grade created");
      setShowGradeForm(false);
      setGradeForm({ stage: "Secondary", name: "", order: 11 });
      qc.invalidateQueries({ queryKey: ["grades", activeSchoolId] });
    },
  });
  const createSection = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...sectionForm,
          schoolId: activeSchoolId,
          branchId: sectionForm.branchId || null,
          roomId: sectionForm.roomId || null,
        }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم إنشاء القسم" : "Section created");
      setShowSectionForm(false);
      setSectionForm({ name: "", code: "", gradeId: "", branchId: "", studentCount: 25, roomId: "" });
      qc.invalidateQueries({ queryKey: ["sections", activeSchoolId] });
    },
  });

  const deleteGrade = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/grades/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["grades", activeSchoolId] }),
  });
  const deleteSection = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/sections/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sections", activeSchoolId] }),
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">{tr("nav_academic", lang)}</h1>

      {!activeSchoolId && <div className="text-sm text-slate-500">{lang === "ar" ? "اختر مدرسة أولاً" : "Select a school first"}</div>}

      {/* Grades */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{lang === "ar" ? "الصفوف" : "Grades"} ({grades.length})</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowGradeForm(!showGradeForm)}>
            <Plus className="w-4 h-4" /> {tr("add", lang)}
          </Button>
        </CardHeader>
        <CardContent>
          {showGradeForm && (
            <div className="grid grid-cols-4 gap-2 mb-3 p-3 border border-slate-200 dark:border-slate-800 rounded">
              <div>
                <Label className="text-xs">{lang === "ar" ? "المرحلة" : "Stage"}</Label>
                <Select value={gradeForm.stage} onValueChange={(v) => setGradeForm({ ...gradeForm, stage: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Primary">{lang === "ar" ? "ابتدائي" : "Primary"}</SelectItem>
                    <SelectItem value="Secondary">{lang === "ar" ? "ثانوي" : "Secondary"}</SelectItem>
                    <SelectItem value="High">{lang === "ar" ? "عالي" : "High"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{lang === "ar" ? "الاسم" : "Name"}</Label>
                <Input value={gradeForm.name} onChange={(e) => setGradeForm({ ...gradeForm, name: e.target.value })} placeholder="الصف العاشر" />
              </div>
              <div>
                <Label className="text-xs">{lang === "ar" ? "الترتيب" : "Order"}</Label>
                <Input type="number" value={gradeForm.order} onChange={(e) => setGradeForm({ ...gradeForm, order: Number(e.target.value) })} />
              </div>
              <div className="flex items-end">
                <Button size="sm" onClick={() => createGrade.mutate()} disabled={!gradeForm.name}>
                  {tr("save", lang)}
                </Button>
              </div>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("name", lang)}</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>{tr("classes", lang)}</TableHead>
                <TableHead>{tr("actions", lang)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grades.map((g: any) => (
                <TableRow key={g.id}>
                  <TableCell>{g.name}</TableCell>
                  <TableCell><Badge variant="outline">{g.stage}</Badge></TableCell>
                  <TableCell>{g.order}</TableCell>
                  <TableCell>{g._count?.sections ?? 0}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => deleteGrade.mutate(g.id)}>
                      <Trash2 className="w-3 h-3 text-red-600" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Branches (just display) */}
      {branches.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">{lang === "ar" ? "الفروع" : "Branches"} ({branches.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {branches.map((b: any) => (
                <Badge key={b.id} variant="secondary">{b.name} · {b.grade?.name}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sections */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{lang === "ar" ? "الشعب" : "Sections"} ({sections.length})</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowSectionForm(!showSectionForm)}>
            <Plus className="w-4 h-4" /> {tr("add", lang)}
          </Button>
        </CardHeader>
        <CardContent>
          {showSectionForm && (
            <div className="grid grid-cols-3 gap-2 mb-3 p-3 border border-slate-200 dark:border-slate-800 rounded">
              <div>
                <Label className="text-xs">{tr("name", lang)}</Label>
                <Input value={sectionForm.name} onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value })} placeholder="10-A" />
              </div>
              <div>
                <Label className="text-xs">{tr("code", lang)}</Label>
                <Input value={sectionForm.code} onChange={(e) => setSectionForm({ ...sectionForm, code: e.target.value })} placeholder="10A" />
              </div>
              <div>
                <Label className="text-xs">{lang === "ar" ? "الصف" : "Grade"}</Label>
                <Select value={sectionForm.gradeId} onValueChange={(v) => setSectionForm({ ...sectionForm, gradeId: v })}>
                  <SelectTrigger><SelectValue placeholder="--" /></SelectTrigger>
                  <SelectContent>
                    {grades.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{lang === "ar" ? "الفرع" : "Branch"}</Label>
                <Select value={sectionForm.branchId} onValueChange={(v) => setSectionForm({ ...sectionForm, branchId: v })}>
                  <SelectTrigger><SelectValue placeholder="--" /></SelectTrigger>
                  <SelectContent>
                    {branches.filter((b: any) => b.gradeId === sectionForm.gradeId).map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{lang === "ar" ? "العدد" : "Students"}</Label>
                <Input type="number" value={sectionForm.studentCount} onChange={(e) => setSectionForm({ ...sectionForm, studentCount: Number(e.target.value) })} />
              </div>
              <div>
                <Label className="text-xs">{tr("rooms", lang)}</Label>
                <Select value={sectionForm.roomId} onValueChange={(v) => setSectionForm({ ...sectionForm, roomId: v })}>
                  <SelectTrigger><SelectValue placeholder="--" /></SelectTrigger>
                  <SelectContent>
                    {rooms.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3 flex justify-end">
                <Button size="sm" onClick={() => createSection.mutate()} disabled={!sectionForm.name || !sectionForm.gradeId}>
                  {tr("save", lang)}
                </Button>
              </div>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("name", lang)}</TableHead>
                <TableHead>{tr("code", lang)}</TableHead>
                <TableHead>{lang === "ar" ? "الصف" : "Grade"}</TableHead>
                <TableHead>{lang === "ar" ? "الفرع" : "Branch"}</TableHead>
                <TableHead>{lang === "ar" ? "العدد" : "Students"}</TableHead>
                <TableHead>{tr("rooms", lang)}</TableHead>
                <TableHead>{tr("actions", lang)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sections.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell><Badge variant="outline">{s.code}</Badge></TableCell>
                  <TableCell>{s.grade?.name}</TableCell>
                  <TableCell>{s.branch?.name || "—"}</TableCell>
                  <TableCell>{s.studentCount}</TableCell>
                  <TableCell>{s.room?.name || "—"}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => deleteSection.mutate(s.id)}>
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
