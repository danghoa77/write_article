import { Icon, Notice } from "./components";
import { replacementCharacters } from "./lib";
import {
  teamKey,
  type CharacterSettings,
  type StoryAnalysis,
  type Team,
} from "./types";

const storyLabels = {
  sad_news: "Sad news",
  lifestyle: "Đời sống",
  match: "Trận đấu",
  recognition: "Vinh danh",
  other: "Nội dung khác",
};
const identityLabels = {
  none: "Không có nhân vật",
  fictional: "Nhân vật hư cấu",
  real: "Người thật",
  mixed: "Nhiều loại nhân vật",
  uncertain: "Chưa rõ danh tính",
};
export default function CharacterControls({
  value,
  change,
  analysis,
  teams,
  scanning,
  scan,
  canScan,
  disabled,
}: {
  value: CharacterSettings;
  change: (value: Partial<CharacterSettings>) => void;
  analysis: StoryAnalysis | null;
  teams: Team[];
  scanning: boolean;
  scan: () => void;
  canScan: boolean;
  disabled: boolean;
}) {
  const characters = replacementCharacters(analysis);
  return (
    <section className="character-controls stack" aria-label="Xử lý nhân vật">
      <div className="row between">
        <h3>Xử lý nhân vật</h3>
        <button
          className="small"
          type="button"
          disabled={!canScan || disabled || scanning}
          onClick={scan}
        >
          {scanning ? (
            <span className="spinner" />
          ) : (
            <Icon name="eye" size={15} />
          )}
          {scanning ? "Đang quét…" : "Quét nội dung"}
        </button>
      </div>
      <label>
        Cách xử lý nhân vật
        <select
          value={value.characterMode}
          disabled={disabled || scanning}
          onChange={(event) =>
            change({
              characterMode: event.target
                .value as CharacterSettings["characterMode"],
              characterSelections: [],
            })
          }
        >
          <option value="auto">Tự động theo nội dung</option>
          <option value="preserve">Giữ nguyên nhân vật</option>
          <option value="manual">Tôi chọn nhân vật</option>
        </select>
      </label>
      <p className="field-hint">
        Mỗi lần viết đều quét nguồn trước khi chọn người. Bạn có thể quét trước
        để xem loại bài và nhân vật. Người không nêu tên hoặc hư cấu được giữ
        nguyên.
      </p>
      {analysis?.scan && (
        <Notice>
          <strong>
            {storyLabels[analysis.scan.storyType]} ·{" "}
            {identityLabels[analysis.scan.identityCase]}
          </strong>
          <p>{analysis.scan.reason}</p>
          {!!analysis.characters.length && (
            <p>
              {analysis.characters
                .map(
                  (person) =>
                    `${person.name}${person.narrativeRole === "primary" ? " (chính)" : person.narrativeRole === "reference" ? " (tham chiếu)" : ""}${person.requiredTraits.length ? ` — ${person.requiredTraits.join(", ")}` : ""}`,
                )
                .join("; ")}
            </p>
          )}
        </Notice>
      )}
      {value.characterMode === "preserve" && (
        <p className="field-hint">
          Giữ tên và danh tính; chỉ điều chỉnh bối cảnh đội phù hợp, không
          chuyển tiểu sử của người đó thành thành tích của đội mới.
        </p>
      )}
      {value.characterMode === "manual" && !analysis && (
        <Notice kind="warning">
          Bấm Quét nội dung trước, sau đó chọn nhân vật riêng cho từng đội.
        </Notice>
      )}
      {value.characterMode === "manual" && analysis && !characters.length && (
        <p className="field-hint">
          Không có người thật cần thay thế trong nội dung này.
        </p>
      )}
      {value.characterMode === "manual" &&
        characters.length > 0 &&
        teams.map((team) => (
          <div className="character-team stack" key={teamKey(team)}>
            <strong>
              {team.team} · {team.sport}
            </strong>
            {characters.map((person) => {
              const names = [
                ...new Set([
                  ...(person.role === "player" ? team.players : []),
                  ...(person.role === "coach" && team.headCoach
                    ? [team.headCoach]
                    : []),
                  ...(team.personnel ?? [])
                    .filter((item) => item.role === person.role)
                    .map((item) => item.name),
                ]),
              ];
              return (
                <label key={person.name}>
                  {person.name} →
                  <select
                    aria-label={`Thay ${person.name} cho ${team.team}`}
                    disabled={disabled || scanning}
                    value={
                      value.characterSelections.find(
                        (item) =>
                          teamKey(item) === teamKey(team) &&
                          item.sourceName === person.name,
                      )?.targetName ?? ""
                    }
                    onChange={(event) =>
                      change({
                        characterSelections: [
                          ...value.characterSelections.filter(
                            (item) =>
                              !(
                                teamKey(item) === teamKey(team) &&
                                item.sourceName === person.name
                              ),
                          ),
                          ...(event.target.value
                            ? [
                                {
                                  team: team.team,
                                  sport: team.sport,
                                  sourceName: person.name,
                                  targetName: event.target.value,
                                },
                              ]
                            : []),
                        ],
                      })
                    }
                  >
                    <option value="">Chọn từ lineup / hồ sơ đội</option>
                    {names.map((name) => (
                      <option value={name} key={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        ))}
      {value.characterMode !== "preserve" && (
        <details
          className="event-facts"
          open={
            characters.length > 0 &&
            analysis?.scan?.eventSpecific !== undefined &&
            analysis.scan.eventSpecific !== "none"
          }
        >
          <summary>Dữ kiện sự kiện riêng cho từng đội</summary>
          <p className="field-hint">
            Cần khi chuyển biến cố cá nhân hoặc kết quả trận sang người khác.
            Ghi đúng tên người, sự kiện và nguồn bạn có; lineup chỉ xác định
            thành viên đội. Dữ kiện này chưa được hệ thống xác minh realtime.
          </p>
          <div className="stack">
            {teams.map((team) => (
              <label key={teamKey(team)}>
                {team.team} · dữ kiện cho bài này
                <textarea
                  rows={3}
                  maxLength={20000}
                  disabled={disabled || scanning}
                  value={
                    value.teamFacts.find(
                      (item) => teamKey(item) === teamKey(team),
                    )?.facts ?? ""
                  }
                  onChange={(event) =>
                    change({
                      teamFacts: [
                        ...value.teamFacts.filter(
                          (item) => teamKey(item) !== teamKey(team),
                        ),
                        ...(event.target.value.trim()
                          ? [
                              {
                                team: team.team,
                                sport: team.sport,
                                facts: event.target.value,
                              },
                            ]
                          : []),
                      ],
                    })
                  }
                  placeholder="Nhân vật, diễn biến thực tế, thông tin hoặc đường dẫn nguồn…"
                />
              </label>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
