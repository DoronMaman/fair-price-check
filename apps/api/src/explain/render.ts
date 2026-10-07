import { FactIdSchema, type ExplanationSegment, type FactSheet } from '@fpc/shared';
import { PLACEHOLDER_RE } from './factGuard.js';

/**
 * Placeholder text → segments. Each {{fact_id}} becomes a fact segment carrying
 * the code-formatted value. Only call on text that passed factGuard (or a
 * template); an unknown id here is a programming error.
 */
export function renderParagraphs(paragraphs: string[], facts: FactSheet): ExplanationSegment[][] {
  return paragraphs
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((p) => {
      const out: ExplanationSegment[] = [];
      let last = 0;
      for (const m of p.matchAll(PLACEHOLDER_RE)) {
        if (m.index > last) out.push({ type: 'text', text: p.slice(last, m.index) });
        const factId = FactIdSchema.parse(m[1]);
        const fact = facts[factId];
        if (!fact) throw new Error(`renderParagraphs: fact ${factId} not in sheet`);
        out.push({ type: 'fact', factId, text: fact.formatted });
        last = m.index + m[0].length;
      }
      if (last < p.length) out.push({ type: 'text', text: p.slice(last) });
      return out;
    });
}

/** Plain string, for logs and tests. */
export function toPlainText(paragraphs: ExplanationSegment[][]): string {
  return paragraphs.map((segs) => segs.map((s) => s.text).join('')).join('\n');
}
