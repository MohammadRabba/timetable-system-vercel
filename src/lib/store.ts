"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Lang } from "@/lib/i18n";

type LangState = {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
};

export const useLangStore = create<LangState>()(
  persist(
    (set, get) => ({
      lang: "ar",
      setLang: (l) => set({ lang: l }),
      toggle: () => set({ lang: get().lang === "ar" ? "en" : "ar" }),
    }),
    { name: "tt-lang" }
  )
);

// Pane routing for single-page app
export type Pane =
  | "dashboard"
  | "school"
  | "academic"
  | "subjects"
  | "teachers"
  | "rooms"
  | "lessons"
  | "duties"
  | "constraints"
  | "schedule"
  | "timetable"
  | "conflicts"
  | "reports"
  | "excel"
  | "audit"
  | "settings";

type AppState = {
  pane: Pane;
  setPane: (p: Pane) => void;
  // Active selections
  activeSchoolId: string | null;
  setActiveSchoolId: (id: string | null) => void;
  activeTeacherId: string | null;
  setActiveTeacherId: (id: string | null) => void;
  activeSectionId: string | null;
  setActiveSectionId: (id: string | null) => void;
  activeRoomId: string | null;
  setActiveRoomId: (id: string | null) => void;
  activeSubjectId: string | null;
  setActiveSubjectId: (id: string | null) => void;
  activeVersionId: string | null;
  setActiveVersionId: (id: string | null) => void;
  // Undo/redo
  undoStack: any[];
  redoStack: any[];
  pushUndo: (action: any) => void;
  popUndo: () => any | null;
  pushRedo: (action: any) => void;
  popRedo: () => any | null;
  clearHistory: () => void;
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      pane: "dashboard",
      setPane: (p) => set({ pane: p }),
      activeSchoolId: null,
      setActiveSchoolId: (id) => set({ activeSchoolId: id }),
      activeTeacherId: null,
      setActiveTeacherId: (id) => set({ activeTeacherId: id }),
      activeSectionId: null,
      setActiveSectionId: (id) => set({ activeSectionId: id }),
      activeRoomId: null,
      setActiveRoomId: (id) => set({ activeRoomId: id }),
      activeSubjectId: null,
      setActiveSubjectId: (id) => set({ activeSubjectId: id }),
      activeVersionId: null,
      setActiveVersionId: (id) => set({ activeVersionId: id }),
      undoStack: [],
      redoStack: [],
      pushUndo: (action) => set((s) => ({ undoStack: [...s.undoStack, action].slice(-50), redoStack: [] })),
      popUndo: () => {
        const s = get();
        if (!s.undoStack.length) return null;
        const last = s.undoStack[s.undoStack.length - 1];
        set({ undoStack: s.undoStack.slice(0, -1) });
        return last;
      },
      pushRedo: (action) => set((s) => ({ redoStack: [...s.redoStack, action].slice(-50) })),
      popRedo: () => {
        const s = get();
        if (!s.redoStack.length) return null;
        const last = s.redoStack[s.redoStack.length - 1];
        set({ redoStack: s.redoStack.slice(0, -1) });
        return last;
      },
      clearHistory: () => set({ undoStack: [], redoStack: [] }),
    }),
    { name: "tt-app" }
  )
);
