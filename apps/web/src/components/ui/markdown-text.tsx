/**
 * Markdown ligero para respuestas del asesor IA.
 * Soporta: **negrita**, listas (- * •), saltos de línea, encabezados # ## ### en línea propia.
 */

import type { ReactNode } from "react";

export function MarkdownText({ text }: { text: string }) {
  const normalized = normalizeAdvisorMarkdown(text);
  const lines = normalized.split("\n");

  const elements: ReactNode[] = [];
  let listItems: string[] | null = null;
  let key = 0;

  const flushList = () => {
    if (listItems && listItems.length > 0) {
      elements.push(
        <ul key={`ul-${key++}`} className="list-disc list-inside space-y-1 text-sm">
          {listItems.map((item, li) => (
            <li key={li} className="leading-relaxed">
              <InlineMarkdown text={item} />
            </li>
          ))}
        </ul>,
      );
      listItems = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();

    if (!t) {
      flushList();
      continue;
    }

    const hm = t.match(/^(#{1,3})\s+(.*)$/);
    if (hm) {
      flushList();
      const level = hm[1].length;
      const HeadingTag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      const headingClass =
        level === 1 ? "text-lg font-semibold mt-4 mb-1.5"
        : level === 2 ? "text-base font-semibold mt-3 mb-1"
        : "text-sm font-semibold mt-3 mb-1";

      elements.push(
        <HeadingTag key={`h-${key++}`} className={headingClass}>
          <InlineMarkdown text={hm[2]} />
        </HeadingTag>,
      );
      continue;
    }

    const lm = t.match(/^[-*•]\s+(.*)$/);
    if (lm) {
      if (!listItems) listItems = [];
      listItems.push(lm[1]);
      continue;
    }

    flushList();
    elements.push(
      <p key={`p-${key++}`} className="text-sm leading-relaxed">
        <InlineMarkdown text={t} />
      </p>,
    );
  }

  flushList();

  return <div className="space-y-2">{elements}</div>;
}

/** Corrige patrones típicos del LLM que rompen el markdown (ej. • ### en la misma línea). */
function normalizeAdvisorMarkdown(raw: string): string {
  let s = raw.replace(/\r\n/g, "\n");

  // "• ### Título" o "- ### Título" → encabezado sin viñeta (línea aparte)
  s = s.replace(/^[\t ]*[•\*-]\s+(#{1,3}\s+)/gm, "\n\n$1");
  s = s.replace(/\n[\t ]*[•\*-]\s+(#{1,3}\s+)/g, "\n\n$1");

  return s.trim();
}

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return (
    <>
      {parts.map((part, i) => {
        const boldMatch = part.match(/^\*\*(.+)\*\*$/);
        if (boldMatch) {
          return (
            <strong key={i} className="font-semibold">
              {boldMatch[1]}
            </strong>
          );
        }
        return (
          <span key={i} className="inline">
            {part}
          </span>
        );
      })}
    </>
  );
}
