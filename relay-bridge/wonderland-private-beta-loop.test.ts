import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createNodeDurableBacking } from '../src/relay/persistence/durable-mission-file';
import {
  attachOwnedReference,
  bindWallet,
  createWonderlandAccountStore,
  multiplayerIdentityOf,
  signInToWonderland,
  signOutOfWonderland,
  type WonderlandAccountDraft,
} from '../src/relay/mission/wonderland-account';
import {
  createWonderlandSession,
  createWonderlandSessionStore,
  joinWonderlandSession,
  markWonderlandDisconnected,
  mayActOnBehalfOf,
  reconnectToWonderlandSession,
  viewWonderlandSession,
} from '../src/relay/mission/multiplayer';
import {
  attachCreationToProject,
  createWonderlandProject,
  createWonderlandProjectStore,
  openWonderlandProject,
  saveProjectFile,
} from '../src/relay/mission/project-workspace';
import {
  authorizeWonderWebAction,
  createWonderWebCreation,
  createWonderWebStore,
  projectWonderWebSurface,
  wonderWebAccessFor,
} from '../src/relay/mission/wonder-web';
import {
  authorizePurchase,
  commitPurchase,
  createWonderlandWalletStore,
  explainReceipt,
  markPurchaseSubmitted,
  openSandboxWallet,
  reserveFundsForPurchase,
  setSpendingPolicy,
  summariseWallet,
  syncBalances,
  type JuliusSpendingPolicy,
  type PurchaseQuote,
} from '../src/relay/mission/wallet';
import {
  buildWonderWebCreation,
  closeWonderWebCreation,
  openWonderWebCreation,
  resolveWonderWebPaths,
} from './wonder-web';

/**
 * THE COMBINED PRIVATE-BETA PROOF.
 *
 * Five systems, one flow, on REAL DISK with a REAL HTTP server:
 *
 *   login -> enter Wonderland -> join multiplayer -> create a project ->
 *   produce a creation -> open it in Wonder Web -> save it to the project ->
 *   access the wallet -> make an authorized sandbox purchase exactly once ->
 *   leave -> return -> everything is still there
 *
 * while a second user stays completely isolated throughout.
 *
 * WHAT MAKES THIS A PROOF RATHER THAN A DEMO: every store is constructed over a
 * temp directory and then DISCARDED at the "user leaves" step. The return leg
 * builds brand-new store instances over the same directory, so nothing is
 * carried across in memory and only what actually reached disk can be found.
 * The creation is served by the real sandbox server and fetched over a real
 * socket.
 *
 * Julius is not called. The creation arrives through a deterministic fixture,
 * which is exactly what the direction asked for — these product systems must be
 * provable without waiting for a paid provider.
 */

const A = { provider: 'github' as const, providerSubject: '1001', displayName: 'KAI' };
const B = { provider: 'github' as const, providerSubject: '2002', displayName: 'JUDITH' };
const USER_A = 'ghu-1001';
const USER_B = 'ghu-2002';

const MONDAY = '2026-09-14T09:00:00.000Z';
const T = (n: number) => new Date(Date.UTC(2026, 8, 14, 9, n)).toISOString();
const TUESDAY = '2026-09-15T09:00:00.000Z';

const temps: string[] = [];
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true }).catch(() => {});
});

const usd = (minor: number) => ({ amountMinor: minor, currency: 'USD' as const });

const SHIRT_QUOTE: PurchaseQuote = {
  quoteId: 'qte_shirt',
  merchantId: 'sandbox-print-co',
  itemDescription: 'Wonderland shirt from creation cre_beta',
  category: 'physical_print',
  itemPrice: usd(2_500),
  shipping: usd(500),
  tax: usd(200),
  total: usd(3_200),
  quotedAtIso: T(20),
  expiresAtIso: null,
};

const POLICY: JuliusSpendingPolicy = {
  enabled: true,
  maxPerTransaction: usd(5_000),
  maxPerDay: usd(15_000),
  maxPerMission: usd(10_000),
  requiresConfirmationAbove: usd(0),
  physicalGoodsAllowed: true,
  digitalGoodsAllowed: true,
  recurringPurchasesAllowed: false,
  allowedCategories: ['physical_print'],
  allowedMerchants: ['sandbox-print-co'],
};

/** The deterministic creation fixture. No provider is contacted. */
const FIXTURE_HTML =
  '<!doctype html><title>Beta Creation</title><h1 id="made">MADE IN WONDERLAND</h1>';

describe('THE PRIVATE-BETA LOOP, end to end', () => {
  it('runs all twenty-one steps and keeps user B isolated throughout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wonderland-beta-'));
    temps.push(root);
    const stateDir = join(root, 'state');
    const buildDir = join(root, 'build');

    /* ================= MONDAY: the whole session happens ================ */

    let accountA: WonderlandAccountDraft;
    let accountB: WonderlandAccountDraft;
    let sessionJoinCode: string;
    let walletLedger;

    {
      const accounts = createWonderlandAccountStore(createNodeDurableBacking(stateDir));
      const projects = createWonderlandProjectStore(createNodeDurableBacking(stateDir));
      const creations = createWonderWebStore(createNodeDurableBacking(stateDir));
      const sessions = createWonderlandSessionStore(createNodeDurableBacking(stateDir));
      const wallets = createWonderlandWalletStore(createNodeDurableBacking(stateDir));

      /* --- 1. User A authenticates. --------------------------------- */
      const signInA = signInToWonderland({ identity: A, existing: null, atIso: MONDAY });
      if (!signInA.ok) throw new Error('A sign-in refused');
      expect(signInA.value.kind).toBe('created');
      accountA = signInA.value.account;
      expect(accountA.userId).toBe(USER_A);

      /* --- 2. User A enters Wonderland (a durable account exists). --- */
      expect((await accounts.write(accountA)).ok).toBe(true);

      /* --- 3. User B authenticates SEPARATELY. ---------------------- */
      const signInB = signInToWonderland({ identity: B, existing: null, atIso: MONDAY });
      if (!signInB.ok) throw new Error('B sign-in refused');
      accountB = signInB.value.account;
      expect((await accounts.write(accountB)).ok).toBe(true);

      /* --- 5. Their identities remain distinct. --------------------- */
      expect(accountA.userId).not.toBe(accountB.userId);
      expect(multiplayerIdentityOf(accountA).userId).toBe(USER_A);
      expect(multiplayerIdentityOf(accountB).userId).toBe(USER_B);

      /* --- 4. Both join ONE multiplayer session. -------------------- */
      const made = createWonderlandSession({
        sessionId: 'ses_beta',
        hostUserId: accountA.userId,
        hostDisplayName: accountA.displayName,
        name: 'Private Beta',
        createdAtIso: T(1),
      });
      if (!made.ok) throw new Error('session refused');
      sessionJoinCode = made.value.joinCode;

      const joined = joinWonderlandSession(made.value, {
        userId: accountB.userId,
        displayName: accountB.displayName,
        joinCode: sessionJoinCode,
        atIso: T(2),
      });
      if (!joined.ok) throw new Error('B join refused');
      expect(joined.value.participants.map((p) => p.userId)).toEqual([USER_A, USER_B]);
      expect((await sessions.write(joined.value)).ok).toBe(true);

      // B sees A, but the join code (an invite capability) is withheld.
      const bView = viewWonderlandSession(joined.value, USER_B);
      if (!bView.ok) throw new Error('B view refused');
      expect(bView.value.participants).toHaveLength(2);
      expect(bView.value.joinCode).toBeNull();

      /* --- 6. User A creates a Project. ----------------------------- */
      const project = createWonderlandProject({
        projectId: 'prj_beta',
        ownerUserId: accountA.userId,
        name: 'Beta Project',
        description: 'The first private-beta project',
        createdAtIso: T(3),
      });
      if (!project.ok) throw new Error('project refused');
      let projectA = project.value;

      const attachedProject = attachOwnedReference(accountA, 'projectIds', 'prj_beta');
      if (!attachedProject.ok) throw new Error('attach refused');
      accountA = attachedProject.value;

      /* --- 7. A creation arrives through the fixture. --------------- */
      const paths = resolveWonderWebPaths(buildDir, 'cre_beta');
      if (paths === null) throw new Error('paths refused');
      await mkdir(paths.artifactRoot, { recursive: true });
      await writeFile(join(paths.artifactRoot, 'index.html'), FIXTURE_HTML);

      const creation = createWonderWebCreation({
        creationId: 'cre_beta',
        ownerUserId: accountA.userId,
        name: 'Beta Creation',
        missionId: 'mis_beta',
        projectId: 'prj_beta',
        creationType: 'website',
        runtimeType: 'static_bundle',
        sourceFiles: [{ path: 'index.html', sizeBytes: FIXTURE_HTML.length, sha256: null, mediaType: null }],
        provenance: 'simulated',
        producer: { systemId: 'beta-fixture', systemVersion: '1', attestationId: null },
        createdAtIso: T(4),
      });
      if (!creation.ok) throw new Error('creation refused');

      /* --- 8. The creation BUILDS. ---------------------------------- */
      const built = await buildWonderWebCreation(
        creation.value,
        paths,
        {
          executable: null,
          args: [],
          entrypoint: 'index.html',
          expectedArtifacts: [{ path: 'index.html', sizeBytes: FIXTURE_HTML.length, sha256: null, mediaType: null }],
        },
        () => T(5),
      );
      expect(built.status).toBe('READY');
      expect(built.entrypoint).toBe('index.html');

      /* --- 9 & 10. Wonder Web opens it and User A interacts. -------- */
      const opened = await openWonderWebCreation(built, paths, accountA.userId, null, () => T(6));
      if (!opened.ok) throw new Error(`open refused: ${opened.reason}`);

      const response = await fetch(opened.handle.server.entrypointUrl);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('MADE IN WONDERLAND');
      // The boundary is real on the live socket, not just in a unit test.
      expect(response.headers.get('content-security-policy')).toContain("connect-src 'none'");

      const surface = projectWonderWebSurface({
        viewerUserId: accountA.userId,
        viewerDisplayName: accountA.displayName,
        peers: [{ userId: USER_B, displayName: 'JUDITH', connectionState: 'LIVE' }],
        creation: opened.handle.creation,
        projectId: 'prj_beta',
        observedAtIso: T(6),
      });
      expect(surface.viewport.kind).toBe('creation');
      expect(surface.tabs[0].label).toBe('MY VIEW');
      expect(surface.tabs[1].label).toBe('JUDITH');
      expect(surface.tabs[1].access).toBe('observe');

      const stopped = await closeWonderWebCreation(opened.handle, () => T(7));
      expect(stopped.status).toBe('STOPPED');

      /* --- 11. The creation is SAVED INTO the project. -------------- */
      const withFile = saveProjectFile(
        projectA, accountA.userId,
        { path: 'creations/index.html', sizeBytes: FIXTURE_HTML.length, sha256: null, mediaType: 'text/html', origin: 'creation_output' },
        T(8),
      );
      if (!withFile.ok) throw new Error('save refused');
      const withCreation = attachCreationToProject(withFile.value, accountA.userId, 'cre_beta', T(8));
      if (!withCreation.ok) throw new Error('attach refused');
      projectA = withCreation.value;

      expect((await projects.write(projectA)).ok).toBe(true);
      expect((await creations.write(stopped)).ok).toBe(true);

      /* --- 12. User B cannot mutate Project A. ---------------------- */
      expect(openWonderlandProject(projectA, USER_B).ok).toBe(false);
      expect(saveProjectFile(projectA, USER_B, { path: 'hack.txt', sizeBytes: 1, sha256: null, mediaType: null, origin: 'authored' }, T(9)).ok).toBe(false);
      expect(attachCreationToProject(projectA, USER_B, 'cre_evil', T(9)).ok).toBe(false);

      /* --- 13. User B cannot mutate User A's creation. -------------- */
      expect(wonderWebAccessFor(stopped, USER_B, [USER_A])).toBe('observe');
      for (const action of ['run', 'stop', 'rebuild', 'read_files', 'save_to_project'] as const) {
        expect(authorizeWonderWebAction(stopped, USER_B, action, [USER_A]).ok, action).toBe(false);
      }
      const bOpen = await openWonderWebCreation(stopped, paths, USER_B, null, () => T(9));
      expect(bOpen.ok).toBe(false);

      // And co-presence in the session grants nothing either.
      expect(mayActOnBehalfOf(joined.value, USER_B, USER_A)).toBe(false);

      /* --- WALLET: access, authorize, execute exactly once. --------- */
      const walletOpen = openSandboxWallet({
        walletId: 'wal_a', ownerUserId: accountA.userId, createdAtIso: T(10),
      });
      if (!walletOpen.ok) throw new Error('wallet refused');
      let walletA = walletOpen.value.wallet;
      walletLedger = walletOpen.value.entries;

      expect(summariseWallet(walletA).isSandbox).toBe(true);
      expect(summariseWallet(walletA).fundingLabel).toContain('NOT REAL MONEY');

      const policied = setSpendingPolicy(walletA, POLICY, T(11));
      if (!policied.ok) throw new Error('policy refused');
      walletA = policied.value;

      const authorized = authorizePurchase({
        purchaseId: 'pur_shirt',
        wallet: walletA,
        requesterUserId: accountA.userId,
        quote: SHIRT_QUOTE,
        rights: 'USER_OWNS_RIGHTS',
        entries: walletLedger,
        missionId: 'mis_beta',
        projectId: 'prj_beta',
        creationId: 'cre_beta',
        idempotencyKey: 'beta-shirt-1',
        nowIso: T(20),
      });
      if (!authorized.ok) throw new Error('authorize refused');
      if (authorized.value.kind !== 'authorized') throw new Error(`expected authorization, got ${authorized.value.kind}`);

      const reserved = reserveFundsForPurchase(authorized.value.intent, walletLedger, walletA, T(21));
      if (!reserved.ok) throw new Error('reserve refused');
      const submitted = markPurchaseSubmitted(reserved.value.intent, reserved.value.entries, T(22));
      if (!submitted.ok) throw new Error('submit refused');
      const committed = commitPurchase(submitted.value.intent, submitted.value.entries, walletA, 'ord_beta', T(23));
      if (!committed.ok) throw new Error('commit refused');
      walletLedger = committed.value.entries;
      walletA = syncBalances(walletA, walletLedger);

      // EXACTLY ONCE, even when the commit is replayed.
      const replay = commitPurchase(committed.value.intent, walletLedger, walletA, 'ord_beta', T(24));
      if (!replay.ok) throw new Error('replay refused');
      expect(replay.value.entries).toHaveLength(walletLedger.length);
      expect(walletLedger.filter((e) => e.type === 'PURCHASE')).toHaveLength(1);
      expect(walletA.availableBalance).toEqual(usd(46_800));

      const receipt = committed.value.receipt;
      expect(explainReceipt(receipt, walletLedger)).toContain('$32.00');

      const bound = bindWallet(accountA, 'wal_a');
      if (!bound.ok) throw new Error('bind refused');
      accountA = bound.value;

      expect((await wallets.write(walletA)).ok).toBe(true);
      expect(await wallets.writeLedger('wal_a', walletLedger)).toBe(true);
      expect((await accounts.write(accountA)).ok).toBe(true);

      /* --- 14. User A exits. ---------------------------------------- */
      accountA = signOutOfWonderland(accountA, T(30));
      expect((await accounts.write(accountA)).ok).toBe(true);
    }
    // Every store instance above is now out of scope. Nothing is in memory.

    /* ================= TUESDAY: a cold return ======================== */

    const accounts = createWonderlandAccountStore(createNodeDurableBacking(stateDir));
    const projects = createWonderlandProjectStore(createNodeDurableBacking(stateDir));
    const creations = createWonderWebStore(createNodeDurableBacking(stateDir));
    const sessions = createWonderlandSessionStore(createNodeDurableBacking(stateDir));
    const wallets = createWonderlandWalletStore(createNodeDurableBacking(stateDir));

    /* --- 15. User A returns. ---------------------------------------- */
    const foundAccount = await accounts.findByProviderSubject('github', '1001');
    expect(foundAccount).not.toBeNull();
    if (foundAccount === null) return;

    const back = signInToWonderland({ identity: A, existing: { ...foundAccount }, atIso: TUESDAY });
    if (!back.ok) throw new Error('return sign-in refused');
    expect(back.value.kind).toBe('returned');
    const returnedA = back.value.account;
    expect(returnedA.userId).toBe(USER_A);

    /* --- 16. The project still exists, with its work. ---------------- */
    const foundProject = await projects.read('prj_beta');
    expect(foundProject.ok).toBe(true);
    if (!foundProject.ok) return;
    expect(foundProject.record.name).toBe('Beta Project');
    expect(foundProject.record.creationIds).toEqual(['cre_beta']);
    expect(foundProject.record.files.map((f) => f.path)).toEqual(['creations/index.html']);
    expect(openWonderlandProject(foundProject.record, USER_A).ok).toBe(true);

    /* --- 17. The creation OPENS AGAIN, over a real socket. ---------- */
    const foundCreation = await creations.read('cre_beta');
    expect(foundCreation.ok).toBe(true);
    if (!foundCreation.ok) return;
    expect(foundCreation.record.entrypoint).toBe('index.html');

    const paths = resolveWonderWebPaths(buildDir, 'cre_beta');
    if (paths === null) throw new Error('paths refused');
    const reopened = await openWonderWebCreation(
      foundCreation.record, paths, USER_A, null, () => TUESDAY,
    );
    if (!reopened.ok) throw new Error(`reopen refused: ${reopened.reason}`);
    const reBody = await (await fetch(reopened.handle.server.entrypointUrl)).text();
    expect(reBody).toContain('MADE IN WONDERLAND');
    await closeWonderWebCreation(reopened.handle, () => TUESDAY);

    /* --- 18 & 19. Multiplayer reconnect, ownership intact. ---------- */
    const foundSession = await sessions.read('ses_beta');
    expect(foundSession.ok).toBe(true);
    if (!foundSession.ok) return;

    const dropped = markWonderlandDisconnected(foundSession.record, USER_B, T(40));
    if (!dropped.ok) throw new Error('disconnect refused');
    expect(dropped.value.participants.find((p) => p.userId === USER_B)?.connection).toBe('RECONNECTING');
    // A disconnection is not a departure: the slot is still held.
    expect(dropped.value.participants).toHaveLength(2);

    const rejoined = reconnectToWonderlandSession(dropped.value, USER_B, T(41));
    if (!rejoined.ok) throw new Error('reconnect refused');
    expect(rejoined.value.participants.find((p) => p.userId === USER_B)?.connection).toBe('CONNECTED');

    // 19 — ownership is STILL correct after the reconnect.
    expect(mayActOnBehalfOf(rejoined.value, USER_B, USER_A)).toBe(false);
    expect(rejoined.value.participants.find((p) => p.userId === USER_B)?.isHost).toBe(false);
    expect(openWonderlandProject(foundProject.record, USER_B).ok).toBe(false);
    expect(authorizeWonderWebAction(foundCreation.record, USER_B, 'run', [USER_A]).ok).toBe(false);

    /* --- WALLET + history persist, and B still cannot reach them. --- */
    const foundWallet = await wallets.read('wal_a');
    expect(foundWallet.ok).toBe(true);
    if (!foundWallet.ok) return;
    expect(foundWallet.record.availableBalance).toEqual(usd(46_800));
    expect(foundWallet.record.ownerUserId).toBe(USER_A);

    const ledger = await wallets.readLedger('wal_a');
    expect(ledger.filter((e) => e.type === 'PURCHASE')).toHaveLength(1);
    expect(await wallets.findByOwner(USER_B)).toBeNull();

    /* --- 20. NO SECRETS in any artifact written to disk. ------------ */
    const secretShapes = [
      /gh[pousr]_[A-Za-z0-9]{20,}/,
      /sk-[A-Za-z0-9]{8,}/,
      /AKIA[0-9A-Z]{12,}/,
      /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/,
      /BEGIN [A-Z ]*PRIVATE KEY/,
      /\b(?:password|cvv|cardNumber|routingNumber|clientSecret)\b/i,
    ];
    const files = await readdir(stateDir, { recursive: true, withFileTypes: true });
    let scanned = 0;
    for (const entry of files) {
      if (!entry.isFile()) continue;
      const text = await readFile(join(entry.parentPath ?? stateDir, entry.name), 'utf8').catch(() => '');
      if (text === '') continue;
      scanned += 1;
      for (const shape of secretShapes) {
        expect(text, `${entry.name} matched ${shape}`).not.toMatch(shape);
      }
    }
    // The scan proves something only if it actually read the durable state.
    expect(scanned).toBeGreaterThan(0);
  }, 60_000);
});
