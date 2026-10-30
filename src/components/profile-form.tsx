"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ProfileFieldName } from "@/lib/profile-schema";
import type { ProfileFormState } from "@/app/actions/profile";
import { SubmitButton } from "@/components/submit-button";
import { DOMAINS, LIMITS, SENIORITY_LEVELS, TARGET_ROLES, WEAK_AREAS } from "@/lib/profile-options";

export type ProfileFormValues = {
  full_name: string;
  years_experience: string;
  target_role: string;
  seniority: string;
  domains: string[];
  target_companies: string;
  weak_areas: string[];
  interview_date: string;
};

type Props = {
  mode: "onboarding" | "edit";
  initial: ProfileFormValues;
  /** Earliest date the picker offers (from the server, matching server-side validation). */
  minInterviewDate: string;
  action: (prev: ProfileFormState, formData: FormData) => Promise<ProfileFormState>;
};

const idle: ProfileFormState = { status: "idle" };

// Order in which fields appear, used to focus the first error.
const FIELD_ORDER: ProfileFieldName[] = [
  "full_name",
  "years_experience",
  "target_role",
  "seniority",
  "domains",
  "target_companies",
  "weak_areas",
  "interview_date",
];

export function ProfileForm({ mode, initial, minInterviewDate, action }: Props) {
  const [state, formAction] = useActionState(action, idle);
  const [values, setValues] = useState<ProfileFormValues>(initial);
  const [savedValues, setSavedValues] = useState<ProfileFormValues>(initial);
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>(undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();

  // After a successful save, the current values become the new baseline.
  if (state.status === "saved" && state.savedAt !== lastSavedAt) {
    setLastSavedAt(state.savedAt);
    setSavedValues(values);
  }

  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(savedValues), [values, savedValues]);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Move focus to the first field with an error so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (state.status !== "error" || !state.fieldErrors) return;
    const firstBad = FIELD_ORDER.find((f) => state.fieldErrors?.[f]);
    if (!firstBad) return;
    const el = formRef.current?.querySelector<HTMLElement>(`[data-field="${firstBad}"]`);
    el?.focus();
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state]);

  const set = <K extends keyof ProfileFormValues>(key: K, value: ProfileFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const toggle = (key: "domains" | "weak_areas", value: string) =>
    setValues((v) => {
      const list = v[key];
      return { ...v, [key]: list.includes(value) ? list.filter((x) => x !== value) : [...list, value] };
    });

  const domainLimitReached = values.domains.length >= LIMITS.maxDomains;
  // A stored date that has passed may be kept; a newly entered one must be upcoming.
  const dateMin = values.interview_date && values.interview_date === initial.interview_date ? undefined : minInterviewDate;

  const err = (f: ProfileFieldName) => errors[f];
  const describedBy = (f: ProfileFieldName, hint = false) =>
    [hint ? `${id}-${f}-hint` : null, err(f) ? `${id}-${f}-error` : null].filter(Boolean).join(" ") || undefined;
  const errorText = (field: ProfileFieldName) =>
    err(field) ? (
      <p id={`${id}-${field}-error`} className="field-error" role="alert">
        {err(field)}
      </p>
    ) : null;

  return (
    <form ref={formRef} action={formAction} className="grid gap-12" noValidate>
      {state.status === "error" && state.message ? (
        <p className="notice notice-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <section className="grid gap-5" aria-labelledby={`${id}-about`}>
        <h2 id={`${id}-about`} className="text-[1.3rem]!">
          About you
        </h2>
        <div className="grid gap-5 sm:grid-cols-[1fr_12rem]">
          <div className="field">
            <label className="label" htmlFor={`${id}-full_name`}>
              Name
            </label>
            <input
              id={`${id}-full_name`}
              data-field="full_name"
              name="full_name"
              className="input"
              autoComplete="name"
              maxLength={LIMITS.fullNameMax}
              required
              value={values.full_name}
              onChange={(e) => set("full_name", e.target.value)}
              aria-invalid={err("full_name") ? true : undefined}
              aria-describedby={describedBy("full_name")}
            />
            {errorText("full_name")}
          </div>
          <div className="field">
            <label className="label" htmlFor={`${id}-years_experience`}>
              Years of experience
            </label>
            <input
              id={`${id}-years_experience`}
              data-field="years_experience"
              name="years_experience"
              className="input tabular-nums"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              required
              value={values.years_experience}
              onChange={(e) => set("years_experience", e.target.value.replace(/\D/g, "").slice(0, 2))}
              aria-invalid={err("years_experience") ? true : undefined}
              aria-describedby={describedBy("years_experience")}
            />
            {errorText("years_experience")}
          </div>
        </div>
      </section>

      <section className="grid gap-8" aria-labelledby={`${id}-target`}>
        <h2 id={`${id}-target`} className="text-[1.3rem]!">
          The interview you&apos;re preparing for
        </h2>

        <fieldset
          className="grid gap-3"
          aria-invalid={err("target_role") ? true : undefined}
          aria-describedby={describedBy("target_role")}
        >
          <legend className="label mb-3">Role</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {TARGET_ROLES.map((r, i) => (
              <label key={r.value} className="option">
                <input
                  type="radio"
                  name="target_role"
                  value={r.value}
                  checked={values.target_role === r.value}
                  onChange={() => set("target_role", r.value)}
                  data-field={i === 0 ? "target_role" : undefined}
                />
                <span className="option-title">{r.label}</span>
              </label>
            ))}
          </div>
          {errorText("target_role")}
        </fieldset>

        <fieldset
          className="grid gap-3"
          aria-invalid={err("seniority") ? true : undefined}
          aria-describedby={describedBy("seniority", true)}
        >
          <legend className="label mb-1">Level</legend>
          <p id={`${id}-seniority-hint`} className="hint mb-2">
            Sets how much the interviewer guides you and how deep the follow-ups go.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {SENIORITY_LEVELS.map((s, i) => (
              <label key={s.value} className="option">
                <input
                  type="radio"
                  name="seniority"
                  value={s.value}
                  checked={values.seniority === s.value}
                  onChange={() => set("seniority", s.value)}
                  data-field={i === 0 ? "seniority" : undefined}
                />
                <span className="option-title">{s.label}</span>
                <span className="option-hint">{s.hint}</span>
              </label>
            ))}
          </div>
          {errorText("seniority")}
        </fieldset>

        <fieldset
          className="grid gap-3"
          aria-invalid={err("domains") ? true : undefined}
          aria-describedby={describedBy("domains", true)}
        >
          <legend className="label mb-1">Domains</legend>
          <p id={`${id}-domains-hint`} className="hint mb-2" aria-live="polite">
            Pick up to {LIMITS.maxDomains}. Your problems come from these. {values.domains.length} of{" "}
            {LIMITS.maxDomains} selected.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {DOMAINS.map((d, i) => {
              const checked = values.domains.includes(d.value);
              return (
                <label key={d.value} className="option">
                  <input
                    type="checkbox"
                    name="domains"
                    value={d.value}
                    checked={checked}
                    disabled={!checked && domainLimitReached}
                    onChange={() => toggle("domains", d.value)}
                    data-field={i === 0 ? "domains" : undefined}
                  />
                  <span className="option-title">{d.label}</span>
                  <span className="option-hint">{d.hint}</span>
                </label>
              );
            })}
          </div>
          {errorText("domains")}
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-[1fr_14rem]">
          <div className="field">
            <label className="label" htmlFor={`${id}-target_companies`}>
              Target companies <span className="font-normal text-ink-faint">(optional)</span>
            </label>
            <input
              id={`${id}-target_companies`}
              data-field="target_companies"
              name="target_companies"
              className="input"
              placeholder="Stripe, Netflix, Uber"
              autoComplete="off"
              maxLength={LIMITS.maxCompanies * (LIMITS.companyNameMax + 2)}
              value={values.target_companies}
              onChange={(e) => set("target_companies", e.target.value)}
              aria-invalid={err("target_companies") ? true : undefined}
              aria-describedby={describedBy("target_companies", true)}
            />
            <p id={`${id}-target_companies-hint`} className="hint">
              Up to {LIMITS.maxCompanies}, separated by commas.
            </p>
            {errorText("target_companies")}
          </div>
          <div className="field">
            <label className="label" htmlFor={`${id}-interview_date`}>
              Interview date <span className="font-normal text-ink-faint">(optional)</span>
            </label>
            <div className="flex gap-2">
              <input
                id={`${id}-interview_date`}
                data-field="interview_date"
                name="interview_date"
                type="date"
                className="input"
                min={dateMin}
                value={values.interview_date}
                onChange={(e) => set("interview_date", e.target.value)}
                aria-invalid={err("interview_date") ? true : undefined}
                aria-describedby={describedBy("interview_date")}
              />
              {values.interview_date ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => set("interview_date", "")}
                  aria-label="Clear interview date"
                >
                  Clear
                </button>
              ) : null}
            </div>
            {errorText("interview_date")}
          </div>
        </div>
      </section>

      <section className="grid gap-3" aria-labelledby={`${id}-focus`}>
        <h2 id={`${id}-focus`} className="text-[1.3rem]!">
          What you want to get better at <span className="text-base font-normal text-ink-faint">(optional)</span>
        </h2>
        <p className="hint">The interviewer will push harder on these.</p>
        <div className="flex flex-wrap gap-2" data-field="weak_areas" tabIndex={-1}>
          {WEAK_AREAS.map((w) => (
            <label key={w.value} className="option py-2!">
              <input
                type="checkbox"
                name="weak_areas"
                value={w.value}
                checked={values.weak_areas.includes(w.value)}
                onChange={() => toggle("weak_areas", w.value)}
              />
              <span className="option-title font-medium!">{w.label}</span>
            </label>
          ))}
        </div>
        {errorText("weak_areas")}
      </section>

      <div className="flex flex-wrap items-center gap-4 border-t border-grid pt-6">
        <SubmitButton pendingLabel="Saving…" disabled={mode === "edit" && !dirty}>
          {mode === "onboarding" ? "Save profile and continue" : "Save changes"}
        </SubmitButton>
        {mode === "edit" && dirty ? (
          <button type="button" className="btn btn-ghost" onClick={() => setValues(savedValues)}>
            Discard changes
          </button>
        ) : null}
        <span className="text-sm text-ink-faint" role="status" aria-live="polite">
          {mode === "edit" && !dirty && state.status === "saved" ? "Changes saved." : null}
        </span>
      </div>
    </form>
  );
}
