"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { motion } from "framer-motion";
import {
  Users,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Save,
  Mail,
  LogOut,
} from "lucide-react";

type PersonAvailability = Record<string, string[]>;

type ParticipantEntry = {
  participantName: string;
  availability: PersonAvailability;
};

type AvailabilityMap = Record<string, ParticipantEntry>;
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
const DEFAULT_POLL_ID = "team-meeting-demo";

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

function inflateRowsToAvailability(rows: MeetingRow[]): AvailabilityMap {
  const result: AvailabilityMap = {};

  rows.forEach((row) => {
    const ownerKey = row.owner_user_id || row.participant_name;
    if (!ownerKey || !row.date_key) return;

    if (!result[ownerKey]) {
      result[ownerKey] = {
        participantName: row.participant_name || ownerKey,
        availability: {},
      };
    }

    result[ownerKey].participantName = row.participant_name || ownerKey;
    result[ownerKey].availability[row.date_key] = Array.isArray(row.slots)
      ? Array.from(new Set(row.slots)).sort()
      : [];
  });

  return result;
}

function inflateLocalAvailability(input: unknown): AvailabilityMap {
  if (!input || typeof input !== "object") return {};

  const result: AvailabilityMap = {};

  Object.entries(input as Record<string, unknown>).forEach(([ownerKey, value]) => {
    if (!value || typeof value !== "object") return;

    const maybeEntry = value as { participantName?: unknown; availability?: unknown };

    if ("availability" in maybeEntry) {
      result[ownerKey] = {
        participantName:
          typeof maybeEntry.participantName === "string" && maybeEntry.participantName.trim()
            ? maybeEntry.participantName
            : ownerKey,
        availability: normalizePersonAvailability(maybeEntry.availability),
      };
    } else {
      result[ownerKey] = {
        participantName: ownerKey,
        availability: normalizePersonAvailability(value),
      };
    }
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

function formatWeekRange(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(weekStart.getDate() + 6);
  const startMonth = weekStart.toLocaleDateString("de-DE", { month: "long" });
  const endMonth = end.toLocaleDateString("de-DE", { month: "long" });
  const year = end.getFullYear();

  if (
    weekStart.getMonth() === end.getMonth() &&
    weekStart.getFullYear() === end.getFullYear()
  ) {
    return `${startMonth} ${weekStart.getDate()} – ${end.getDate()}, ${year}`;
  }

  return `${startMonth} ${weekStart.getDate()} – ${endMonth} ${end.getDate()}, ${year}`;
}

function getMagicLinkRedirectUrl(pollId: string): string {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set("poll", pollId);
  return url.toString();
}

export default function Page() {
  const [pollId, setPollId] = useState(DEFAULT_POLL_ID);
  const [weekStart, setWeekStart] = useState<Date>(getWeekStart(new Date()));
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
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [sessionEmail, setSessionEmail] = useState("");
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false);
  const [authMessage, setAuthMessage] = useState("");

  const supabaseRef = useRef<SupabaseClient | null>(null);
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);

  const currentOwnerKey = supabaseRef.current
    ? currentUserId
    : (savedMyName || myName).trim();

  const activeParticipant = savedMyName || myName;
  const isLoggedIn = !supabaseRef.current || Boolean(currentUserId);

  useEffect(() => {
    setPollId(getPollId());
    supabaseRef.current = createSupabaseBrowserClient();
    if (!supabaseRef.current) {
      setAuthReady(true);
      setAuthChecked(true);
    }
    setActiveCalendarView("all");
  }, []);

  async function fetchAllAvailability(): Promise<void> {
    const supabase = supabaseRef.current;

    if (!supabase) {
      if (typeof window !== "undefined") {
        const localRaw = localStorage.getItem(getStorageKey(pollId));
        const local = localRaw ? JSON.parse(localRaw) : {};
        setAvailability(inflateLocalAvailability(local.availability || {}));
      }
      return;
    }

    if (!currentUserId) {
      setAvailability({});
      return;
    }

    const { data, error } = await supabase
      .from("meeting_availability")
      .select("participant_name, owner_user_id, date_key, slots")
      .eq("poll_id", pollId);

    if (error) {
      setSaveMessage(
        "Online-Daten konnten nicht geladen werden. Bitte Supabase-Konfiguration, RLS oder Netzwerk prüfen."
      );
    } else {
      setAvailability(inflateRowsToAvailability((data || []) as MeetingRow[]));
    }
  }

  async function sendMagicLink(): Promise<void> {
    const supabase = supabaseRef.current;
    const trimmedEmail = emailInput.trim();

    if (!supabase) {
      setAuthMessage("Supabase ist nicht konfiguriert. Magic Link ist im Demo-Modus nicht verfügbar.");
      return;
    }

    if (!trimmedEmail) {
      setAuthMessage("Bitte geben Sie eine E-Mail-Adresse ein.");
      return;
    }

    setIsSendingMagicLink(true);
    setAuthMessage("");
    setAuthError("");

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: {
          emailRedirectTo: getMagicLinkRedirectUrl(pollId),
          shouldCreateUser: true,
        },
      });

      if (error) throw error;

      setAuthMessage("Der Magic Link wurde versendet. Bitte prüfen Sie Ihr E-Mail-Postfach.");
    } catch (error) {
      console.error(error);
      setAuthMessage("Der Magic Link konnte nicht gesendet werden. Bitte prüfen Sie Auth-Einstellungen und Redirect-URLs.");
    } finally {
      setIsSendingMagicLink(false);
    }
  }

  async function signOut(): Promise<void> {
    const supabase = supabaseRef.current;
    if (!supabase) return;

    const { error } = await supabase.auth.signOut();
    if (error) {
      setAuthMessage("Abmeldung fehlgeschlagen.");
      return;
    }

    setCurrentUserId("");
    setSessionEmail("");
    setAvailability({});
    setDraftAvailability({});
    setIsDirty(false);
    setAuthReady(false);
    setAuthMessage("Sie wurden abgemeldet.");
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

      if (!supabase) {
        await fetchAllAvailability();
        if (!ignore) {
          setIsLoading(false);
          setAuthChecked(true);
        }
        return;
      }

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        if (!ignore) {
          setSaveMessage("Anmeldestatus konnte nicht gelesen werden. Bitte Supabase Auth prüfen.");
          setAuthError("Anmeldestatus konnte nicht gelesen werden. Bitte Supabase Auth prüfen.");
          setAuthReady(false);
          setAuthChecked(true);
          setIsLoading(false);
        }
        return;
      }

      if (!ignore) {
        setCurrentUserId(session?.user?.id || "");
        setSessionEmail(session?.user?.email || "");
        setAuthReady(Boolean(session?.user?.id));
        setAuthChecked(true);
        setAuthError("");
      }

      if (session?.user?.id) {
        await fetchAllAvailability();
      }

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
    if (!pollId || typeof window === "undefined" || supabaseRef.current) return;
    localStorage.setItem(getStorageKey(pollId), JSON.stringify({ availability }));
  }, [availability, pollId]);

  useEffect(() => {
    if (!currentOwnerKey) {
      setDraftAvailability({});
      setIsDirty(false);
      return;
    }

    const committed = normalizePersonAvailability(
      availability[currentOwnerKey]?.availability || {}
    );
    setDraftAvailability(committed);
    setIsDirty(false);
  }, [availability, currentOwnerKey]);

  useEffect(() => {
    if (!currentOwnerKey) return;
    if (savedMyName) return;

    const serverName = availability[currentOwnerKey]?.participantName?.trim() || "";

    if (serverName) {
      setMyName(serverName);
      setSavedMyName(serverName);
      setParticipantNameInput(serverName);
    }
  }, [availability, currentOwnerKey, savedMyName]);

  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase || !pollId) return;

    const channel = supabase
      .channel(`meeting-poll-${pollId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "meeting_availability",
          filter: `poll_id=eq.${pollId}`,
        },
        async () => {
          if (currentUserId) {
            await fetchAllAvailability();
          }
        }
      )
      .subscribe();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const nextUserId = session?.user?.id || "";
      setCurrentUserId(nextUserId);
      setSessionEmail(session?.user?.email || "");
      setAuthReady(Boolean(nextUserId));
      setAuthChecked(true);
      if (nextUserId) {
        setAuthError("");
        await fetchAllAvailability();
      } else {
        setAvailability({});
      }
    });

    return () => {
      void supabase.removeChannel(channel);
      subscription.unsubscribe();
    };
  }, [pollId, currentUserId]);

  const participants = useMemo(
    () =>
      Object.entries(availability)
        .map(([ownerKey, entry]) => ({
          ownerKey,
          name: entry.participantName || ownerKey,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "de")),
    [availability]
  );

  const weekRangeLabel = useMemo(() => formatWeekRange(weekStart), [weekStart]);

  const canEditCurrentView =
    activeCalendarView === "all" || activeCalendarView === currentOwnerKey;

  const aggregatedCellCountMap = useMemo(() => {
    const map: Record<string, number> = {};

    Object.values(availability).forEach((entry) => {
      Object.entries(entry.availability).forEach(([dateKey, slots]) => {
        slots.forEach((slotId) => {
          const key = `${dateKey}__${slotId}`;
          map[key] = (map[key] || 0) + 1;
        });
      });
    });

    return map;
  }, [availability]);

  const viewedParticipantName =
    activeCalendarView === "all"
      ? ""
      : availability[activeCalendarView]?.participantName || "";

  const viewedPersonAvailability = useMemo<PersonAvailability>(() => {
    if (activeCalendarView === "all") return {};
    return normalizePersonAvailability(
      availability[activeCalendarView]?.availability || {}
    );
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
    activeCalendarView === "all"
      ? "Gemeinsamer Kalender"
      : viewedParticipantName
        ? `Auswahl von ${viewedParticipantName}`
        : "Persönlicher Kalender";

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

    if (updated.length === 0) {
      delete next[dateKey];
    } else {
      next[dateKey] = [...updated].sort();
    }

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
      setSaveMessage("Bitte melden Sie sich zuerst per Magic Link an.");
      return;
    }

    const normalizedDraft = normalizePersonAvailability(draftAvailability);
    setIsSaving(true);
    setSaveMessage("");

    try {
      if (supabase) {
        const { error: deleteError } = await supabase
          .from("meeting_availability")
          .delete()
          .eq("poll_id", pollId)
          .eq("owner_user_id", currentUserId);

        if (deleteError) throw deleteError;

        const rowsToInsert = flattenPersonAvailability(
          normalizedDraft,
          trimmedName,
          currentUserId,
          pollId
        );

        if (rowsToInsert.length > 0) {
          const { error: insertError } = await supabase
            .from("meeting_availability")
            .insert(rowsToInsert);

          if (insertError) throw insertError;
        }

        await fetchAllAvailability();
      } else {
        setAvailability((prev) => {
          const next = { ...prev };
          const previousLocalKey = savedMyName?.trim();

          if (previousLocalKey && previousLocalKey !== trimmedName) {
            delete next[previousLocalKey];
          }

          next[trimmedName] = {
            participantName: trimmedName,
            availability: normalizedDraft,
          };

          return next;
        });
      }

      setSavedMyName(trimmedName);
      setMyName(trimmedName);
      setParticipantNameInput(trimmedName);
      setDraftAvailability(normalizedDraft);
      setIsDirty(false);
      setSaveMessage("Ihre Verfügbarkeit wurde gespeichert.");
    } catch (error) {
      console.error(error);
      setSaveMessage(
        "Speichern fehlgeschlagen. Bitte Tabellenstruktur, RLS-Policy, Auth-Einstellungen und Netzwerk prüfen."
      );
    } finally {
      setIsSaving(false);
    }
  }

  function goPrevWeek(): void {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() - 7);
      return next;
    });
  }

  function goNextWeek(): void {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() + 7);
      return next;
    });
  }

  function goToCurrentWeek(): void {
    setWeekStart(getWeekStart(new Date()));
  }

  const mySavedAvailability = currentOwnerKey
    ? normalizePersonAvailability(availability[currentOwnerKey]?.availability || {})
    : {};

  const hasServerDiff =
    Boolean(currentOwnerKey) &&
    !arePersonAvailabilityEqual(mySavedAvailability, draftAvailability);

  return (
    <div className="min-h-screen bg-[#f6f7f4] p-3 sm:p-4 lg:p-6">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 lg:gap-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="text-3xl font-bold text-slate-900">Terminabstimunger</div>
          <div className="mt-2 text-base text-slate-600 sm:text-lg">
            Meeting: Weiterentwicklung KS-Schallschutzrechners
          </div>
          <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
            <strong>Kurzanleitung:</strong> Geben Sie Ihren Namen ein und bestätigen Sie ihn.
            Wählen Sie anschließend passende Zeitfenster im Kalender aus und speichern Sie danach
            Ihre Auswahl.
          </div>
        </div>

        {supabaseRef.current && (
          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Mail className="h-5 w-5" />
                Anmeldung per Magic Link
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isLoggedIn ? (
                <>
                  <div className="flex flex-col gap-3 xl:flex-row">
                    <Input
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="Ihre E-Mail-Adresse"
                      onKeyDown={(e) => e.key === "Enter" && void sendMagicLink()}
                      className="h-11 rounded-xl"
                    />
                    <Button
                      onClick={() => void sendMagicLink()}
                      className="h-11 rounded-xl"
                      disabled={isSendingMagicLink}
                    >
                      {isSendingMagicLink ? "Wird gesendet…" : "Magic Link senden"}
                    </Button>
                  </div>

                  <div className="text-sm text-slate-500">
                    Melden Sie sich mit Ihrer E-Mail-Adresse an. Danach können Sie Ihre eigenen
                    Zeitfenster bearbeiten und speichern.
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-sm text-slate-700">
                    <span>Angemeldet als</span>
                    <Badge variant="secondary">{sessionEmail || "Benutzer"}</Badge>
                  </div>
                  <Button variant="outline" className="gap-2 rounded-xl" onClick={() => void signOut()}>
                    <LogOut className="h-4 w-4" />
                    Abmelden
                  </Button>
                </div>
              )}

              {authMessage && (
                <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">
                  {authMessage}
                </div>
              )}

              {authError && (
                <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
                  {authError}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Users className="h-5 w-5" />
              Namen eingeben
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 xl:flex-row">
              <Input
                value={participantNameInput}
                onChange={(e) => setParticipantNameInput(e.target.value)}
                placeholder="Ihren Namen eingeben"
                onKeyDown={(e) => e.key === "Enter" && registerMe()}
                className="h-11 rounded-xl"
                disabled={!isLoggedIn}
              />
              <Button onClick={registerMe} className="h-11 rounded-xl" disabled={!isLoggedIn}>
                Bestätigen
              </Button>
            </div>

            <div className="space-y-3">
              <div className="text-sm font-medium text-slate-700">Kalenderansicht</div>
              <div className="text-sm text-slate-500">
                Klicken Sie auf einen Teilnehmendennamen, um nur dessen bereits gespeicherte
                Auswahl zu sehen. Im gemeinsamen Kalender sehen Sie alle bereits gewählten
                Zeitfenster.
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant={activeCalendarView === "all" ? "default" : "secondary"}
                  className="cursor-pointer px-3 py-1.5"
                  onClick={() => setActiveCalendarView("all")}
                >
                  Gemeinsamer Kalender
                </Badge>

                {participants.map((participant) => (
                  <Badge
                    key={participant.ownerKey}
                    variant={activeCalendarView === participant.ownerKey ? "default" : "secondary"}
                    className="cursor-pointer px-3 py-1.5"
                    onClick={() => setActiveCalendarView(participant.ownerKey)}
                  >
                    {participant.name}
                  </Badge>
                ))}
              </div>
            </div>

            {isLoading ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                Daten werden geladen…
              </div>
            ) : supabaseRef.current && !authChecked ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                Anmeldestatus wird geprüft…
              </div>
            ) : supabaseRef.current && !isLoggedIn ? (
              <div className="rounded-2xl border border-dashed border-amber-300 p-4 text-sm text-amber-700">
                Bitte melden Sie sich zuerst per Magic Link an.
              </div>
            ) : null}

            {hasServerDiff && !isDirty && (
              <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
                Der lokale Entwurf weicht von den Serverdaten ab. Bitte erneut auswählen und speichern.
              </div>
            )}

            {saveMessage && (
              <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">
                {saveMessage}
              </div>
            )}
          </CardContent>
        </Card>

        {!supabaseRef.current && (
          <Alert className="rounded-2xl border-amber-200 bg-amber-50">
            <AlertDescription className="text-sm leading-6 text-amber-900">
              NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_ANON_KEY sind noch nicht gesetzt.
              Die Seite läuft nur im lokalen Demo-Modus ohne Magic Link.
            </AlertDescription>
          </Alert>
        )}

        <Card className="overflow-hidden rounded-[28px] border-slate-200 shadow-sm">
          <CardHeader className="gap-3 border-b border-slate-100 pb-4 sm:gap-4 sm:pb-5">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 lg:justify-between">
              <div className="flex w-full flex-wrap items-center justify-center gap-2 sm:gap-3 lg:w-auto lg:justify-start">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-[16px] border border-slate-200 bg-white sm:h-11 sm:w-11 sm:rounded-[18px] lg:h-14 lg:w-14 lg:rounded-[22px]"
                  onClick={goPrevWeek}
                  aria-label="Vorherige Woche"
                >
                  <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5 lg:h-7 lg:w-7" />
                </Button>

                <div className="min-w-[150px] flex-1 rounded-[16px] border border-slate-200 bg-white px-3 py-2 text-center text-base font-semibold text-slate-900 sm:min-w-[240px] sm:flex-none sm:rounded-[18px] sm:px-4 sm:py-2.5 sm:text-xl lg:min-w-[420px] lg:rounded-[24px] lg:px-6 lg:py-4 lg:text-3xl">
                  {weekRangeLabel}
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-[16px] border border-slate-200 bg-white sm:h-11 sm:w-11 sm:rounded-[18px] lg:h-14 lg:w-14 lg:rounded-[22px]"
                  onClick={goNextWeek}
                  aria-label="Nächste Woche"
                >
                  <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 lg:h-7 lg:w-7" />
                </Button>

                <Button
                  variant="outline"
                  className="h-9 rounded-[16px] border-2 border-green-500 px-3 text-xs font-semibold text-green-600 hover:bg-green-50 sm:h-11 sm:rounded-[18px] sm:px-4 sm:text-sm lg:h-14 lg:rounded-[22px] lg:px-6 lg:text-lg"
                  onClick={goToCurrentWeek}
                >
                  Heute
                </Button>
              </div>

              <Button
                className="h-9 w-full gap-2 rounded-[16px] sm:h-11 sm:w-auto sm:rounded-[18px] lg:h-14 lg:rounded-[22px] lg:px-6 lg:text-lg"
                onClick={() => void saveMyAvailability()}
                disabled={isSaving || !savedMyName || !isDirty || !canEditCurrentView || !isLoggedIn}
              >
                <Save className="h-4 w-4 lg:h-5 lg:w-5" />
                {isSaving ? "Wird gespeichert…" : "Auswahl speichern"}
              </Button>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-600 sm:text-sm">
                  Ein Klick markiert ein Zeitfenster. Ein weiterer Klick entfernt die Auswahl wieder.
                </p>
                <div className="text-sm font-medium text-slate-700">{calendarTitle}</div>
              </div>

              <div className="rounded-2xl bg-slate-50 p-3 text-xs leading-6 text-slate-600 sm:text-sm">
                <strong>Farben im Kalender:</strong> Weiße Felder bedeuten, dass bisher niemand
                dieses Zeitfenster gewählt hat. Hellgrüne Felder zeigen bereits gewählte
                Zeitfenster im gemeinsamen Kalender. Dunkelgrüne Felder markieren die aktuell
                beliebtesten drei Zeitfenster im gemeinsamen Kalender. Ein blauer Rand bedeutet,
                dass Sie dieses Zeitfenster in Ihrem eigenen Entwurf ausgewählt haben. Die Zahl im
                Feld zeigt, wie viele Teilnehmende dieses Zeitfenster gewählt haben – im Verhältnis
                zur Gesamtzahl aller Teilnehmenden.
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-2 sm:p-3 lg:p-5">
            <div className="w-full overflow-auto rounded-[24px] border border-slate-100 max-h-[75vh]">
              <div className="grid min-w-[900px] grid-cols-[64px_repeat(7,minmax(0,1fr))] gap-1 bg-[#f6f7f4] p-1 sm:grid-cols-[78px_repeat(7,minmax(0,1fr))] sm:gap-1.5 sm:p-1.5 md:grid-cols-[88px_repeat(7,minmax(0,1fr))] lg:grid-cols-[110px_repeat(7,minmax(0,1fr))] lg:gap-3 lg:p-3">
                <div className="sticky left-0 top-0 z-40 rounded-[14px] bg-[#f6f7f4]" />

                {weekDays.map((day, index) => {
                  const dateKey = formatDateKey(day);
                  const ownDraftHasSelection = Boolean((draftAvailability[dateKey] || []).length);
                  const isToday = formatDateKey(day) === formatDateKey(new Date());

                  return (
                    <div
                      key={dateKey}
                      className={`sticky top-0 z-30 rounded-[18px] border border-slate-200 px-1 py-2 text-center shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/90 sm:rounded-[22px] sm:px-2 sm:py-3 lg:rounded-[28px] lg:px-3 lg:py-5 ${
                        activeCalendarView === "all" && ownDraftHasSelection
                          ? "bg-blue-50"
                          : "bg-white"
                      }`}
                    >
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 sm:text-xs">
                        {WEEKDAYS[index]}
                      </div>
                      <div
                        className={`mt-1 text-2xl font-semibold leading-none sm:text-3xl lg:mt-2 lg:text-5xl ${
                          activeCalendarView === "all" && ownDraftHasSelection
                            ? "text-blue-700"
                            : "text-slate-800"
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
                    <div className="sticky left-0 z-20 flex items-start rounded-[16px] border border-slate-200 bg-white px-1.5 py-2 text-[10px] font-medium leading-tight text-slate-700 shadow-sm sm:rounded-[20px] sm:px-2.5 sm:py-3 sm:text-xs md:text-sm lg:rounded-[28px] lg:px-4 lg:py-6 lg:text-xl xl:text-2xl">
                      {slot.label}
                    </div>

                    {weekDays.map((day) => {
                      const dateKey = formatDateKey(day);

                      const ownDraftSelected = (draftAvailability[dateKey] || []).includes(slot.id);
                      const aggregatedCount = aggregatedCellCountMap[`${dateKey}__${slot.id}`] || 0;
                      const savedPersonalSelected = Boolean(
                        viewedPersonAvailability[dateKey]?.includes(slot.id)
                      );

                      const isOwnPersonalView =
                        activeCalendarView !== "all" && activeCalendarView === currentOwnerKey;

                      const isForeignPersonalView =
                        activeCalendarView !== "all" && activeCalendarView !== currentOwnerKey;

                      const displayedPersonalSelected = isOwnPersonalView
                        ? ownDraftSelected
                        : savedPersonalSelected;

                      const isTopThree =
                        activeCalendarView === "all" &&
                        topThreeCellKeys.has(`${dateKey}__${slot.id}`);

                      const showOwnBlueBorder =
                        (activeCalendarView === "all" || isOwnPersonalView) && ownDraftSelected;

                      const isFilledInCurrentView =
                        activeCalendarView === "all"
                          ? aggregatedCount > 0
                          : displayedPersonalSelected;

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
                          type="button"
                          disabled={isForeignPersonalView || !isLoggedIn}
                          onClick={() => {
                            if (!isForeignPersonalView && isLoggedIn) {
                              toggleCell(dateKey, slot.id);
                            }
                          }}
                          className={`relative min-h-[52px] rounded-[14px] px-1 py-1 text-left transition sm:min-h-[68px] sm:rounded-[18px] sm:px-1.5 sm:py-1.5 md:min-h-[82px] md:rounded-[20px] lg:min-h-[112px] lg:rounded-[28px] lg:px-4 lg:py-4 ${
                            isForeignPersonalView || !isLoggedIn
                              ? "cursor-default opacity-100"
                              : "cursor-pointer"
                          } ${
                            isFilledInCurrentView
                              ? `${borderClass} ${filledClass}`
                              : `${borderClass} bg-white text-slate-800 ${
                                  isForeignPersonalView || !isLoggedIn ? "" : "hover:bg-slate-50"
                                }`
                          }`}
                        >
                          <div className="flex h-full items-end justify-end">
                            {activeCalendarView === "all" ? (
                              aggregatedCount > 0 ? (
                                <Badge
                                  variant="outline"
                                  className={`max-w-full whitespace-nowrap px-1 py-0 text-[9px] font-semibold leading-none sm:px-1.5 sm:py-0.5 sm:text-[11px] md:px-2 md:py-0.5 md:text-xs lg:px-2.5 lg:py-1 lg:text-sm xl:text-base ${
                                    isTopThree
                                      ? "border-white/40 bg-white/10 text-white"
                                      : "border-slate-200 text-slate-700"
                                  }`}
                                >
                                  {aggregatedCount} / {participants.length}
                                </Badge>
                              ) : null
                            ) : displayedPersonalSelected ? (
                              <Badge
                                variant="outline"
                                className="max-w-full whitespace-nowrap border-slate-200 px-1 py-0 text-[9px] font-semibold leading-none text-slate-700 sm:px-1.5 sm:py-0.5 sm:text-[11px] md:px-2 md:py-0.5 md:text-xs lg:px-2.5 lg:py-1 lg:text-sm xl:text-base"
                              >
                                {aggregatedCount} / {participants.length}
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
            <p className="text-sm text-slate-600">
              Angezeigt werden alle Zeitfenster, die von mehr als der Hälfte der Teilnehmenden
              gewählt wurden – sortiert von den meisten zu den wenigsten Stimmen.
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