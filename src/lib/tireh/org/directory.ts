/**
 * OrgDirectory — read-only view of the organization used to resolve who is
 * talking, who is in a conversation, and how people relate to each other.
 */

import type { Company, Group, OrgConfig, Persona, Person, Project } from '../types';

export class OrgDirectory {
  private readonly peopleById = new Map<string, Person>();
  private readonly peopleByTelegramId = new Map<number, Person>();
  private readonly personasById = new Map<string, Persona>();
  private readonly groupsByChatId = new Map<number, Group>();
  private readonly groupsById = new Map<string, Group>();
  private readonly projectsById = new Map<string, Project>();
  private readonly companiesById = new Map<string, Company>();

  constructor(readonly config: OrgConfig) {
    for (const person of config.people) {
      this.peopleById.set(person.id, person);
      if (person.telegramUserId !== undefined) {
        this.peopleByTelegramId.set(person.telegramUserId, person);
      }
    }
    for (const persona of config.personas) this.personasById.set(persona.id, persona);
    for (const group of config.groups) {
      this.groupsById.set(group.id, group);
      this.groupsByChatId.set(group.telegramChatId, group);
    }
    for (const project of config.projects) this.projectsById.set(project.id, project);
    for (const company of config.companies) this.companiesById.set(company.id, company);
  }

  get organizationName(): string {
    return this.config.organization.name;
  }

  getPerson(id: string): Person | undefined {
    return this.peopleById.get(id);
  }

  getPersonByTelegramId(telegramUserId: number): Person | undefined {
    return this.peopleByTelegramId.get(telegramUserId);
  }

  getPersona(id: string): Persona | undefined {
    return this.personasById.get(id);
  }

  getGroup(id: string): Group | undefined {
    return this.groupsById.get(id);
  }

  getGroupByChatId(telegramChatId: number): Group | undefined {
    return this.groupsByChatId.get(telegramChatId);
  }

  getProject(id: string): Project | undefined {
    return this.projectsById.get(id);
  }

  getCompany(id: string): Company | undefined {
    return this.companiesById.get(id);
  }

  listPeople(): Person[] {
    return this.config.people;
  }

  listProjectsFor(personId: string): Project[] {
    return this.config.projects.filter((p) => p.memberIds.includes(personId));
  }

  isProjectMember(personId: string, projectId: string): boolean {
    return this.getProject(projectId)?.memberIds.includes(personId) ?? false;
  }

  isCompanyMember(personId: string, companyId: string): boolean {
    return this.getPerson(personId)?.companyIds.includes(companyId) ?? false;
  }

  isGroupMember(personId: string, groupId: string): boolean {
    return this.getGroup(groupId)?.memberIds.includes(personId) ?? false;
  }

  directReports(personId: string): Person[] {
    return this.config.people.filter((p) => p.managerId === personId);
  }

  /**
   * Describe how two people relate, from the reporting tree and declared
   * relationships. Returns an empty list when they have no known relation.
   */
  describeRelationship(aId: string, bId: string): string[] {
    const a = this.getPerson(aId);
    const b = this.getPerson(bId);
    if (!a || !b || aId === bId) return [];

    const relations: string[] = [];
    if (b.managerId === a.id) relations.push(`${b.name} reports to ${a.name}`);
    if (a.managerId === b.id) relations.push(`${a.name} reports to ${b.name}`);
    if (a.managerId && a.managerId === b.managerId) {
      const manager = this.getPerson(a.managerId);
      relations.push(`${a.name} and ${b.name} both report to ${manager?.name ?? a.managerId}`);
    }

    for (const rel of this.config.relationships) {
      if ((rel.a === aId && rel.b === bId) || (rel.a === bId && rel.b === aId)) {
        relations.push(`${a.name} and ${b.name}: ${rel.label}`);
      }
    }

    const sharedProjects = this.config.projects.filter(
      (p) => p.memberIds.includes(aId) && p.memberIds.includes(bId)
    );
    for (const project of sharedProjects) {
      relations.push(`${a.name} and ${b.name} both work on ${project.name}`);
    }

    return relations;
  }

  /** One-line public profile, e.g. "Parastoo — Executive (manages Milad)" */
  describePerson(personId: string): string {
    const person = this.getPerson(personId);
    if (!person) return personId;
    const parts = [`${person.name} — ${person.role}`];
    const manager = person.managerId ? this.getPerson(person.managerId) : undefined;
    if (manager) parts.push(`reports to ${manager.name}`);
    const reports = this.directReports(personId);
    if (reports.length > 0) parts.push(`manages ${reports.map((r) => r.name).join(', ')}`);
    const projects = this.listProjectsFor(personId);
    if (projects.length > 0) parts.push(`works on ${projects.map((p) => p.name).join(', ')}`);
    if (person.notes) parts.push(person.notes);
    return parts.join('; ');
  }
}
