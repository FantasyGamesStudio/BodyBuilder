import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { advisorApi, type RecurringFood } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

function referenceLabel(food: RecurringFood): string {
  const ref = food.quantityG;
  const per100 = Math.abs(ref - 100) < 0.05;
  if (per100) {
    return `${food.kcalPerServing} kcal · P:${food.proteinG} C:${food.carbsG} G:${food.fatG} /100g`;
  }
  return `${food.kcalPerServing} kcal (${ref} g)`;
}

/** Fila compacta: nombre + macros de referencia + gramos + añadir */
export function RecurringFavoriteRow({
  food,
  nutritionDate,
  mealSlot,
  onAdded,
  disabled,
  embedded,
}: {
  food: RecurringFood;
  nutritionDate: string;
  mealSlot?: string;
  onAdded: () => void;
  disabled?: boolean;
  /** Sin borde propio: va dentro de un contenedor con borde (p. ej. fila + estrella). */
  embedded?: boolean;
}) {
  const defaultG = Math.round(food.quantityG * 10) / 10;
  const [grams, setGrams] = useState(String(defaultG));
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const g = Math.round(food.quantityG * 10) / 10;
    setGrams(String(g));
  }, [food.id, food.quantityG]);

  async function handleAdd() {
    const g = parseFloat(grams.replace(",", "."));
    if (!Number.isFinite(g) || g <= 0 || adding || disabled) return;
    setAdding(true);
    try {
      await advisorApi.logRecurring(food.id, nutritionDate, mealSlot, g);
      onAdded();
    } finally {
      setAdding(false);
    }
  }

  return (
    <div
      className={cn(
        "flex items-center transition-all gap-2 pl-3 pr-2 py-2 flex-1 min-w-0",
        embedded ? "bg-card" : "rounded-xl border border-border/60 bg-card",
        adding && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{food.name}</p>
        <p className="text-[11px] text-muted-foreground leading-tight">{referenceLabel(food)}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <label className="sr-only" htmlFor={`g-${food.id}`}>
          Gramos
        </label>
        <Input
          id={`g-${food.id}`}
          type="number"
          inputMode="decimal"
          min={1}
          step={1}
          className="h-9 w-[4.25rem] px-2 text-xs tabular-nums"
          value={grams}
          onChange={(e) => setGrams(e.target.value)}
          disabled={adding || disabled}
        />
        <span className="text-[10px] text-muted-foreground w-4">g</span>
        <Button
          type="button"
          size="sm"
          className="h-9 px-2.5"
          disabled={adding || disabled}
          onClick={handleAdd}
          title="Añadir al día"
        >
          {adding ? (
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

/** Tarjeta estrecha para la cabecera del asesor (scroll horizontal) */
export function RecurringFavoriteCard({
  food,
  nutritionDate,
  onAdded,
  disabled,
}: {
  food: RecurringFood;
  nutritionDate: string;
  onAdded: () => void;
  disabled?: boolean;
}) {
  const defaultG = Math.round(food.quantityG * 10) / 10;
  const [grams, setGrams] = useState(String(defaultG));
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const g = Math.round(food.quantityG * 10) / 10;
    setGrams(String(g));
  }, [food.id, food.quantityG]);

  async function handleAdd() {
    const g = parseFloat(grams.replace(",", "."));
    if (!Number.isFinite(g) || g <= 0 || adding || disabled) return;
    setAdding(true);
    try {
      await advisorApi.logRecurring(food.id, nutritionDate, undefined, g);
      onAdded();
    } finally {
      setAdding(false);
    }
  }

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-1.5 rounded-xl border border-border/60 bg-card px-2.5 py-2 w-[min(100%,220px)]",
        adding && "opacity-60",
      )}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium truncate">{food.name}</p>
        <p className="text-[10px] text-muted-foreground line-clamp-2 leading-snug">{referenceLabel(food)}</p>
      </div>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          inputMode="decimal"
          min={1}
          step={1}
          className="h-8 flex-1 min-w-0 px-2 text-xs tabular-nums"
          value={grams}
          onChange={(e) => setGrams(e.target.value)}
          disabled={adding || disabled}
        />
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 px-2"
          disabled={adding || disabled}
          onClick={handleAdd}
        >
          {adding ? (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}
