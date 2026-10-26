import type { PreparedContent } from './content.model.js';

const plain = (text: string) =>
  text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&\w+;/g, ' ')
    .trim();
export const wordCount = (text: string) =>
  plain(text).split(/\s+/).filter(Boolean).length;
export function editorialFindings(article: PreparedContent, source: string) {
  const failures: string[] = [];
  if (!article.caption.startsWith('FICTION: '))
    failures.push('Rule 15: caption must start with FICTION: ');
  if (/<img\b/i.test(article.content))
    failures.push('Rule 14: use image placeholders, never img tags');
  if (!/<(?:p|ul|ol)\b/i.test(article.content))
    failures.push('Output contract: content must be HTML');
  // A substantive source supports useful length/coverage comparisons. Tiny inputs
  // have no paragraph/word-count baseline; the full prompt still applies to them.
  const count = wordCount(source);
  if (count >= 120) {
    const words = wordCount(article.content);
    if (words < count * 0.65 || words > count * 1.4)
      failures.push(
        `Rules 4/5: preserve source detail and approximate length (${count} source words; ${words} output words)`,
      );
    const sourceParagraphs = /<p\b/i.test(source)
      ? [...source.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)].length
      : source.split(/\n\s*\n/).filter((paragraph) => wordCount(paragraph) >= 5)
          .length;
    const outputParagraphs = [
      ...article.content.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi),
    ].length;
    if (
      sourceParagraphs >= 4 &&
      outputParagraphs < Math.ceil(sourceParagraphs * 0.5)
    )
      failures.push(
        'Rules 4/12: restore the source paragraph purposes instead of collapsing the article into a summary',
      );
    const images = [
      ...article.content.matchAll(/<!--IMAGE:\s*([^>]*?)\s*-->/g),
    ];
    if (images.length < 5 || images.length > 6)
      failures.push('Rule 14: exactly 5–6 IMAGE placeholders are required');
    if (
      images.some((image) => {
        const n = image[1].trim().split(/\s+/).length;
        return n < 3 || n > 6 || /\b(?:19|20)\d{2}\b/.test(image[1]);
      })
    )
      failures.push(
        'Rule 14: image queries must have 3–6 words and no year/season',
      );
  }
  return failures;
}
