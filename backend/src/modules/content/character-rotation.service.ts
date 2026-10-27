import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { FirebaseService } from '../firebase/firebase.service.js';
import { ContentConfigService } from './content-config.service.js';
import type { ContentTeam, PreparedContent } from './content.model.js';

const normalize = (text: string) =>
  text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const contains = (text: string, name: string) => {
  const escaped = normalize(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
    'u',
  ).test(normalize(text));
};
interface Ticket {
  reference: FirebaseFirestore.DocumentReference;
  lease: string;
  candidates: string[];
  excluded: string[];
  cycle: number;
}

// This service never decides narrative context or chooses a replacement itself.
@Injectable()
export class CharacterRotationService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly config: ContentConfigService,
  ) {}

  async begin(
    caption: string,
    content: string,
    team: ContentTeam,
  ): Promise<Ticket> {
    const uid = this.config.value('CONTENT_HISTORY_SCOPE') || 'public';
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          normalize(caption),
          normalize(content),
          normalize(team.team),
          normalize(team.sport),
        ]),
      )
      .digest('hex');
    const reference = this.firebase
      .database()
      .collection('users')
      .doc(encodeURIComponent(uid))
      .collection('characterRotation')
      .doc(key);
    const candidates = [
      ...new Map(
        [
          ...team.players,
          ...(team.personnel ?? [])
            .filter((person) => person.role === 'player')
            .map((person) => person.name),
        ]
          .filter((name) => name.trim())
          .map((name) => [normalize(name), name.trim()]),
      ).values(),
    ];
    try {
      return await this.firebase.database().runTransaction(async (tx) => {
        const saved = (await tx.get(reference)).data() ?? {};
        if (saved.lease && saved.leaseUntil > Date.now())
          throw new ConflictException(
            'This source and team are already being written; wait for that request to finish',
          );
        let excluded = (saved.used ?? []).filter((name: string) =>
          candidates.some(
            (candidate) => normalize(candidate) === normalize(name),
          ),
        ) as string[];
        let cycle = saved.cycle ?? 1;
        // Strictly over 75%: exactly three out of four must not reset yet.
        if (candidates.length && excluded.length * 4 > candidates.length * 3) {
          excluded = [];
          cycle++;
        }
        const lease = randomUUID();
        tx.set(reference, {
          used: excluded,
          cycle,
          lease,
          leaseUntil: Date.now() + 600_000,
          updatedAt: new Date().toISOString(),
        });
        return { reference, lease, candidates, excluded, cycle };
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException(
        'Character rotation storage unavailable; no article generated',
      );
    }
  }

  writerTeam(team: ContentTeam, ticket: Ticket): ContentTeam {
    if (!ticket.excluded.length) return team;
    const excluded = new Set(ticket.excluded.map(normalize));
    return {
      ...team,
      players: team.players.filter((name) => !excluded.has(normalize(name))),
      personnel: team.personnel?.filter(
        (person) => !excluded.has(normalize(person.name)),
      ),
      // Captains may be stored as a comma-separated list, with role annotations.
      captain:
        team.captain
          ?.split(/[,;|\n]+/)
          .map((name) => name.trim())
          .filter(
            (name) =>
              name && !ticket.excluded.some((old) => contains(name, old)),
          )
          .join(', ') || null,
    };
  }

  directive(ticket: Ticket) {
    if (!ticket.excluded.length) return '';
    return (
      '\n\nREPEAT-WRITE VARIATION (same source and target team only):\n' +
      'Previous versions used these roster players as caption characters: ' +
      JSON.stringify(ticket.excluded) +
      '.\n' +
      'Those players have been REMOVED from the eligible target lineup. The remaining supplied lineup is the exclusive player pool for this adaptation; choose a suitable player ONLY from that remaining pool. Do not restore an excluded player from memory, source text, captain information or earlier versions. ' +
      'Do not use those names in the new caption. Do not substitute a coach merely for variety. ' +
      'Keep the full story, details, numbers, tone and output format required above. This is only a player repetition constraint; do not fact-check, summarize or generalize the source.\n'
    );
  }

  async complete(ticket: Ticket, article: PreparedContent) {
    // Caption characters only: supporting comparisons in the body must not exhaust the roster.
    const selected = ticket.candidates.filter((name) =>
      contains(article.caption, name),
    );
    if (
      selected.some((name) =>
        ticket.excluded.some((old) => normalize(old) === normalize(name)),
      )
    )
      throw new UnprocessableEntityException({
        code: 'CHARACTER_REPEATED',
        message:
          'Model đã lặp cầu thủ trong caption. Bản này chưa được chấp nhận; hãy viết lại.',
        selected,
      });
    await this.firebase.database().runTransaction(async (tx) => {
      const saved = (await tx.get(ticket.reference)).data();
      if (
        !saved ||
        saved.lease !== ticket.lease ||
        saved.leaseUntil < Date.now()
      )
        throw new ConflictException(
          'Character rotation lease expired; retry writing',
        );
      tx.set(ticket.reference, {
        used: [...new Set([...ticket.excluded, ...selected])],
        cycle: ticket.cycle,
        updatedAt: new Date().toISOString(),
      });
    });
    return {
      selected,
      excluded: ticket.excluded,
      cycle: ticket.cycle,
      note: selected.length
        ? 'Cầu thủ đã dùng được loại khỏi lineup gửi đi; model chọn từ các cầu thủ còn lại theo prompt n8n.'
        : 'Caption không có tên cầu thủ nhận diện được trong lineup/hồ sơ; không tự đoán nhân vật để lưu lịch sử.',
    };
  }

  async release(ticket: Ticket) {
    // Failed writes release only their own lease and never consume a player.
    await this.firebase.database().runTransaction(async (tx) => {
      const saved = (await tx.get(ticket.reference)).data();
      if (saved?.lease === ticket.lease)
        tx.set(ticket.reference, { ...saved, lease: null, leaseUntil: 0 });
    });
  }
}
