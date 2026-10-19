// THE DECLARED TEST of julius-unreal-mission-1 (row 14-Unreal, C1: the Social Hub keeps its scroll positions across a refresh).
//
// STATIC ONLY. This sandbox has Node and git, and no C++ compiler and no Unreal: nothing here can build or run the hub. What it
// can prove, it proves exactly:
//   (a) the six QA functions the acceptance test calls are declared, verbatim, in the public part of SWonderlandSocialHubPanel,
//       and each has exactly one definition in the .cpp;
//   (b) under wonderland/, nothing but the two files the change edits differs from the seed, and no file was added or removed;
//   (c) F-21 is intact: a refresh and a voice change still only ASK for a rebuild, and Slate's pre-tick still runs it;
//   (d) the QA code at the foot of the .cpp, from `namespace WonderlandSocialBlockedQa` to the end, is byte for byte the seed's;
//   (e) two cheap guards against an edit that cannot compile: (), [] and {} balance outside comments and literals, and no
//       #include is added or removed beyond the one allowed addition.
// The behaviour itself (SC1-SC6) is proven after the run, on the built game, by CORE's wl.Qa.SocialHubScroll. Its source is
// wonderland/Source/Wonderland/WonderlandSocialHubScrollQa.cpp in this workspace, read-only, and it is not compiled here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'wonderland/Source/Wonderland';
const H = `${DIR}/WonderlandSocialHubPanel.h`;
const CPP = `${DIR}/WonderlandSocialHubPanel.cpp`;
// Every file under wonderland/ but the two the change edits, with the seed's sha256 (generated from the seed, never typed).
const FROZEN = new Map([
  ['wonderland/Source/Wonderland/WonderlandSocialTypes.h', '336907b669b94a0323399c77375dd862bd1b6582ebafab39febe0c36e9a7dd22'],
  ['wonderland/Source/Wonderland/WonderlandSocialProfilePanel.h', '183f0760b435eafe9e00be47c2ab2a4a7a94212ac89150e17081188c7842854a'],
  ['wonderland/Source/Wonderland/WonderlandSocialSignIn.h', 'db4f4106c82fe8e6ce5833ab418d9e40ae328172737fecb23e02cdbc1d2f5eeb'],
  ['wonderland/Source/Wonderland/WonderlandUiStyle.h', '8ba0f50a554e1b50a4ceebebea953e249ae0b98a862c060a04c8ae0f3157b0c5'],
  ['wonderland/Source/Wonderland/WonderlandSocialHubScrollQa.cpp', 'ccf7f2a556340acece4505e7f6a2ec5c765280436614708151e73978880c3870'],
]);
const EDITED = [CPP, H];
const QA_REGION_START = 'namespace WonderlandSocialBlockedQa';
const QA_REGION_SHA256 = '1d572294865bd938d48d3d85a368cdecf085e81df10e361982cf573dfa800f3d';
const CPP_INCLUDES = ["Containers/Ticker.h", "Engine/LocalPlayer.h", "Engine/World.h", "Framework/Application/SlateApplication.h", "GameFramework/PlayerController.h", "HAL/IConsoleManager.h", "Misc/DateTime.h", "Styling/CoreStyle.h", "Widgets/Input/SButton.h", "Widgets/Input/SEditableTextBox.h", "Widgets/Layout/SBorder.h", "Widgets/Layout/SBox.h", "Widgets/Layout/SScaleBox.h", "Widgets/Layout/SScrollBox.h", "Widgets/Layout/SWrapBox.h", "Widgets/SBoxPanel.h", "Widgets/SOverlay.h", "Widgets/Text/STextBlock.h", "WonderlandSocialHubPanel.h", "WonderlandSocialLive.h", "WonderlandUiStyle.h", "WonderlandUiSubsystem.h"];
const H_INCLUDES = ["Brushes/SlateRoundedBoxBrush.h", "CoreMinimal.h", "Styling/SlateBrush.h", "Styling/SlateTypes.h", "Widgets/SCompoundWidget.h", "WonderlandSocialProfilePanel.h", "WonderlandSocialSignIn.h", "WonderlandSocialTypes.h"];
const H_INCLUDE_MAY_ADD = ['Widgets/Layout/SScrollBox.h'];
const DECLARATIONS = [
  'float QaListScrollOffset() const;',
  'bool QaSetListScrollOffset(float Offset);',
  'float QaHistoryScrollOffset() const;',
  'bool QaSetHistoryScrollOffset(float Offset);',
  'bool QaHistoryAtEnd() const;',
  'void QaSetScrollMemory(bool bOn);',
];
const DEFINITIONS = [
  /\bfloat\s+SWonderlandSocialHubPanel::QaListScrollOffset\s*\(\s*\)\s*const\s*\{/g,
  /\bbool\s+SWonderlandSocialHubPanel::QaSetListScrollOffset\s*\(\s*float\s+[A-Za-z_]\w*\s*\)\s*\{/g,
  /\bfloat\s+SWonderlandSocialHubPanel::QaHistoryScrollOffset\s*\(\s*\)\s*const\s*\{/g,
  /\bbool\s+SWonderlandSocialHubPanel::QaSetHistoryScrollOffset\s*\(\s*float\s+[A-Za-z_]\w*\s*\)\s*\{/g,
  /\bbool\s+SWonderlandSocialHubPanel::QaHistoryAtEnd\s*\(\s*\)\s*const\s*\{/g,
  /\bvoid\s+SWonderlandSocialHubPanel::QaSetScrollMemory\s*\(\s*bool\s+[A-Za-z_]\w*\s*\)\s*\{/g,
];

const bytes = (path) => readFileSync(path);
const text = (path) => readFileSync(path, 'utf8');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** The source with every comment removed and every string or character literal emptied, so delimiters and calls are read
 *  from code only. Throws on an unterminated comment or literal, which could not compile either. */
function codeOnly(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new Error('an unterminated /* comment');
      out += ' ';
      i = end + 2;
      continue;
    }
    if (c === 'R' && d === '"' && !/\w/.test(src[i - 1] ?? '')) {
      const open = src.indexOf('(', i + 2);
      if (open < 0) throw new Error('an unterminated raw string');
      const close = src.indexOf(`)${src.slice(i + 2, open)}"`, open + 1);
      if (close < 0) throw new Error('an unterminated raw string');
      out += '""';
      i = close + (open - (i + 2)) + 2;
      continue;
    }
    if (c === '"' || (c === "'" && !(/\d/.test(src[i - 1] ?? '') && /\d/.test(d ?? '')))) {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\n') throw new Error(`an unterminated ${c} literal`);
        j += src[j] === '\\' ? 2 : 1;
      }
      if (j >= src.length) throw new Error(`an unterminated ${c} literal`);
      out += c + c;
      i = j + 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** The body of the one function whose header matches `header` (a regex ending at its opening brace), braces included. */
function bodyOf(code, header) {
  const matches = [...code.matchAll(header)];
  assert.equal(matches.length, 1, `expected exactly one definition matching ${header}, found ${matches.length}`);
  const open = matches[0].index + matches[0][0].length - 1;
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  throw new Error(`the body of ${header} never closes`);
}

const squash = (s) => s.replace(/\s+/g, ' ').trim();
const includesOf = (src) => [...src.matchAll(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm)].map((m) => m[1]).sort();

function filesUnder(root) {
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name).split('\\').join('/');
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

test('(a) the six QA declarations are public in SWonderlandSocialHubPanel, each defined exactly once in the .cpp', () => {
  const h = codeOnly(text(H)).replace(/[ \t]+/g, ' ');
  const classAt = h.indexOf('class WONDERLAND_API SWonderlandSocialHubPanel');
  assert.ok(classAt >= 0, 'the class SWonderlandSocialHubPanel is not declared');
  const klass = h.slice(classAt);
  const publicAt = klass.indexOf('public:');
  const privateAt = klass.indexOf('private:', publicAt);
  assert.ok(publicAt >= 0 && privateAt > publicAt, 'the class has no public: section followed by private:');
  for (const declaration of DECLARATIONS) {
    const count = klass.split(declaration).length - 1;
    assert.equal(count, 1, `"${declaration}" must be declared exactly once in the class (found ${count})`);
    const at = klass.indexOf(declaration);
    assert.ok(at > publicAt && at < privateAt, `"${declaration}" must be in the public section`);
  }
  const cpp = codeOnly(text(CPP));
  for (const definition of DEFINITIONS) {
    const count = [...cpp.matchAll(definition)].length;
    assert.equal(count, 1, `exactly one definition must match ${definition} (found ${count})`);
  }
});

test('(b) under wonderland/, only the two edited files may differ from the seed, and no file is added or removed', () => {
  for (const [path, want] of FROZEN) {
    assert.match(want, /^[0-9a-f]{64}$/, `${path}: its pinned sha256 is not filled in`);
    assert.equal(sha256(bytes(path)), want, `${path} is read-only and must be byte for byte the seed's`);
  }
  const expected = [...FROZEN.keys(), ...EDITED].sort();
  assert.deepEqual(filesUnder('wonderland').sort(), expected, 'a file under wonderland/ was added or removed');
});

test('(c) F-21 is intact: refreshes only ask for a rebuild, and Slate\'s pre-tick runs it', () => {
  const cpp = codeOnly(text(CPP));
  const h = codeOnly(text(H));
  for (const name of ['SetSnapshot', 'SetVoice']) {
    const body = bodyOf(cpp, new RegExp(`\\bvoid\\s+SWonderlandSocialHubPanel::${name}\\s*\\([^)]*\\)\\s*\\{`, 'g'));
    assert.match(body, /\bRequestRebuild\s*\(\s*\)/, `${name} must still call RequestRebuild()`);
    assert.doesNotMatch(body, /(?<![\w])Rebuild\s*\(/, `${name} must never rebuild at once`);
  }
  assert.equal(squash(bodyOf(cpp, /\bvoid\s+SWonderlandSocialHubPanel::RequestRebuild\s*\(\s*\)\s*\{/g)), '{ bRebuildPending = true; }');
  assert.equal(squash(bodyOf(cpp, /\bvoid\s+SWonderlandSocialHubPanel::HandleSlatePreTick\s*\(\s*float\s+\w+\s*\)\s*\{/g)), '{ if (bRebuildPending) { Rebuild(); } }');
  assert.equal(squash(bodyOf(cpp, /\bvoid\s+SWonderlandSocialHubPanel::FlushRebuild\s*\(\s*\)\s*\{/g)), '{ if (bRebuildPending) { Rebuild(); } }');
  const construct = squash(bodyOf(cpp, /\bvoid\s+SWonderlandSocialHubPanel::Construct\s*\(\s*const\s+FArguments\s*&\s*\w+\s*\)\s*\{/g));
  assert.ok(construct.includes('OnPreTick().AddSP(this, &SWonderlandSocialHubPanel::HandleSlatePreTick)'), 'Construct must still register the pre-tick');
  const destructor = squash(bodyOf(cpp, /SWonderlandSocialHubPanel::~SWonderlandSocialHubPanel\s*\(\s*\)\s*\{/g));
  assert.ok(destructor.includes('OnPreTick().Remove(SlatePreTickHandle)'), 'the destructor must still remove the pre-tick');
  assert.match(h, /\bFString\s+ReplyDraftConversationId\s*;/, 'ReplyDraftConversationId must remain');
  const rebuild = squash(bodyOf(cpp, /\bvoid\s+SWonderlandSocialHubPanel::Rebuild\s*\(\s*\)\s*\{/g));
  assert.ok(rebuild.includes('ReplyDraftConversationId = OpenConversationId;'), 'Rebuild must still record the draft\'s conversation');
  assert.ok(rebuild.includes('bRebuildPending = false;'), 'Rebuild must still clear the pending request');
});

test('(d) the QA code at the foot of the .cpp is byte for byte the seed\'s', () => {
  const src = bytes(CPP).toString('utf8');
  const starts = src.split('\n').filter((line) => line === QA_REGION_START).length;
  assert.equal(starts, 1, `exactly one line must read "${QA_REGION_START}"`);
  const at = src.indexOf(`\n${QA_REGION_START}\n`) + 1;
  assert.ok(at > 0, 'the QA region\'s first line was not found at a line start');
  assert.equal(sha256(Buffer.from(src.slice(at), 'utf8')), QA_REGION_SHA256, 'the QA code (WonderlandSocialBlockedQa, WonderlandSocialHubClicksQa) was changed');
});

test('(e) both files balance their delimiters, and their #includes are the seed\'s (the .h may add only SScrollBox.h)', () => {
  for (const path of EDITED) {
    const code = codeOnly(text(path));
    const stack = [];
    const pairs = { ')': '(', ']': '[', '}': '{' };
    for (const ch of code) {
      if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
      else if (ch in pairs) assert.equal(stack.pop(), pairs[ch], `${path}: an unbalanced "${ch}"`);
    }
    assert.equal(stack.length, 0, `${path}: ${stack.length} delimiter(s) left open`);
  }
  assert.deepEqual(includesOf(text(CPP)), CPP_INCLUDES, 'the .cpp\'s #includes must be exactly the seed\'s');
  const h = includesOf(text(H));
  for (const want of H_INCLUDES) assert.ok(h.includes(want), `the .h must still include ${want}`);
  for (const got of h) assert.ok(H_INCLUDES.includes(got) || H_INCLUDE_MAY_ADD.includes(got), `the .h may not include ${got}`);
});
