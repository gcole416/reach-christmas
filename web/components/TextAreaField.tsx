export function TextAreaField({
  label,
  value,
  onChange,
  rows = 2,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-ink-secondary">{label}</span>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-cat-blue"
      />
    </label>
  );
}
