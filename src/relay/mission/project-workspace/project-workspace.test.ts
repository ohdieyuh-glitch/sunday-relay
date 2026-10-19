import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryDurableBacking } from '../durable/durable-store';
import { createNodeDurableBacking } from '../../persistence/durable-mission-file';
import {
  WONDERLAND_PROJECT_MAX_COLLABORATORS,
  WONDERLAND_PROJECT_ROLES,
  WONDERLAND_ROLE_CAPABILITIES,
  addProjectCollaborator,
  archiveWonderlandProject,
  attachCreationToProject,
  capabilitiesFor,
  changeCollaboratorRole,
  createWonderlandProject,
  createWonderlandProjectStore,
  duplicateWonderlandProject,
  openWonderlandProject,
  readWonderlandProject,
  removeProjectCollaborator,
  renameWonderlandProject,
  reopenWonderlandProject,
  saveProjectFile,
  sealWonderlandProject,
  suggestProjectPromotion,
  type WonderlandProjectDraft,
} from './index';

const OWNER = 'ghu-1001';
const COLLAB = 'ghu-2002';
const STRANGER = 'ghu-3003';
const MONDAY = '2026-09-14T09:00:00.000Z';
const TUESDAY = '2026-09-15T09:00:00.000Z';

const temps: string[] = [];
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true }).catch(() => {});
});

function project(id = 'prj_1'): WonderlandProjectDraft {
  const made = createWonderlandProject({
    projectId: id,
    ownerUserId: OWNER,
    name: 'Shirt Designer',
    description: 'A thing I am building',
    createdAtIso: MONDAY,
  });
  if (!made.ok) throw new Error(made.error.message);
  return made.value;
}

const file = (path: string) => ({
  path,
  sizeBytes: 10,
  sha256: null,
  mediaType: null,
  origin: 'authored' as const,
});

/* ------------------------------------------------------------------------ */

describe('a project is created with a leader and an avatar', () => {
  it('seats the owner as project leader', () => {
    const made = project();
    expect(made.members).toHaveLength(1);
    expect(made.members[0]).toMatchObject({ userId: OWNER, role: 'project_leader' });
  });

  it('carries a Project Avatar v1 bound to the project', () => {
    const made = project();
    expect(made.avatar.projectId).toBe('prj_1');
    expect(made.avatar.ownerUserId).toBe(OWNER);
    expect(made.avatar.manifestation).toBe('placeholder_sigil');
    expect(made.avatar.formHint).toMatch(/^form-\d+$/);
  });

  it('gives the avatar a stable form for the same project', () => {
    expect(project('prj_x').avatar.formHint).toBe(project('prj_x').avatar.formHint);
  });

  it('keeps the avatar free of files, creations and missions', () => {
    // The placeholder must be replaceable later WITHOUT rewriting storage, and
    // that is only true while the avatar holds identity and nothing else.
    const keys = Object.keys(project().avatar);
    for (const forbidden of ['files', 'assets', 'creationIds', 'missionIds', 'members']) {
      expect(keys, `the avatar should not hold ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('refuses a project with no owner or no name', () => {
    expect(createWonderlandProject({ projectId: 'p', ownerUserId: '', name: 'x', createdAtIso: MONDAY }).ok).toBe(false);
    expect(createWonderlandProject({ projectId: 'p', ownerUserId: OWNER, name: '  ', createdAtIso: MONDAY }).ok).toBe(false);
  });
});

describe('the seven project operations', () => {
  it('renames, and the avatar follows the name', () => {
    const renamed = renameWonderlandProject(project(), OWNER, 'Plush Factory', TUESDAY);
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.value.name).toBe('Plush Factory');
    expect(renamed.value.avatar.displayName).toBe('Plush Factory');
  });

  it('archives and reopens, and archiving is reversible', () => {
    const archived = archiveWonderlandProject(project(), OWNER, TUESDAY);
    if (!archived.ok) throw new Error('archive refused');
    expect(archived.value.status).toBe('ARCHIVED');
    expect(archived.value.avatar.status).toBe('ARCHIVED');

    const reopened = reopenWonderlandProject(archived.value, OWNER, TUESDAY);
    if (!reopened.ok) throw new Error('reopen refused');
    expect(reopened.value.status).toBe('ACTIVE');
  });

  it('refuses to archive twice', () => {
    const once = archiveWonderlandProject(project(), OWNER, TUESDAY);
    if (!once.ok) throw new Error('archive refused');
    expect(archiveWonderlandProject(once.value, OWNER, TUESDAY).ok).toBe(false);
  });

  it('duplicates the work but not the history', () => {
    const withFile = saveProjectFile(project(), OWNER, file('src/app.ts'), MONDAY);
    if (!withFile.ok) throw new Error('save refused');
    const withCreation = attachCreationToProject(withFile.value, OWNER, 'cre_1', MONDAY);
    if (!withCreation.ok) throw new Error('attach refused');

    const copy = duplicateWonderlandProject(withCreation.value, OWNER, 'prj_2', 'Copy', TUESDAY);
    if (!copy.ok) throw new Error('duplicate refused');
    expect(copy.value.files.map((f) => f.path)).toEqual(['src/app.ts']);
    // A creation belongs to the run that produced it; two projects must not
    // both claim the right to rebuild the same one.
    expect(copy.value.creationIds).toEqual([]);
    expect(copy.value.missionIds).toEqual([]);
    expect(copy.value.projectId).toBe('prj_2');
  });

  it('opens for a member and refuses a stranger', () => {
    expect(openWonderlandProject(project(), OWNER).ok).toBe(true);
    const refused = openWonderlandProject(project(), STRANGER);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe('not_a_member');
  });
});

describe('the workspace holds files across saves', () => {
  it('increments a path revision rather than duplicating the path', () => {
    const first = saveProjectFile(project(), OWNER, file('a.txt'), MONDAY);
    if (!first.ok) throw new Error('save refused');
    const second = saveProjectFile(first.value, OWNER, file('a.txt'), TUESDAY);
    if (!second.ok) throw new Error('save refused');

    expect(second.value.files).toHaveLength(1);
    expect(second.value.files[0].revision).toBe(2);
    expect(second.value.files[0].updatedAtIso).toBe(TUESDAY);
  });

  it('refuses a path that escapes the workspace', () => {
    for (const path of ['../escape.txt', '/etc/passwd', 'C:/x', 'a\\b']) {
      expect(saveProjectFile(project(), OWNER, file(path), MONDAY).ok, path).toBe(false);
    }
  });

  it('attaches a creation idempotently', () => {
    const once = attachCreationToProject(project(), OWNER, 'cre_1', MONDAY);
    if (!once.ok) throw new Error('attach refused');
    const twice = attachCreationToProject(once.value, OWNER, 'cre_1', MONDAY);
    if (!twice.ok) throw new Error('attach refused');
    expect(twice.value.creationIds).toEqual(['cre_1']);
  });
});

describe('roles, the ceiling, and the line that must not be crossed', () => {
  it('holds at most five collaborators', () => {
    let current = project();
    for (let i = 1; i < WONDERLAND_PROJECT_MAX_COLLABORATORS; i++) {
      const added = addProjectCollaborator(current, OWNER, `ghu-${9000 + i}`, 'editor', MONDAY);
      if (!added.ok) throw new Error(`add ${i} refused`);
      current = added.value;
    }
    expect(current.members).toHaveLength(WONDERLAND_PROJECT_MAX_COLLABORATORS);
    const overflow = addProjectCollaborator(current, OWNER, 'ghu-9999', 'editor', MONDAY);
    expect(overflow.ok).toBe(false);
  });

  it('gives a viewer read and nothing else', () => {
    const added = addProjectCollaborator(project(), OWNER, COLLAB, 'viewer', MONDAY);
    if (!added.ok) throw new Error('add refused');
    expect(capabilitiesFor(added.value, COLLAB)).toEqual(['view_project']);
  });

  it('NEVER lets a human reviewer start a mission or change configuration', () => {
    // The founder's line: a human Reviewer is a person with permissions and is
    // NOT Relay's independent Harnessing Reviewer. Letting this role move the
    // gate or spend the budget is what would turn verification into a social
    // gate.
    const reviewer = WONDERLAND_ROLE_CAPABILITIES.reviewer;
    expect(reviewer).not.toContain('start_mission');
    expect(reviewer).not.toContain('change_configuration');
    expect(reviewer).not.toContain('manage_collaborators');
  });

  it('grants no verification authority to ANY human role', () => {
    // No role anywhere in the table may carry a capability that sounds like it
    // satisfies the automated reviewer gate.
    for (const role of WONDERLAND_PROJECT_ROLES) {
      for (const capability of WONDERLAND_ROLE_CAPABILITIES[role]) {
        expect(capability, `${role} carries ${capability}`).not.toMatch(/verif|review_gate|harness/i);
      }
    }
  });

  it('refuses a stranger every mutation', () => {
    const base = project();
    expect(renameWonderlandProject(base, STRANGER, 'Hijacked', TUESDAY).ok).toBe(false);
    expect(saveProjectFile(base, STRANGER, file('x.txt'), TUESDAY).ok).toBe(false);
    expect(archiveWonderlandProject(base, STRANGER, TUESDAY).ok).toBe(false);
    expect(addProjectCollaborator(base, STRANGER, 'ghu-4', 'editor', TUESDAY).ok).toBe(false);
    expect(attachCreationToProject(base, STRANGER, 'cre_x', TUESDAY).ok).toBe(false);
  });

  it('removes access immediately and leaves nothing behind', () => {
    const added = addProjectCollaborator(project(), OWNER, COLLAB, 'editor', MONDAY);
    if (!added.ok) throw new Error('add refused');
    expect(saveProjectFile(added.value, COLLAB, file('ok.txt'), MONDAY).ok).toBe(true);

    const removed = removeProjectCollaborator(added.value, OWNER, COLLAB, TUESDAY);
    if (!removed.ok) throw new Error('remove refused');
    // Authorization is DERIVED from the member list on every call, so there is
    // no cached grant that could outlive the removal.
    expect(capabilitiesFor(removed.value, COLLAB)).toEqual([]);
    expect(saveProjectFile(removed.value, COLLAB, file('after.txt'), TUESDAY).ok).toBe(false);
    expect(openWonderlandProject(removed.value, COLLAB).ok).toBe(false);
  });

  it('keeps the owner as leader and refuses to remove them', () => {
    expect(removeProjectCollaborator(project(), OWNER, OWNER, TUESDAY).ok).toBe(false);
    expect(changeCollaboratorRole(project(), OWNER, OWNER, 'viewer', TUESDAY).ok).toBe(false);
  });

  it('makes an archived project read-only even for its leader', () => {
    const archived = archiveWonderlandProject(project(), OWNER, TUESDAY);
    if (!archived.ok) throw new Error('archive refused');
    expect(saveProjectFile(archived.value, OWNER, file('x.txt'), TUESDAY).ok).toBe(false);
    // But reopening is still available, or archiving would be a trap.
    expect(reopenWonderlandProject(archived.value, OWNER, TUESDAY).ok).toBe(true);
  });
});

describe('a project survives being written and read back', () => {
  it('detects tampering with the member list', () => {
    const sealed = sealWonderlandProject(project());
    const tampered = {
      ...sealed,
      members: [...sealed.members, { userId: STRANGER, role: 'project_leader', addedAtIso: MONDAY, addedByUserId: STRANGER }],
    };
    const read = readWonderlandProject(tampered);
    expect(read.ok).toBe(false);
  });

  it('never reads a corrupt project as an empty one', () => {
    const sealed = sealWonderlandProject(project());
    const read = readWonderlandProject({ ...sealed, members: [] });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toBe('corrupt');
  });

  it('lists only projects the account may view', async () => {
    const store = createWonderlandProjectStore(createInMemoryDurableBacking());
    await store.write(project('prj_a'));
    const other = createWonderlandProject({
      projectId: 'prj_b', ownerUserId: STRANGER, name: 'Theirs', createdAtIso: MONDAY,
    });
    if (!other.ok) throw new Error('create refused');
    await store.write(other.value);

    const mine = await store.listFor(OWNER);
    expect(mine.map((p) => p.projectId)).toEqual(['prj_a']);
    const theirs = await store.listFor(STRANGER);
    expect(theirs.map((p) => p.projectId)).toEqual(['prj_b']);
  });
});

describe('build Monday, return Tuesday — proven against real disk', () => {
  it('reopens the same project, with its files and creation, after a restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wonderland-project-'));
    temps.push(root);

    // ---- Monday: a separate store instance, which is then discarded.
    {
      const monday = createWonderlandProjectStore(createNodeDurableBacking(root));
      let work = project('prj_monday');
      const saved = saveProjectFile(work, OWNER, file('src/shirt.ts'), MONDAY);
      if (!saved.ok) throw new Error('save refused');
      work = saved.value;
      const attached = attachCreationToProject(work, OWNER, 'cre_shirt', MONDAY);
      if (!attached.ok) throw new Error('attach refused');
      const written = await monday.write(attached.value);
      expect(written.ok).toBe(true);
    }

    // ---- Tuesday: a brand new store over the same directory. Nothing is
    // carried across in memory; only what actually reached disk can be found.
    const tuesday = createWonderlandProjectStore(createNodeDurableBacking(root));
    const found = await tuesday.read('prj_monday');
    expect(found.ok).toBe(true);
    if (!found.ok) return;

    expect(found.record.name).toBe('Shirt Designer');
    expect(found.record.files.map((f) => f.path)).toEqual(['src/shirt.ts']);
    expect(found.record.creationIds).toEqual(['cre_shirt']);
    expect(found.record.avatar.manifestation).toBe('placeholder_sigil');

    // ---- And the work continues rather than merely being readable.
    const opened = openWonderlandProject(found.record, OWNER);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const continued = saveProjectFile(opened.project, OWNER, file('src/plush.ts'), TUESDAY);
    if (!continued.ok) throw new Error('continue refused');
    expect(continued.value.files.map((f) => f.path)).toEqual(['src/shirt.ts', 'src/plush.ts']);

    const rewritten = await tuesday.write(continued.value);
    expect(rewritten.ok).toBe(true);

    // ---- A third instance sees Tuesday's work too.
    const wednesday = createWonderlandProjectStore(createNodeDurableBacking(root));
    const again = await wednesday.read('prj_monday');
    if (!again.ok) throw new Error('lost after second restart');
    expect(again.record.files).toHaveLength(2);
  });

  it('does not find another account\'s project in a listing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wonderland-project-'));
    temps.push(root);
    const store = createWonderlandProjectStore(createNodeDurableBacking(root));
    await store.write(project('prj_private'));

    const reopened = createWonderlandProjectStore(createNodeDurableBacking(root));
    expect((await reopened.listFor(STRANGER)).map((p) => p.projectId)).toEqual([]);
    expect((await reopened.listFor(OWNER)).map((p) => p.projectId)).toEqual(['prj_private']);
  });
});

describe('promotion suggests, and never promotes', () => {
  const base = {
    stackedMissionCount: 0, fileCount: 0, creationCount: 0,
    resumedAfterLeaving: false, alreadyInProject: false,
  };

  it('stays quiet for a single small task', () => {
    const suggestion = suggestProjectPromotion(base);
    expect(suggestion.suggest).toBe(false);
  });

  it('stays quiet when the work already lives in a project', () => {
    const suggestion = suggestProjectPromotion({
      ...base, stackedMissionCount: 9, fileCount: 40, alreadyInProject: true,
    });
    expect(suggestion.suggest).toBe(false);
    if (suggestion.suggest) return;
    expect(suggestion.because).toBe('already_in_project');
  });

  it.each([
    ['missions_stacked', { stackedMissionCount: 3 }],
    ['file_heavy', { fileCount: 8 }],
    ['creations_produced', { creationCount: 2 }],
    ['work_resumed', { resumedAfterLeaving: true }],
  ])('suggests for %s', (reason, signal) => {
    const suggestion = suggestProjectPromotion({ ...base, ...signal });
    expect(suggestion.suggest).toBe(true);
    if (!suggestion.suggest) return;
    expect(suggestion.reasons).toContain(reason);
    expect(suggestion.action).toBe('create_or_move_into_project');
  });
});
