import { marked } from "marked";

/**
 * Markdown from a person or the maintainer (feedback and its reply),
 * rendered the way it was written. The same two rules as Elixir's
 * Markdown component, because the same text goes to the same people:
 * raw HTML is escaped BEFORE parsing, so only Markdown syntax produces
 * markup; and a link keeps its href only when it is http(s) or mailto.
 */
const SAFE_HREF = /^(https?:|mailto:)/i;
const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    link({ href, text }) {
      if (!SAFE_HREF.test(String(href ?? "")))
        return `<span>${escapeHtml(text)}</span>`;
      return `<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${text}</a>`;
    },
  },
});

export function Markdown({ text, style }) {
  return (
    <div
      className="prose"
      style={style}
      dangerouslySetInnerHTML={{ __html: marked.parse(escapeHtml(text ?? "")) }}
    />
  );
}
