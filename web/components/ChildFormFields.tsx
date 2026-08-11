import type { IntakeChildInput } from "@/lib/store";
import { FormField } from "@/components/FormField";
import { TextAreaField } from "@/components/TextAreaField";

// Shared between the intake form (new family) and the family edit page
// (existing family). `id` distinguishes the two cases for the caller: null
// means "not saved yet" (insert on submit), a uuid means "existing row"
// (update on submit) — the fields themselves are identical either way.
export interface ChildFormState extends IntakeChildInput {
  key: string;
  id: string | null;
  // The `Child.updatedAt` this block was seeded from, so the edit page can tell
  // the data layer which version of the row the user was looking at (US-13).
  // Opaque string — seed it straight from `Child.updatedAt` and pass it back
  // untouched; never round-trip it through `new Date(...)`/`.toISOString()` or
  // a datetime input, which drops microseconds and makes every save look like a
  // conflict. null means "this block isn't a saved row yet" (insert on submit).
  updatedAt: string | null;
}

export function emptyChild(): ChildFormState {
  return {
    key: crypto.randomUUID(),
    id: null,
    updatedAt: null,
    firstName: "",
    grade: "",
    age: "",
    sex: "",
    specificNeeds: "",
    pantSize: "",
    shirtSize: "",
    shoeSize: "",
    otherNotes: "",
    targetCardCount: "1",
    wishlistItems: ["", "", ""],
  };
}

export function ChildFormFields({
  child,
  index,
  canRemove,
  onChange,
  onRemove,
  onWishlistChange,
  onAddWishlistItem,
  onRemoveWishlistItem,
}: {
  child: ChildFormState;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<ChildFormState>) => void;
  onRemove: () => void;
  onWishlistChange: (idx: number, value: string) => void;
  onAddWishlistItem: () => void;
  onRemoveWishlistItem: (idx: number) => void;
}) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-primary">
          {child.id ? child.firstName || `Child ${index + 1}` : `Child ${index + 1}`}
        </h3>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs font-medium text-ink-secondary hover:text-status-critical"
          >
            Remove
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <FormField label="First name" value={child.firstName} onChange={(v) => onChange({ firstName: v })} required />
        <FormField
          label="Grade"
          value={child.grade}
          onChange={(v) => onChange({ grade: v })}
          placeholder="e.g. K, 3, 10"
        />
        <FormField label="Age" value={child.age} onChange={(v) => onChange({ age: v })} type="number" />
        <FormField label="Sex" value={child.sex} onChange={(v) => onChange({ sex: v })} />
        <FormField label="Pant size" value={child.pantSize} onChange={(v) => onChange({ pantSize: v })} />
        <FormField label="Shirt size" value={child.shirtSize} onChange={(v) => onChange({ shirtSize: v })} />
        <FormField label="Shoe size" value={child.shoeSize} onChange={(v) => onChange({ shoeSize: v })} />
        <FormField
          label="Sponsor slots"
          value={child.targetCardCount}
          onChange={(v) => onChange({ targetCardCount: v })}
          type="number"
        />
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        Sponsor slots: how many separate sponsors this child can have (splits their wishlist across that
        many printed cards). Most kids only need 1.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextAreaField
          label="Specific needs"
          value={child.specificNeeds}
          onChange={(v) => onChange({ specificNeeds: v })}
        />
        <TextAreaField label="Other notes" value={child.otherNotes} onChange={(v) => onChange({ otherNotes: v })} />
      </div>

      <div className="mt-3">
        <span className="text-sm text-ink-secondary">Wishlist</span>
        <div className="mt-1 space-y-2">
          {child.wishlistItems.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                value={item}
                onChange={(e) => onWishlistChange(idx, e.target.value)}
                placeholder={`Wishlist item ${idx + 1}`}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-cat-blue"
              />
              <button
                type="button"
                onClick={() => onRemoveWishlistItem(idx)}
                aria-label={`Remove wishlist item ${idx + 1}`}
                className="shrink-0 rounded-full px-2 py-1 text-ink-muted hover:text-status-critical"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onAddWishlistItem}
          className="mt-2 text-xs font-medium text-cat-blue hover:opacity-80"
        >
          + Add wishlist item
        </button>
      </div>
    </div>
  );
}
