"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr, DAY_LABELS, type Lang } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useMemo, useState, useEffect } from "react";
import {
  DndContext, DragEndEvent, DragStartEvent, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable,
} from "@dnd-kit/core";
import { Undo2, Redo2, Lock, Unlock, GripVertical, AlertTriangle, Wand2, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DayCode } from "@/lib/scheduling/engine";

type ViewKind = "school" | "teacher" | "class" | "room" | "subject";

export function TimetablePane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const activeTeacherId = useAppStore((s) => s.activeTeacherId);
  const activeSectionId = useAppStore((s) => s.activeSectionId);
  const activeRoomId = useAppStore((s) => s.activeRoomId);
  const activeSubjectId = useAppStore((s) => s.activeSubjectId);
  const setActiveTeacherId = useAppStore((s) => s.setActiveTeacherId);
  const setActiveSectionId = useAppStore((s) => s.setActiveSectionId);
  const setActiveRoomId = useAppStore((s) => s.setActiveRoomId);
  const setActiveSubjectId = useAppStore((s) => s.setActiveSubjectId);
  const activeVersionId = useAppStore((s) => s.activeVersionId);
  const setActiveVersionId = useAppStore((s) => s.setActiveVersionId);

  const [view, setView] = useState<ViewKind>("school");

  // Fetch school for workingDays + periods
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

  // Versions
  const { data: versionsData } = useQuery({
    queryKey: ["versions", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/timetable/versions?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const versions = versionsData?.versions || [];

  // Set active version to current
  useEffect(() => {
    if (!activeVersionId && versions.length > 0) {
      const cur = versions.find((v: any) => v.isCurrent) || versions[0];
      setActiveVersionId(cur.id);
    }
  }, [versions, activeVersionId, setActiveVersionId]);

  // Teachers/Sections/Rooms/Subjects dropdowns
  const { data: teachersData } = useQuery({
    queryKey: ["teachers", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/teachers?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
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
  const { data: subjectsData } = useQuery({
    queryKey: ["subjects", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/subjects?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const teachers = teachersData?.teachers || [];
  const sections = sectionsData?.sections || [];
  const rooms = roomsData?.rooms || [];
  const subjects = subjectsData?.subjects || [];

  // Fetch entries for the current view
  const entriesQuery = useQuery({
    queryKey: ["entries", activeVersionId, view, activeTeacherId, activeSectionId, activeRoomId, activeSubjectId],
    queryFn: async () => {
      if (!activeVersionId) return { entries: [] };
      const p = new URLSearchParams({ versionId: activeVersionId });
      if (view === "teacher" && activeTeacherId) p.set("teacherId", activeTeacherId);
      if (view === "class" && activeSectionId) p.set("sectionId", activeSectionId);
      if (view === "room" && activeRoomId) p.set("roomId", activeRoomId);
      if (view === "subject" && activeSubjectId) p.set("subjectId", activeSubjectId);
      const r = await fetch(`/api/timetable/entries?${p}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeVersionId,
  });

  const entries = entriesQuery.data?.entries || [];

  // DnD setup
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const qc = useQueryClient();
  const moveMutation = useMutation({
    mutationFn: async ({ entryId, day, period }: { entryId: string; day: DayCode; period: number }) => {
      const r = await fetch("/api/timetable/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, day, period, versionId: activeVersionId }),
      });
      return r.json();
    },
    onMutate: async ({ entryId, day, period }) => {
      // Optimistic update — revert on error
      await qc.cancelQueries({ queryKey: ["entries", activeVersionId, view, activeTeacherId, activeSectionId, activeRoomId, activeSubjectId] });
      const prev = qc.getQueryData<any>(["entries", activeVersionId, view, activeTeacherId, activeSectionId, activeRoomId, activeSubjectId]);
      if (prev) {
        const newEntries = prev.entries.map((e: any) => e.id === entryId ? { ...e, day, period } : e);
        qc.setQueryData(["entries", activeVersionId, view, activeTeacherId, activeSectionId, activeRoomId, activeSubjectId], { ...prev, entries: newEntries });
      }
      return { prev };
    },
    // onSuccess is set per-call in onDragEnd (we need access to local closure
    // variables for the repair flow). Default behavior:
    onError: (_e: any, _v: any, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(["entries", activeVersionId], ctx.prev);
      toast.error("Move failed");
    },
  });

  // ===== Phase 5-7: Local repair state =====
  // When a drag causes a conflict, the move API returns `conflict: true`
  // and a list of conflicts. We then offer "Try automatic repair" —
  // which calls /api/timetable/repair (real CP-SAT local repair engine).
  // The repair response contains `changes` (what actually moved) and
  // `proposedEntries` (the full repaired timetable). We show them in a
  // modal BEFORE committing — user must click Apply to commit.
  const [repairState, setRepairState] = useState<{
    open: boolean;
    loading: boolean;
    error: string | null;
    proposedChanges: any[] | null;
    proposedEntries: any[] | null;
    message: string | null;
    numMoved: number | null;
    profile: any | null;
    // Track the original drag that triggered the repair request
    originalDrag: { entryId: string; day: DayCode; period: number } | null;
  }>({
    open: false, loading: false, error: null,
    proposedChanges: null, proposedEntries: null,
    message: null, numMoved: null, profile: null, originalDrag: null,
  });

  const repairMutation = useMutation({
    mutationFn: async (params: {
      versionId: string;
      changedLessonOccurrenceId: string;
      targetDay: DayCode;
      targetPeriod: number;
      targetRoomId?: string | null;
      repairRadius?: number;
    }) => {
      const r = await fetch("/api/timetable/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      return r.json();
    },
    onMutate: () => {
      setRepairState((s) => ({ ...s, loading: true, error: null }));
    },
    onSuccess: (data) => {
      if (data.ok && data.repaired && data.changes?.length > 0) {
        setRepairState((s) => ({
          ...s, loading: false,
          proposedChanges: data.changes,
          proposedEntries: data.proposedEntries,
          message: data.message,
          numMoved: data.numMovedLessons,
          profile: data.profile,
          open: true,
        }));
      } else {
        setRepairState((s) => ({
          ...s, loading: false,
          error: data.message || (lang === "ar" ? "تعذّر الإصلاح" : "Repair failed"),
        }));
        toast.error(data.message || (lang === "ar" ? "تعذّر الإصلاح" : "Repair failed"));
      }
    },
    onError: (e: any) => {
      setRepairState((s) => ({ ...s, loading: false, error: String(e?.message || e) }));
      toast.error(lang === "ar" ? "فشل الإصلاح" : "Repair failed");
    },
  });

  const applyRepairMutation = useMutation({
    mutationFn: async (changes: any[]) => {
      // Commit each proposed change sequentially via /api/timetable/move
      // The change has: occurrenceId, lessonId, fromDay, fromPeriod, fromRoomId,
      //                toDay, toPeriod, toRoomId
      // Find the entry id by lessonId+fromDay+fromPeriod in current entries
      const results: any[] = [];
      for (const c of changes) {
        // Find the entry to move
        const matching = entries.find(
          (e: any) => e.lessonId === c.lessonId
            && e.day === c.fromDay
            && e.period === c.fromPeriod
        );
        if (!matching) {
          results.push({ change: c, error: "ENTRY_NOT_FOUND" });
          continue;
        }
        const r = await fetch("/api/timetable/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entryId: matching.id,
            day: c.toDay,
            period: c.toPeriod,
            versionId: activeVersionId,
            allowSwap: false,
          }),
        });
        const data = await r.json();
        results.push({ change: c, response: data });
      }
      return results;
    },
    onSuccess: (results) => {
      const failed = results.filter((r: any) => r.error || !r.response?.ok);
      if (failed.length === 0) {
        toast.success(lang === "ar"
          ? `تم تطبيق الإصلاح (${results.length} نقل)`
          : `Repair applied (${results.length} moves)`);
      } else {
        toast.error(lang === "ar"
          ? `${failed.length}/${results.length} فشل النقل`
          : `${failed.length}/${results.length} moves failed`);
      }
      setRepairState((s) => ({
        ...s, open: false, proposedChanges: null, proposedEntries: null,
      }));
      qc.invalidateQueries({ queryKey: ["entries", activeVersionId] });
    },
  });

  const tryAutoRepair = async (
    originalDrag: { entryId: string; day: DayCode; period: number },
    changedOccurrenceId: string,
    targetDay: DayCode,
    targetPeriod: number,
    targetRoomId?: string | null,
  ) => {
    if (!activeVersionId) return;
    repairMutation.mutate({
      versionId: activeVersionId,
      changedLessonOccurrenceId: changedOccurrenceId,
      targetDay,
      targetPeriod,
      targetRoomId: targetRoomId || null,
      repairRadius: 2,
    });
  };

  const cancelRepair = () => {
    setRepairState((s) => ({
      ...s, open: false, proposedChanges: null, proposedEntries: null,
    }));
  };

  const applyRepair = () => {
    if (!repairState.proposedChanges) return;
    applyRepairMutation.mutate(repairState.proposedChanges);
  };

  const lockMutation = useMutation({
    mutationFn: async ({ entryId, locked }: { entryId: string; locked: boolean }) => {
      const r = await fetch("/api/timetable/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, locked }),
      });
      return r.json();
    },
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم التحديث" : "Updated");
      qc.invalidateQueries({ queryKey: ["entries", activeVersionId] });
    },
  });

  const undoMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/timetable/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: activeVersionId }),
      });
      return r.json();
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(lang === "ar" ? "تراجع" : "Undone");
        qc.invalidateQueries({ queryKey: ["entries", activeVersionId] });
      } else {
        toast.error(lang === "ar" ? "لا يوجد شيء للتراجع" : "Nothing to undo");
      }
    },
  });
  const redoMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/timetable/redo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: activeVersionId }),
      });
      return r.json();
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(lang === "ar" ? "أعيد" : "Redone");
        qc.invalidateQueries({ queryKey: ["entries", activeVersionId] });
      } else {
        toast.error(lang === "ar" ? "لا يوجد شيء للإعادة" : "Nothing to redo");
      }
    },
  });

  const workingDays = useMemo(() => {
    if (!school) return ["SUN", "MON", "TUE", "WED", "THU"] as DayCode[];
    return (school.workingDays || "SUN,MON,TUE,WED,THU").split(",").filter(Boolean) as DayCode[];
  }, [school]);
  const periodsPerDay = school?.periodsPerDay || 7;

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const dragId = String(active.id);
    const dropId = String(over.id);
    // dropId is `DAY_PERIOD`
    const [day, period] = dropId.split("_");
    const targetDay = day as DayCode;
    const targetPeriod = Number(period);

    // Find the dragged entry to derive its occurrenceId (lessonId#n)
    const draggedEntry = entries.find((en: any) => en.id === dragId);
    if (!draggedEntry) {
      toast.error(lang === "ar" ? "تعذّر العثور على الحصة" : "Could not find entry");
      return;
    }
    // Derive occurrenceId: count same-lessonId entries before this one to get occurrence number
    const sameLessonEntries = entries.filter((en: any) => en.lessonId === draggedEntry.lessonId);
    const occIdx = sameLessonEntries.findIndex((en: any) => en.id === dragId) + 1;
    const occurrenceId = `${draggedEntry.lessonId}#${occIdx}`;

    // Track the original drag for the repair flow
    const originalDrag = { entryId: dragId, day: targetDay, period: targetPeriod };
    setRepairState((s) => ({ ...s, originalDrag }));

    moveMutation.mutate(
      { entryId: dragId, day: targetDay, period: targetPeriod },
      {
        onSuccess: (data) => {
          if (data.conflict) {
            // The move was rejected — target slot occupied.
            // Open the repair dialog by calling /api/timetable/repair.
            // Phase 7: Show a toast offering "Try automatic repair" —
            // user can also click the button in the conflict toast.
            toast(
              lang === "ar"
                ? `تعارض في الخانة المطلوبة. ${data.conflicts?.[0]?.message || ""}`
                : `Conflict at target slot. ${data.conflicts?.[0]?.message || ""}`,
              {
                duration: 8000,
                action: {
                  label: lang === "ar" ? "إصلاح تلقائي" : "Auto-repair",
                  onClick: () => tryAutoRepair(
                    originalDrag, occurrenceId, targetDay, targetPeriod, draggedEntry.roomId,
                  ),
                },
              }
            );
            qc.invalidateQueries({ queryKey: ["entries", activeVersionId] });
          } else {
            toast.success(lang === "ar" ? "تم النقل" : "Moved");
          }
        },
      }
    );
  };

  if (!activeSchoolId) {
    return <div className="p-6 text-slate-500">{lang === "ar" ? "اختر مدرسة" : "Select a school"}</div>;
  }
  if (!activeVersionId) {
    return (
      <div className="p-6 space-y-3">
        <h1 className="text-2xl font-bold">{tr("nav_timetable", lang)}</h1>
        <Card>
          <CardContent className="p-6 text-center text-sm text-slate-500">
            {lang === "ar" ? "لا يوجد جدول بعد. اذهب لتوليد جدول جديد." : "No timetable yet. Generate one first."}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">{tr("nav_timetable", lang)}</h1>
        <div className="flex items-center gap-2">
          <Select value={activeVersionId || undefined} onValueChange={setActiveVersionId}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{versions.map((v: any) => <SelectItem key={v.id} value={v.id}>v#{v.version} {v.isCurrent ? "(current)" : ""}</SelectItem>)}</SelectContent>
          </Select>
          <Button id="btn-undo" variant="outline" size="icon" onClick={() => undoMutation.mutate()} title="Undo (Ctrl+Z)">
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button id="btn-redo" variant="outline" size="icon" onClick={() => redoMutation.mutate()} title="Redo (Ctrl+Y)">
            <Redo2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as ViewKind)}>
        <TabsList>
          <TabsTrigger value="school">{tr("school_view", lang)}</TabsTrigger>
          <TabsTrigger value="teacher">{tr("teacher_view", lang)}</TabsTrigger>
          <TabsTrigger value="class">{tr("class_view", lang)}</TabsTrigger>
          <TabsTrigger value="room">{tr("room_view", lang)}</TabsTrigger>
          <TabsTrigger value="subject">{tr("subject_view", lang)}</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Entity selectors */}
      <div className="flex items-center gap-2 flex-wrap">
        {view === "teacher" && (
          <Select value={activeTeacherId || undefined} onValueChange={setActiveTeacherId}>
            <SelectTrigger className="w-64"><SelectValue placeholder={tr("nav_teachers", lang)} /></SelectTrigger>
            <SelectContent>{teachers.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {view === "class" && (
          <Select value={activeSectionId || undefined} onValueChange={setActiveSectionId}>
            <SelectTrigger className="w-48"><SelectValue placeholder={tr("classes", lang)} /></SelectTrigger>
            <SelectContent>{sections.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {view === "room" && (
          <Select value={activeRoomId || undefined} onValueChange={setActiveRoomId}>
            <SelectTrigger className="w-48"><SelectValue placeholder={tr("rooms", lang)} /></SelectTrigger>
            <SelectContent>{rooms.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {view === "subject" && (
          <Select value={activeSubjectId || undefined} onValueChange={setActiveSubjectId}>
            <SelectTrigger className="w-48"><SelectValue placeholder={tr("subjects", lang)} /></SelectTrigger>
            <SelectContent>{subjects.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <TimetableGrid
          entries={entries}
          workingDays={workingDays}
          periodsPerDay={periodsPerDay}
          lang={lang}
          view={view}
          onToggleLock={(id, locked) => lockMutation.mutate({ entryId: id, locked })}
        />
      </DndContext>

      {/* ===== Phase 7: Local Repair Dialog =====
          Shows the proposed changes BEFORE committing. User must click
          Apply to commit (which calls /api/timetable/move for each
          change) or Cancel to discard. */}
      <Dialog open={repairState.open} onOpenChange={(o) => !o && cancelRepair()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-blue-500" />
              {lang === "ar" ? "إصلاح تلقائي مقترح" : "Automatic repair proposed"}
            </DialogTitle>
            <DialogDescription>
              {lang === "ar"
                ? `سيتم نقل ${repairState.numMoved || 0} حصة. راجع التغييرات قبل التطبيق.`
                : `This will move ${repairState.numMoved || 0} lesson(s). Review the changes before applying.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {repairState.message && (
              <div className="text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 rounded p-3">
                {repairState.message}
              </div>
            )}

            {repairState.proposedChanges?.map((c: any, i: number) => (
              <div key={i} className="border border-slate-200 dark:border-slate-800 rounded p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">
                    {lang === "ar" ? "حصة:" : "Lesson:"}{" "}
                    <span className="text-blue-600 dark:text-blue-400">{c.lessonId}</span>
                  </div>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded",
                    c.reason === "direct user move"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                  )}>
                    {c.reason === "direct user move"
                      ? (lang === "ar" ? "نقل المستخدم" : "user move")
                      : (lang === "ar" ? "إخلاء" : "repair")}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-red-50 dark:bg-red-950 rounded p-2">
                    <div className="text-slate-500">{lang === "ar" ? "من" : "From"}</div>
                    <div>{DAY_LABELS[c.fromDay as DayCode]?.[lang] || c.fromDay} P{c.fromPeriod}</div>
                  </div>
                  <div className="bg-emerald-50 dark:bg-emerald-950 rounded p-2">
                    <div className="text-slate-500">{lang === "ar" ? "إلى" : "To"}</div>
                    <div>{DAY_LABELS[c.toDay as DayCode]?.[lang] || c.toDay} P{c.toPeriod}</div>
                  </div>
                </div>
              </div>
            ))}

            {repairState.profile && (
              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer">{lang === "ar" ? "تفاصيل الأداء" : "Performance"}</summary>
                <pre className="mt-2 bg-slate-50 dark:bg-slate-900 p-2 rounded">
                  {JSON.stringify(repairState.profile, null, 2)}
                </pre>
              </details>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={cancelRepair} disabled={applyRepairMutation.isPending}>
              <X className="w-4 h-4 mr-2" />
              {lang === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={applyRepair} disabled={applyRepairMutation.isPending}>
              {applyRepairMutation.isPending ? (
                <span className="animate-pulse">{lang === "ar" ? "جاري التطبيق..." : "Applying..."}</span>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  {lang === "ar" ? "تطبيق" : "Apply"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Loading overlay during repair computation */}
      {repairState.loading && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-900 rounded-lg p-6 flex items-center gap-3">
            <Wand2 className="w-5 h-5 animate-pulse text-blue-500" />
            <span>{lang === "ar" ? "جاري حساب الإصلاح المحلي..." : "Computing local repair..."}</span>
          </div>
        </div>
      )}

      <style jsx>{`
        .tt-grid {
          display: grid;
          grid-template-columns: 80px repeat(${periodsPerDay}, minmax(120px, 1fr));
          gap: 2px;
          font-size: 11px;
        }
      `}</style>
    </div>
  );
}

function TimetableGrid({
  entries, workingDays, periodsPerDay, lang, view, onToggleLock,
}: {
  entries: any[];
  workingDays: DayCode[];
  periodsPerDay: number;
  lang: Lang;
  view: ViewKind;
  onToggleLock: (id: string, locked: boolean) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div style={{ display: "grid", gridTemplateColumns: `80px repeat(${periodsPerDay}, minmax(140px, 1fr))`, gap: "2px", fontSize: "11px" }}>
        {/* Header row */}
        <div className="bg-slate-900 text-white p-1.5 font-medium text-center">{tr("name", lang)}/Period</div>
        {Array.from({ length: periodsPerDay }, (_, i) => (
          <div key={i} className="bg-slate-900 text-white p-1.5 font-medium text-center">P{i + 1}</div>
        ))}

        {/* Body rows */}
        {workingDays.map((day) => (
          <DayRow key={day} day={day} entries={entries} periodsPerDay={periodsPerDay} lang={lang} view={view} onToggleLock={onToggleLock} />
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-4 text-xs flex-wrap">
        <Legend color="bg-emerald-500" label={tr("teaching", lang)} />
        <Legend color="bg-amber-500" label={tr("duty", lang)} />
        <Legend color="bg-blue-500" label={tr("supervision", lang)} />
        <Legend color="bg-slate-400" label={tr("reserve", lang)} />
        <Legend color="bg-slate-100" label={tr("free", lang)} />
        <Legend color="bg-red-400" label={tr("unavailable", lang)} />
      </div>
    </div>
  );
}

function DayRow({
  day, entries, periodsPerDay, lang, view, onToggleLock,
}: {
  day: DayCode;
  entries: any[];
  periodsPerDay: number;
  lang: Lang;
  view: ViewKind;
  onToggleLock: (id: string, locked: boolean) => void;
}) {
  return (
    <>
      <div className="bg-slate-100 dark:bg-slate-800 p-1.5 font-medium text-center">
        {DAY_LABELS[lang][day]}
      </div>
      {Array.from({ length: periodsPerDay }, (_, i) => {
        const p = i + 1;
        const cellEntries = entries.filter((e) => e.day === day && e.period === p);
        return <Cell key={p} day={day} period={p} entries={cellEntries} lang={lang} view={view} onToggleLock={onToggleLock} />;
      })}
    </>
  );
}

function Cell({
  day, period, entries, lang, view, onToggleLock,
}: {
  day: DayCode;
  period: number;
  entries: any[];
  lang: Lang;
  view: ViewKind;
  onToggleLock: (id: string, locked: boolean) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${day}_${period}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[60px] p-1 border border-slate-200 dark:border-slate-800 rounded-sm bg-white dark:bg-slate-900",
        isOver && "ring-2 ring-blue-400"
      )}
    >
      {entries.length === 0 && (
        <div className="h-full flex items-center justify-center text-slate-300 text-[10px]">{tr("free", lang)}</div>
      )}
      {entries.map((e) => (
        <DraggableEntry key={e.id} entry={e} lang={lang} view={view} onToggleLock={onToggleLock} />
      ))}
    </div>
  );
}

function DraggableEntry({
  entry, lang, view, onToggleLock,
}: {
  entry: any;
  lang: Lang;
  view: ViewKind;
  onToggleLock: (id: string, locked: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: entry.id });
  const subject = entry.lesson?.subject || entry.subject;
  const teacher = entry.lesson?.teacher || entry.teacher;
  const section = entry.lesson?.section || entry.section;
  const room = entry.lesson?.room || entry.room;
  const isDuty = ["DUTY", "SUPERVISION", "RESERVE"].includes(entry.cellType);

  const bg = isDuty
    ? entry.cellType === "SUPERVISION" ? "bg-blue-100 dark:bg-blue-950 border-blue-300 dark:border-blue-800"
    : entry.cellType === "RESERVE" ? "bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700"
    : "bg-amber-100 dark:bg-amber-950 border-amber-300 dark:border-amber-800"
    : "bg-emerald-100 dark:bg-emerald-950 border-emerald-300 dark:border-emerald-800";

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "rounded border p-1 cursor-grab active:cursor-grabbing mb-1",
        bg,
        isDragging && "opacity-50",
        entry.locked && "ring-2 ring-red-500"
      )}
      style={{ borderInlineStart: subject?.color ? `3px solid ${subject.color}` : undefined }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="font-semibold truncate text-[11px]">
          {isDuty ? entry.duty?.title || entry.cellType : subject?.name || "—"}
        </div>
        <div className="flex items-center gap-0.5">
          {entry.locked ? (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onToggleLock(entry.id, false); }}
              className="text-red-600"
            >
              <Unlock className="w-3 h-3" />
            </button>
          ) : (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onToggleLock(entry.id, true); }}
              className="text-slate-500"
            >
              <Lock className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      {!isDuty && (
        <>
          {view !== "teacher" && <div className="text-[10px] text-slate-600 dark:text-slate-300 truncate">{teacher?.name}</div>}
          {view !== "class" && <div className="text-[10px] text-slate-600 dark:text-slate-300 truncate">{section?.name}</div>}
          {view !== "room" && <div className="text-[10px] text-slate-500 truncate">{room?.name || "—"}</div>}
        </>
      )}
      {isDuty && entry.duty?.teacher && (
        <div className="text-[10px] text-slate-600 dark:text-slate-300 truncate">{entry.duty.teacher.name}</div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`w-3 h-3 ${color} rounded`} /> {label}
    </div>
  );
}
