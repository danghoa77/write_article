import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service.js';
import { ContentConfigService } from './content-config.service.js';
import { ContentService } from './content.service.js';
import { CharacterSelectionService } from './character-selection.service.js';
import type { ContentTeam, TeamSelection } from './content.model.js';

const normalize = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();
const sportKey = (sport: string) => {
  const value = normalize(sport);
  return value === 'nfl football' ? 'nfl' : value;
};
const teamKey = (team: TeamSelection) =>
  `${sportKey(team.sport)}:${normalize(team.team)}`;

@Injectable()
export class TeamSettingsService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly config: ContentConfigService,
    private readonly content: ContentService,
    private readonly selection: CharacterSelectionService,
  ) {}

  private reference(uid: string) {
    return this.firebase
      .database()
      .collection('users')
      .doc(encodeURIComponent(uid))
      .collection('settings')
      .doc('teams');
  }

  private validate(teams: ContentTeam[]) {
    if (!Array.isArray(teams) || teams.length > 50)
      throw new BadRequestException(
        'teams must contain 0 to 50 configured teams',
      );
    const seen = new Set<string>();
    for (const team of teams) {
      this.content.validateTeam(team);
      if (
        !team.team.trim() ||
        !team.sport.trim() ||
        !team.players.length ||
        !team.categories.length ||
        team.players.some((name) => !name.trim()) ||
        team.players.length > 1000 ||
        (team.season !== undefined && typeof team.season !== 'string') ||
        (team.lineupAsOf !== undefined && typeof team.lineupAsOf !== 'string')
      )
        throw new BadRequestException(
          'Configured teams require name, sport, nonempty players and categories',
        );
      this.selection.select({ summary: '', characters: [] }, team);
      const key = teamKey(team);
      if (seen.has(key))
        throw new BadRequestException('Duplicate team and sport');
      seen.add(key);
    }
    if (Buffer.byteLength(JSON.stringify(teams), 'utf8') > 750000)
      throw new BadRequestException('Team configuration is too large');
  }

  private response(saved: any = {}): {
    teams: ContentTeam[];
    revision: number;
    updatedAt: string | null;
  } {
    return {
      teams: saved.teams ?? this.config.defaults().teams,
      revision: saved.revision ?? 0,
      updatedAt: saved.updatedAt ?? null,
    };
  }

  async get(uid: string) {
    try {
      return this.response((await this.reference(uid).get()).data());
    } catch (error) {
      this.storageError(error);
    }
  }

  async update(uid: string, body: { revision: number; teams: ContentTeam[] }) {
    if (
      !body ||
      Object.keys(body).some((key) => !['revision', 'teams'].includes(key)) ||
      !Number.isSafeInteger(body.revision) ||
      body.revision < 0
    )
      throw new BadRequestException('Provide revision and teams only');
    this.validate(body.teams);
    // Store only serializable input, without undefined optional properties.
    const teams = JSON.parse(JSON.stringify(body.teams)) as ContentTeam[];
    try {
      const reference = this.reference(uid);
      return await this.firebase
        .database()
        .runTransaction(async (transaction) => {
          const saved = (await transaction.get(reference)).data() ?? {};
          if ((saved.revision ?? 0) !== body.revision)
            throw new ConflictException(
              'Lineup changed on another device; reload before saving',
            );
          const next = {
            teams,
            revision: body.revision + 1,
            updatedAt: new Date().toISOString(),
          };
          transaction.set(reference, next);
          return this.response(next);
        });
    } catch (error) {
      this.storageError(error);
    }
  }

  async resolve(
    requested: (ContentTeam | TeamSelection)[] | undefined,
    authorization?: string,
  ): Promise<ContentTeam[]> {
    if (
      requested !== undefined &&
      (!Array.isArray(requested) || !requested.length || requested.length > 50)
    )
      throw new BadRequestException('teams must contain 1 to 50 selections');
    let uid: string | undefined;
    if (authorization !== undefined) {
      const match = /^Bearer\s+(\S+)$/i.exec(authorization);
      if (!match)
        throw new UnauthorizedException(
          'Invalid Firebase Authorization header',
        );
      uid = (await this.firebase.user(match[1])).uid;
    }
    return this.resolveForUser(requested, uid);
  }

  async resolveForUser(
    requested: (ContentTeam | TeamSelection)[] | undefined,
    uid?: string,
  ): Promise<ContentTeam[]> {
    if (
      requested !== undefined &&
      (!Array.isArray(requested) || !requested.length || requested.length > 50)
    )
      throw new BadRequestException('teams must contain 1 to 50 selections');
    const needsCatalog =
      !requested ||
      requested.some(
        (team) =>
          !team ||
          typeof team !== 'object' ||
          (!('players' in team) && !('categories' in team)),
      );
    const catalog = needsCatalog
      ? uid
        ? (await this.get(uid)).teams
        : this.config.defaults().teams
      : [];
    const selections = requested ?? catalog;
    const seen = new Set<string>();
    return selections.map((item) => {
      if (
        !item ||
        typeof item.team !== 'string' ||
        !item.team.trim() ||
        typeof item.sport !== 'string' ||
        !item.sport.trim()
      )
        throw new BadRequestException('Each selection requires team and sport');
      const key = teamKey(item);
      if (seen.has(key))
        throw new BadRequestException('Duplicate team and sport in batch');
      seen.add(key);
      if ('players' in item || 'categories' in item) {
        this.content.validateTeam(item as ContentTeam);
        return structuredClone(item as ContentTeam);
      }
      if (Object.keys(item).some((key) => !['team', 'sport'].includes(key)))
        throw new BadRequestException(
          'A team selection accepts only team and sport; save lineup separately',
        );
      const found = catalog.filter((team) => teamKey(team) === key);
      if (found.length !== 1)
        throw new BadRequestException({
          code: 'TEAM_NOT_CONFIGURED',
          team: item.team,
          sport: item.sport,
          message:
            'No unique configured lineup for this team and sport; set up the team before running',
        });
      return structuredClone(found[0]);
    });
  }

  private storageError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(
      'Firestore lineup storage unavailable; check database and service-account permissions',
    );
  }
}
