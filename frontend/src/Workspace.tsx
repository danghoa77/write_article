import { useCallback, useEffect, useRef, useState } from "react";
import { Brand, Icon, Modal, Notice } from "./components";
import TeamEditor from "./TeamEditor";
import {
  CategoriesPage,
  CredentialsPage,
  GeneralSettings,
  LibraryPage,
  ProviderStatus,
  SaveContentSample,
} from "./Management";
import type {
  WorkspaceSettings,
  WorkspaceOptions,
  Library,
  LibraryItem,
  PromptDocument,
  ApiKeyAction,
} from "./types";
import { api, ApiError, errorText, hasExpired, load, save } from "./lib";
import {
  teamKey,
  type Config,
  type Preferences,
  type Prompts,
  type PromptStage,
  type Result,
  type Run,
  type Session,
  type Team,
} from "./types";

type Page =
  | "compose"
  | "teams"
  | "prompts"
  | "library"
  | "categories"
  | "tokens"
  | "settings";
const navigation: {
  id: Page;
  title: string;
  icon: string;
  description: string;
}[] = [
  {
    id: "compose",
    title: "Viết bài",
    icon: "pen",
    description: "Một nguồn nội dung, những câu chuyện riêng cho từng đội.",
  },
  {
    id: "teams",
    title: "Đội & lineup",
    icon: "team",
    description: "Dữ kiện bạn chuẩn bị là nền tảng cho nhân vật được chọn.",
  },
  {
    id: "prompts",
    title: "Prompt",
    icon: "prompt",
    description: "Tinh chỉnh quy tắc viết mà vẫn giữ nguyên cấu trúc đầu ra.",
  },
  {
    id: "library",
    title: "Content mẫu",
    icon: "prompt",
    description: "Lưu lại caption và nội dung để dùng khi cần viết bài mới.",
  },
  {
    id: "categories",
    title: "Categories xuất bản",
    icon: "settings",
    description: "Quản lý mã category Tinfos cho bài và thẻ Trello đầu ra.",
  },
  {
    id: "tokens",
    title: "Token tìm ảnh",
    icon: "lock",
    description: "Quản lý key Tavily, Serper và theo dõi trạng thái sử dụng.",
  },
  {
    id: "settings",
    title: "Cài đặt",
    icon: "settings",
    description: "Điều chỉnh luồng làm việc theo cách của bạn.",
  },
];
const stages: { id: PromptStage; title: string; description: string }[] = [
  {
    id: "rewrite",
    title: "Prompt viết bài n8n",
    description: "Toàn bộ prompt gốc và các rule",
  },
];
const contextLabels: Record<string, string> = {
  contract_retention: "Gia hạn & giữ người",
  transfer: "Chuyển đội",
  farewell: "Chia tay",
  return_comeback: "Trở lại",
  life_event: "Đời sống",
  injury_recovery: "Chấn thương & hồi phục",
  milestone: "Dấu mốc & vinh danh",
  rivalry: "Đối đầu",
  other: "Nội dung khác",
};
const stageLabel: Record<string, string> = {
  review: "Duyệt nhân vật",
  plan: "Chọn nhân vật",
  generate: "Viết bài",
  "generate-batch": "Viết bài",
  create: "Tạo nháp",
  images: "Tìm ảnh",
  update: "Cập nhật bài",
  publish: "Publish",
  "trello-comment": "Caption Trello",
  unknown: "Chưa xác định",
};
function Status({ result }: { result: Result }) {
  const status = result.requiresReview
    ? "warning"
    : result.success
      ? "success"
      : result.published || result.stage === "unknown"
        ? "warning"
        : "danger";
  return (
    <span className={`status ${status}`}>
      <Icon
        name={
          status === "success"
            ? "check"
            : status === "warning"
              ? "warning"
              : "error"
        }
        size={12}
      />
      {result.requiresReview
        ? "Cần duyệt"
        : result.preview
          ? result.requiresReview
            ? "Cần duyệt"
            : result.success
              ? "Bản xem trước"
              : "Viết thử lỗi"
          : result.success
            ? "Đã publish"
            : result.published
              ? "Cần thêm caption"
              : result.stage === "unknown"
                ? "Cần kiểm tra"
                : "Chưa hoàn tất"}
    </span>
  );
}
function Categories({
  value,
  options,
  change,
  label,
}: {
  value: number[];
  options: number[];
  change: (values: number[]) => void;
  label: string;
}) {
  return (
    <div className="team-cat" role="group" aria-label={label}>
      <span>Category</span>
      {options.map((id) => (
        <label
          className={`category-chip ${value.includes(id) ? "checked" : ""}`}
          key={id}
        >
          <input
            type="checkbox"
            checked={value.includes(id)}
            aria-label={`${label} ${id}`}
            onChange={() =>
              change(
                value.includes(id)
                  ? value.filter((item) => item !== id)
                  : [...value, id],
              )
            }
          />
          {id}
        </label>
      ))}
    </div>
  );
}
function ResultDetail({
  result,
  close,
}: {
  result: Result;
  close: () => void;
}) {
  return (
    <Modal title={result.team} close={close}>
      <div className="result-details">
        <div>
          <Status result={result} />
        </div>
        {!result.success && (
          <Notice kind={result.published ? "warning" : "danger"}>
            <strong>{stageLabel[result.stage ?? ""] ?? "Xử lý bài"}: </strong>
            {errorText(result.error ?? result.message)}
            {result.published && (
              <p>
                Bài đã publish. Hãy kiểm tra thẻ Trello trước khi thực hiện lại.
              </p>
            )}
          </Notice>
        )}
        {result.title && (
          <div>
            <label>Tiêu đề</label>
            <p>{result.title}</p>
          </div>
        )}
        {result.caption && (
          <div>
            <label>Caption</label>
            <p>{result.caption}</p>
          </div>
        )}
        {result.rotation && (
          <Notice>
            <strong>
              Cầu thủ trong caption:{" "}
              {result.rotation.selected.join(", ") || "Không nhận diện được"}
            </strong>
            <p>{result.rotation.note}</p>
            {!!result.rotation.excluded.length && (
              <p>Đã tránh: {result.rotation.excluded.join(", ")}</p>
            )}
            <p>
              Vòng {result.rotation.cycle}. Bản viết thử cũng được tính vào lịch
              sử.
            </p>
          </Notice>
        )}
        {result.characterPlan && (
          <div>
            <label>Nhân vật & lý do</label>
            {result.characterPlan.mappings.length ? (
              result.characterPlan.mappings.map((person) => (
                <p key={person.sourceId}>
                  <strong>
                    {person.sourceName ?? "Nhân vật không nêu tên"} →{" "}
                    {person.target}
                  </strong>
                  <br />
                  <span className="muted">{person.reason}</span>
                  {(person.knowledgeSource === "model_knowledge" ||
                    person.backgroundSource === "model_knowledge") && (
                    <>
                      <br />
                      <small>Kiến thức model · chưa xác minh realtime</small>
                    </>
                  )}
                </p>
              ))
            ) : (
              <p>Không chọn tên riêng; giữ ở cấp độ đội hoặc cách gọi chung.</p>
            )}
          </div>
        )}
        {!!result.reviewWarnings?.length && (
          <Notice kind="warning">{result.reviewWarnings.join(" ")}</Notice>
        )}
        {result.article && (
          <div>
            <label>Bản viết thử · chưa publish</label>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>
              {result.article.content
                .replace(/<!--[\s\S]*?-->/g, "")
                .replace(/<\/(?:p|h[1-6]|li)>/gi, "\n\n")
                .replace(/<[^>]*>/g, "")
                .replace(/\n{3,}/g, "\n\n")
                .trim()}
            </div>
          </div>
        )}
        {result.postId && (
          <div>
            <label>Post ID</label>
            <code>{result.postId}</code>
          </div>
        )}
        {result.slug && (
          <div>
            <label>Slug</label>
            <code>{result.slug}</code>
          </div>
        )}
        <div className="row">
          {result.cardId && (
            <a
              href={`https://trello.com/c/${encodeURIComponent(result.cardId)}`}
              target="_blank"
              rel="noreferrer"
            >
              Mở Trello <Icon name="external" size={13} />
            </a>
          )}
          {result.published && result.slug && (
            <a
              href={`https://tfs.jervisfamily.com/posts/${encodeURIComponent(result.slug)}`}
              target="_blank"
              rel="noreferrer"
            >
              Xem bài viết <Icon name="external" size={13} />
            </a>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function Workspace({
  session,
  expire,
  logout,
}: {
  session: Session;
  expire: () => void;
  logout: () => Promise<void>;
}) {
  const storage = "aw:" + session.username.trim().toLowerCase() + ":";
  const [page, setPage] = useState<Page>("compose");
  const [menu, setMenu] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [settingsData, setSettingsData] = useState<WorkspaceSettings | null>(
    null,
  );
  const [library, setLibrary] = useState<Library>({ items: [], revision: 0 });
  const [deletingTeam, setDeletingTeam] = useState<Team | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamRevision, setTeamRevision] = useState(0);
  const [prompts, setPrompts] = useState<Prompts | null>(null);
  const [promptRevision, setPromptRevision] = useState(0);
  const [promptDocument, setPromptDocument] = useState<PromptDocument | null>(
    null,
  );
  const [promptStage, setPromptStage] = useState<PromptStage>("rewrite");
  const [promptSaving, setPromptSaving] = useState(false);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [source, setSource] = useState(() => {
    const saved = load<{
      caption: string;
      content: string;
      cardId: string;
      note: string;
    }>(storage + "source", {
      caption: "",
      content: "",
      cardId: "",
      note: "",
    });
    return {
      ...saved,
      note: saved.note ?? "",
    };
  });
  const [sourceLoading, setSourceLoading] = useState(false);
  const [latest, setLatest] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const [toast, setToast] = useState<{
    kind: "success" | "warning" | "danger" | "info";
    text: string;
  } | null>(null);
  const [editor, setEditor] = useState<{ team: Team; index: number } | null>(
    null,
  );
  const [detail, setDetail] = useState<Result | null>(null);
  const [resetPrompt, setResetPrompt] = useState(false);

  const handleError = useCallback(
    (error: unknown) => {
      if (
        error instanceof ApiError &&
        (error.status === 401 || hasExpired(error.data))
      ) {
        expire();
        return;
      }
      setToast({
        kind: "danger",
        text:
          error instanceof Error ? error.message : "Không thể kết nối máy chủ",
      });
    },
    [expire],
  );
  const initialize = useCallback(async () => {
    const results = await Promise.allSettled([
      api<Config>("workspace/config"),
      api<{ teams: Team[]; revision: number }>("workspace/teams"),
      api<PromptDocument>("workspace/prompts"),
      api<WorkspaceSettings>("workspace/settings"),
      api<Library>("workspace/library"),
    ]);
    if (
      results.some(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof ApiError &&
          result.reason.status === 401,
      )
    ) {
      expire();
      return;
    }
    if (results[0].status === "rejected") {
      handleError(results[0].reason);
      setLoading(false);
      return;
    }
    if (results[3].status === "rejected") {
      handleError(results[3].reason);
      setLoading(false);
      return;
    }
    const appData = results[3].value;
    setSettingsData(appData);
    if (results[4].status === "fulfilled") setLibrary(results[4].value);
    const cfg = results[0].value;
    setConfig(cfg);
    const teamData =
      results[1].status === "fulfilled"
        ? results[1].value
        : load(storage + "teams", { teams: cfg.teams, revision: 0 });
    setTeams(teamData.teams);
    setTeamRevision(teamData.revision);
    const promptData: PromptDocument =
      results[2].status === "fulfilled"
        ? results[2].value
        : load(storage + "prompts", {
            prompts: cfg.pipelinePrompts,
            revision: 0,
          });
    const draft = load<PromptDocument | null>(storage + "prompt-draft", null);
    setPrompts(
      draft?.revision === promptData.revision &&
        draft?.version === promptData.version
        ? draft.prompts
        : promptData.prompts,
    );
    setPromptRevision(promptData.revision);
    setPromptDocument(promptData);
    const defaults: Preferences = {
      selected: teamData.teams[0] ? [teamKey(teamData.teams[0])] : [],
      categories: {},
      textProvider: appData.settings.textProvider,
      imageProvider: appData.settings.imageProvider,
      slugSuffix: appData.settings.slugSuffix,
      listId: cfg.trello.listId,
    };
    const preferences = {
      ...defaults,
      ...load<Partial<Preferences>>(storage + "preferences", {}),
    };
    preferences.slugSuffix =
      preferences.slugSuffix.trim() ||
      appData.settings.slugSuffix ||
      "danghoa123";
    setPrefs(preferences);
    if (
      results[1].status === "rejected" ||
      results[2].status === "rejected" ||
      results[4].status === "rejected"
    )
      setToast({
        kind: "warning",
        text: "Chưa tải được cấu hình đám mây. Đang dùng bản trên máy hoặc mặc định; bấm tải lại trước khi lưu cấu hình.",
      });
    setLoading(false);
  }, [expire, handleError, storage]);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [busy]);
  function persist(key: string, value: unknown) {
    if (!save(storage + key, value))
      setToast({
        kind: "warning",
        text: "Trình duyệt không cho lưu dữ liệu trên máy. Lựa chọn có thể không giữ được sau khi tải lại.",
      });
  }
  function updatePrefs(patch: Partial<Preferences>) {
    if (prefs) {
      const next = { ...prefs, ...patch };
      setPrefs(next);
      persist("preferences", next);
    }
  }
  function updateSource(patch: Partial<typeof source>) {
    const next = { ...source, ...patch };
    setSource(next);
    persist("source", next);
  }
  async function getSource() {
    if (!prefs) return;
    setSourceLoading(true);
    setToast(null);
    try {
      const data = await api<{
        caption: string;
        content: string;
        cardId: string;
      }>("workspace/source");
      updateSource({ ...data, note: "" });
      setToast({
        kind: "success",
        text: "Đã lấy caption và nội dung từ Trello. Bạn có thể chỉnh lại trước khi viết.",
      });
    } catch (error) {
      handleError(error);
    } finally {
      setSourceLoading(false);
      void refreshHealth();
    }
  }
  const selected = teams
    .filter((team) => prefs?.selected.includes(teamKey(team)))
    .map((team) => ({
      ...team,
      categories: (prefs?.categories[teamKey(team)] ?? team.categories).filter(
        (id) =>
          settingsData?.settings.categories.some((item) => item.id === id),
      ),
    }));
  const options =
    settingsData?.settings.categories
      .map((item) => item.id)
      .sort((a, b) => a - b) ?? [];
  const requiredKeys = prefs
    ? [
        prefs.textProvider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY",
        prefs.imageProvider === "tavily" ? "TAVILY_API_KEY" : "SERPER_API_KEY",
        "TRELLO_API_KEY",
        "TRELLO_API_TOKEN",
      ]
    : [];
  const missing = requiredKeys.filter((key) => !config?.credentials[key]);
  const canPreview =
    !busy &&
    !promptDocument?.needsSync &&
    !sourceLoading &&
    !!source.caption.trim() &&
    !!source.content.trim() &&
    selected.length > 0 &&
    selected.every((team) => team.categories.length > 0) &&
    !!config?.credentials[
      prefs?.textProvider === "gpt" ? "OPENAI_API_KEY" : "GEMINI_API_KEY"
    ] &&
    !!prompts &&
    Object.values(prompts).every((value) => value.trim());
  const canRun = canPreview && missing.length === 0;
  function record(value: Run) {
    const next = [value, ...load<Run[]>(storage + "history", [])].slice(0, 20);
    persist("history", next);
    setLatest(value);
  }
  async function run(preview = false) {
    if (
      !(preview ? canPreview : canRun) ||
      !prefs ||
      !prompts ||
      running.current
    )
      return;
    running.current = true;
    setBusy(true);
    setElapsed(0);
    setToast(null);
    setLatest(null);
    const id = crypto.randomUUID();
    const time = new Date().toISOString();
    try {
      let response = await api<Omit<Run, "id" | "time">>(
        preview ? "workspace/preview" : "workspace/run",
        {
          teams: selected,
          caption: source.caption,
          content: source.content,
          textProvider: prefs.textProvider,
          imageProvider: prefs.imageProvider,
          prompts,
          ...(prefs.slugSuffix.trim()
            ? { slugSuffix: prefs.slugSuffix.trim() }
            : {}),
          prompt: source.note,
          promptVersion: promptDocument?.version,
          promptRevision,
        },
        "POST",
        300000,
      );
      if (preview) {
        const results = response.results.map((item) => ({
          ...item,
          preview: true,
          published: false,
          commented: false,
          title: item.article?.title,
          caption: item.article?.caption,
        }));
        response = {
          ...response,
          results,
          summary: {
            total: selected.length,
            succeeded: results.filter((item) => item.success).length,
            failed: results.filter((item) => !item.success).length,
          },
        };
      }
      record({
        ...response,
        id,
        time,
        sourceCardId: source.cardId || response.sourceCardId,
      });
      const completed =
        !preview &&
        response.success &&
        response.summary.succeeded === selected.length &&
        response.results.length === selected.length &&
        response.results.every(
          (item) => item.success && item.published && item.commented,
        );
      if (completed) {
        updateSource({
          caption: "",
          content: "",
          note: "",
          cardId: "",
        });
      }
      if (response.sessionExpired) expire();
      else
        setToast({
          kind:
            response.success &&
            !response.results.some((item) => item.requiresReview)
              ? "success"
              : "warning",
          text: preview
            ? `Đã viết thử ${response.summary.succeeded}/${response.summary.total} đội. Chưa publish; mở chi tiết để xem nhân vật và bài viết.`
            : completed
              ? `Đã publish và thêm caption Trello cho ${response.summary.succeeded} đội. Đã xóa nội dung nhập để chuẩn bị bài mới.`
              : `Hoàn tất ${response.summary.succeeded}/${response.summary.total} đội. Xem kết quả trước khi chạy lại.`,
        });
    } catch (error) {
      const data =
        error instanceof ApiError &&
        error.data &&
        typeof error.data === "object"
          ? (error.data as {
              completedResults?: Result[];
              results?: Result[];
              team?: string;
              stage?: string;
              postId?: string;
              published?: boolean;
              error?: unknown;
            })
          : {};
      const rows: Result[] = [...(data.completedResults ?? [])];
      if (data.team)
        rows.push({
          team: data.team,
          success: false,
          postId: data.postId,
          published: data.published,
          stage: data.stage,
          error:
            data.error ??
            errorText(error instanceof ApiError ? error.data : null),
        });
      else if (data.results) rows.push(...data.results);
      const uncertain =
        !(error instanceof ApiError) ||
        ([504, 502].includes(error.status) && !data.stage && !data.results);
      if (!rows.length)
        rows.push(
          ...selected.map((team) => ({
            team: team.team,
            sport: team.sport,
            success: false,
            stage: uncertain ? "unknown" : (data.stage ?? "generate"),
            error: uncertain
              ? "Kết nối bị ngắt. Hãy kiểm tra Tinfos và Trello trước khi chạy lại để tránh bài trùng."
              : errorText(error instanceof ApiError ? error.data : null),
          })),
        );
      const succeeded = rows.filter((row) => row.success).length;
      record({
        id,
        time,
        success: false,
        uncertain,
        results: rows,
        sourceCardId: source.cardId,
        summary: {
          total: selected.length,
          succeeded,
          failed: selected.length - succeeded,
        },
      });
      if (
        error instanceof ApiError &&
        (error.status === 401 || hasExpired(error.data))
      )
        expire();
      else
        setToast({
          kind: uncertain ? "warning" : "danger",
          text: uncertain
            ? "Chưa xác định trạng thái sau khi mất kết nối. Kiểm tra Tinfos/Trello trước khi chạy lại."
            : error instanceof Error
              ? error.message
              : "Luồng chưa hoàn tất",
        });
    } finally {
      running.current = false;
      setBusy(false);
      void refreshHealth();
    }
  }
  async function refreshHealth() {
    try {
      const value = await api<WorkspaceSettings>("workspace/settings");
      setSettingsData(value);
      setConfig((current) =>
        current
          ? {
              ...current,
              credentials: Object.fromEntries(
                Object.entries(value.credentials).map(([name, info]) => [
                  name,
                  info.configured,
                ]),
              ),
            }
          : current,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expire();
    }
  }
  async function updateSettings(
    patch: Partial<WorkspaceOptions>,
    secrets?: Record<string, string | null>,
  ) {
    if (!settingsData) throw Error("Chưa tải được cấu hình");
    try {
      const value = await api<WorkspaceSettings>(
        "workspace/settings",
        {
          revision: settingsData.revision,
          settings: patch,
          ...(secrets && Object.keys(secrets).length ? { secrets } : {}),
        },
        "PATCH",
      );
      setSettingsData(value);
      setConfig((current) =>
        current
          ? {
              ...current,
              credentials: Object.fromEntries(
                Object.entries(value.credentials).map(([name, info]) => [
                  name,
                  info.configured,
                ]),
              ),
            }
          : current,
      );
      const nextPatch: Partial<Preferences> = {};
      if (patch.slugSuffix !== undefined)
        nextPatch.slugSuffix = patch.slugSuffix;
      if (patch.textProvider !== undefined)
        nextPatch.textProvider = patch.textProvider;
      if (patch.imageProvider !== undefined)
        nextPatch.imageProvider = patch.imageProvider;
      if (patch.categories && prefs)
        nextPatch.categories = Object.fromEntries(
          Object.entries(prefs.categories).map(([key, ids]) => [
            key,
            ids.filter((id) =>
              patch.categories!.some((item) => item.id === id),
            ),
          ]),
        );
      if (Object.keys(nextPatch).length) updatePrefs(nextPatch);
      setToast({ kind: "success", text: "Đã lưu cấu hình lên Firestore." });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expire();
      throw error;
    }
  }
  async function manageApiKeys(action: ApiKeyAction) {
    if (!settingsData) throw Error("Chưa tải được cấu hình");
    try {
      const value = await api<WorkspaceSettings>(
        "workspace/api-keys",
        { ...action, revision: settingsData.revision },
        "PATCH",
      );
      setSettingsData(value);
      setConfig((current) =>
        current
          ? {
              ...current,
              credentials: Object.fromEntries(
                Object.entries(value.credentials).map(([name, info]) => [
                  name,
                  info.configured,
                ]),
              ),
            }
          : current,
      );
      setToast({
        kind: "success",
        text: "Đã cập nhật API key. Lượt chạy tiếp theo dùng key bạn chọn.",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expire();
      if (error instanceof ApiError && error.status === 409)
        await refreshHealth();
      throw error;
    }
  }
  async function saveLibrary(items: LibraryItem[]) {
    try {
      const value = await api<Library>(
        "workspace/library",
        { items, revision: library.revision },
        "PUT",
      );
      setLibrary(value);
      setToast({ kind: "success", text: "Đã lưu thư viện content." });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expire();
      throw error;
    }
  }
  async function deleteTeam() {
    if (!deletingTeam || busy) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      const value = await api<{ teams: Team[]; revision: number }>(
        "workspace/teams",
        {
          teams: teams.filter(
            (team) => teamKey(team) !== teamKey(deletingTeam),
          ),
          revision: teamRevision,
        },
        "PUT",
      );
      setTeams(value.teams);
      setTeamRevision(value.revision);
      persist("teams", value);
      if (prefs)
        updatePrefs({
          selected: prefs.selected.filter(
            (key) => key !== teamKey(deletingTeam),
          ),
        });
      setDeletingTeam(null);
      setToast({
        kind: "success",
        text: "Đã xóa lineup đội khỏi cấu hình của bạn.",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expire();
      else
        setDeleteError(
          error instanceof Error ? error.message : "Không xóa được lineup",
        );
    } finally {
      setDeleteBusy(false);
    }
  }
  async function commitTeam(value: Team) {
    if (!editor) return;
    const next = [...teams];
    if (editor.index < 0) next.push(value);
    else next[editor.index] = value;
    try {
      const response = await api<{ teams: Team[]; revision: number }>(
        "workspace/teams",
        { teams: next, revision: teamRevision },
        "PUT",
      );
      setTeams(response.teams);
      setTeamRevision(response.revision);
      persist("teams", response);
      if (prefs && editor.index >= 0) {
        const oldKey = teamKey(editor.team),
          newKey = teamKey(value);
        if (oldKey !== newKey)
          updatePrefs({
            selected: prefs.selected.map((key) =>
              key === oldKey ? newKey : key,
            ),
            categories: {
              ...prefs.categories,
              [newKey]: prefs.categories[oldKey] ?? value.categories,
            },
          });
      }
      setToast({ kind: "success", text: "Đã lưu lineup lên Firestore." });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expire();
      throw error;
    }
  }
  async function savePrompts(reset = false) {
    if (!prompts) return;
    setPromptSaving(true);
    try {
      const data = await api<PromptDocument>(
        reset ? "workspace/prompts/reset" : "workspace/prompts",
        reset
          ? { revision: promptRevision, stages: [promptStage] }
          : { revision: promptRevision, prompts },
        reset ? "POST" : "PATCH",
      );
      setPrompts(data.prompts);
      setPromptRevision(data.revision);
      setPromptDocument(data);
      persist("prompts", data);
      persist("prompt-draft", data);
      setResetPrompt(false);
      setToast({
        kind: "success",
        text: reset
          ? "Đã khôi phục prompt đang chọn."
          : "Đã lưu prompt viết bài lên Firestore.",
      });
    } catch (error) {
      handleError(error);
    } finally {
      setPromptSaving(false);
    }
  }
  function changePrompt(value: string) {
    if (!prompts) return;
    const next = { ...prompts, [promptStage]: value };
    setPrompts(next);
    persist("prompt-draft", {
      prompts: next,
      revision: promptRevision,
      version: promptDocument?.version,
    });
  }
  async function signOut() {
    try {
      await logout();
    } catch (error) {
      handleError(error);
    }
  }
  function navigate(value: Page) {
    setPage(value);
    setMenu(false);
    setToast(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const nav = (
    <nav className="nav-items" aria-label="Điều hướng chính">
      {navigation.map((item) => (
        <button
          key={item.id}
          className={page === item.id ? "active" : ""}
          aria-current={page === item.id ? "page" : undefined}
          onClick={() => navigate(item.id)}
        >
          <Icon name={item.icon} size={18} />
          {item.title}
          {item.id === "teams" && (
            <span className="nav-count">{teams.length}</span>
          )}
        </button>
      ))}
    </nav>
  );
  const user = (
    <div className="user-row">
      <span className="avatar">
        {session.username.slice(0, 2).toUpperCase()}
      </span>
      <div className="user-details">
        <strong>{session.username}</strong>
        <small>Tài khoản Tinfos</small>
      </div>
      <button
        className="icon-button"
        data-tooltip="Đăng xuất"
        aria-label="Đăng xuất"
        disabled={busy}
        onClick={() => void signOut()}
      >
        <Icon name="logout" size={17} />
      </button>
    </div>
  );
  const current = navigation.find((item) => item.id === page)!;
  const heading = (
    <div className="page-heading">
      <div>
        <div className="eyebrow">KHÔNG GIAN NỘI DUNG</div>
        <h1>{current.title}</h1>
        <p>{current.description}</p>
      </div>
      {page === "teams" ? (
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            setEditor({
              index: -1,
              team: { team: "", sport: "", players: [], categories: [] },
            })
          }
        >
          <Icon name="plus" size={16} />
          Thêm đội
        </button>
      ) : (
        <span className="date">
          {new Intl.DateTimeFormat("vi-VN", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          }).format(new Date())}
        </span>
      )}
    </div>
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Đến nội dung chính
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="nav-label">WORKSPACE</div>
        {nav}
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <strong>
              <span className="tiny-dot" />
              Một nguồn, nhiều đội
            </strong>
            Mỗi bài được viết theo lineup riêng và chuyển tới đúng thẻ Trello.
          </div>
          {user}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu-button"
              aria-label="Mở menu"
              onClick={() => setMenu(true)}
            >
              <Icon name="menu" />
            </button>
            <span>Không gian làm việc</span>
            <span>/</span>
            <strong>{current.title}</strong>
          </div>
          <div className="topbar-right">
            <span className="connection">
              <span className="tiny-dot" />
              Đã đăng nhập
            </span>
            <span className="avatar">
              {session.username.slice(0, 2).toUpperCase()}
            </span>
          </div>
        </header>
        <main id="main-content" className="workspace">
          {heading}
          {toast && (
            <div className="toast">
              <Notice kind={toast.kind}>
                <div className="row between">
                  <span>{toast.text}</span>
                  <button
                    className="icon-button small"
                    aria-label="Ẩn thông báo"
                    onClick={() => setToast(null)}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              </Notice>
            </div>
          )}
          {loading ? (
            <div className="panel empty-state">
              <span className="spinner" />
              <p>Đang tải cấu hình của bạn…</p>
            </div>
          ) : !config || !prefs || !prompts || !settingsData ? (
            <div className="panel empty-state">
              <Icon name="warning" />
              <h2>Chưa tải được cấu hình</h2>
              <button
                onClick={() => {
                  setLoading(true);
                  void initialize();
                }}
              >
                Thử lại
              </button>
            </div>
          ) : (
            <>
              {page === "compose" && (
                <>
                  <div className="compose-grid">
                    <div className="compose-main">
                      <section className="panel" aria-label="Nội dung nguồn">
                        <div className="panel-header">
                          <div className="panel-title">
                            <span className="step-number">01</span>
                            <h2>Nội dung nguồn</h2>
                          </div>
                          <div className="row">
                            <SaveContentSample
                              draft={source}
                              disabled={busy || sourceLoading}
                              saveItem={(item) =>
                                saveLibrary([...library.items, item])
                              }
                            />
                            <button
                              className="small"
                              disabled={busy || sourceLoading}
                              onClick={() => void getSource()}
                            >
                              <Icon name="trello" size={14} />
                              {sourceLoading ? "Đang lấy…" : "Lấy từ Trello"}
                            </button>
                          </div>
                        </div>
                        <fieldset
                          className="panel-body stack"
                          disabled={busy || sourceLoading}
                        >
                          <p className="field-hint">
                            Nhập nội dung trực tiếp hoặc bấm Lấy từ Trello để
                            dùng nguồn đã cấu hình.
                          </p>
                          <div>
                            <div className="field-heading">
                              <label htmlFor="caption">Caption</label>
                              <small>
                                {source.caption.length.toLocaleString("vi-VN")}{" "}
                                ký tự
                              </small>
                            </div>
                            <textarea
                              id="caption"
                              placeholder="Câu chuyện bắt đầu từ đây. Dán caption gốc của bạn…"
                              rows={3}
                              value={source.caption}
                              onChange={(event) =>
                                updateSource({ caption: event.target.value })
                              }
                            />
                          </div>
                          <div>
                            <div className="field-heading">
                              <label htmlFor="content">Nội dung bài viết</label>
                              <small>Văn bản hoặc HTML</small>
                            </div>
                            <textarea
                              className="source-content"
                              id="content"
                              placeholder="Dán nội dung bài viết gốc. AutoWrite sẽ điều chỉnh đội và nhân vật theo lineup bạn chọn."
                              rows={8}
                              value={source.content}
                              onChange={(event) =>
                                updateSource({ content: event.target.value })
                              }
                            />
                          </div>
                          <label>
                            Lưu ý cho nội dung này · tùy chọn
                            <textarea
                              rows={3}
                              aria-label="Lưu ý cho nội dung này"
                              value={source.note}
                              onChange={(event) =>
                                updateSource({ note: event.target.value })
                              }
                              placeholder="Ví dụ: nhấn mạnh cảm xúc, giữ nguyên đoạn kết…"
                            />
                            <span className="field-hint">
                              Chỉ áp dụng cho cặp caption/content này và được
                              lưu kèm khi bấm Lưu content mẫu.
                            </span>
                          </label>
                          <div className="source-footer">
                            <span className="source-tag">
                              <Icon
                                name={source.cardId ? "trello" : "pen"}
                                size={13}
                              />
                              {source.cardId
                                ? "Đã lấy nguồn Trello · có thể chỉnh sửa"
                                : "Nguồn dùng chung cho tất cả đội"}
                            </span>
                            <span>
                              {source.content.trim()
                                ? source.content
                                    .trim()
                                    .split(/\s+/)
                                    .length.toLocaleString("vi-VN")
                                : 0}{" "}
                              từ
                            </span>
                          </div>
                        </fieldset>
                      </section>
                      <section className="panel" aria-label="Đội và category">
                        <div className="panel-header">
                          <div className="panel-title">
                            <span className="step-number">02</span>
                            <h2>Đội & category</h2>
                          </div>
                          <span className="save-note">
                            <Icon name="check" size={13} />
                            Tự lưu lựa chọn trên máy
                          </span>
                        </div>
                        <div className="team-toolbar">
                          <span>
                            {selected.length}/{teams.length} đội được chọn
                          </span>
                          <div className="row">
                            <button
                              className="ghost small"
                              disabled={busy}
                              onClick={() =>
                                updatePrefs({ selected: teams.map(teamKey) })
                              }
                            >
                              Chọn tất cả
                            </button>
                            <button
                              className="ghost small"
                              disabled={busy}
                              onClick={() => updatePrefs({ selected: [] })}
                            >
                              Bỏ chọn
                            </button>
                          </div>
                        </div>
                        <fieldset className="team-list" disabled={busy}>
                          {teams.map((team) => {
                            const key = teamKey(team),
                              checked = prefs.selected.includes(key),
                              cats = (
                                prefs.categories[key] ?? team.categories
                              ).filter((id) => options.includes(id));
                            return (
                              <div
                                key={key}
                                className={`team-choice ${checked ? "selected" : ""}`}
                              >
                                <div className="team-choice-top">
                                  <label>
                                    <input
                                      type="checkbox"
                                      aria-label={`Chọn ${team.team}`}
                                      checked={checked}
                                      onChange={() =>
                                        updatePrefs({
                                          selected: checked
                                            ? prefs.selected.filter(
                                                (value) => value !== key,
                                              )
                                            : [...prefs.selected, key],
                                        })
                                      }
                                    />
                                    <span>
                                      <span className="team-name">
                                        {team.team}
                                      </span>
                                      <span className="team-meta">
                                        <span>
                                          {team.players.length} cầu thủ
                                        </span>
                                        <span>·</span>
                                        <span>
                                          {team.headCoach ?? "Chưa có HLV"}
                                        </span>
                                      </span>
                                    </span>
                                  </label>
                                  <span className="sport-label">
                                    {team.sport.replace(" Football", "")}
                                  </span>
                                  <button
                                    className="icon-button small"
                                    aria-label={`Sửa lineup ${team.team}`}
                                    data-tooltip="Chỉnh lineup"
                                    onClick={() =>
                                      setEditor({
                                        team,
                                        index: teams.indexOf(team),
                                      })
                                    }
                                  >
                                    <Icon name="pen" size={14} />
                                  </button>
                                </div>
                                {checked && (
                                  <Categories
                                    label={`Category ${team.team}`}
                                    value={cats}
                                    options={options}
                                    change={(values) =>
                                      updatePrefs({
                                        categories: {
                                          ...prefs.categories,
                                          [key]: values,
                                        },
                                      })
                                    }
                                  />
                                )}
                              </div>
                            );
                          })}
                        </fieldset>
                      </section>
                    </div>
                    <aside
                      className="panel run-panel"
                      aria-label="Thiết lập viết bài"
                    >
                      <div className="panel-header">
                        <div className="panel-title">
                          <span className="step-number">03</span>
                          <h2>Viết & xuất bản</h2>
                        </div>
                      </div>
                      <div className="panel-body">
                        <fieldset
                          className="run-controls stack"
                          disabled={busy}
                        >
                          <div>
                            <div className="overline">Công cụ viết</div>
                            <div className="provider-options">
                              {(["gemini", "gpt"] as const).map((provider) => (
                                <label
                                  className={`provider-option ${prefs.textProvider === provider ? "checked" : ""}`}
                                  key={provider}
                                >
                                  <input
                                    type="radio"
                                    name="text-provider"
                                    value={provider}
                                    checked={prefs.textProvider === provider}
                                    onChange={() =>
                                      updatePrefs({ textProvider: provider })
                                    }
                                  />
                                  <span>
                                    {provider === "gemini" ? "Gemini" : "GPT"}
                                    <small>
                                      {config.credentials[
                                        provider === "gemini"
                                          ? "GEMINI_API_KEY"
                                          : "OPENAI_API_KEY"
                                      ]
                                        ? "Đã có API key"
                                        : "Chưa có API key"}
                                    </small>
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                          <label>
                            Nguồn tìm ảnh
                            <select
                              value={prefs.imageProvider}
                              onChange={(event) =>
                                updatePrefs({
                                  imageProvider: event.target
                                    .value as Preferences["imageProvider"],
                                })
                              }
                            >
                              <option value="tavily">Tavily</option>
                              <option value="serper">Serper</option>
                            </select>
                          </label>
                          <label>
                            Hậu tố slug
                            <input
                              placeholder="danghoa123"
                              value={prefs.slugSuffix}
                              onChange={(event) =>
                                updatePrefs({ slugSuffix: event.target.value })
                              }
                            />
                            <span className="field-hint">
                              Ví dụ: danghoa123 hoặc ngocthao123
                            </span>
                          </label>
                        </fieldset>
                        <div className="run-submit">
                          <div className="provider-health">
                            <div>
                              <small>
                                {prefs.textProvider === "gpt"
                                  ? "GPT"
                                  : "Gemini"}
                              </small>
                              <ProviderStatus
                                data={
                                  settingsData.providers[prefs.textProvider]
                                }
                              />
                            </div>
                            <div>
                              <small>
                                {prefs.imageProvider === "tavily"
                                  ? "Tavily"
                                  : "Serper"}
                              </small>
                              <ProviderStatus
                                data={
                                  settingsData.providers[prefs.imageProvider]
                                }
                              />
                            </div>
                          </div>
                          <div className="separator" />
                          <div className="run-stat">
                            <span>Bài viết sẽ tạo</span>
                            <strong>{selected.length} bài</strong>
                          </div>
                          <div className="run-stat">
                            <span>Đích xuất bản</span>
                            <strong>Tinfos → Trello</strong>
                          </div>
                          {missing.length > 0 && (
                            <p className="field-hint warning-text">
                              <Icon name="warning" size={13} /> Thiếu API key
                              cho lựa chọn hiện tại. Kiểm tra Cài đặt hoặc đổi
                              công cụ.
                            </p>
                          )}
                          {selected.some((team) => !team.categories.length) && (
                            <p className="field-hint warning-text">
                              Chọn ít nhất một category cho mỗi đội.
                            </p>
                          )}
                          <button
                            className="primary run-button"
                            disabled={!canRun}
                            onClick={() => void run()}
                          >
                            {busy ? (
                              <span className="spinner" />
                            ) : (
                              <Icon name="pen" size={17} />
                            )}{" "}
                            {busy
                              ? "Đang xử lý…"
                              : `Viết & publish ${selected.length} bài`}
                          </button>
                          <button
                            disabled={!canPreview}
                            onClick={() => void run(true)}
                          >
                            <Icon name="eye" size={16} />
                            Viết thử · chưa publish
                          </button>
                          <p className="field-hint">
                            Công cụ đã chọn viết bài cho từng đội.
                          </p>
                          <p className="field-hint">
                            Mỗi lần bấm là một lượt viết mới; nút publish không
                            đăng trực tiếp bản thử trước đó.
                          </p>
                          {!busy && (
                            <p className="run-note">
                              Bài viết được publish sau khi cập nhật thành công.
                              <br />
                              Caption sẽ vào đúng thẻ Trello của từng bài.
                            </p>
                          )}
                          {busy && (
                            <div
                              className="busy-box"
                              role="status"
                              aria-live="polite"
                            >
                              <strong>
                                <span className="spinner" />
                                Đang quét, chọn nhân vật và viết bài
                              </strong>
                              <p>
                                Đã chạy {elapsed} giây. Luồng có thể cần vài
                                phút; hãy giữ trang này mở.
                              </p>
                              <div className="progress-track">
                                <span />
                              </div>
                              <span>
                                Kết quả sẽ hiển thị riêng theo từng đội.
                              </span>
                            </div>
                          )}
                          <div className="pipeline">
                            <Icon name="check" size={11} />
                            Cập nhật
                            <Icon name="arrow" size={11} />
                            Publish
                            <Icon name="arrow" size={11} />
                            Caption
                          </div>
                        </div>
                      </div>
                    </aside>
                  </div>
                  {latest && (
                    <section
                      className="panel results-panel"
                      aria-label="Kết quả lần chạy"
                    >
                      <div className="panel-header">
                        <h2>Kết quả lần chạy</h2>
                        <span className="muted">
                          {latest.summary.succeeded}/{latest.summary.total} đội
                          hoàn tất
                        </span>
                      </div>
                      {latest.uncertain && (
                        <div className="panel-body">
                          <Notice kind="warning">
                            Kết nối bị ngắt. Kiểm tra Tinfos và Trello trước khi
                            chạy lại; bài có thể đã được tạo.
                          </Notice>
                        </div>
                      )}
                      {latest.context && (
                        <div className="panel-body">
                          <Notice
                            kind={
                              latest.context.status === "fallback"
                                ? "warning"
                                : "info"
                            }
                          >
                            <strong>
                              {contextLabels[
                                latest.context.analysis?.storyType ?? ""
                              ] ?? "Ngữ cảnh chưa đọc được"}
                            </strong>
                            <p>
                              {latest.context.analysis?.narrativeAction ??
                                "Đang dùng cách gọi chung, chưa chọn tên thay thế."}
                            </p>
                            {latest.context.warnings.length > 0 && (
                              <p>{latest.context.warnings.join(" ")}</p>
                            )}
                            {!!latest.context.modelWarnings?.length && (
                              <details>
                                <summary>Ghi chú tham khảo của model</summary>
                                <p>{latest.context.modelWarnings.join(" ")}</p>
                              </details>
                            )}
                          </Notice>
                        </div>
                      )}
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Đội</th>
                              <th>Trạng thái</th>
                              <th>Chi tiết</th>
                            </tr>
                          </thead>
                          <tbody>
                            {latest.results.map((result, index) => (
                              <tr key={index}>
                                <td>
                                  <strong>{result.team}</strong>
                                  <small>{result.sport}</small>
                                </td>
                                <td>
                                  <Status result={result} />
                                </td>
                                <td>
                                  <button
                                    className="small ghost"
                                    onClick={() => setDetail(result)}
                                  >
                                    Xem
                                    <Icon name="arrow" size={13} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </>
              )}
              {page === "teams" && (
                <>
                  <Notice>
                    Lineup dùng cho nhân vật và HLV hiện tại. Hãy cập nhật theo
                    mùa giải; bạn có thể sửa category riêng tại màn hình Viết
                    bài.
                  </Notice>
                  <div className="team-management">
                    {teams.map((team, index) => (
                      <article
                        className="panel roster-card"
                        key={teamKey(team)}
                      >
                        <div className="row between">
                          <span className="roster-icon">
                            <Icon name="team" />
                          </span>
                          <span className="sport-label">{team.sport}</span>
                        </div>
                        <h2>{team.team}</h2>
                        <p>{team.players.length} cầu thủ trong lineup</p>
                        <dl>
                          <dt>Head coach</dt>
                          <dd>{team.headCoach || "Chưa có"}</dd>
                          <dt>Mùa giải</dt>
                          <dd>{team.season || "Chưa nhập"}</dd>
                          <dt>Cập nhật</dt>
                          <dd>{team.lineupAsOf || "Chưa nhập"}</dd>
                          <dt>Category mặc định</dt>
                          <dd>{team.categories.join(", ")}</dd>
                        </dl>
                        <button
                          disabled={busy}
                          onClick={() => setEditor({ team, index })}
                        >
                          <Icon name="pen" size={15} />
                          Chỉnh lineup
                        </button>
                        <button
                          className="ghost danger"
                          disabled={busy}
                          onClick={() => {
                            setDeleteError("");
                            setDeletingTeam(team);
                          }}
                        >
                          <Icon name="trash" size={15} />
                          Xóa lineup
                        </button>
                      </article>
                    ))}
                  </div>
                </>
              )}
              {page === "prompts" && (
                <>
                  <Notice>
                    <strong>Prompt n8n · đổi cầu thủ giữa các lần viết</strong>
                    <p>
                      Mỗi đội gọi công cụ viết đã chọn một lần với đầy đủ prompt
                      n8n và lineup. Với cùng caption/content và đội, lịch sử
                      Firebase giúp tránh dùng lại cầu thủ đã xuất hiện trong
                      caption. Không thêm bước phân tích hoặc kiểm chứng nội
                      dung.
                    </p>
                  </Notice>
                  <details className="panel prompt-policy">
                    <summary>Cách tránh lặp cầu thủ</summary>
                    <pre>{promptDocument?.policy}</pre>
                  </details>
                  <div className="row" role="group" aria-label="Chọn prompt">
                    {stages.map((stage) => (
                      <button
                        key={stage.id}
                        aria-pressed={promptStage === stage.id}
                        className={promptStage === stage.id ? "primary" : ""}
                        onClick={() => setPromptStage(stage.id)}
                      >
                        {stage.title}
                      </button>
                    ))}
                  </div>
                  <div className="direct-prompt-layout">
                    <section className="panel">
                      <div className="panel-header">
                        <h2>
                          {
                            stages.find((stage) => stage.id === promptStage)
                              ?.title
                          }
                        </h2>
                        <span className="save-note">
                          <Icon name="cloud" size={13} />
                          Bản lưu #{promptRevision}
                        </span>
                      </div>
                      <div className="panel-body">
                        <p className="field-hint" style={{ marginBottom: 15 }}>
                          <>
                            Giữ các biến {"{{date}}"}, {"{{year}}"},{" "}
                            {"{{sportTeam}}"},{"{{caption}}"}, {"{{content}}"},{" "}
                            {"{{headCoachLine}}"},{"{{captainLine}}"},{" "}
                            {"{{playersLine}}"} để tự điền dữ liệu. Giữ định
                            dạng Title / Caption / Content.
                          </>
                        </p>
                        <textarea
                          className="prompt-editor"
                          aria-label="Nội dung prompt"
                          spellCheck={false}
                          value={prompts[promptStage]}
                          disabled={busy || promptSaving}
                          onChange={(event) => changePrompt(event.target.value)}
                        />
                        <div className="prompt-actions">
                          <button
                            className="primary"
                            disabled={
                              busy ||
                              promptSaving ||
                              Object.values(prompts).some(
                                (value) => !value.trim(),
                              )
                            }
                            onClick={() => void savePrompts()}
                          >
                            <Icon name="cloud" size={15} />
                            {promptSaving ? "Đang lưu…" : "Lưu lên đám mây"}
                          </button>
                          <button
                            disabled={busy || promptSaving}
                            onClick={() => setResetPrompt(true)}
                          >
                            <Icon name="refresh" size={15} />
                            Khôi phục mặc định
                          </button>
                          <span className="save-note">
                            Bản nháp tự lưu trên máy
                          </span>
                        </div>
                      </div>
                    </section>
                  </div>
                </>
              )}
              {page === "library" && (
                <LibraryPage
                  library={library}
                  saveItems={saveLibrary}
                  draft={source}
                  applyItem={(item) => {
                    updateSource({
                      caption: item.caption,
                      content: item.content,
                      note: item.note ?? "",
                      cardId: "",
                    });
                    navigate("compose");
                    setToast({
                      kind: "success",
                      text: "Đã đưa mẫu vào nội dung nguồn. Bạn có thể chỉnh trước khi viết.",
                    });
                  }}
                />
              )}
              {page === "categories" && (
                <CategoriesPage
                  categories={settingsData.settings.categories}
                  update={updateSettings}
                />
              )}
              {page === "tokens" && (
                <CredentialsPage
                  data={settingsData}
                  update={updateSettings}
                  imagesOnly
                  manageKeys={manageApiKeys}
                />
              )}
              {page === "settings" && (
                <div className="stack">
                  <GeneralSettings
                    key={settingsData.revision}
                    data={settingsData}
                    update={updateSettings}
                  />
                  <CredentialsPage
                    manageKeys={manageApiKeys}
                    data={settingsData}
                    update={updateSettings}
                  />
                  <section className="panel">
                    <div className="panel-body row between">
                      <p className="muted">
                        Đăng nhập với <strong>{session.username}</strong>. Cấu
                        hình lưu theo tài khoản trên Firestore.
                      </p>
                      <button
                        onClick={() => {
                          setLoading(true);
                          void initialize();
                        }}
                        disabled={busy}
                      >
                        <Icon name="refresh" size={15} />
                        Tải lại cấu hình
                      </button>
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() => void signOut()}
                      >
                        <Icon name="logout" size={15} />
                        Đăng xuất
                      </button>
                    </div>
                  </section>
                </div>
              )}
            </>
          )}
          <footer className="app-foot">
            <span>AutoWrite · Content Studio</span>
            <span>
              <Icon name="moon" size={11} /> Dark Night — Midnight Indigo
            </span>
          </footer>
        </main>
      </div>
      {menu && (
        <Modal title="Không gian làm việc" close={() => setMenu(false)}>
          <div className="mobile-nav">
            <Brand />
            {nav}
            {user}
          </div>
        </Modal>
      )}
      {editor && (
        <TeamEditor
          team={editor.team}
          commit={commitTeam}
          close={() => setEditor(null)}
        />
      )}
      {detail && <ResultDetail result={detail} close={() => setDetail(null)} />}
      {deletingTeam && (
        <Modal
          title="Xóa lineup đội?"
          close={() => {
            if (!deleteBusy) setDeletingTeam(null);
          }}
        >
          {deleteError && <Notice kind="danger">{deleteError}</Notice>}
          <p>
            Xóa lineup của <strong>{deletingTeam.team}</strong> khỏi cấu hình?
            Các bài viết và thẻ Trello đã tạo không bị xóa.
          </p>
          <div className="prompt-actions">
            <button disabled={deleteBusy} onClick={() => setDeletingTeam(null)}>
              Giữ lại
            </button>
            <button
              className="danger"
              disabled={deleteBusy}
              onClick={() => void deleteTeam()}
            >
              {deleteBusy ? "Đang xóa…" : "Xóa lineup"}
            </button>
          </div>
        </Modal>
      )}
      {resetPrompt && (
        <Modal
          title="Khôi phục prompt mặc định?"
          close={() => {
            if (!promptSaving) setResetPrompt(false);
          }}
        >
          <p>
            Chỉ prompt “
            {stages.find((stage) => stage.id === promptStage)?.title}” sẽ được
            khôi phục. Các prompt còn lại được giữ nguyên.
          </p>
          <div className="prompt-actions">
            <button
              disabled={promptSaving}
              onClick={() => setResetPrompt(false)}
            >
              Giữ bản hiện tại
            </button>
            <button
              className="primary"
              disabled={promptSaving}
              onClick={() => void savePrompts(true)}
            >
              {promptSaving ? "Đang khôi phục…" : "Khôi phục prompt"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
