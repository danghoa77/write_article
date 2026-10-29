// @ts-nocheck
// Based on n8n format5; section parsing preserves multiline captions verbatim.
export async function formatContent(
  this: any,
  inputItems: any[],
  context: any = {},
) {
  const items = inputItems;
  const $input = { all: () => inputItems, first: () => inputItems[0] };
  const $ = (name: string) => ({ all: () => context.nodes?.[name] ?? [] });
  const $getWorkflowStaticData = () => context.history ?? {};
  return items.map((item) => {
    const rawText = item.json.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const titleMatch = rawText.match(/^[\t ]*Title:[\t ]*([^\r\n]*)/im);
    const captionLabel = /^[\t ]*Caption:[\t ]*/im.exec(rawText);
    const captionStart = captionLabel
      ? captionLabel.index + captionLabel[0].length
      : 0;
    // Labels must start their own line: inline "Content:" inside a caption
    // is prose, not a section boundary. Do not use \s* across section lines.
    const remaining = rawText.slice(captionStart);
    const contentLabel = /^[\t ]*Content:[\t ]*/im.exec(remaining);
    const firstTag = remaining.search(
      /<(?:p|h[1-6]|ul|ol|div|section|article|blockquote|table)(?:\s|>)/i,
    );
    const captionEnd = contentLabel
      ? contentLabel.index
      : firstTag !== -1
        ? firstTag
        : remaining.length;
    const caption = captionLabel ? remaining.slice(0, captionEnd).trim() : '';
    const content = contentLabel
      ? remaining.slice(contentLabel.index + contentLabel[0].length).trim()
      : firstTag !== -1
        ? remaining.slice(firstTag).trim()
        : '';

    return {
      json: {
        sportTeam: item.json['Sport Team'] || 'No Team',
        title: titleMatch?.[1].trim() || 'No Title',
        caption: caption || 'No Caption',
        content: content.trim() || 'No Content',
      },
    };
  });
}
