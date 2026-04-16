"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { motion } from "framer-motion";
import { CheckCircle2, Save, Download } from "lucide-react";

type AvailabilityMap = Record<string, Record<string, string[]>>;
type PersonAvailability = Record<string, string[]>;
type CalendarView = "all" | string;

type MeetingRow = {
  poll_id: string;
  participant_name: string;
  owner_user_id: string;
  date_key: string;
  slots: string[];
};

const TIME_SLOTS = [
  { id: "09:00-10:00", label: "09:00–10:00" },
  { id: "10:00-11:00", label: "10:00–11:00" },
  { id: "11:00-12:00", label: "11:00–12:00" },
  { id: "12:00-13:00", label: "12:00–13:00" },
  { id: "13:00-14:00", label: "13:00–14:00" },
  { id: "14:00-15:00", label: "14:00–15:00" },
  { id: "15:00-16:00", label: "15:00–16:00" },
  { id: "16:00-17:00", label: "16:00–17:00" },
] as const;

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONTHS_DE = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];
const DEFAULT_POLL_ID = "team-meeting-demo";

const GERMAN_INSTRUCTIONS = `Terminabstimmung
Weiterentwicklung des KS-Schallschutzrechners

Kurzanleitung
1. Bitte geben Sie Ihren Namen ein und bestätigen Sie diesen.
2. Wählen Sie anschließend passende Zeitfenster in Ihrem Kalender aus und speichern Sie danach Ihre Auswahl.
3. Fertig.

Kalenderansicht
Klicken Sie auf einen Teilnehmendennamen, um dessen Auswahl anzuzeigen.
Der gemeinsame Kalender zeigt alle gewählten Zeitfenster.

Bedienung im Kalender
Einmal klicken: Zeitfenster markieren.
Noch einmal klicken: Markierung entfernen.

Farben im Kalender
Weiß: noch nicht gewählt
Hellgrün: von anderen gewählt
Dunkelgrün: Top-3-Zeiten
Blauer Rand: Ihre Auswahl

Zeitfenster mit Mehrheit
Angezeigt werden: Zeitfenster mit Mehrheitszustimmung, absteigend sortiert.
`;

function downloadGermanInstructions(): void {
  const blob = new Blob([GERMAN_INSTRUCTIONS], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "anleitung_terminabstimmung_de.txt";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function getPollId(): string {
  if (typeof window === "undefined") return DEFAULT_POLL_ID;
  const params = new URLSearchParams(window.location.search);
  return params.get("poll")?.trim() || DEFAULT_POLL_ID;
}

function getStorageKey(pollId: string): string {
  return `meeting-scheduler-local-${pollId}`;
}

function getProfileKey(pollId: string): string {
  return `meeting-scheduler-profile-${pollId}`;
}

function createSupabaseBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey);
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateDE(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const weekdayMap = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  return `${d}.${m}.${y} ${weekdayMap[date.getDay()]}`;
}

function normalizePersonAvailability(input: unknown): PersonAvailability {
  if (!input || typeof input !== "object") return {};
  const next: PersonAvailability = {};

  Object.entries(input as Record<string, unknown>).forEach(([dateKey, slots]) => {
    if (!Array.isArray(slots)) return;
    const cleaned = Array.from(new Set(slots.filter(Boolean))).sort() as string[];
    if (cleaned.length > 0) next[dateKey] = cleaned;
  });

  return next;
}

function inflateRowsToAvailability(
  rows: Array<{ participant_name: string; date_key: string; slots: string[] }>
): AvailabilityMap {
  const result: AvailabilityMap = {};
  rows.forEach((row) => {
    if (!row?.participant_name || !row?.date_key) return;
    if (!result[row.participant_name]) result[row.participant_name] = {};
    result[row.participant_name][row.date_key] = Array.isArray(row.slots)
      ? Array.from(new Set(row.slots)).sort()
      : [];
  });
  return result;
}

function flattenPersonAvailability(
  personAvailability: PersonAvailability,
  participantName: string,
  ownerUserId: string,
  pollId: string
): MeetingRow[] {
  return Object.entries(personAvailability).map(([date_key, slots]) => ({
    poll_id: pollId,
    participant_name: participantName,
    owner_user_id: ownerUserId,
    date_key,
    slots: [...slots].sort(),
  }));
}

function arePersonAvailabilityEqual(a: PersonAvailability, b: PersonAvailability): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;

  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return false;
    const aSlots = [...(a[aKeys[i]] || [])].sort();
    const bSlots = [...(b[bKeys[i]] || [])].sort();
    if (aSlots.length !== bSlots.length) return false;
    for (let j = 0; j < aSlots.length; j += 1) {
      if (aSlots[j] !== bSlots[j]) return false;
    }
  }
  return true;
}

function getWeekStart(date: Date): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() - copy.getDay());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function formatWeekRange(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(weekStart.getDate() + 6);

  const startDay = weekStart.getDate();
  const endDay = end.getDate();
  const startMonth = MONTHS_DE[weekStart.getMonth()];
  const endMonth = MONTHS_DE[end.getMonth()];
  const startYear = weekStart.getFullYear();
  const endYear = end.getFullYear();

  if (weekStart.getMonth() === end.getMonth() && startYear === endYear) {
    return `${startDay}.–${endDay}. ${startMonth} ${startYear}`;
  }

  if (startYear === endYear) {
    return `${startDay}. ${startMonth} – ${endDay}. ${endMonth} ${startYear}`;
  }

  return `${startDay}. ${startMonth} ${startYear} – ${endDay}. ${endMonth} ${endYear}`;
}

export default function Page() {
  const today = new Date();
  const [pollId, setPollId] = useState(DEFAULT_POLL_ID);
  const [weekStart, setWeekStart] = useState<Date>(getWeekStart(today));

  const [selectedDay, setSelectedDay] = useState<number>(today.getDate());
  const [selectedMonth, setSelectedMonth] = useState<number>(today.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(today.getFullYear());

  const [participantNameInput, setParticipantNameInput] = useState("");
  const [myName, setMyName] = useState("");
  const [savedMyName, setSavedMyName] = useState("");
  const [availability, setAvailability] = useState<AvailabilityMap>({});
  const [draftAvailability, setDraftAvailability] = useState<PersonAvailability>({});
  const [activeCalendarView, setActiveCalendarView] = useState<CalendarView>("all");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saveMessage, setSaveMessage] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");

  const supabaseRef = useRef<SupabaseClient | null>(null);
  const activeParticipant = savedMyName || myName;
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);

  const daysInSelectedMonth = useMemo(
    () => getDaysInMonth(selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  );

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 11 }, (_, index) => currentYear - 5 + index);
  }, []);

  useEffect(() => {
    if (selectedDay > daysInSelectedMonth) {
      setSelectedDay(daysInSelectedMonth);
    }
  }, [selectedDay, daysInSelectedMonth]);

  useEffect(() => {
    const selectedDate = new Date(selectedYear, selectedMonth - 1, Math.min(selectedDay, daysInSelectedMonth));
    setWeekStart(getWeekStart(selectedDate));
  }, [selectedDay, selectedMonth, selectedYear, daysInSelectedMonth]);

  useEffect(() => {
    setPollId(getPollId());
    supabaseRef.current = createSupabaseBrowserClient();
    setAuthReady(!supabaseRef.current);
    setActiveCalendarView("all");
  }, []);

  async function fetchAllAvailability(): Promise<void> {
    const supabase = supabaseRef.current;

    if (!supabase) {
      if (typeof window !== "undefined") {
        const localRaw = localStorage.getItem(getStorageKey(pollId));
        const local = localRaw ? JSON.parse(localRaw) : {};
        setAvailability(local.availability || {});
      }
      return;
    }

    const { data, error } = await supabase
      .from("meeting_availability")
      .select("participant_name, date_key, slots")
      .eq("poll_id", pollId);

    if (error) {
      setSaveMessage(
        "Online-Daten konnten nicht geladen werden. Bitte Supabase-Konfiguration, RLS oder Netzwerk prüfen."
      );
    } else {
      setAvailability(
        inflateRowsToAvailability(
          (data || []) as Array<{ participant_name: string; date_key: string; slots: string[] }>
        )
      );
    }
  }

  useEffect(() => {
    if (!pollId) return;
    let ignore = false;

    async function init(): Promise<void> {
      setIsLoading(true);

      if (typeof window !== "undefined") {
        const profileRaw = localStorage.getItem(getProfileKey(pollId));
        const profile = profileRaw ? JSON.parse(profileRaw) : {};
        const cachedName = profile.myName || "";

        if (!ignore) {
          setMyName(cachedName);
          setSavedMyName(cachedName);
          setParticipantNameInput(cachedName);
        }
      }

      const supabase = supabaseRef.current;
      if (supabase) {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          if (!ignore) {
            setSaveMessage("Anmeldestatus konnte nicht gelesen werden. Bitte Supabase Auth prüfen.");
            setAuthError("Anmeldestatus konnte nicht gelesen werden. Bitte Supabase Auth prüfen.");
            setAuthReady(false);
            setIsLoading(false);
          }
          return;
        }

        let activeSession = session;
        if (!activeSession) {
          const { data: anonData, error: anonError } = await supabase.auth.signInAnonymously();
          if (anonError) {
            if (!ignore) {
              setSaveMessage(
                "Anonyme Anmeldung fehlgeschlagen. Bitte Anonymous Sign-ins in Supabase Auth aktivieren."
              );
              setAuthError(
                "Anonyme Anmeldung fehlgeschlagen. Bitte Anonymous Sign-ins in Supabase Auth aktivieren."
              );
              setAuthReady(false);
              setIsLoading(false);
            }
            return;
          }
          activeSession = anonData.session;
        }

        if (!ignore) {
          setCurrentUserId(activeSession?.user?.id || "");
          setAuthReady(Boolean(activeSession?.user?.id));
          setAuthError("");
        }
      }

      await fetchAllAvailability();
      if (!ignore) setIsLoading(false);
    }

    void init();
    return () => {
      ignore = true;
    };
  }, [pollId]);

  useEffect(() => {
    if (!pollId || typeof window === "undefined") return;
    localStorage.setItem(getProfileKey(pollId), JSON.stringify({ myName }));
  }, [myName, pollId]);

  useEffect(() => {
    if (!savedMyName) {
      setDraftAvailability({});
      setIsDirty(false);
      return;
    }
    const committed = normalizePersonAvailability(availability[savedMyName] || {});
    setDraftAvailability(committed);
    setIsDirty(false);
  }, [availability, savedMyName]);

  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase || !pollId) return;

    const channel = supabase
      .channel(`meeting-poll-${pollId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "meeting_availability", filter: `poll_id=eq.${pollId}` },
        async () => {
          await fetchAllAvailability();
        }
      )
      .subscribe();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setCurrentUserId(session?.user?.id || "");
      setAuthReady(Boolean(session?.user?.id));
      if (session?.user?.id) setAuthError("");
      if (event === "SIGNED_OUT") setSaveMessage("Die Sitzung ist abgelaufen. Bitte Seite neu laden.");
    });

    return () => {
      void supabase.removeChannel(channel);
      subscription.unsubscribe();
    };
  }, [pollId]);

  const participants = useMemo(() => Object.keys(availability).sort(), [availability]);
  const weekRangeLabel = useMemo(() => formatWeekRange(weekStart), [weekStart]);
  const canEditCurrentView = activeCalendarView === "all" || activeCalendarView === savedMyName;

  const aggregatedCellCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    Object.values(availability).forEach((personData) => {
      Object.entries(personData).forEach(([dateKey, slots]) => {
        slots.forEach((slotId) => {
          const key = `${dateKey}__${slotId}`;
          map[key] = (map[key] || 0) + 1;
        });
      });
    });
    return map;
  }, [availability]);

  const viewedPersonAvailability = useMemo<PersonAvailability>(() => {
    if (activeCalendarView === "all") return {};
    return normalizePersonAvailability(availability[activeCalendarView] || {});
  }, [activeCalendarView, availability]);

  const topThreeCellKeys = useMemo(() => {
    const ranked = weekDays
      .flatMap((day) => {
        const dateKey = formatDateKey(day);
        return TIME_SLOTS.map((slot) => ({
          key: `${dateKey}__${slot.id}`,
          count: aggregatedCellCountMap[`${dateKey}__${slot.id}`] || 0,
          dateKey,
          slotId: slot.id,
        }));
      })
      .filter((item) => item.count > 0)
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
        return a.slotId.localeCompare(b.slotId);
      })
      .slice(0, 3);

    return new Set(ranked.map((item) => item.key));
  }, [aggregatedCellCountMap, weekDays]);

  const majoritySlots = useMemo(() => {
    const totalParticipants = participants.length;
    if (totalParticipants === 0) {
      return [] as Array<{ dateKey: string; slotId: string; label: string; count: number }>;
    }

    const threshold = totalParticipants / 2;
    const result: Array<{ dateKey: string; slotId: string; label: string; count: number }> = [];

    weekDays.forEach((day) => {
      const dateKey = formatDateKey(day);
      TIME_SLOTS.forEach((slot) => {
        const count = aggregatedCellCountMap[`${dateKey}__${slot.id}`] || 0;
        if (count > threshold) {
          result.push({ dateKey, slotId: slot.id, label: slot.label, count });
        }
      });
    });

    return result.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
      return a.slotId.localeCompare(b.slotId);
    });
  }, [aggregatedCellCountMap, participants.length, weekDays]);

  const calendarTitle =
    activeCalendarView === "all" ? "Gemeinsamer Kalender" : `Auswahl von ${activeCalendarView}`;

  function registerMe(): void {
    const trimmed = participantNameInput.trim();
    if (!trimmed) return;
    setMyName(trimmed);
    setSavedMyName(trimmed);
    setSaveMessage("");
  }

  function toggleCell(dateKey: string, slotId: string): void {
    if (!activeParticipant) {
      setSaveMessage("Bitte zuerst Ihren Namen bestätigen.");
      return;
    }
    if (!canEditCurrentView) {
      setSaveMessage("Im Kalender einer anderen Person ist nur die Anzeige möglich.");
      return;
    }

    const next = { ...draftAvailability };
    const existing = next[dateKey] || [];
    const updated = existing.includes(slotId)
      ? existing.filter((s) => s !== slotId)
      : [...existing, slotId];

    if (updated.length === 0) delete next[dateKey];
    else next[dateKey] = [...updated].sort();

    setDraftAvailability(normalizePersonAvailability(next));
    setIsDirty(true);
    setSaveMessage("");
  }

  async function saveMyAvailability(): Promise<void> {
    const trimmedName = activeParticipant.trim();
    if (!trimmedName) {
      setSaveMessage("Bitte zuerst einen Namen eingeben und bestätigen.");
      return;
    }

    const supabase = supabaseRef.current;
    if (supabase && (!authReady || !currentUserId)) {
      setSaveMessage("Die anonyme Anmeldung ist noch nicht bereit. Bitte kurz warten und erneut versuchen.");
      return;
    }

    const normalizedDraft = normalizePersonAvailability(draftAvailability);
    setIsSaving(true);
    setSaveMessage("");

    try {
      if (supabase) {
        const { data: myRows, error: fetchMineError } = await supabase
          .from("meeting_availability")
          .select("date_key")
          .eq("poll_id", pollId)
          .eq("owner_user_id", currentUserId);
        if (fetchMineError) throw fetchMineError;

        const savedDates = ((myRows || []) as Array<{ date_key: string }>).map((row) => row.date_key);
        const draftDates = Object.keys(normalizedDraft);
        const datesToDelete = savedDates.filter((dateKey) => !draftDates.includes(dateKey));

        if (datesToDelete.length > 0) {
          const { error: deleteError } = await supabase
            .from("meeting_availability")
            .delete()
            .eq("poll_id", pollId)
            .eq("owner_user_id", currentUserId)
            .in("date_key", datesToDelete);
          if (deleteError) throw deleteError;
        }

        const rowsToUpsert = flattenPersonAvailability(normalizedDraft, trimmedName, currentUserId, pollId);
        if (rowsToUpsert.length > 0) {
          const { error: upsertError } = await supabase
            .from("meeting_availability")
            .upsert(rowsToUpsert, { onConflict: "poll_id,participant_name,date_key" });
          if (upsertError) throw upsertError;
        }

        await fetchAllAvailability();
      } else {
        const nextAvailability = { ...availability, [trimmedName]: normalizedDraft };
        setAvailability(nextAvailability);
        if (typeof window !== "undefined") {
          localStorage.setItem(
            getStorageKey(pollId),
            JSON.stringify({ availability: nextAvailability })
          );
        }
      }

      setSavedMyName(trimmedName);
      setMyName(trimmedName);
      setDraftAvailability(normalizedDraft);
      setIsDirty(false);
      setSaveMessage("Ihre Verfügbarkeit wurde gespeichert.");
    } catch (error) {
      console.error(error);
      setSaveMessage(
        "Speichern fehlgeschlagen. Bitte Tabellenstruktur, RLS-Policy, anonyme Anmeldung und Netzwerk prüfen."
      );
    } finally {
      setIsSaving(false);
    }
  }

  function goToToday(): void {
    const now = new Date();
    setSelectedDay(now.getDate());
    setSelectedMonth(now.getMonth() + 1);
    setSelectedYear(now.getFullYear());
  }

  const mySavedAvailability = savedMyName ? normalizePersonAvailability(availability[savedMyName] || {}) : {};
  const hasServerDiff = savedMyName ? !arePersonAvailabilityEqual(mySavedAvailability, draftAvailability) : false;

  return (
    <div className="min-h-screen bg-[#f6f7f4] p-3 sm:p-4 lg:p-6">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 lg:gap-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex-1">
              <div className="text-3xl font-bold text-slate-900">Terminabstimmung</div>
              <div className="mt-2 text-base text-slate-600 sm:text-lg">
                Weiterentwicklung des KS-Schallschutzrechners
              </div>
            </div>

            <Button
              variant="outline"
              className="h-11 shrink-0 gap-2 rounded-xl border-blue-200 bg-white text-slate-700 hover:bg-slate-50"
              onClick={downloadGermanInstructions}
            >
              <Download className="h-4 w-4" />
              Anleitung herunterladen
            </Button>
          </div>
        </div>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl sm:text-2xl">Schritt 1: Namen eingeben</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 xl:flex-row">
              <Input
                value={participantNameInput}
                onChange={(e) => setParticipantNameInput(e.target.value)}
                placeholder="Ihren Namen eingeben"
                onKeyDown={(e) => e.key === "Enter" && registerMe()}
                className="h-11 rounded-xl"
              />
              <Button onClick={registerMe} className="h-11 rounded-xl">
                Bestätigen
              </Button>
            </div>

            {isLoading ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                Daten und anonyme Anmeldung werden vorbereitet…
              </div>
            ) : supabaseRef.current && !authReady ? (
              <div className="rounded-2xl border border-dashed border-amber-300 p-4 text-sm text-amber-700">
                {authError || "Die anonyme Anmeldung ist noch nicht bereit. Bitte Supabase Auth prüfen und die Seite neu laden."}
              </div>
            ) : null}

            {hasServerDiff && !isDirty && (
              <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
                Der lokale Entwurf weicht von den Serverdaten ab. Bitte erneut auswählen und speichern.
              </div>
            )}
          </CardContent>
        </Card>

        {!supabaseRef.current && (
          <Alert className="rounded-2xl border-amber-200 bg-amber-50">
            <AlertDescription className="text-sm leading-6 text-amber-900">
              NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_ANON_KEY sind noch nicht gesetzt.
              Die Seite läuft nur im lokalen Demo-Modus.
            </AlertDescription>
          </Alert>
        )}

        <Card className="overflow-hidden rounded-[28px] border-slate-200 shadow-sm">
          <CardHeader className="gap-4 border-b border-slate-100 pb-4 sm:pb-5">
            <CardTitle className="text-xl sm:text-2xl">Schritt 2: Zeitfenster auswählen</CardTitle>

            <div className="space-y-3">
              <p className="text-base font-medium leading-7 text-slate-700 sm:text-lg">
                Kalenderansicht: Klicken Sie auf einen Teilnehmendennamen, um dessen Auswahl anzuzeigen.
                Der gemeinsame Kalender zeigt alle gewählten Zeitfenster.
              </p>

              <div className="flex flex-wrap gap-3">
                <Badge
                  variant={activeCalendarView === "all" ? "default" : "secondary"}
                  className="cursor-pointer px-4 py-2 text-base sm:text-lg"
                  onClick={() => setActiveCalendarView("all")}
                >
                  Gemeinsamer Kalender
                </Badge>

                {participants.map((name) => (
                  <Badge
                    key={name}
                    variant={activeCalendarView === name ? "default" : "secondary"}
                    className="cursor-pointer px-4 py-2 text-base sm:text-lg"
                    onClick={() => setActiveCalendarView(name)}
                  >
                    {name}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <select
                  value={selectedDay}
                  onChange={(e) => setSelectedDay(Number(e.target.value))}
                  className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm outline-none focus:border-blue-400 sm:text-base"
                >
                  {Array.from({ length: daysInSelectedMonth }, (_, index) => index + 1).map((day) => (
                    <option key={day} value={day}>
                      Tag {day}
                    </option>
                  ))}
                </select>

                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm outline-none focus:border-blue-400 sm:text-base"
                >
                  {MONTHS_DE.map((month, index) => (
                    <option key={month} value={index + 1}>
                      {month}
                    </option>
                  ))}
                </select>

                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm outline-none focus:border-blue-400 sm:text-base"
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      Jahr {year}
                    </option>
                  ))}
                </select>

                <Button
                  variant="outline"
                  className="h-11 rounded-xl border-2 border-green-500 px-4 text-sm font-semibold text-green-600 hover:bg-green-50 sm:text-base"
                  onClick={goToToday}
                >
                  Heute
                </Button>
              </div>

              <div className="text-sm font-medium text-slate-700 sm:text-base">{calendarTitle}</div>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-base font-semibold text-slate-900 sm:text-xl lg:min-w-[320px] lg:text-2xl">
                {weekRangeLabel}
              </div>

              <Button
                className="h-11 gap-2 rounded-xl px-5 text-sm sm:text-base"
                onClick={() => void saveMyAvailability()}
                disabled={isSaving || !savedMyName || !isDirty || !canEditCurrentView}
              >
                <Save className="h-4 w-4" />
                {isSaving ? "Wird gespeichert…" : "Auswahl speichern"}
              </Button>
            </div>

            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-700 sm:text-sm">
              Einmal klicken: Zeitfenster markieren. Noch einmal klicken: Markierung entfernen.{" "}
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-full border border-slate-300 bg-white" />
                Weiß: noch nicht gewählt
              </span>{" "}
              •{" "}
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-full bg-green-100" />
                von anderen gewählt
              </span>{" "}
              •{" "}
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-full bg-green-600" />
                Top-3-Zeiten
              </span>{" "}
              •{" "}
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-blue-500 bg-white" />
                Ihre Auswahl
              </span>
            </div>

            {saveMessage && (
              <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-700">{saveMessage}</div>
            )}
          </CardHeader>

          <CardContent className="p-2 sm:p-3 lg:p-5">
            <div className="w-full">
              <div className="grid w-full grid-cols-[64px_repeat(7,minmax(0,1fr))] gap-1 sm:grid-cols-[78px_repeat(7,minmax(0,1fr))] sm:gap-1.5 md:grid-cols-[88px_repeat(7,minmax(0,1fr))] lg:grid-cols-[110px_repeat(7,minmax(0,1fr))] lg:gap-3">
                <div />
                {weekDays.map((day, index) => {
                  const dateKey = formatDateKey(day);
                  const ownDraftHasSelection = Boolean((draftAvailability[dateKey] || []).length);
                  const isToday = formatDateKey(day) === formatDateKey(new Date());

                  return (
                    <div
                      key={dateKey}
                      className={`rounded-[18px] border border-slate-200 bg-white px-1 py-2 text-center sm:rounded-[22px] sm:px-2 sm:py-3 lg:rounded-[28px] lg:px-3 lg:py-5 ${
                        activeCalendarView === "all" && ownDraftHasSelection ? "bg-blue-50" : ""
                      }`}
                    >
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 sm:text-xs">
                        {WEEKDAYS[index]}
                      </div>
                      <div
                        className={`mt-1 text-2xl font-semibold leading-none sm:text-3xl lg:mt-2 lg:text-5xl ${
                          activeCalendarView === "all" && ownDraftHasSelection ? "text-blue-700" : "text-slate-800"
                        }`}
                      >
                        {day.getDate()}
                      </div>
                      {isToday && (
                        <div className="mt-1 text-[10px] text-slate-500 sm:text-xs lg:mt-3 lg:text-sm">
                          Heute
                        </div>
                      )}
                    </div>
                  );
                })}

                {TIME_SLOTS.map((slot) => (
                  <React.Fragment key={slot.id}>
                    <div className="flex items-start rounded-[16px] border border-slate-200 bg-white px-1.5 py-2 text-[10px] font-medium leading-tight text-slate-700 sm:rounded-[20px] sm:px-2.5 sm:py-3 sm:text-xs md:text-sm lg:rounded-[28px] lg:px-4 lg:py-6 lg:text-xl xl:text-2xl">
                      {slot.label}
                    </div>

                    {weekDays.map((day) => {
                      const dateKey = formatDateKey(day);
                      const ownDraftSelected = (draftAvailability[dateKey] || []).includes(slot.id);
                      const aggregatedCount = aggregatedCellCountMap[`${dateKey}__${slot.id}`] || 0;
                      const personSelected = Boolean(viewedPersonAvailability[dateKey]?.includes(slot.id));
                      const isTopThree =
                        activeCalendarView === "all" && topThreeCellKeys.has(`${dateKey}__${slot.id}`);
                      const showOwnBlueBorder = canEditCurrentView && ownDraftSelected;

                      const isFilledInCurrentView =
                        activeCalendarView === "all" ? aggregatedCount > 0 : personSelected;

                      const filledClass =
                        activeCalendarView === "all"
                          ? isTopThree
                            ? "bg-green-600 text-white"
                            : "bg-green-100 text-slate-800"
                          : "bg-blue-50 text-slate-800";

                      const borderClass = showOwnBlueBorder
                        ? activeCalendarView === "all" && isTopThree
                          ? "border-4 border-blue-500"
                          : "border-2 border-blue-500"
                        : "border border-slate-200";

                      return (
                        <button
                          key={`${dateKey}-${slot.id}`}
                          onClick={() => toggleCell(dateKey, slot.id)}
                          className={`relative min-h-[52px] rounded-[14px] px-1 py-1 text-left transition sm:min-h-[68px] sm:rounded-[18px] sm:px-1.5 sm:py-1.5 md:min-h-[82px] md:rounded-[20px] lg:min-h-[112px] lg:rounded-[28px] lg:px-4 lg:py-4 ${
                            isFilledInCurrentView
                              ? `${borderClass} ${filledClass}`
                              : `${borderClass} bg-white text-slate-800 hover:bg-slate-50`
                          }`}
                        >
                          <div className="flex h-full items-end justify-end">
                            {(activeCalendarView === "all"
                              ? aggregatedCount > 0
                              : personSelected || showOwnBlueBorder) ? (
                              <Badge
                                variant="outline"
                                className={`max-w-full whitespace-nowrap px-1 py-0 text-[9px] font-semibold leading-none sm:px-1.5 sm:py-0.5 sm:text-[11px] md:px-2 md:py-0.5 md:text-xs lg:px-2.5 lg:py-1 lg:text-sm xl:text-base ${
                                  activeCalendarView === "all" && isTopThree
                                    ? "border-white/40 bg-white/10 text-white"
                                    : "border-slate-200 text-slate-700"
                                }`}
                              >
                                {activeCalendarView === "all"
                                  ? `${aggregatedCount} / ${participants.length}`
                                  : personSelected
                                  ? `${aggregatedCount} / ${participants.length}`
                                  : ""}
                              </Badge>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <CheckCircle2 className="h-5 w-5" />
              Zeitfenster mit Mehrheit
            </CardTitle>
            <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
              Angezeigt werden: Zeitfenster mit Mehrheitszustimmung, absteigend sortiert.
            </p>
          </CardHeader>
          <CardContent>
            {activeCalendarView !== "all" ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                Diese Übersicht ist nur im gemeinsamen Kalender verfügbar.
              </div>
            ) : participants.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                Noch keine gespeicherten Teilnehmenden vorhanden.
              </div>
            ) : majoritySlots.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                Für diese Woche liegt derzeit kein Zeitfenster mit Mehrheit vor.
              </div>
            ) : (
              <div className="space-y-3">
                {majoritySlots.map((item) => (
                  <motion.div
                    key={`${item.dateKey}-${item.slotId}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border bg-slate-50 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{formatDateDE(item.dateKey)}</div>
                        <div className="mt-1 text-sm text-slate-600">{item.label}</div>
                      </div>
                      <Badge>
                        {item.count} / {participants.length}
                      </Badge>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
