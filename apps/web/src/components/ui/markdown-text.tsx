/**
 * Lightweight markdown renderer for AI responses.
 * Supports: **bold**, - lists, line breaks.
 */

export function MarkdownText({ text }: { text: string }) {
  const paragraphs = text.split("\n\n");

  return (
    <div className="space-y-2">
      {paragraphs.map((para, pi) => {
        if (!para.trim()) return null;

        const lines = para.split("\n");

        // Check if this paragraph is a list
        const isList = lines.some((l) => l.trim().startsWith("- ") || l.trim().startsWith("* "));

        if (isList) {
          return (
            <ul key={pi} className="list-disc list-inside space-y-1 text-sm">
              {lines.map((line, li) => {
                const content = line.replace(/^[-*]\s+/, "");
                return (
                  <li key={li} className="leading-relaxed">
                    <InlineMarkdown text={content} />
                  </li>
                );
              })}
            </ul>
          );
        }

        // Regular paragraph
        return (
          <p key={pi} className="text-sm leading-relaxed">
            {lines.map((line, li) => (
              <span key={li}>
                <InlineMarkdown text={line} />
                {li < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  // Split by **bold** patterns
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
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
