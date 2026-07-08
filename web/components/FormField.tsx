export function FormField({
  label,
  value,
  onChange,
  type = "text",
  required,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="block text-sm">
      <span className="text-ink-secondary">{label}</span>
      <input
        type={type}
        required={required}
        maxLength={maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink-primary focus:outline-none focus:ring-2 focus:ring-cat-blue"
      />
    </label>
  );
}
