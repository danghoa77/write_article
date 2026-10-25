// @ts-nocheck
// Ported from connected n8n node format5. No runtime eval.
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

    // Title: từ "Title:" đến hết dòng
    const titleMatch = rawText.match(/^\s*Title:\s*(.+?)\s*(?:\r?\n|$)/i);

    // Caption: từ "Caption:" đến hết dòng
    const captionMatch = rawText.match(/^\s*Caption:\s*(.+?)\s*(?:\r?\n|$)/im);

    // Content: mọi thứ sau dòng Caption (hoặc bắt đầu từ thẻ <p> đầu tiên)
    let content = '';
    const contentLabelMatch = rawText.match(/Content:\s*([\s\S]*)/i);
    if (contentLabelMatch) {
      // Trường hợp Gemini có ghi nhãn "Content:"
      content = contentLabelMatch[1];
    } else {
      // Trường hợp không có nhãn: lấy từ <p> đầu tiên
      const firstTag = rawText.search(/<p[\s>]/i);
      content = firstTag !== -1 ? rawText.slice(firstTag) : '';
    }

    return {
      json: {
        sportTeam: item.json['Sport Team'] || 'No Team',
        title: titleMatch ? titleMatch[1].trim() : 'No Title',
        caption: captionMatch ? captionMatch[1].trim() : 'No Caption',
        content: content.trim() || 'No Content',
      },
    };
  });
}
