import { useState, type FormEvent } from "react";
import { Icon, Modal, Notice } from "./components";
import type {
  Category,
  Library,
  LibraryItem,
  WorkspaceOptions,
  WorkspaceSettings,
} from "./types";
export type SaveSettings = (
  settings: Partial<WorkspaceOptions>,
  secrets?: Record<string, string | null>,
) => Promise<void>;

export function ProviderStatus({
  data,
}: {
  data: WorkspaceSettings["providers"][string];
}) {
  const failed = ["quota", "invalid", "rate_limit"].includes(data?.status);
  const labels: Record<string, string> = {
    ready: "Hoạt động",
    unverified: "Chưa ghi nhận lỗi",
    quota: "Hết quota",
    invalid: "Key/token lỗi",
    rate_limit: "Giới hạn tần suất",
  };
  return (
    <span
      className={`status ${!data?.configured ? "warning" : failed ? "danger" : "success"}`}
    >
      <Icon
        name={!data?.configured || failed ? "warning" : "check"}
        size={12}
      />
      {!data?.configured
        ? "Chưa có key"
        : (labels[data.status] ?? "Chưa ghi nhận lỗi")}
    </span>
  );
}
function ProviderCard({
  id,
  title,
  fields,
  data,
  update,
  model,
}: {
  id: string;
  title: string;
  fields: { key: string; label: string }[];
  data: WorkspaceSettings;
  update: SaveSettings;
  model?: "geminiModel" | "openaiModel";
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<Record<string, boolean>>({});
  const [modelValue, setModelValue] = useState(
    model ? data.settings[model] : "",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setDone(false);
    const secrets: Record<string, string | null> = {};
    for (const field of fields) {
      if (cleared[field.key]) secrets[field.key] = null;
      else if (values[field.key]?.trim())
        secrets[field.key] = values[field.key].trim();
    }
    try {
      await update(model ? { [model]: modelValue } : {}, secrets);
      setValues({});
      setCleared({});
      setDone(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Không lưu được key");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={`panel provider-card ${!data.providers[id]?.configured ? "is-missing" : ["quota", "invalid", "rate_limit"].includes(data.providers[id]?.status) ? "is-danger" : "is-ready"}`}
    >
      <div className="panel-header">
        <h2>{title}</h2>
        <ProviderStatus data={data.providers[id]} />
      </div>
      <form className="panel-body stack" onSubmit={submit}>
        {error && <Notice kind="danger">{error}</Notice>}
        {done && <Notice kind="success">Đã lưu cấu hình {title}.</Notice>}
        <fieldset className="stack" disabled={busy}>
          {fields.map((field) => (
            <div key={field.key}>
              <label>
                {field.label}
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={`${title} ${field.label}`}
                  placeholder={
                    data.credentials[field.key]?.configured
                      ? "•••••••• · Nhập key mới để thay"
                      : "Nhập key hoặc token"
                  }
                  value={values[field.key] ?? ""}
                  disabled={cleared[field.key]}
                  onChange={(event) =>
                    setValues({ ...values, [field.key]: event.target.value })
                  }
                />
              </label>
              {data.credentials[field.key]?.configured && (
                <label className="check-label field-hint">
                  <input
                    type="checkbox"
                    checked={!!cleared[field.key]}
                    onChange={(event) =>
                      setCleared({
                        ...cleared,
                        [field.key]: event.target.checked,
                      })
                    }
                  />
                  Xóa {field.label.toLowerCase()} hiện tại khi lưu
                </label>
              )}
            </div>
          ))}
          {model && (
            <label>
              Model
              <input
                aria-label={`${title} model`}
                value={modelValue}
                onChange={(event) => setModelValue(event.target.value)}
                placeholder={
                  id === "gpt"
                    ? "Model GPT bạn có quyền sử dụng"
                    : "Model Gemini"
                }
                required={id === "gemini"}
              />
            </label>
          )}
          <p className="field-hint">
            Để trống key để giữ nguyên. Key được mã hóa trên server và không lưu
            trong trình duyệt.
          </p>
          <button className="primary" type="submit">
            {busy ? (
              <span className="spinner" />
            ) : (
              <Icon name="lock" size={15} />
            )}
            Lưu {title}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
export function CredentialsPage({
  data,
  update,
  imagesOnly = false,
}: {
  data: WorkspaceSettings;
  update: SaveSettings;
  imagesOnly?: boolean;
}) {
  return (
    <>
      <Notice>
        Trạng thái cập nhật sau khi gọi dịch vụ: đỏ khi hết quota/key lỗi/giới
        hạn tần suất; xanh khi chưa ghi nhận lỗi hoặc đã gọi thành công. Đây
        không phải số dư token trực tiếp.
      </Notice>
      <div className="settings-grid">
        {imagesOnly ? (
          <>
            <ProviderCard
              id="tavily"
              title="Tavily"
              fields={[{ key: "TAVILY_API_KEY", label: "API key" }]}
              data={data}
              update={update}
            />
            <ProviderCard
              id="serper"
              title="Serper"
              fields={[{ key: "SERPER_API_KEY", label: "API key" }]}
              data={data}
              update={update}
            />
          </>
        ) : (
          <>
            <ProviderCard
              id="gemini"
              title="Gemini"
              fields={[{ key: "GEMINI_API_KEY", label: "API key" }]}
              model="geminiModel"
              data={data}
              update={update}
            />
            <ProviderCard
              id="gpt"
              title="ChatGPT / OpenAI"
              fields={[{ key: "OPENAI_API_KEY", label: "API key" }]}
              model="openaiModel"
              data={data}
              update={update}
            />
            <ProviderCard
              id="trello"
              title="Trello"
              fields={[
                { key: "TRELLO_API_KEY", label: "API key" },
                { key: "TRELLO_API_TOKEN", label: "Token" },
              ]}
              data={data}
              update={update}
            />
          </>
        )}
      </div>
    </>
  );
}
export function GeneralSettings({
  data,
  update,
}: {
  data: WorkspaceSettings;
  update: SaveSettings;
}) {
  const [draft, setDraft] = useState(data.settings),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await update({
        slugSuffix: draft.slugSuffix,
        textProvider: draft.textProvider,
        imageProvider: draft.imageProvider,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Không thể lưu");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Mặc định cho luồng viết</h2>
        <span className="save-note">
          <Icon name="cloud" size={14} />
          Theo tài khoản
        </span>
      </div>
      <form onSubmit={submit} className="panel-body stack">
        {error && <Notice kind="danger">{error}</Notice>}
        <fieldset className="stack" disabled={busy}>
          <div className="form-grid">
            <label>
              Slug mặc định
              <input
                value={draft.slugSuffix}
                onChange={(event) =>
                  setDraft({ ...draft, slugSuffix: event.target.value })
                }
                required
                placeholder="danghoa123"
              />
            </label>
          </div>
          <div className="form-grid">
            <label>
              Công cụ viết mặc định
              <select
                value={draft.textProvider}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    textProvider: event.target
                      .value as WorkspaceOptions["textProvider"],
                  })
                }
              >
                <option value="gemini">Gemini</option>
                <option value="gpt">GPT</option>
              </select>
            </label>
            <label>
              Công cụ tìm ảnh mặc định
              <select
                value={draft.imageProvider}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    imageProvider: event.target
                      .value as WorkspaceOptions["imageProvider"],
                  })
                }
              >
                <option value="tavily">Tavily</option>
                <option value="serper">Serper</option>
              </select>
            </label>
          </div>
          <button className="primary" type="submit">
            <Icon name="cloud" size={15} />
            {busy ? "Đang lưu…" : "Lưu cài đặt"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
export function CategoriesPage({
  categories,
  update,
}: {
  categories: Category[];
  update: SaveSettings;
}) {
  const [editing, setEditing] = useState<{
      item: Category;
      index: number;
    } | null>(null),
    [removing, setRemoving] = useState<Category | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function commit(items: Category[]) {
    setBusy(true);
    setError("");
    try {
      await update({ categories: items });
      setEditing(null);
      setRemoving(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Không thể lưu category",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="row between" style={{ marginBottom: 18 }}>
        <p className="muted">
          Mã dùng khi publish lên Tinfos và chuyển bài đến Trello tương ứng. Mã
          cần tồn tại trên Tinfos; tên ở đây chỉ để gợi nhớ.
        </p>
        <button
          className="primary"
          onClick={() => {
            setError("");
            setEditing({ item: { id: 0, name: "" }, index: -1 });
          }}
        >
          <Icon name="plus" size={15} />
          Thêm category
        </button>
      </div>
      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mã category</th>
                <th>Tên gợi nhớ</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((item, index) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.id}</strong>
                  </td>
                  <td>{item.name}</td>
                  <td>
                    <div className="row">
                      <button
                        className="small"
                        onClick={() => {
                          setError("");
                          setEditing({ item: { ...item }, index });
                        }}
                      >
                        <Icon name="pen" size={13} />
                        Sửa
                      </button>
                      <button
                        className="small danger"
                        onClick={() => {
                          setError("");
                          setRemoving(item);
                        }}
                      >
                        <Icon name="trash" size={13} />
                        Xóa
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!categories.length && (
          <div className="empty-state">
            Chưa có category. Thêm mã để chọn khi viết bài.
          </div>
        )}
      </section>
      <p className="field-hint">
        Không thay đổi Trello nguồn lấy caption/content. Xóa mã khỏi danh sách
        không xóa bài hay thẻ đã publish; hãy chọn lại category cho đội nếu cần.
      </p>
      {editing && (
        <Modal
          title={
            editing.index < 0
              ? "Thêm category xuất bản"
              : "Sửa category xuất bản"
          }
          close={() => {
            if (!busy) setEditing(null);
          }}
        >
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              const next = [...categories];
              if (editing.index < 0) next.push(editing.item);
              else next[editing.index] = editing.item;
              void commit(next);
            }}
          >
            {error && <Notice kind="danger">{error}</Notice>}
            <label>
              Mã category
              <input
                type="number"
                min="1"
                step="1"
                required
                value={editing.item.id || ""}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    item: { ...editing.item, id: Number(event.target.value) },
                  })
                }
              />
            </label>
            <label>
              Tên gợi nhớ
              <input
                required
                value={editing.item.name}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    item: { ...editing.item, name: event.target.value },
                  })
                }
              />
            </label>
            <button className="primary" disabled={busy} type="submit">
              {busy ? "Đang lưu…" : "Lưu category"}
            </button>
          </form>
        </Modal>
      )}
      {removing && (
        <Modal
          title={`Xóa category ${removing.id}?`}
          close={() => {
            if (!busy) setRemoving(null);
          }}
        >
          {error && <Notice kind="danger">{error}</Notice>}
          <p>
            Chỉ bỏ mã {removing.id} khỏi danh sách lựa chọn. Những bài và thẻ
            Trello đã tạo vẫn được giữ.
          </p>
          <div className="prompt-actions">
            <button onClick={() => setRemoving(null)} disabled={busy}>
              Giữ lại
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                void commit(
                  categories.filter((item) => item.id !== removing.id),
                )
              }
            >
              Xóa category
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function SaveContentSample({
  draft,
  disabled,
  saveItem,
}: {
  draft: { caption: string; content: string; note: string };
  disabled: boolean;
  saveItem: (item: LibraryItem) => Promise<void>;
}) {
  const [item, setItem] = useState<LibraryItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!item || busy || !item.title.trim()) return;
    setBusy(true);
    setError("");
    try {
      await saveItem({ ...item, title: item.title.trim() });
      setItem(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Không lưu được mẫu");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="small"
        disabled={disabled || (!draft.caption.trim() && !draft.content.trim())}
        onClick={() => {
          setError("");
          setItem({
            id: crypto.randomUUID(),
            title: draft.caption.trim().slice(0, 80) || "Nội dung mẫu",
            caption: draft.caption,
            content: draft.content,
            note: draft.note,
          });
        }}
      >
        <Icon name="cloud" size={14} />
        Lưu content mẫu
      </button>
      {item && (
        <Modal
          title="Lưu content mẫu"
          close={() => {
            if (!busy) setItem(null);
          }}
        >
          <form className="stack" onSubmit={submit}>
            {error && <Notice kind="danger">{error}</Notice>}
            <fieldset className="stack" disabled={busy}>
              <label>
                Tên mẫu
                <input
                  required
                  maxLength={180}
                  value={item.title}
                  onChange={(event) =>
                    setItem({ ...item, title: event.target.value })
                  }
                />
              </label>
              <p className="muted">
                Lưu nguyên caption, content và lưu ý riêng đang nhập vào Content
                mẫu để dùng lại.
              </p>
              <p className="field-hint">
                Caption: {item.caption.length.toLocaleString("vi-VN")} ký tự ·
                Content: {item.content.length.toLocaleString("vi-VN")} ký tự
              </p>
              <button
                className="primary"
                type="submit"
                disabled={!item.title.trim()}
              >
                <Icon name="cloud" size={15} />
                {busy ? "Đang lưu…" : "Lưu mẫu lên đám mây"}
              </button>
            </fieldset>
          </form>
        </Modal>
      )}
    </>
  );
}

export function LibraryPage({
  library,
  saveItems,
  applyItem,
  draft,
}: {
  library: Library;
  saveItems: (items: LibraryItem[]) => Promise<void>;
  applyItem: (item: LibraryItem) => void;
  draft: { caption: string; content: string; note: string };
}) {
  const [editing, setEditing] = useState<LibraryItem | null>(null),
    [removing, setRemoving] = useState<LibraryItem | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState("");
  async function commit(items: LibraryItem[]) {
    setBusy(true);
    setError("");
    try {
      await saveItems(items);
      setEditing(null);
      setRemoving(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Không lưu được mẫu");
    } finally {
      setBusy(false);
    }
  }
  const add = (fromDraft = false) => {
    setError("");
    setEditing({
      id: crypto.randomUUID(),
      title: "",
      caption: fromDraft ? draft.caption : "",
      content: fromDraft ? draft.content : "",
      note: fromDraft ? draft.note : "",
    });
  };
  const filtered = library.items.filter((item) =>
    `${item.title} ${item.caption}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="library-toolbar">
        <input
          aria-label="Tìm content mẫu"
          type="search"
          placeholder="Tìm tên mẫu hoặc caption…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="row">
          <button
            onClick={() => add(true)}
            disabled={!draft.caption.trim() && !draft.content.trim()}
          >
            <Icon name="pen" size={15} />
            Lưu nguồn đang nhập
          </button>
          <button className="primary" onClick={() => add()}>
            <Icon name="plus" size={15} />
            Thêm mẫu
          </button>
        </div>
      </div>
      <div className="team-management">
        {filtered.map((item) => (
          <article className="panel roster-card" key={item.id}>
            <span className="roster-icon">
              <Icon name="prompt" />
            </span>
            <h2>{item.title}</h2>
            <p className="library-excerpt">{item.caption || item.content}</p>
            <small>
              {item.content.length.toLocaleString("vi-VN")} ký tự nội dung
            </small>
            <div className="row library-actions">
              <button className="primary" onClick={() => applyItem(item)}>
                <Icon name="arrow" size={15} />
                Dùng mẫu
              </button>
              <button
                className="icon-button"
                aria-label={`Sửa mẫu ${item.title}`}
                onClick={() => {
                  setError("");
                  setEditing({ ...item });
                }}
              >
                <Icon name="pen" size={15} />
              </button>
              <button
                className="icon-button danger"
                aria-label={`Xóa mẫu ${item.title}`}
                onClick={() => {
                  setError("");
                  setRemoving(item);
                }}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <div className="panel empty-state">
          <Icon name="prompt" size={28} />
          <h2>
            {library.items.length
              ? "Không tìm thấy mẫu phù hợp"
              : "Lưu những câu chuyện bạn muốn dùng lại"}
          </h2>
          <p>Caption và content mẫu được lưu theo tài khoản trên Firestore.</p>
        </div>
      )}
      {editing && (
        <Modal
          title={
            library.items.some((item) => item.id === editing.id)
              ? "Chỉnh content mẫu"
              : "Thêm content mẫu"
          }
          close={() => {
            if (!busy) setEditing(null);
          }}
          wide
        >
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              const exists = library.items.some(
                (item) => item.id === editing.id,
              );
              void commit(
                exists
                  ? library.items.map((item) =>
                      item.id === editing.id ? editing : item,
                    )
                  : [...library.items, editing],
              );
            }}
          >
            {error && <Notice kind="danger">{error}</Notice>}
            <fieldset disabled={busy} className="stack">
              <label>
                Tên mẫu
                <input
                  required
                  maxLength={180}
                  value={editing.title}
                  onChange={(event) =>
                    setEditing({ ...editing, title: event.target.value })
                  }
                  placeholder="Ví dụ: câu chuyện chấn thương"
                />
              </label>
              <label>
                Caption mẫu
                <textarea
                  rows={3}
                  value={editing.caption}
                  onChange={(event) =>
                    setEditing({ ...editing, caption: event.target.value })
                  }
                />
              </label>
              <label>
                Content mẫu
                <textarea
                  rows={10}
                  value={editing.content}
                  onChange={(event) =>
                    setEditing({ ...editing, content: event.target.value })
                  }
                />
              </label>
              <label>
                Lưu ý riêng cho mẫu · tùy chọn
                <textarea
                  rows={3}
                  value={editing.note ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, note: event.target.value })
                  }
                  placeholder="Hướng dẫn chỉ dùng cho caption/content của mẫu này…"
                />
              </label>
              <button type="submit" className="primary">
                <Icon name="cloud" size={15} />
                {busy ? "Đang lưu…" : "Lưu mẫu lên đám mây"}
              </button>
            </fieldset>
          </form>
        </Modal>
      )}
      {removing && (
        <Modal
          title="Xóa content mẫu?"
          close={() => {
            if (!busy) setRemoving(null);
          }}
        >
          {error && <Notice kind="danger">{error}</Notice>}
          <p>
            Xóa mẫu “{removing.title}” khỏi thư viện của bạn? Những bài đã
            publish không bị ảnh hưởng.
          </p>
          <div className="prompt-actions">
            <button disabled={busy} onClick={() => setRemoving(null)}>
              Giữ lại
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                void commit(
                  library.items.filter((item) => item.id !== removing.id),
                )
              }
            >
              Xóa mẫu
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
