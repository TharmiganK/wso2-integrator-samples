import { useState, type FormEvent } from "react";

// ---------------------------------------------------------------------------
// Dynamic VALUE rendering (read-only). Renders an arbitrary object one level
// deep: primitives inline, nested objects/arrays as a compact JSON block.
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function renderScalar(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Renders a record as a definition list, one level deep. */
export function KeyValues({ data }: { data: Record<string, unknown> | null | undefined }) {
  if (!data || Object.keys(data).length === 0) {
    return <p className="muted">No fields.</p>;
  }
  return (
    <dl className="kv">
      {Object.entries(data).map(([key, value]) => (
        <div className="kv-row" key={key}>
          <dt>{humanize(key)}</dt>
          <dd>
            {typeof value === "object" && value !== null ? (
              <pre className="json">{renderScalar(value)}</pre>
            ) : (
              renderScalar(value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Dynamic FORM rendering. A form is described by a list of fields. Field values
// that are themselves objects are edited as JSON (the "one level deep" rule).
// ---------------------------------------------------------------------------

export type FieldType = "boolean" | "text" | "textarea" | "number" | "json";

export interface FormField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  default?: unknown;
}

// Known completion forms, keyed by the (short) human-task name. Falls back to a
// raw-JSON editor for any task we don't have an explicit form for.
export const COMPLETION_FORMS: Record<string, FormField[]> = {
  // Completing the task replays the order; use the "Fail task" action to discard it
  // to the dead-letter store instead, so there is no replay toggle here.
  reviewFailedSalesOrder: [
    {
      name: "editedPayload",
      label: "Corrected order (optional)",
      type: "json",
      help: "Provide a corrected order to replay instead of the original payload.",
    },
    { name: "comments", label: "Comments", type: "textarea" },
  ],
};

/**
 * Build dynamic form fields from a JSON Schema string (one level deep). The
 * workflow runtime auto-derives this schema from the human task's expected
 * result type, so the completion form adapts automatically if that type changes.
 */
export function fieldsFromJsonSchema(schemaJson: string | null | undefined): FormField[] | null {
  if (!schemaJson) return null;
  let schema: any;
  try {
    schema = JSON.parse(schemaJson);
  } catch {
    return null;
  }
  if (!schema || schema.type !== "object" || typeof schema.properties !== "object") return null;
  const required: string[] = Array.isArray(schema.required) ? schema.required : [];
  return Object.entries(schema.properties as Record<string, any>).map(([name, prop]) => {
    let t = prop?.type;
    if (Array.isArray(t)) t = t.find((x: string) => x !== "null") ?? "string";
    let type: FieldType = "text";
    if (t === "boolean") type = "boolean";
    else if (t === "number" || t === "integer") type = "number";
    else if (t === "object" || t === "array") type = "json";
    return {
      name,
      label: humanize(name),
      type,
      required: required.includes(name),
      default: prop?.default ?? (type === "boolean" ? false : undefined),
    };
  });
}

/** Build dynamic form fields from an example object, one level deep. */
export function fieldsFromObject(obj: Record<string, unknown>): FormField[] {
  return Object.entries(obj).map(([name, value]) => {
    let type: FieldType = "text";
    if (typeof value === "boolean") type = "boolean";
    else if (typeof value === "number") type = "number";
    else if (isPlainObject(value) || Array.isArray(value)) type = "json";
    return { name, label: humanize(name), type, default: value };
  });
}

function initialValues(fields: FormField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === "json") out[f.name] = JSON.stringify(f.default ?? {}, null, 2);
    else if (f.type === "boolean") out[f.name] = Boolean(f.default ?? false);
    else out[f.name] = f.default ?? "";
  }
  return out;
}

/** Convert raw form state into the typed payload to submit. */
function collect(fields: FormField[], values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.type === "json") out[f.name] = JSON.parse(String(v || "null"));
    else if (f.type === "number") out[f.name] = v === "" ? null : Number(v);
    else if (f.type === "boolean") out[f.name] = Boolean(v);
    else {
      if (v === "" && !f.required) continue; // omit empty optional strings
      out[f.name] = v;
    }
  }
  return out;
}

export function DynamicForm({
  fields,
  submitLabel,
  onSubmit,
  busy,
}: {
  fields: FormField[];
  submitLabel: string;
  onSubmit: (payload: Record<string, unknown>) => void;
  busy?: boolean;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(fields));
  const [error, setError] = useState<string | null>(null);

  function set(name: string, value: unknown) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      onSubmit(collect(fields, values));
      setError(null);
    } catch (err) {
      setError(`Invalid JSON: ${(err as Error).message}`);
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      {fields.map((f) => (
        <div className="field" key={f.name}>
          {f.type === "boolean" ? (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={Boolean(values[f.name])}
                onChange={(e) => set(f.name, e.target.checked)}
              />
              {f.label}
            </label>
          ) : (
            <>
              <label>{f.label}{f.required ? " *" : ""}</label>
              {f.type === "textarea" || f.type === "json" ? (
                <textarea
                  rows={f.type === "json" ? 6 : 3}
                  className={f.type === "json" ? "mono" : ""}
                  value={String(values[f.name] ?? "")}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              ) : (
                <input
                  type={f.type === "number" ? "number" : "text"}
                  value={String(values[f.name] ?? "")}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              )}
            </>
          )}
          {f.help && <p className="muted small">{f.help}</p>}
        </div>
      ))}
      {error && <p className="error">{error}</p>}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? "Working…" : submitLabel}
      </button>
    </form>
  );
}
