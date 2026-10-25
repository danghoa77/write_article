import { useState, type FormEvent } from "react";
import { Icon, Modal, Notice } from "./components";
import type { Team } from "./types";

export default function TeamEditor({
  team,
  close,
  commit,
}: {
  team: Team;
  close: () => void;
  commit: (team: Team) => Promise<void>;
}) {
  const [draft, setDraft] = useState(team);
  const [players, setPlayers] = useState(team.players.join("\n"));
  const [categories, setCategories] = useState(team.categories.join(", "));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [personnel, setPersonnel] = useState(
    JSON.stringify(team.personnel ?? [], null, 2),
  );
  const update = (key: keyof Team, value: string) =>
    setDraft({ ...draft, [key]: value });
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const cats = categories
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map(Number);
    const names = [
      ...new Set(
        players
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    if (
      !cats.length ||
      !cats.every((value) => Number.isInteger(value) && value > 0) ||
      !names.length
    ) {
      setError(
        "Nhập category là số nguyên dương, ngăn cách bằng dấu phẩy, và ít nhất một cầu thủ.",
      );
      return;
    }
    let profiles: Team["personnel"];
    try {
      profiles = JSON.parse(personnel);
      if (!Array.isArray(profiles)) throw Error();
    } catch {
      setError("Hồ sơ nâng cao phải là một danh sách JSON hợp lệ.");
      return;
    }
    setBusy(true);
    try {
      await commit({
        ...draft,
        team: draft.team.trim(),
        sport: draft.sport.trim(),
        players: names,
        categories: [...new Set(cats)],
        personnel: profiles,
      });
      close();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Không thể lưu lineup");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={team.team ? "Chỉnh sửa lineup" : "Thêm đội mới"}
      close={() => {
        if (!busy) close();
      }}
      wide
    >
      <form onSubmit={submit}>
        {error && <Notice kind="danger">{error}</Notice>}
        <fieldset className="stack" disabled={busy}>
          <div className="form-grid">
            <label>
              Tên đội
              <input
                value={draft.team}
                onChange={(event) => update("team", event.target.value)}
                required
                placeholder="Ví dụ: Denver Broncos"
              />
            </label>
            <label>
              Môn thể thao
              <input
                value={draft.sport}
                onChange={(event) => update("sport", event.target.value)}
                required
                placeholder="Ví dụ: NFL"
                list="sports"
              />
              <datalist id="sports">
                <option value="AFL" />
                <option value="NFL" />
                <option value="NCAA Football" />
                <option value="NBA" />
                <option value="Football" />
              </datalist>
            </label>
          </div>
          <div className="form-grid">
            <label>
              Head coach
              <input
                value={draft.headCoach ?? ""}
                onChange={(event) => update("headCoach", event.target.value)}
                placeholder="HLV trong lineup hiện tại"
              />
            </label>
            <label>
              Đội trưởng
              <input
                value={draft.captain ?? ""}
                onChange={(event) => update("captain", event.target.value)}
                placeholder="Tên đội trưởng"
              />
            </label>
          </div>
          <div className="form-grid">
            <label>
              Mùa giải
              <input
                value={draft.season ?? ""}
                onChange={(event) => update("season", event.target.value)}
                placeholder="Ví dụ: 2026–2027"
              />
            </label>
            <label>
              Ngày cập nhật lineup
              <input
                type="date"
                value={draft.lineupAsOf ?? ""}
                onChange={(event) => update("lineupAsOf", event.target.value)}
              />
            </label>
          </div>
          <label>
            Category mặc định
            <input
              value={categories}
              onChange={(event) => setCategories(event.target.value)}
              placeholder="44, 45"
              required
            />
            <span className="field-hint">
              Có thể đổi riêng cho từng đội khi viết bài.
            </span>
          </label>
          <label>
            Cầu thủ ·{" "}
            {players.split("\n").filter((value) => value.trim()).length} người
            <textarea
              rows={8}
              value={players}
              onChange={(event) => setPlayers(event.target.value)}
              placeholder="Mỗi cầu thủ một dòng"
              required
            />
          </label>
          <details>
            <summary>Hồ sơ nhân vật nâng cao</summary>
            <p className="field-hint">
              Tùy chọn: dữ kiện về giai đoạn sự nghiệp, vai trò, gia đình. Giữ
              định dạng hồ sơ của API.
            </p>
            <textarea
              aria-label="Hồ sơ nhân vật nâng cao"
              rows={7}
              value={personnel}
              onChange={(event) => setPersonnel(event.target.value)}
              spellCheck={false}
            />
          </details>
          <div className="row between">
            <span className="save-note">
              <Icon name="cloud" size={14} />
              Lưu theo tài khoản trên Firestore
            </span>
            <button className="primary" type="submit">
              {busy ? (
                <span className="spinner" />
              ) : (
                <Icon name="cloud" size={16} />
              )}
              Lưu lineup
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
